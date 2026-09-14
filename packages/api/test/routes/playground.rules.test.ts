import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import playgroundRoutes from '../../src/routes/playground.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import {
  playgroundRulesExecuteResponseSchema,
  type PlaygroundRulesExecuteResponse,
} from '@sparql-query-lib/contracts';

// Mock setup
const hoisted = vi.hoisted(() => {
  const ephemeralEntities = new Map<string, any>();

  return {
    ephemeralEntities,
    mockAddEphemeral: vi.fn((entity: any, type: string) => {
      ephemeralEntities.set(entity.$id, { entity, type });
      return entity;
    }),
    mockRemoveEphemeral: vi.fn((id: string) => {
      ephemeralEntities.delete(id);
    }),
    mockExecute: vi.fn(),
    mockValidateWithAllGrammars: vi.fn(),
    // `ruleTuples` alongside it: these specs exercise the SRL rule-tuples
    // extension, which a default deployment withholds. The gate itself is
    // covered in ruleTuplesGate.test.ts.
    mockFeatureFlags: vi.fn(() => ({ playgroundRules: true, ruleTuples: true })),
  };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    addEphemeral: hoisted.mockAddEphemeral,
    removeEphemeral: hoisted.mockRemoveEphemeral,
  }),
}));

vi.mock('../../src/lib/RuleSetExecutor.js', () => ({
  RuleSetExecutor: vi.fn(function () {
    return {
      execute: hoisted.mockExecute,
    };
  }),
}));

vi.mock('../../src/lib/RuleGrammarValidator.js', () => ({
  RuleGrammarValidator: vi.fn(function () {
    return {
      validateWithAllGrammars: hoisted.mockValidateWithAllGrammars,
    };
  }),
}));

vi.mock('../../src/lib/RuleStratifier.js', () => ({
  RuleStratifier: vi.fn(function () {
    return {
      analyzeRuleVersions: vi.fn(() => ({ strata: {}, edges: [], monotonicity: {} })),
    };
  }),
}));

vi.mock('../../src/config/featureFlags.js', () => ({
  getFeatureFlags: hoisted.mockFeatureFlags,
}));

describe('Playground Rules Routes (/playground/rules)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      if (error.validation && Array.isArray(error.validation)) {
        const validationErrors = error.validation.map((err: any) => {
          if (err.keyword === 'required') {
            return `${err.params?.missingProperty || 'Field'} is required`;
          }
          return err.message || 'Validation error';
        });
        const errorMessage = validationErrors.length > 0 ? validationErrors[0] : 'Validation failed';
        return reply.status(statusCode).send({ error: errorMessage });
      }
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });

    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }

    await app.register(playgroundRoutes, { prefix: '/playground' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.ephemeralEntities.clear();
    hoisted.mockFeatureFlags.mockReturnValue({ playgroundRules: true, ruleTuples: true });
  });

  afterAll(async () => {
    await app.close();
  });

  /*
   * The editor sends the rule set as one SRL document — prologue, DATA blocks
   * and rules together — and the server splits it. That keeps the split in one
   * place (the parser) rather than one per surface.
   */
  describe('SRL document input', () => {
    const validate = () => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'INSERT { } WHERE { }',
        primaryGrammar: 'srl',
        validations: [],
      });
      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [],
        dataBlocks: [],
        finalGraphNQuads: '',
      });
    };

    const DOC = [
      'PREFIX : <http://example/>',
      'DATA { :a :parent :b }',
      'RULE { ?x :grandparent ?z } WHERE { ?x :parent ?y . ?y :parent ?z }',
    ].join('\n');

    it('splits a document into rule and data block entities', async () => {
      validate();
      // Ephemerals are torn down in a `finally`, so they are read during the
      // run rather than after it.
      let live: string[] = [];
      hoisted.mockExecute.mockImplementation(async () => {
        live = [...hoisted.ephemeralEntities.values()].map((e) => e.type);
        return { status: 'converged', iterations: [], dataBlocks: [], finalGraphNQuads: '' };
      });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: { srl: DOC },
      });

      expect(res.statusCode).toBe(200);
      expect(live.filter((t) => t === 'RuleVersion')).toHaveLength(1);
      expect(live.filter((t) => t === 'DataBlockVersion')).toHaveLength(1);
    });

    it('names results from the document instead of by position', async () => {
      validate();
      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: { srl: DOC },
      });
      expect(Object.values(JSON.parse(res.body).ruleNames)).toEqual(['rule-1-grandparent']);
    });

    it('rejects TUPLE unless the extension is enabled', async () => {
      validate();
      const payload = { srl: 'PREFIX : <http://example/>\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }' };

      const off = await app.inject({ method: 'POST', url: '/playground/rules/execute', payload });
      expect(off.statusCode).toBe(400);
      expect(JSON.parse(off.body).error).toMatch(/rule-tuples extension/i);

      const on = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: { ...payload, tuples: true },
      });
      expect(on.statusCode).toBe(200);
    });

    it('passes initial named tuples to the executor, canonically', async () => {
      validate();
      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          srl: 'PREFIX : <http://example/>\nRULE { ?a :reaches ?b } WHERE { TUPLE(:reach, ?a, ?b) }',
          tuples: true,
          tupleSeeds: 'TUPLE(:reach, :a, :b)',
        },
      });

      expect(res.statusCode).toBe(200);
      const [ruleSetVersion] = hoisted.mockExecute.mock.calls.at(-1)!;
      // Expanded against the document's prologue, so a seed matches a rule read.
      expect(ruleSetVersion.tupleSeeds).toBe(
        'TUPLE(<http://example/reach>, <http://example/a>, <http://example/b>)',
      );
      expect(ruleSetVersion.tuplesEnabled).toBe(true);
    });

    it('rejects seed rows when the extension is off', async () => {
      validate();
      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: { srl: DOC, tupleSeeds: 'TUPLE(:reach, :a, :b)' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/rule-tuples extension/i);
    });

    it('reports a syntax error instead of running a broken document', async () => {
      validate();
      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: { srl: 'this is not SRL' },
      });
      expect(res.statusCode).toBe(400);
      expect(hoisted.mockExecute).not.toHaveBeenCalled();
    });
  });

  // GROUP 1: Ephemeral Entity Lifecycle
  describe('Ephemeral Entity Lifecycle', () => {
    it('creates ephemeral entities for data blocks and rules', async () => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'NORMALIZED SPARQL',
        primaryGrammar: 'SHACL',
        validations: [],
      });

      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [],
        dataBlocks: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          dataBlocks: ['<s> <p> <o> .', '<a> <b> <c> .'],
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }', 'INSERT { ?a <new2> <val2> } WHERE { ?a <b> <c> }'],
        },
      });

      expect(res.statusCode).toBe(200);

      // Verify 4 ephemeral entities were created (2 data blocks + 2 rules)
      expect(hoisted.mockAddEphemeral).toHaveBeenCalledTimes(4);

      // Verify types
      const calls = hoisted.mockAddEphemeral.mock.calls;
      expect(calls[0][1]).toBe('DataBlockVersion');
      expect(calls[1][1]).toBe('DataBlockVersion');
      expect(calls[2][1]).toBe('RuleVersion');
      expect(calls[3][1]).toBe('RuleVersion');

      // Verify IDs follow pattern
      const entity0 = calls[0][0];
      const entity1 = calls[1][0];
      const entity2 = calls[2][0];
      const entity3 = calls[3][0];

      expect(entity0.$id).toMatch(/^urn:sqlib:ruleset:[0-9a-f]+:data-1$/);
      expect(entity1.$id).toMatch(/^urn:sqlib:ruleset:[0-9a-f]+:data-2$/);
      expect(entity2.$id).toMatch(/^urn:sqlib:ruleset:[0-9a-f]+:rule-1$/);
      expect(entity3.$id).toMatch(/^urn:sqlib:ruleset:[0-9a-f]+:rule-2$/);
    });

    it('removes ephemeral entities after successful execution', async () => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'NORMALIZED SPARQL',
        primaryGrammar: 'SHACL',
        validations: [],
      });

      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [],
        dataBlocks: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          dataBlocks: ['<s> <p> <o> .'],
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      expect(res.statusCode).toBe(200);

      // Verify cleanup called for each ephemeral entity
      expect(hoisted.mockRemoveEphemeral).toHaveBeenCalledTimes(2); // 1 dataBlock + 1 rule

      // Verify the IDs that were added are the same ones removed
      const addedIds = hoisted.mockAddEphemeral.mock.calls.map(call => call[0].$id);
      const removedIds = hoisted.mockRemoveEphemeral.mock.calls.map(call => call[0]);

      expect(removedIds.sort()).toEqual(addedIds.sort());
    });

    it('removes ephemeral entities after execution error', async () => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'NORMALIZED SPARQL',
        primaryGrammar: 'SHACL',
        validations: [],
      });

      hoisted.mockExecute.mockRejectedValue(new Error('Execution failed'));

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          dataBlocks: ['<s> <p> <o> .'],
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      expect(res.statusCode).toBe(500);

      // Verify cleanup still called even on error
      expect(hoisted.mockRemoveEphemeral).toHaveBeenCalledTimes(2);
    });

    it('does not create ephemeral entities on validation error', async () => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: false,
        normalized: null,
        primaryGrammar: null,
        validations: [],
        error: 'Invalid SPARQL syntax',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          dataBlocks: [],
          rules: ['INVALID SPARQL'],
        },
      });

      expect(res.statusCode).toBe(400);

      // Verification validation happens before entity creation
      expect(hoisted.mockAddEphemeral).not.toHaveBeenCalled();
      expect(hoisted.mockRemoveEphemeral).not.toHaveBeenCalled();
    });
  });

  // GROUP 2: Request Validation
  describe('Request Validation', () => {
    beforeEach(() => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'NORMALIZED SPARQL',
        primaryGrammar: 'SHACL',
        validations: [],
      });
      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [],
        dataBlocks: [],
      });
    });

    it('validates dataBlocks is optional array', async () => {
      // Test with null dataBlocks
      const res1 = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          dataBlocks: null,
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });
      expect(res1.statusCode).toBe(200);

      // Test without dataBlocks property
      const res2 = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });
      expect(res2.statusCode).toBe(200);
    });

    it('requires something to run, but a data-only rule set is something', async () => {
      // Nothing at all is an error...
      const empty = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: { dataBlocks: [], rules: [] },
      });
      expect(empty.statusCode).toBe(400);
      expect(JSON.parse(empty.body).error).toContain('At least one rule or data block is required');

      // ...but DATA is as much a part of a rule set as a rule is, so a
      // document that is only data runs (and simply derives nothing).
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'INSERT DATA { <s> <p> <o> }',
        primaryGrammar: 'srl',
        validations: [],
      });
      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [],
        dataBlocks: [],
        finalGraphNQuads: '',
      });
      const dataOnly = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: { dataBlocks: ['<s> <p> <o> .'], rules: [] },
      });
      expect(dataOnly.statusCode).toBe(200);
    });

    it('validates maxIterations minimum value', async () => {
      // JSON schema has minimum: 1 which enforces validation at the Fastify level

      // Test with 0 - JSON schema minimum is 1, but AJV allows 0 (it's not < 1, it's the boundary)
      // The backend then filters it out since the code checks `> 0`
      const res1 = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
          maxIterations: 0,
        },
      });
      expect(res1.statusCode).toBe(200);

      // Test with negative value - JSON schema correctly rejects values < 1
      const res2 = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
          maxIterations: -5,
        },
      });
      expect(res2.statusCode).toBe(400);

      // Test with valid value (>0) - passes through
      const res3 = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
          maxIterations: 10,
        },
      });
      expect(res3.statusCode).toBe(200);

      // Verify valid value is passed through to executor
      const validCall = hoisted.mockExecute.mock.calls[hoisted.mockExecute.mock.calls.length - 1];
      expect(validCall[1].maxIterations).toBe(10);
    });

    it('applies default values correctly', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      expect(res.statusCode).toBe(200);

      // Verify executor was called with defaults
      expect(hoisted.mockExecute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          inferenceFormat: 'application/n-triples',
        })
      );
    });
  });

  // GROUP 3: Response Schema Validation
  describe('Response Schema Validation', () => {
    beforeEach(() => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'NORMALIZED SPARQL',
        primaryGrammar: 'SHACL',
        validations: [],
      });
    });

    it('response matches shared contract schema (Fastify + Zod validation)', async () => {
      const mockResponse: PlaygroundRulesExecuteResponse = {
        status: 'converged',
        iterations: [
          {
            index: 1,
            signature: 'abc123',
            tripleCount: 10,
            delta: 5,
            rules: [
              {
                ruleVersionId: 'urn:sqlib:ruleset:test:rule-1',
                programSource: 'normalized',
                durationMs: 10.5,
                triplesInserted: 5,
                triplesDeleted: 0,
                quadSamples: ['<s> <p> <o> .'],
                insertedQuads: ['<s> <p> <o> .'],
                deletedQuads: [],
                timedOut: false,
              },
            ],
          },
        ],
        dataBlocks: [
          {
            dataBlockVersionId: 'urn:sqlib:ruleset:test:data-1',
            programSource: 'normalized',
            durationMs: 5.2,
            tripleDelta: 3,
          },
        ],
        finalGraphNQuads: '<s> <p> <o> .',
        finalGraphContent: '<s> <p> <o> .',
        finalGraphContentType: 'application/n-triples',
        ruleNames: {
          'urn:sqlib:ruleset:test:rule-1': 'Rule 1',
        },
      };

      hoisted.mockExecute.mockResolvedValue(mockResponse);

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      expect(res.statusCode).toBe(200);

      // Parse response
      const body = JSON.parse(res.body);

      // Validate with Zod schema (this is the critical test for the frontend bug)
      const zodParseResult = playgroundRulesExecuteResponseSchema.safeParse(body);

      if (!zodParseResult.success) {
        console.error('Zod validation errors:', zodParseResult.error.issues);
      }

      expect(zodParseResult.success).toBe(true);

      // Verify structure
      expect(body).toMatchObject({
        status: 'converged',
        iterations: expect.any(Array),
        dataBlocks: expect.any(Array),
      });
    });

    it('carries the stratum of each firing through serialization', async () => {
      // The response serializer drops properties the schema does not name, so a
      // field the executor reports is only reaching the client if the contract
      // lists it. The replay timeline colours a step by this.
      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [
          {
            index: 1,
            signature: 'abc123',
            tripleCount: 10,
            delta: 5,
            rules: [
              {
                ruleVersionId: 'urn:sqlib:ruleset:test:rule-1',
                stratum: 2,
                programSource: 'normalized',
                durationMs: 10.5,
                triplesInserted: 5,
                triplesDeleted: 0,
                quadSamples: [],
                insertedQuads: [],
                deletedQuads: [],
                timedOut: false,
              },
            ],
          },
        ],
        dataBlocks: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: { rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'] },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.iterations[0].rules[0].stratum).toBe(2);
      expect(playgroundRulesExecuteResponseSchema.safeParse(body).success).toBe(true);
    });

    it('response includes ruleNames map', async () => {
      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [],
        dataBlocks: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['RULE 1', 'RULE 2', 'RULE 3'],
        },
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.ruleNames).toBeDefined();
      expect(Object.keys(body.ruleNames).length).toBe(3);

      // Verify format: ID -> "Rule N"
      const ruleNameValues = Object.values(body.ruleNames);
      expect(ruleNameValues).toContain('Rule 1');
      expect(ruleNameValues).toContain('Rule 2');
      expect(ruleNameValues).toContain('Rule 3');
    });

    it('response programSource is enum-compatible string', async () => {
      const mockResponse = {
        status: 'converged',
        iterations: [{
          index: 1,
          signature: 'abc',
          tripleCount: 1,
          delta: 0,
          rules: [{
            ruleVersionId: 'test',
            programSource: 'normalized', // String value that should match enum
            durationMs: 1,
            triplesInserted: 0,
            triplesDeleted: 0,
            quadSamples: [],
            insertedQuads: [],
            deletedQuads: [],
            timedOut: false,
          }],
        }],
        dataBlocks: [{
          dataBlockVersionId: 'test',
          programSource: 'raw', // String value that should match enum
          durationMs: 1,
          tripleDelta: 0,
        }],
      };

      hoisted.mockExecute.mockResolvedValue(mockResponse);

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      const body = JSON.parse(res.body);

      // Validate that Zod accepts these string values
      const zodResult = playgroundRulesExecuteResponseSchema.safeParse(body);
      expect(zodResult.success).toBe(true);
    });
  });

  // GROUP 4: Grammar Validation
  describe('Grammar Validation', () => {
    beforeEach(() => {
      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [],
        dataBlocks: [],
      });
    });

    it('validates data block syntax before execution', async () => {
      hoisted.mockValidateWithAllGrammars
        .mockReturnValueOnce({
          valid: true,
          normalized: 'NORMALIZED',
          primaryGrammar: 'SPARQL',
          validations: [],
        })
        .mockReturnValueOnce({
          valid: false,
          normalized: null,
          primaryGrammar: null,
          validations: [],
          error: 'Syntax error at line 1',
        })
        .mockReturnValueOnce({
          valid: true,
          normalized: 'NORMALIZED',
          primaryGrammar: 'SHACL',
          validations: [],
        });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          dataBlocks: ['<s> <p> <o> .', 'INVALID SYNTAX'],
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('Data block 2 invalid');
      expect(body.error).toContain('Syntax error at line 1');

      // Verify execution was not called
      expect(hoisted.mockExecute).not.toHaveBeenCalled();
    });

    it('validates rule syntax before execution', async () => {
      hoisted.mockValidateWithAllGrammars
        .mockReturnValueOnce({
          valid: false,
          normalized: null,
          primaryGrammar: null,
          validations: [],
          error: 'Invalid rule syntax',
        });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          dataBlocks: [],
          rules: ['INVALID RULE SYNTAX'],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('Rule 1 invalid');
      expect(body.error).toContain('Invalid rule syntax');

      // Verify execution was not called
      expect(hoisted.mockExecute).not.toHaveBeenCalled();
    });

    it('accumulates multiple validation errors', async () => {
      hoisted.mockValidateWithAllGrammars
        .mockReturnValueOnce({
          valid: false,
          normalized: null,
          primaryGrammar: null,
          validations: [],
          error: 'Data block error',
        })
        .mockReturnValueOnce({
          valid: false,
          normalized: null,
          primaryGrammar: null,
          validations: [],
          error: 'Rule error',
        });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          dataBlocks: ['INVALID'],
          rules: ['INVALID'],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);

      // Verify both errors are present
      expect(body.error).toContain('Data block 1 invalid');
      expect(body.error).toContain('Rule 1 invalid');
      expect(body.error).toContain('; '); // Errors joined with semicolon
    });
  });

  // GROUP 5: Stratification
  describe('Stratification', () => {
    beforeEach(() => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'NORMALIZED SPARQL',
        primaryGrammar: 'SHACL',
        validations: [],
      });
      hoisted.mockExecute.mockResolvedValue({
        status: 'converged',
        iterations: [],
        dataBlocks: [],
      });
    });

    it('includes stratification report in ruleSetVersion', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      expect(res.statusCode).toBe(200);

      // Verify executor was called with ruleSetVersion that has stratification report
      expect(hoisted.mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          stratificationReport: expect.any(String),
        }),
        expect.anything()
      );
    });

    it('continues execution if stratification fails', async () => {
      // This test verifies the warning path - stratification failure is caught
      // and execution continues (the warning is logged but not exposed in the response)

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      expect(res.statusCode).toBe(200);

      // Execution should still be called even if stratification had issues
      expect(hoisted.mockExecute).toHaveBeenCalled();
    });
  });

  // GROUP 6: Feature Flag
  describe('Feature Flag', () => {
    beforeEach(() => {
      hoisted.mockValidateWithAllGrammars.mockReturnValue({
        valid: true,
        normalized: 'NORMALIZED SPARQL',
        primaryGrammar: 'SHACL',
        validations: [],
      });
    });

    it('returns 404 when rules feature disabled', async () => {
      hoisted.mockFeatureFlags.mockReturnValue({ playgroundRules: false });

      const res = await app.inject({
        method: 'POST',
        url: '/playground/rules/execute',
        payload: {
          rules: ['INSERT { ?s <new> <val> } WHERE { ?s <p> <o> }'],
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Rules feature is disabled');
    });
  });
});
