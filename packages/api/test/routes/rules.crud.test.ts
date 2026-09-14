import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import ruleRoutes from '../../src/routes/rules.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

  const hoisted = vi.hoisted(() => {
  const mockRuleValidatorInstance = {
    validateWithAllGrammars: vi.fn().mockReturnValue({
      valid: true,
      normalized: 'INSERT DATA { <a> <b> <c> . }',
      primaryGrammar: 'shacl-rules',
      validations: [],
    }),
  };
  const MockRuleGrammarValidator = vi.fn(function () {
    return mockRuleValidatorInstance;
  });
  return {
    rule: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    ruleVersion: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    coordinatorGet: vi.fn(),
    mockCreateVersion: vi.fn(),
    mockUpdateVersion: vi.fn(),
    mockRuleValidatorInstance,
    MockRuleGrammarValidator,
  };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    Rule: hoisted.rule,
    RuleVersion: hoisted.ruleVersion,
  }),
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
  }),
}));

vi.mock('../../src/lib/RuleVersionWriter.js', () => ({
  createRuleVersion: hoisted.mockCreateVersion,
  annotateRuleVersion: hoisted.mockUpdateVersion,
}));

vi.mock('../../src/lib/RuleGrammarValidator.js', () => ({
  RuleGrammarValidator: hoisted.MockRuleGrammarValidator,
}));

describe('Rules Routes (/rules) - CRUD', () => {
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

    await app.register(ruleRoutes, { prefix: '/rules' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rule.list.mockReset();
    hoisted.rule.get.mockReset();
    hoisted.rule.create.mockReset();
    hoisted.rule.update.mockReset();
    hoisted.rule.delete.mockReset();
    hoisted.ruleVersion.list.mockReset();
    hoisted.ruleVersion.get.mockReset();
    hoisted.ruleVersion.create.mockReset();
    hoisted.ruleVersion.update.mockReset();
    hoisted.ruleVersion.delete.mockReset();
    hoisted.coordinatorGet.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /rules returns rules from cache', async () => {
    const rule = {
      $id: 'urn:sqlib:rule:1',
      '@type': 'Rule',
      name: 'Example Rule',
      isPartOf: ['urn:sqlib:library:lib1'],
      dateModified: '2024-01-07T00:00:00.000Z',
    };
    hoisted.rule.list.mockReturnValue([rule]);

    const res = await app.inject({ method: 'GET', url: '/rules' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: rule.$id,
        name: 'Example Rule',
        isPartOf: ['urn:sqlib:library:lib1'],
        dateModified: '2024-01-07T00:00:00.000Z',
      },
    ]);
  });

  it('POST /rules creates a rule in a library', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const library = { $id: libraryId, '@type': 'Library', name: 'Test Library' };
    const created = {
      $id: 'urn:sqlib:rule:new',
      '@type': 'Rule',
      name: 'New Rule',
      isPartOf: [libraryId],
      dateModified: '2024-01-08T00:00:00.000Z',
    };

    hoisted.coordinatorGet.mockImplementation((iri: string) => (iri === libraryId ? library : null));
    hoisted.rule.create.mockResolvedValue(created);

    const res = await app.inject({
      method: 'POST',
      url: '/rules',
      payload: { name: 'New Rule', isPartOf: libraryId },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: created.$id,
      name: 'New Rule',
      isPartOf: [libraryId],
      dateModified: '2024-01-08T00:00:00.000Z',
    });
    expect(res.headers.etag).toBe('"2024-01-08T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe('Mon, 08 Jan 2024 00:00:00 GMT');
  });

  it('POST /rules requires isPartOf field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rules',
      payload: { name: 'New Rule' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'isPartOf is required' });
  });

  it('POST /rules rejects references to unknown entities', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const library = { $id: libraryId, '@type': 'Library', name: 'Test Library' };

    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === libraryId) return library;
      return null;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/rules',
      payload: { name: 'New Rule', isPartOf: [libraryId, 'urn:sqlib:rule-set:missing'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Referenced entity urn:sqlib:rule-set:missing does not exist' });
  });

  it('GET /rules/:id returns rule details with concurrency headers', async () => {
    const id = 'urn:sqlib:rule:1';
    const rule = {
      $id: id,
      '@type': 'Rule',
      name: 'Example Rule',
      isPartOf: ['urn:sqlib:library:lib1'],
      dateModified: '2024-01-09T00:00:00.000Z',
    };
    hoisted.rule.get.mockReturnValue(rule);

    const res = await app.inject({ method: 'GET', url: `/rules/${encodeURIComponent(id)}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id,
      name: 'Example Rule',
      isPartOf: ['urn:sqlib:library:lib1'],
      dateModified: '2024-01-09T00:00:00.000Z',
    });
    expect(res.headers.etag).toBe('"2024-01-09T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe('Tue, 09 Jan 2024 00:00:00 GMT');
  });

  it('PUT /rules/:id updates metadata and enforces concurrency headers', async () => {
    const id = 'urn:sqlib:rule:1';
    const currentRule = {
      $id: id,
      '@type': 'Rule',
      name: 'Example Rule',
      isPartOf: ['urn:sqlib:library:lib1'],
      dateModified: '2024-01-09T00:00:00.000Z',
    };
    const updatedRule = {
      $id: id,
      '@type': 'Rule',
      name: 'Updated Rule',
      isPartOf: ['urn:sqlib:library:lib1'],
      dateModified: '2024-01-10T00:00:00.000Z',
    };

    hoisted.rule.get.mockImplementation((lookupId: string) => (lookupId === id ? currentRule : null));
    hoisted.rule.update.mockResolvedValue(updatedRule);

    const res = await app.inject({
      method: 'PUT',
      url: `/rules/${encodeURIComponent(id)}`,
      payload: { name: 'Updated Rule' },
      headers: { 'if-match': currentRule.dateModified },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id,
      name: 'Updated Rule',
      isPartOf: ['urn:sqlib:library:lib1'],
      dateModified: '2024-01-10T00:00:00.000Z',
    });
    expect(res.headers.etag).toBe('"2024-01-10T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe('Wed, 10 Jan 2024 00:00:00 GMT');
  });

  it('PUT /rules/:id rejects outdated ETags', async () => {
    const id = 'urn:sqlib:rule:1';
    const currentRule = {
      $id: id,
      '@type': 'Rule',
      name: 'Example Rule',
      isPartOf: ['urn:sqlib:library:lib1'],
      dateModified: '2024-01-09T00:00:00.000Z',
    };
    hoisted.rule.get.mockReturnValue(currentRule);

    const res = await app.inject({
      method: 'PUT',
      url: `/rules/${encodeURIComponent(id)}`,
      payload: { name: 'Updated Rule' },
      headers: { 'if-match': '"outdated-tag"' },
    });

    expect(res.statusCode).toBe(412);
    expect(res.json()).toMatchObject({
      error: 'Precondition Failed',
      expected: '2024-01-09T00:00:00.000Z',
    });
  });

  it('POST /rules/:id/versions creates a rule version via writer', async () => {
    const id = 'urn:sqlib:rule:1';
    const parent = {
      $id: id,
      '@type': 'Rule',
      name: 'Example Rule',
      isPartOf: ['urn:sqlib:library:lib1'],
    };
    const payloadRule = 'RULE { ?s ?p ?o } WHERE { ?s ?p ?o }';
    const createdVersion = {
      $id: 'urn:sqlib:rule-version:1',
      '@type': 'RuleVersion',
      isPartOf: id,
      version: 1,
      ruleString: payloadRule,
      normalizedInsert: 'INSERT DATA { <a> <b> <c> . }',
      comment: 'Initial version',
      defaultBackend: null,
      dateModified: '2024-01-11T00:00:00.000Z',
    };

    hoisted.rule.get.mockReturnValue(parent);
    hoisted.mockCreateVersion.mockResolvedValue(createdVersion);

    const res = await app.inject({
      method: 'POST',
      url: `/rules/${encodeURIComponent(id)}/versions`,
      payload: { ruleString: payloadRule, comment: 'Initial version' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: createdVersion.$id,
      isPartOf: id,
      version: 1,
      ruleString: payloadRule,
      normalizedInsert: 'INSERT DATA { <a> <b> <c> . }',
      comment: 'Initial version',
      defaultBackend: null,
      dateModified: '2024-01-11T00:00:00.000Z',
    });
    expect(res.headers.etag).toBe('"2024-01-11T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe('Thu, 11 Jan 2024 00:00:00 GMT');
    expect(hoisted.mockCreateVersion).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        ruleString: payloadRule,
        comment: 'Initial version',
        defaultBackend: null,
        allowInvalidSave: false,
      }),
    );
  });

  it('POST /rules/:id/versions forwards immutable flag', async () => {
    const id = 'urn:sqlib:rule:1';
    const parent = { $id: id, '@type': 'Rule' };
    const payloadRule = 'RULE { ?s ?p ?o } WHERE { ?s ?p ?o }';
    hoisted.rule.get.mockReturnValue(parent);
    hoisted.mockCreateVersion.mockResolvedValue({ $id: 'urn:sqlib:rule-version:1', '@type': 'RuleVersion', isPartOf: id, version: 1, immutable: true, ruleString: payloadRule });

    const res = await app.inject({
      method: 'POST',
      url: `/rules/${encodeURIComponent(id)}/versions`,
      payload: { ruleString: payloadRule, immutable: true },
    });

    expect(res.statusCode).toBe(201);
    expect(hoisted.mockCreateVersion).toHaveBeenCalledWith(id, expect.objectContaining({ immutable: true }));
  });

  it('POST /rules/:id/versions rejects invalid rule strings', async () => {
    const id = 'urn:sqlib:rule:1';
    hoisted.rule.get.mockReturnValue({ $id: id, '@type': 'Rule' });
    hoisted.mockRuleValidatorInstance.validateWithAllGrammars.mockReturnValueOnce({
      valid: false,
      error: 'Invalid SPARQL-RL rule syntax',
      validations: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/rules/${encodeURIComponent(id)}/versions`,
      payload: { ruleString: 'PREFIX ex: <http://example.com/>' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid SPARQL-RL rule syntax' });
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  it('POST /rules/:id/versions returns 404 when rule missing', async () => {
    hoisted.rule.get.mockReturnValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/rules/urn%3Asqlib%3Arule%3Amissing/versions',
      payload: { ruleString: 'RULE { ?s ?p ?o } WHERE { ?s ?p ?o }' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Rule not found' });
  });

  it('DELETE /rules/:id cascading deletes rule and all versions', async () => {
    const id = 'urn:sqlib:rule:1';
    const rule = { $id: id, '@type': 'Rule', name: 'Example Rule' };
    const version1 = { $id: 'urn:sqlib:rule-version:1', '@type': 'RuleVersion', isPartOf: id, version: 1 };
    const version2 = { $id: 'urn:sqlib:rule-version:2', '@type': 'RuleVersion', isPartOf: id, version: 2 };

    hoisted.rule.get.mockReturnValue(rule);
    hoisted.ruleVersion.list.mockReturnValue([version1, version2]);
    hoisted.ruleVersion.delete.mockResolvedValue(undefined);
    hoisted.rule.delete.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: `/rules/${encodeURIComponent(id)}` });

    expect(res.statusCode).toBe(204);
    expect(hoisted.ruleVersion.delete).toHaveBeenCalledTimes(2);
    expect(hoisted.ruleVersion.delete).toHaveBeenCalledWith(version1.$id);
    expect(hoisted.ruleVersion.delete).toHaveBeenCalledWith(version2.$id);
    expect(hoisted.rule.delete).toHaveBeenCalledWith(id);
  });

  it('DELETE /rules/:id deletes rule when no versions exist', async () => {
    const id = 'urn:sqlib:rule:1';
    const rule = { $id: id, '@type': 'Rule', name: 'Example Rule' };
    hoisted.rule.get.mockReturnValue(rule);
    hoisted.ruleVersion.list.mockReturnValue([]);
    hoisted.rule.delete.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: `/rules/${encodeURIComponent(id)}` });

    expect(res.statusCode).toBe(204);
    expect(hoisted.rule.delete).toHaveBeenCalledWith(id);
  });

  it('DELETE /rules/:id/versions/:version deletes specific version', async () => {
    const id = 'urn:sqlib:rule:1';
    const parent = { $id: id, '@type': 'Rule', name: 'Example Rule' };
    const version = { $id: 'urn:sqlib:rule-version:1', '@type': 'RuleVersion', isPartOf: id, version: 1 };

    hoisted.rule.get.mockReturnValue(parent);
    hoisted.ruleVersion.list.mockReturnValue([version]);
    hoisted.ruleVersion.delete.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: `/rules/${encodeURIComponent(id)}/versions/1` });

    expect(res.statusCode).toBe(204);
    expect(hoisted.ruleVersion.delete).toHaveBeenCalledWith(version.$id);
  });

  it('DELETE /rules/:id/versions/:version returns 404 when version not found', async () => {
    const id = 'urn:sqlib:rule:1';
    const parent = { $id: id, '@type': 'Rule', name: 'Example Rule' };

    hoisted.rule.get.mockReturnValue(parent);
    hoisted.ruleVersion.list.mockReturnValue([]);

    const res = await app.inject({ method: 'DELETE', url: `/rules/${encodeURIComponent(id)}/versions/99` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Rule version not found' });
  });

  it('DELETE /rules/:id/versions/:version returns 404 when parent not found', async () => {
    hoisted.rule.get.mockReturnValue(null);

    const res = await app.inject({ method: 'DELETE', url: '/rules/urn%3Asqlib%3Arule%3Amissing/versions/1' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Rule not found' });
  });

  it('PATCH /rules/:id/versions/:version refuses a content change', async () => {
    // A version is a snapshot (issue #192): a rule set version that names this
    // one was stratified against exactly this rule text.
    const id = 'urn:sqlib:rule:1';
    const parent = { $id: id, '@type': 'Rule', name: 'Example Rule' };
    const version = { $id: 'urn:sqlib:rule-version:1', '@type': 'RuleVersion', isPartOf: id, version: 1, immutable: true };
    hoisted.rule.get.mockReturnValue(parent);
    hoisted.ruleVersion.list.mockReturnValue([version]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/rules/${encodeURIComponent(id)}/versions/1`,
      payload: { ruleString: 'INSERT DATA {}' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual(['ruleString']);
    expect(hoisted.mockUpdateVersion).not.toHaveBeenCalled();
  });

  // This route had no coverage and its registration was rewritten to go through
  // `typedRoute` — these pin both halves of what that has to preserve: the
  // handler still runs, and the body schema is still registered and enforced.
  it('POST /rules/preview/normalize returns the normalized insert', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rules/preview/normalize',
      payload: { ruleString: 'INSERT DATA { <a> <b> <c> }' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      normalizedInsert: 'INSERT DATA { <a> <b> <c> . };',
      primaryGrammar: 'shacl-rules',
    });
  });

  it('POST /rules/preview/normalize rejects a body missing ruleString', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rules/preview/normalize',
      payload: { nope: 1 },
    });

    expect(res.statusCode).toBe(400);
  });
  // Phase C3 (issue #65): the create and update bodies are now the projection
  // every other entity gets, generated from RuleSchema, instead of the literals
  // this module used to declare. These pin the four places where that changes
  // what the endpoint accepts — each one a disagreement with the schema the web
  // app validates against, which is how they were found. See
  // test/contracts/web-leaf-parity.test.ts.
  describe('body schemas projected from the entity model', () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const library = { $id: libraryId, '@type': 'Library', name: 'Test Library' };

    it('POST /rules accepts a client-minted id, as every other create does', async () => {
      hoisted.coordinatorGet.mockImplementation((iri: string) => (iri === libraryId ? library : null));
      hoisted.rule.create.mockResolvedValue({
        $id: 'urn:temp:rule:1',
        '@type': 'Rule',
        name: 'New Rule',
        isPartOf: [libraryId],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/rules',
        payload: { id: 'urn:temp:rule:1', name: 'New Rule', isPartOf: libraryId },
      });

      expect(res.statusCode).toBe(201);
    });

    it('PUT /rules/:id rejects an empty body instead of writing nothing', async () => {
      const res = await app.inject({ method: 'PUT', url: '/rules/urn:sqlib:rule:1', payload: {} });

      expect(res.statusCode).toBe(400);
      expect(hoisted.rule.update).not.toHaveBeenCalled();
    });

    it('PUT /rules/:id refuses to null out the required name', async () => {
      // ajv coerces `null` to `''` for a string property, so what rejects this
      // is the `minLength: 1` the entity model now carries (Phase C3) — before
      // it, the null became an empty name and was written.
      const res = await app.inject({
        method: 'PUT',
        url: '/rules/urn:sqlib:rule:1',
        payload: { name: null },
      });

      expect(res.statusCode).toBe(400);
      expect(hoisted.rule.update).not.toHaveBeenCalled();
    });

    it('POST /rules rejects an empty name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rules',
        payload: { name: '', isPartOf: 'urn:sqlib:library:lib1' },
      });

      expect(res.statusCode).toBe(400);
      expect(hoisted.rule.create).not.toHaveBeenCalled();
    });

    it('PUT /rules/:id rejects `comment`, which no predicate stored', async () => {
      // The old literal accepted it and passed it to the repository, where
      // RuleSchema has no `comment` and it was dropped. Rule *versions* have
      // one; rules do not.
      const res = await app.inject({
        method: 'PUT',
        url: '/rules/urn:sqlib:rule:1',
        payload: { comment: 'note' },
      });

      expect(res.statusCode).toBe(400);
      expect(hoisted.rule.update).not.toHaveBeenCalled();
    });
  });
});
