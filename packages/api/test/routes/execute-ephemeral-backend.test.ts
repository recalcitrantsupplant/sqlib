import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import Fastify, { FastifyInstance } from 'fastify';
import executeRoutes from '../../src/routes/execute.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';

const hoisted = vi.hoisted(() => {
  class MockStore {}
  return {
    MockStore,
    mockCoordinatorGet: vi.fn(),
  };
});

// Mock CacheCoordinatorProvider singleton
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.mockCoordinatorGet,
  }),
}));

vi.mock('oxigraph', () => ({
  Store: hoisted.MockStore,
}));

// Mock OxigraphStoreManager
vi.mock('../../src/lib/OxigraphStoreManager.js', () => {
  const mockStore = {
    query: vi.fn(),
    update: vi.fn(),
    size: 0,
  };

  return {
    oxigraphStoreManager: {
      getPersistentStore: vi.fn(() => null),
      createPersistentStore: vi.fn(async () => new hoisted.MockStore()),
      createEphemeralStore: vi.fn(() => mockStore),
      destroyEphemeralStore: vi.fn(),
    }
  };
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  await app.register(executeRoutes, { prefix: '/execute' });
  await app.ready();
  return app;
}

describe('Execute route - Ephemeral Backend', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    hoisted.mockCoordinatorGet.mockReset();
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should execute CONSTRUCT with empty WHERE against ephemeral backend', async () => {
    const vId = 'urn:sqlib:query-version:construct-empty';
    const queryString = `
      PREFIX ex: <http://example.org/>
      CONSTRUCT { ex:subject ex:predicate ex:object }
      WHERE {}
    `;
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString,
      queryType: QueryTypeIri.construct
    } as any;

    // First call gets the version
    hoisted.mockCoordinatorGet.mockReturnValueOnce(version);

    // Mock Oxigraph store query to return expected quad
    const mockQuads = [{
      subject: { termType: 'NamedNode', value: 'http://example.org/subject' },
      predicate: { termType: 'NamedNode', value: 'http://example.org/predicate' },
      object: { termType: 'NamedNode', value: 'http://example.org/object' },
    }];
    (oxigraphStoreManager.createEphemeralStore as any).mockReturnValue(Object.assign(
      new hoisted.MockStore(),
      {
        query: vi.fn().mockReturnValue(mockQuads),
        size: 0,
      }
    ));

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: {
        targetId: vId,
        backendId: EPHEMERAL_BACKEND_ID
      }
    });

    expect(res.statusCode).toBe(200);
    expect(oxigraphStoreManager.createEphemeralStore).toHaveBeenCalled();
    expect(oxigraphStoreManager.destroyEphemeralStore).toHaveBeenCalled();

    // Verify cleanup was called with a store ID
    const createCall = (oxigraphStoreManager.createEphemeralStore as any).mock.calls[0];
    const destroyCall = (oxigraphStoreManager.destroyEphemeralStore as any).mock.calls[0];
    expect(createCall[0]).toMatch(/^ephemeral-query-/);
    expect(destroyCall[0]).toMatch(/^ephemeral-query-/);
    expect(createCall[0]).toBe(destroyCall[0]); // Same store ID
  });

  it('should execute SELECT with VALUES against ephemeral backend', async () => {
    const vId = 'urn:sqlib:query-version:select-values';
    const queryString = `
      SELECT ?x ?y WHERE {
        VALUES (?x ?y) {
          (1 2)
          (3 4)
        }
      }
    `;
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString,
      queryType: QueryTypeIri.select
    } as any;

    hoisted.mockCoordinatorGet.mockReturnValueOnce(version);

    // Mock Oxigraph store query to return SELECT bindings
    const mockBindings = [
      new Map([
        ['x', { termType: 'Literal', value: '1' }],
        ['y', { termType: 'Literal', value: '2' }]
      ]),
      new Map([
        ['x', { termType: 'Literal', value: '3' }],
        ['y', { termType: 'Literal', value: '4' }]
      ]),
    ];
    (oxigraphStoreManager.createEphemeralStore as any).mockReturnValue(Object.assign(
      new hoisted.MockStore(),
      {
        query: vi.fn().mockReturnValue(mockBindings),
        size: 0,
      }
    ));

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: {
        targetId: vId,
        backendId: EPHEMERAL_BACKEND_ID
      }
    });

    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.payload);
    expect(result.head).toBeDefined();
    expect(result.results).toBeDefined();
    expect(result.results.bindings).toHaveLength(2);

    // Verify cleanup
    expect(oxigraphStoreManager.createEphemeralStore).toHaveBeenCalled();
    expect(oxigraphStoreManager.destroyEphemeralStore).toHaveBeenCalled();
  });

  it('should execute ASK query against ephemeral backend', async () => {
    const vId = 'urn:sqlib:query-version:ask';
    const queryString = 'ASK { ?s ?p ?o }';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString,
      queryType: QueryTypeIri.ask
    } as any;

    hoisted.mockCoordinatorGet.mockReturnValueOnce(version);

    // Mock Oxigraph store query to return boolean
    (oxigraphStoreManager.createEphemeralStore as any).mockReturnValue(Object.assign(
      new hoisted.MockStore(),
      {
        query: vi.fn().mockReturnValue(false),
        size: 0,
      }
    ));

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: {
        targetId: vId,
        backendId: EPHEMERAL_BACKEND_ID
      }
    });

    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.payload);
    expect(result.boolean).toBe(false);

    // Verify cleanup
    expect(oxigraphStoreManager.createEphemeralStore).toHaveBeenCalled();
    expect(oxigraphStoreManager.destroyEphemeralStore).toHaveBeenCalled();
  });

  it('should cleanup ephemeral store even on execution error', async () => {
    const vId = 'urn:sqlib:query-version:error';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select
    } as any;

    hoisted.mockCoordinatorGet.mockReturnValueOnce(version);

    // Mock Oxigraph store query to throw error
    (oxigraphStoreManager.createEphemeralStore as any).mockReturnValue(Object.assign(
      new hoisted.MockStore(),
      {
        query: vi.fn().mockImplementation(() => {
          throw new Error('Invalid SPARQL query');
        }),
        size: 0,
      }
    ));

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: {
        targetId: vId,
        backendId: EPHEMERAL_BACKEND_ID
      }
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    // Verify cleanup still happened despite error
    expect(oxigraphStoreManager.createEphemeralStore).toHaveBeenCalled();
    expect(oxigraphStoreManager.destroyEphemeralStore).toHaveBeenCalled();
  });

  it('should require backendId for Query/QueryVersion execution', async () => {
    const vId = 'urn:sqlib:query-version:test';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select
    } as any;

    hoisted.mockCoordinatorGet.mockReturnValueOnce(version);

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: {
        targetId: vId,
        // No backendId provided
      }
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toContain('backendId is required');
  });
});
