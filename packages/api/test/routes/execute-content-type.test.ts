import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import Fastify, { FastifyInstance } from 'fastify';
import executeRoutes from '../../src/routes/execute.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';

const hoisted = vi.hoisted(() => ({
  mockCoordinatorGet: vi.fn(),
}));

// Mock CacheCoordinatorProvider singleton
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.mockCoordinatorGet,
  }),
}));

// Mock HttpSparqlExecutor
vi.mock('../../src/server/HttpSparqlExecutor');
import { HttpSparqlExecutor } from '../../src/server/HttpSparqlExecutor.js';
const MockHttpSparqlExecutor = HttpSparqlExecutor as any;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  await app.register(executeRoutes, { prefix: '/execute' });
  await app.ready();
  return app;
}

describe('Execute route - Content-Type header propagation', () => {
  let app: FastifyInstance;
  let testCounter = 0;

  const createBackend = () => ({
    $id: `urn:sqlib:backend:svc-${++testCounter}`,
    '@type': 'Backend',
    name: 'TestBackend',
    backendType: BackendTypeIri.http,
    endpoint: 'http://example.org/sparql',
  } as any);

  beforeEach(async () => {
    hoisted.mockCoordinatorGet.mockReset();
    MockHttpSparqlExecutor.mockReset();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should propagate Content-Type header from backend for SELECT query', async () => {
    const backend = createBackend();
    const qId = 'urn:sqlib:query:select1';
    const vId = 'urn:sqlib:query-version:v1';
    const query = { $id: qId, '@type': 'Query', name: 'SelectQuery', currentVersion: vId } as any;
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      isPartOf: qId,
      version: 1,
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select
    } as any;

    hoisted.mockCoordinatorGet.mockImplementation((id: string) => {
      if (id === qId) return query;
      if (id === backend.$id) return backend;
      if (id === vId) return version;
      return null;
    });

    const mockSelectResult = {
      result: { head: { vars: ['s', 'p', 'o'] }, results: { bindings: [] } },
      duration: 10,
      contentType: 'application/sparql-results+json; charset=utf-8'
    };
    const mockSelect = vi.fn().mockResolvedValue(mockSelectResult);
    MockHttpSparqlExecutor.mockImplementation(function () {
      return {
        selectQueryParsed: mockSelect,
        constructQueryParsed: vi.fn(),
        askQuery: vi.fn(),
        update: vi.fn()
      };
    });

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: qId, backendId: backend.$id }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/sparql-results+json; charset=utf-8');
  });

  it('should use default Content-Type for SELECT when backend does not return one', async () => {
    const backend = createBackend();
    const vId = 'urn:sqlib:query-version:v2';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select
    } as any;

    hoisted.mockCoordinatorGet.mockImplementation((id: string) => {
      if (id === vId) return version;
      if (id === backend.$id) return backend;
      return null;
    });

    const mockSelectResult = {
      result: { head: { vars: ['s'] }, results: { bindings: [] } },
      duration: 5
      // No contentType field
    };
    const mockSelect = vi.fn().mockResolvedValue(mockSelectResult);
    MockHttpSparqlExecutor.mockImplementation(function () {
      return {
        selectQueryParsed: mockSelect,
        constructQueryParsed: vi.fn(),
        askQuery: vi.fn(),
        update: vi.fn()
      };
    });

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: vId, backendId: backend.$id }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/sparql-results+json');
  });

  it('should propagate Content-Type header from backend for CONSTRUCT query', async () => {
    const backend = createBackend();
    const vId = 'urn:sqlib:query-version:construct1';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.construct
    } as any;

    hoisted.mockCoordinatorGet.mockImplementation((id: string) => {
      if (id === vId) return version;
      if (id === backend.$id) return backend;
      return null;
    });

    const mockConstructResult = {
      result: '@prefix ex: <http://example.org/> . ex:s ex:p ex:o .',
      duration: 12,
      contentType: 'text/turtle'
    };
    const mockConstruct = vi.fn().mockResolvedValue(mockConstructResult);
    MockHttpSparqlExecutor.mockImplementation(function () {
      return {
        selectQueryParsed: vi.fn(),
        constructQueryParsed: mockConstruct,
        askQuery: vi.fn(),
        update: vi.fn()
      };
    });

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: vId, backendId: backend.$id }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/turtle');
  });

  it('should use default Content-Type for CONSTRUCT when backend does not return one', async () => {
    const backend = createBackend();
    const vId = 'urn:sqlib:query-version:construct2';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.construct
    } as any;

    hoisted.mockCoordinatorGet.mockImplementation((id: string) => {
      if (id === vId) return version;
      if (id === backend.$id) return backend;
      return null;
    });

    const mockConstructResult = {
      result: '<http://ex.org/s> <http://ex.org/p> <http://ex.org/o> .',
      duration: 8
      // No contentType field
    };
    const mockConstruct = vi.fn().mockResolvedValue(mockConstructResult);
    MockHttpSparqlExecutor.mockImplementation(function () {
      return {
        selectQueryParsed: vi.fn(),
        constructQueryParsed: mockConstruct,
        askQuery: vi.fn(),
        update: vi.fn()
      };
    });

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: vId, backendId: backend.$id }
    });

    expect(res.statusCode).toBe(200);
    // Default Accept header for CONSTRUCT is text/turtle, which is used when backend doesn't return content-type
    expect(res.headers['content-type']).toContain('text/turtle');
  });

  it('should propagate Content-Type header from backend for ASK query', async () => {
    const backend = createBackend();
    const vId = 'urn:sqlib:query-version:ask1';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString: 'ASK { ?s ?p ?o }',
      queryType: QueryTypeIri.ask
    } as any;

    hoisted.mockCoordinatorGet.mockImplementation((id: string) => {
      if (id === vId) return version;
      if (id === backend.$id) return backend;
      return null;
    });

    const mockAskResult = {
      result: true,
      duration: 3,
      contentType: 'application/sparql-results+json'
    };
    const mockAsk = vi.fn().mockResolvedValue(mockAskResult);
    MockHttpSparqlExecutor.mockImplementation(function () {
      return {
        selectQueryParsed: vi.fn(),
        constructQueryParsed: vi.fn(),
        askQuery: mockAsk,
        update: vi.fn()
      };
    });

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: vId, backendId: backend.$id }
    });

    expect(res.statusCode).toBe(200);
    // Fastify may add charset, so check it starts with the expected content-type
    expect(res.headers['content-type']).toContain('application/sparql-results+json');
  });

  it('should use default Content-Type for ASK when backend does not return one', async () => {
    const backend = createBackend();
    const vId = 'urn:sqlib:query-version:ask2';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString: 'ASK { ?s ?p ?o }',
      queryType: QueryTypeIri.ask
    } as any;

    hoisted.mockCoordinatorGet.mockImplementation((id: string) => {
      if (id === vId) return version;
      if (id === backend.$id) return backend;
      return null;
    });

    const mockAskResult = {
      result: false,
      duration: 2
      // No contentType field
    };
    const mockAsk = vi.fn().mockResolvedValue(mockAskResult);
    MockHttpSparqlExecutor.mockImplementation(function () {
      return {
        selectQueryParsed: vi.fn(),
        constructQueryParsed: vi.fn(),
        askQuery: mockAsk,
        update: vi.fn()
      };
    });

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: vId, backendId: backend.$id }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/sparql-results+json');
  });

  it('should respect Accept header fallback for CONSTRUCT when no content-type from backend', async () => {
    const backend = createBackend();
    const vId = 'urn:sqlib:query-version:construct3';
    const version = {
      $id: vId,
      '@type': 'QueryVersion',
      queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.construct
    } as any;

    hoisted.mockCoordinatorGet.mockImplementation((id: string) => {
      if (id === vId) return version;
      if (id === backend.$id) return backend;
      return null;
    });

    const mockConstructResult = {
      result: '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF>',
      duration: 7
      // No contentType field
    };
    const mockConstruct = vi.fn().mockResolvedValue(mockConstructResult);
    MockHttpSparqlExecutor.mockImplementation(function () {
      return {
        selectQueryParsed: vi.fn(),
        constructQueryParsed: mockConstruct,
        askQuery: vi.fn(),
        update: vi.fn()
      };
    });

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      headers: {
        accept: 'application/rdf+xml'
      },
      payload: { targetId: vId, backendId: backend.$id }
    });

    expect(res.statusCode).toBe(200);
    // When backend doesn't return content-type, we infer from Accept header
    expect(res.headers['content-type']).toBe('application/rdf+xml');
  });
});
