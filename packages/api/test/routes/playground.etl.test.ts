import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import playgroundRoutes from '../../src/routes/playground.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import type { AuthContext } from '../../src/auth/types.js';

const hoisted = vi.hoisted(() => {
  class MockStore {}
  const ephemeralEntities = new Map<string, any>();

  return {
    MockStore,
    ephemeralEntities,
    mockAddEphemeral: vi.fn((entity: any, type: string) => {
      ephemeralEntities.set(entity.$id, { entity, type });
      return entity;
    }),
    mockRemoveEphemeral: vi.fn((id: string) => {
      ephemeralEntities.delete(id);
    }),
    mockFeatureFlags: vi.fn(() => ({ playgroundEtl: true })),
    mockStreamChunks: vi.fn(),
    mockApplyArguments: vi.fn(),
    mockGetExecutorForBackendId: vi.fn(),
    mockConstructQueryParsed: vi.fn(),
    mockConvertRowsToBindings: vi.fn(),
    mockCreateEphemeralStore: vi.fn(),
    mockDestroyEphemeralStore: vi.fn(),
  };
});

vi.mock('oxigraph', () => ({
  Store: hoisted.MockStore,
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    addEphemeral: hoisted.mockAddEphemeral,
    removeEphemeral: hoisted.mockRemoveEphemeral,
  }),
}));

vi.mock('../../src/config/featureFlags.js', () => ({
  getFeatureFlags: hoisted.mockFeatureFlags,
}));

vi.mock('../../src/lib/DuckDbService.js', () => ({
  duckDbService: {
    streamChunks: hoisted.mockStreamChunks,
  },
}));

vi.mock('../../src/lib/parser.js', () => ({
  SparqlQueryParser: vi.fn(function () {
    return {
      applyArguments: hoisted.mockApplyArguments,
    };
  }),
}));

vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: vi.fn(function () {
    return {
      getExecutorForBackendId: hoisted.mockGetExecutorForBackendId,
    };
  }),
}));

vi.mock('../../src/lib/EtlService.js', () => ({
  etlService: {
    convertRowsToBindings: hoisted.mockConvertRowsToBindings,
  },
}));

vi.mock('../../src/lib/OxigraphStoreManager.js', () => ({
  oxigraphStoreManager: {
    createEphemeralStore: hoisted.mockCreateEphemeralStore,
    destroyEphemeralStore: hoisted.mockDestroyEphemeralStore,
    getPersistentStore: vi.fn(() => null),
    createPersistentStore: vi.fn(async () => new hoisted.MockStore()),
  },
}));

vi.mock('../../src/server/OxigraphSparqlExecutor.js', () => ({
  OxigraphSparqlExecutor: vi.fn(function () {
    return {
      constructQueryParsed: hoisted.mockConstructQueryParsed,
    };
  }),
}));

describe('Playground ETL Routes (/playground/etl)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    app.setErrorHandler((error, _request, reply) => {
      const statusCode = error.statusCode || 500;
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
    hoisted.mockFeatureFlags.mockReturnValue({ playgroundEtl: true });

    hoisted.mockStreamChunks.mockImplementation(async function* () {
      yield {
        rows: [{ name: 'Alice' }],
        timing: { totalMs: 0, initMs: 0, connectionMs: 0, queryMs: 0, serializeMs: 0 },
      };
    });
    hoisted.mockConvertRowsToBindings.mockReturnValue([
      { name: { type: 'literal', value: 'Alice' } },
    ]);
    hoisted.mockApplyArguments.mockReturnValue('CONSTRUCT {} WHERE {}');
    hoisted.mockConstructQueryParsed.mockResolvedValue({ result: '<s> <p> <o> .' });
    hoisted.mockGetExecutorForBackendId.mockResolvedValue({
      constructQueryParsed: hoisted.mockConstructQueryParsed,
    });
    hoisted.mockCreateEphemeralStore.mockReturnValue(new hoisted.MockStore());
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and cleans up ephemeral ETL entities', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/playground/etl/execute',
      payload: {
        sql: "SELECT 'Alice' AS name",
        sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?name) { (UNDEF) } }',
        backendId: 'test-backend',
        columns: [
          { columnName: 'name', targetVariable: '?name', termType: 'literal', nullPolicy: 'undef' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('completed');
    expect(body.rdfOutput).toContain('<s> <p> <o>');

    expect(hoisted.mockAddEphemeral).toHaveBeenCalledTimes(3);
    expect(hoisted.mockRemoveEphemeral).toHaveBeenCalledTimes(3);

    const addedIds = hoisted.mockAddEphemeral.mock.calls.map((call) => call[0].$id);
    const removedIds = hoisted.mockRemoveEphemeral.mock.calls.map((call) => call[0]);
    expect(removedIds.sort()).toEqual(addedIds.sort());
  });

  it('cleans up ephemeral entities on execution failure', async () => {
    hoisted.mockConstructQueryParsed.mockRejectedValueOnce(new Error('boom'));

    const res = await app.inject({
      method: 'POST',
      url: '/playground/etl/execute',
      payload: {
        sql: "SELECT 'Alice' AS name",
        sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?name) { (UNDEF) } }',
        backendId: 'test-backend',
        columns: [
          { columnName: 'name', targetVariable: '?name', termType: 'literal', nullPolicy: 'undef' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toContain('boom');

    expect(hoisted.mockRemoveEphemeral).toHaveBeenCalledTimes(3);
  });

  it('uses an ephemeral Oxigraph store when backendId is EPHEMERAL_BACKEND_ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/playground/etl/execute',
      payload: {
        sql: "SELECT 'Alice' AS name",
        sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?name) { (UNDEF) } }',
        backendId: EPHEMERAL_BACKEND_ID,
        columns: [
          { columnName: 'name', targetVariable: '?name', termType: 'literal', nullPolicy: 'undef' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('completed');

    expect(hoisted.mockCreateEphemeralStore).toHaveBeenCalledTimes(1);
    expect(hoisted.mockDestroyEphemeralStore).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGetExecutorForBackendId).not.toHaveBeenCalled();
  });

  it('returns 404 when feature flag disabled', async () => {
    hoisted.mockFeatureFlags.mockReturnValue({ playgroundEtl: false });

    const res = await app.inject({
      method: 'POST',
      url: '/playground/etl/execute',
      payload: {
        sql: 'SELECT 1',
        sparqlTemplate: 'CONSTRUCT {} WHERE {}',
        backendId: 'test-backend',
        columns: [
          { columnName: 'x', targetVariable: 'x', termType: 'literal', nullPolicy: 'undef' },
        ],
      },
    });

    expect(res.statusCode).toBe(404);
  });

  /*
   * Issue #132 §4d. The other playground routes take a query or a rule set and
   * run it somewhere the caller may already reach; this one takes arbitrary
   * DuckDB SQL, which is a host filesystem read primitive. So the bar is
   * administrator, not merely authenticated — a principal with every grant on
   * every library still does not get one.
   */
  describe('arbitrary SQL is administrator-only', () => {
    const PAYLOAD = {
      sql: "SELECT 'Alice' AS name",
      sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?name) { (UNDEF) } }',
      backendId: EPHEMERAL_BACKEND_ID,
      columns: [
        { columnName: 'name', targetVariable: '?name', termType: 'literal', nullPolicy: 'undef' },
      ],
    };

    /** A running app whose every request carries the given auth context. */
    async function appAs(context: AuthContext): Promise<FastifyInstance> {
      const instance = Fastify({ logger: false });
      setupValidator(instance);
      instance.setErrorHandler((error, _request, reply) => {
        reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: error.message });
      });
      for (const schema of Object.values(schemas)) {
        if (schema && typeof schema === 'object' && '$id' in schema) instance.addSchema(schema);
      }
      instance.decorateRequest('authContext', undefined);
      instance.addHook('onRequest', async request => {
        request.authContext = context;
      });
      await instance.register(playgroundRoutes, { prefix: '/playground' });
      await instance.ready();
      return instance;
    }

    const contextWith = (admin: boolean): AuthContext => ({
      subject: 'urn:sqlib:principal:user:someone',
      principals: ['urn:sqlib:principal:user:someone'],
      issuer: 'https://issuer.test/',
      tokenType: 'user',
      grants: { admin, libraries: new Map(), backends: new Map() },
      claims: {},
      fullAccess: false,
      mode: 'required',
    });

    it('refuses a non-administrator in required mode', async () => {
      const instance = await appAs(contextWith(false));
      const res = await instance.inject({ method: 'POST', url: '/playground/etl/execute', payload: PAYLOAD });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/Administrator access is required/i);
      // Refused before the SQL reached DuckDB, not after.
      expect(hoisted.mockStreamChunks).not.toHaveBeenCalled();
      await instance.close();
    });

    it('admits an administrator', async () => {
      const instance = await appAs(contextWith(true));
      const res = await instance.inject({ method: 'POST', url: '/playground/etl/execute', payload: PAYLOAD });

      expect(res.statusCode).toBe(200);
      await instance.close();
    });

    // With auth off there is no principal to be an administrator, and the
    // context carries full access — which is why the ETL feature flag ships off
    // rather than this route being the only thing standing in the way.
    it('is a no-op with auth disabled', async () => {
      const res = await app.inject({ method: 'POST', url: '/playground/etl/execute', payload: PAYLOAD });
      expect(res.statusCode).toBe(200);
    });
  });
});
