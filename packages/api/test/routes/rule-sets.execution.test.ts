import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import ruleSetRoutes from '../../src/routes/rule-sets.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockExecutorCtor = vi.fn(function () {
    return {
      execute: mockExecute,
    };
  });

  return {
    ruleSet: {
      get: vi.fn(),
    },
    ruleSetVersion: {
      list: vi.fn(),
    },
    mockExecute,
    mockExecutorCtor,
  };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    RuleSet: hoisted.ruleSet,
    RuleSetVersion: hoisted.ruleSetVersion,
  }),
}));

vi.mock('../../src/lib/RuleSetExecutor.js', () => ({
  RuleSetExecutor: hoisted.mockExecutorCtor,
}));

describe('RuleSets Routes (/rule-sets) - Execution', () => {
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

    await app.register(ruleSetRoutes, { prefix: '/rule-sets' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('executes the current version when none requested', async () => {
    const ruleSetId = 'urn:sqlib:rule-set:abc';
    const versionOne = {
      $id: 'urn:sqlib:rule-set-version:1',
      isPartOf: ruleSetId,
      version: 1,
    };
    const currentVersion = {
      $id: 'urn:sqlib:rule-set-version:2',
      isPartOf: ruleSetId,
      version: 2,
    };
    const parentRuleSet = {
      $id: ruleSetId,
      '@type': 'RuleSet',
      name: 'Example Rule Set',
      currentVersion: currentVersion.$id,
    };
    const executionResult = {
      status: 'converged',
      iterations: [],
      dataBlocks: [],
    };

    hoisted.ruleSet.get.mockImplementation((id: string) => (id === ruleSetId ? parentRuleSet : null));
    hoisted.ruleSetVersion.list.mockReturnValue([versionOne, currentVersion]);
    hoisted.mockExecute.mockResolvedValue(executionResult);

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(ruleSetId)}/execute`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(executionResult);
    expect(hoisted.mockExecutorCtor).toHaveBeenCalledTimes(1);
    // `tupleSeeds: null` means "run the seeds the version stored", which is what
    // a request naming no tuples has always done.
    expect(hoisted.mockExecute).toHaveBeenCalledWith(currentVersion, { inferenceFormat: 'application/n-triples', maxIterations: undefined, initialGraph: null, initialGraphFormat: null, tupleSeeds: null });
  });

  it('executes the requested version with custom maxIterations', async () => {
    const ruleSetId = 'urn:sqlib:rule-set:def';
    const requestedVersion = {
      $id: 'urn:sqlib:rule-set-version:1',
      isPartOf: ruleSetId,
      version: 1,
    };
    const parentRuleSet = {
      $id: ruleSetId,
      '@type': 'RuleSet',
      name: 'Another Rule Set',
      currentVersion: null,
    };
    const executionResult = {
      status: 'maxIterations',
      iterations: [],
      dataBlocks: [],
      maxIterations: 5,
    };

    hoisted.ruleSet.get.mockImplementation((id: string) => (id === ruleSetId ? parentRuleSet : null));
    hoisted.ruleSetVersion.list.mockReturnValue([requestedVersion]);
    hoisted.mockExecute.mockResolvedValue(executionResult);

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(ruleSetId)}/execute`,
      payload: { version: 1, maxIterations: 5 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(executionResult);
    expect(hoisted.mockExecute).toHaveBeenCalledWith(requestedVersion, { maxIterations: 5, inferenceFormat: 'application/n-triples', initialGraph: null, initialGraphFormat: null, tupleSeeds: null });
  });

  it('returns 404 when the rule set is missing', async () => {
    const ruleSetId = 'urn:sqlib:rule-set:missing';
    hoisted.ruleSet.get.mockReturnValue(null);
    hoisted.ruleSetVersion.list.mockReturnValue([]);

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(ruleSetId)}/execute`,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Rule set not found' });
    expect(hoisted.mockExecute).not.toHaveBeenCalled();
  });

  it('returns 404 when the rule set has no versions', async () => {
    const ruleSetId = 'urn:sqlib:rule-set:empty';
    const parentRuleSet = {
      $id: ruleSetId,
      '@type': 'RuleSet',
      name: 'Empty Rule Set',
    };

    hoisted.ruleSet.get.mockReturnValue(parentRuleSet);
    hoisted.ruleSetVersion.list.mockReturnValue([]);

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(ruleSetId)}/execute`,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Rule set has no versions to execute' });
    expect(hoisted.mockExecute).not.toHaveBeenCalled();
  });

  it('returns 404 when a requested version is not found', async () => {
    const ruleSetId = 'urn:sqlib:rule-set:abc';
    const parentRuleSet = {
      $id: ruleSetId,
      '@type': 'RuleSet',
      name: 'Example Rule Set',
    };
    const availableVersion = {
      $id: 'urn:sqlib:rule-set-version:2',
      isPartOf: ruleSetId,
      version: 2,
    };

    hoisted.ruleSet.get.mockReturnValue(parentRuleSet);
    hoisted.ruleSetVersion.list.mockReturnValue([availableVersion]);

    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(ruleSetId)}/execute`,
      payload: { version: 5 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Rule set version 5 not found' });
    expect(hoisted.mockExecute).not.toHaveBeenCalled();
  });
});
