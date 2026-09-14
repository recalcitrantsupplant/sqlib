import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import Fastify, { FastifyInstance } from 'fastify';
import executeRoutes from '../../src/routes/execute.js';
import { SparqlQueryParser } from '../../src/lib/parser.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { ExecutionNodeError } from '../../src/lib/orchestration/ExecutionEngine.js';

// Mock parser + executor factory
vi.mock('../../src/lib/parser');
const MockSparqlQueryParser = SparqlQueryParser as any;

const { executorFactoryInstance } = vi.hoisted(() => {
  const instance = {
    getExecutorForNode: vi.fn(),
    getExecutorForNodeSync: vi.fn(),
  };
  return { executorFactoryInstance: instance };
});

vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: vi.fn(function () {
    return executorFactoryInstance;
  }),
}));

const groupExecution = vi.hoisted(() => ({
  buildFromGroupVersion: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../../src/lib/orchestration/GraphBuilder.js', () => ({
  GraphBuilder: vi.fn(function () {
    return { buildFromGroupVersion: groupExecution.buildFromGroupVersion };
  }),
}));

vi.mock('../../src/lib/orchestration/ExecutionEngine.js', async (importOriginal) => {
  // Keep the real ExecutionNodeError so the route sees the shape it must unpack.
  const actual = await importOriginal<typeof import('../../src/lib/orchestration/ExecutionEngine.js')>();
  return {
    ...actual,
    ExecutionEngine: vi.fn(function () {
      return { execute: groupExecution.execute };
    }),
  };
});

const hoisted = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

// Mock CacheCoordinatorProvider singleton
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.mockGet,
  }),
}));

const createMockExecutor = () => ({
  selectQueryParsed: vi.fn(),
  constructQueryParsed: vi.fn(),
  askQuery: vi.fn(),
  update: vi.fn(),
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app); // Configure AJV with Draft 2020-12 support
  await app.register(executeRoutes, { prefix: '/execute' });
  await app.ready();
  return app;
}

describe('Execute route (v1)', () => {
  let app: FastifyInstance;
  let defaultExecutor: ReturnType<typeof createMockExecutor>;

  const backend = {
    $id: 'urn:sqlib:backend:svc',
    '@type': 'Backend',
    name: 'B',
    backendType: BackendTypeIri.http,
    endpoint: 'http://example.org/sparql',
  } as any;

  beforeEach(async () => {
    hoisted.mockGet.mockReset();
    executorFactoryInstance.getExecutorForNode.mockReset();
    MockSparqlQueryParser.prototype.applyArguments = vi.fn();
    MockSparqlQueryParser.prototype.applyLimitOffsetParameters = vi.fn();
    defaultExecutor = createMockExecutor();
    executorFactoryInstance.getExecutorForNode.mockResolvedValue(defaultExecutor);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('executes a SELECT by resolving stable Query to current QueryVersion', async () => {
    const qId = 'urn:sqlib:query:abc';
    const vId = 'urn:sqlib:query-version:v1';
    const query = { $id: qId, '@type': 'Query', name: 'Q', currentVersion: vId } as any;
    const version = { $id: vId, '@type': 'QueryVersion', isPartOf: qId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select } as any;

    hoisted.mockGet
      .mockReturnValueOnce(query)
      .mockReturnValueOnce(backend)
      .mockReturnValueOnce(version);

    const expected = { head: { vars: ['s','p','o'] }, results: { bindings: [] } };
    const mockExecutor = createMockExecutor();
    mockExecutor.selectQueryParsed.mockResolvedValue({ result: expected, duration: 10 });
    executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);

    const res = await app.inject({ method: 'POST', url: '/execute/', payload: { targetId: qId, backendId: backend.$id } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-resolved-target']).toBe(vId);
    expect(executorFactoryInstance.getExecutorForNode).toHaveBeenCalledTimes(1);
    expect(mockExecutor.selectQueryParsed).toHaveBeenCalledWith(version.queryString, { acceptHeader: 'application/sparql-results+json' });
  });

  it('executes a QueryVersion directly', async () => {
    const vId = 'urn:sqlib:query-version:v2';
    const version = { $id: vId, '@type': 'QueryVersion', queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', queryType: QueryTypeIri.construct } as any;
    hoisted.mockGet
      .mockReturnValueOnce(version)
      .mockReturnValueOnce(backend);

    const mockExecutor = createMockExecutor();
    mockExecutor.constructQueryParsed.mockResolvedValue({ result: '@prefix ... ntriples ...', duration: 10 });
    executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);

    const res = await app.inject({ method: 'POST', url: '/execute/', payload: { targetId: vId, backendId: backend.$id } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-resolved-target']).toBe(vId);
    expect(executorFactoryInstance.getExecutorForNode).toHaveBeenCalled();
    expect(mockExecutor.constructQueryParsed).toHaveBeenCalledWith(version.queryString, { acceptHeader: 'text/turtle' });
  });

  it('accepts nodeDetail without changing non-group execution responses', async () => {
    const vId = 'urn:sqlib:query-version:detail';
    const version = { $id: vId, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select } as any;
    hoisted.mockGet.mockReturnValueOnce(version).mockReturnValueOnce(backend);
    defaultExecutor.selectQueryParsed.mockResolvedValue({ result: { head: { vars: [] }, results: { bindings: [] } }, duration: 1 });

    const res = await app.inject({ method: 'POST', url: '/execute/', payload: {
      targetId: vId, backendId: backend.$id, nodeDetail: 'timings',
    } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ head: { vars: [] }, results: { bindings: [] } });
  });

  /*
   * This used to assert a flat refusal of LIMIT/OFFSET on a group, on the
   * grounds that there was no single query to apply a *global* one to. They are
   * not global: a placeholder is named, so a value reaches the nodes declaring
   * that name. What survives of the refusal is the narrower one — a name no
   * member declares, which would otherwise page nothing and look like it had.
   */
  it('rejects a LIMIT parameter no query in the group declares', async () => {
    const group = { $id: 'urn:sqlib:group:1', '@type': 'QueryGroup', currentVersion: 'urn:sqlib:group-version:1' } as any;
    hoisted.mockGet.mockReturnValueOnce(group);

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: group.$id, limits: [{ name: 'limit', value: 10 }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Limit parameter 'limit' is not declared by any query in this group/);
  });

  it.each([
    ['QueryGroup', 'urn:sqlib:group:fail'],
    ['QueryGroupVersion', 'urn:sqlib:group-version:fail'],
  ])('reports a mid-chain %s failure as 400 naming the failed node', async (type, id) => {
    const versionId = 'urn:sqlib:group-version:fail';
    const version = { $id: versionId, '@type': 'QueryGroupVersion' } as any;
    hoisted.mockGet.mockImplementation((requested: string) =>
      requested === versionId
        ? version
        : { $id: id, '@type': type, currentVersion: versionId });

    groupExecution.buildFromGroupVersion.mockReturnValue({ endNodeIds: [], nodes: new Map() });
    groupExecution.execute.mockImplementation(async (_graph: unknown, _args: unknown, hooks: any) => {
      const node = { id: 'urn:sqlib:node:2', raw: {} } as any;
      hooks?.onNodeStart?.(node, 0);
      const cause = new Error('backend refused the query');
      hooks?.onNodeError?.(node, cause, 12, 0);
      throw new ExecutionNodeError('urn:sqlib:node:2', 'Enrich Results', cause);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: id, nodeDetail: 'timings' },
    });

    // Both target types take the same 400 path; QueryGroupVersion used to fall
    // through to the generic handler and surface as a 500.
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain('backend refused the query');
    expect(body.failedNodeId).toBe('urn:sqlib:node:2');
    expect(body.failedNodeName).toBe('Enrich Results');
    expect(body.nodes).toEqual([
      expect.objectContaining({ nodeId: 'urn:sqlib:node:2', status: 'failed', error: 'backend refused the query' }),
    ]);
  });

  it('applies arguments to VALUES UNDEF before execution', async () => {
    const qId = 'urn:sqlib:query:with-args';
    const vId = 'urn:sqlib:query-version:ver';
    const version = { $id: vId, '@type': 'QueryVersion', isPartOf: qId, version: 1, queryString: 'SELECT * WHERE { VALUES ?x { UNDEF } }', queryType: QueryTypeIri.select } as any;
    const query = { $id: qId, '@type': 'Query', currentVersion: vId } as any;

    hoisted.mockGet
      .mockReturnValueOnce(query)
      .mockReturnValueOnce(backend)
      .mockReturnValueOnce(version);

    const args = [{ head: { vars: ['x'] }, arguments: { bindings: [{ x: { type: 'uri', value: 'http://example.org/x' } }] } }];
    const applied = 'SELECT * WHERE { VALUES ?x { <http://example.org/x> } }';
    const mockExecutor = createMockExecutor();
    mockExecutor.selectQueryParsed.mockResolvedValue({
      result: { head: { vars: ['x'] }, results: { bindings: [] } },
      duration: 10
    });
    (MockSparqlQueryParser.prototype.applyArguments as any).mockReturnValue(applied);
    executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);

    const res = await app.inject({ method: 'POST', url: '/execute/', payload: { targetId: qId, backendId: backend.$id, arguments: args } });
    expect(res.statusCode).toBe(200);
    expect(MockSparqlQueryParser.prototype.applyArguments).toHaveBeenCalledWith(version.queryString, args);
    expect(executorFactoryInstance.getExecutorForNode).toHaveBeenCalled();
    expect(mockExecutor.selectQueryParsed).toHaveBeenCalledWith(applied, { acceptHeader: 'application/sparql-results+json' });
  });

  // Section 1: Entity Fetching and Validation
  describe('Entity Fetching and Validation', () => {
    it('returns 404 when backend not found', async () => {
      const qId = 'urn:sqlib:query:abc';
      const query = { $id: qId, '@type': 'Query', name: 'Q' } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(query)      // targetId found
        .mockReturnValueOnce(null);       // backendId NOT found
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: qId, backendId: 'urn:sqlib:backend:missing' } 
      });
      
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toContain('Backend');
      expect(JSON.parse(res.body).error).toContain('not found');
    });

    it('returns 404 when target not found', async () => {
      hoisted.mockGet
        .mockReturnValueOnce(null)        // targetId NOT found
        .mockReturnValueOnce(backend);    // backendId found
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: 'urn:sqlib:query:missing', backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toContain('Target entity');
      expect(JSON.parse(res.body).error).toContain('not found');
    });
  });

  // Section 2: Target Resolution & Parameter Application
  describe('Target Resolution & Parameter Application', () => {
    it('returns 409 when Query has no currentVersion', async () => {
      const qId = 'urn:sqlib:query:no-version';
      const query = { $id: qId, '@type': 'Query', name: 'Q' } as any; // No currentVersion
      
      hoisted.mockGet
        .mockReturnValueOnce(query)
        .mockReturnValueOnce(backend);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: qId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toContain('no currentVersion');
    });

    it('returns 404 when Query currentVersion not found in cache', async () => {
      const qId = 'urn:sqlib:query:bad-version';
      const vId = 'urn:sqlib:query-version:missing';
      const query = { $id: qId, '@type': 'Query', name: 'Q', currentVersion: vId } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(query)
        .mockReturnValueOnce(backend)
        .mockReturnValueOnce(null); // currentVersion NOT found
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: qId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toContain('Current version');
      expect(JSON.parse(res.body).error).toContain('not found');
    });

    it('returns 400 when parser fails to apply arguments', async () => {
      const qId = 'urn:sqlib:query:bad-args';
      const vId = 'urn:sqlib:query-version:ver';
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select } as any;
      const query = { $id: qId, '@type': 'Query', currentVersion: vId } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(query)
        .mockReturnValueOnce(backend)
        .mockReturnValueOnce(version);
      
      // Mock parser to throw error
      (MockSparqlQueryParser.prototype.applyArguments as any).mockImplementation(() => {
        throw new Error('Invalid argument format');
      });
      
      const args = [{ head: { vars: ['x'] }, arguments: { bindings: [] } }];
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: qId, backendId: backend.$id, arguments: args } 
      });
      
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Failed to apply arguments');
    });

    it('returns 400 for invalid target type', async () => {
      const invalidId = 'urn:sqlib:invalid:xyz';
      const invalidEntity = { $id: invalidId, '@type': 'SomeOtherType' } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(invalidEntity)
        .mockReturnValueOnce(backend);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: invalidId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('not an executable type');
    });
  });

  // Section 3: Backend and Executor Instantiation
  describe('Backend and Executor Instantiation', () => {
    it('returns 400 when backend missing backendType', async () => {
      const qId = 'urn:sqlib:query:abc';
      const vId = 'urn:sqlib:query-version:v1';
      const query = { $id: qId, '@type': 'Query', currentVersion: vId } as any;
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select } as any;
      const badBackend = { $id: 'urn:sqlib:backend:bad', '@type': 'Backend', name: 'Bad' } as any; // No backendType
      
      hoisted.mockGet
        .mockReturnValueOnce(query)
        .mockReturnValueOnce(badBackend)
        .mockReturnValueOnce(version);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: qId, backendId: badBackend.$id } 
      });
      
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Unsupported backend type');
    });

    it('propagates error when HTTP backend missing endpoint', async () => {
      const qId = 'urn:sqlib:query:abc';
      const vId = 'urn:sqlib:query-version:v1';
      const query = { $id: qId, '@type': 'Query', currentVersion: vId } as any;
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select } as any;
      const badBackend = { $id: 'urn:sqlib:backend:no-endpoint', '@type': 'Backend', backendType: BackendTypeIri.http } as any; // No endpoint
      executorFactoryInstance.getExecutorForNode.mockRejectedValue(new Error('HTTP backend missing endpoint'));
      
      hoisted.mockGet
        .mockReturnValueOnce(query)
        .mockReturnValueOnce(badBackend)
        .mockReturnValueOnce(version);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: qId, backendId: badBackend.$id } 
      });
      
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(JSON.parse(res.body).error).toContain('HTTP backend');
    });

    it('returns 400 for unsupported backend type', async () => {
      const qId = 'urn:sqlib:query:abc';
      const vId = 'urn:sqlib:query-version:v1';
      const query = { $id: qId, '@type': 'Query', currentVersion: vId } as any;
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select } as any;
      const badBackend = { $id: 'urn:sqlib:backend:unsupported', '@type': 'Backend', backendType: 'NOSQL' } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(query)
        .mockReturnValueOnce(badBackend)
        .mockReturnValueOnce(version);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: qId, backendId: badBackend.$id } 
      });
      
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Unsupported backend type');
    });

    it('executes query for oxigraphEphemeral backend via executor factory', async () => {
      const qId = 'urn:sqlib:query:abc';
      const vId = 'urn:sqlib:query-version:v1';
      const query = { $id: qId, '@type': 'Query', currentVersion: vId } as any;
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select } as any;
      const oxigraphBackend = { $id: 'urn:sqlib:backend:oxigraph', '@type': 'Backend', backendType: BackendTypeIri.oxigraphEphemeral } as any;
      const mockExecutor = createMockExecutor();
      mockExecutor.selectQueryParsed.mockResolvedValue({ result: {}, duration: 5 });
      executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);
      
      hoisted.mockGet
        .mockReturnValueOnce(query)
        .mockReturnValueOnce(oxigraphBackend)
        .mockReturnValueOnce(version);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: qId, backendId: oxigraphBackend.$id } 
      });
      
      expect(res.statusCode).toBe(200);
      expect(executorFactoryInstance.getExecutorForNode).toHaveBeenCalled();
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalled();
    });

  });

  // Section 4: Query Execution Logic (by Query Type)
  describe('Query Execution Logic by Type', () => {
    it('executes CONSTRUCT query', async () => {
      const vId = 'urn:sqlib:query-version:construct';
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', queryType: QueryTypeIri.construct } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(version)
        .mockReturnValueOnce(backend);
      
      const mockExecutor = createMockExecutor();
      mockExecutor.constructQueryParsed.mockResolvedValue({
        result: '<http://example.org/s> <http://example.org/p> <http://example.org/o> .',
        duration: 10
      });
      executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: vId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(200);
      expect(mockExecutor.constructQueryParsed).toHaveBeenCalledWith(version.queryString, { acceptHeader: 'text/turtle' });
    });

    it('executes DESCRIBE query', async () => {
      const vId = 'urn:sqlib:query-version:describe';
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'DESCRIBE <http://example.org/resource>', queryType: QueryTypeIri.describe } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(version)
        .mockReturnValueOnce(backend);
      
      const mockExecutor = createMockExecutor();
      mockExecutor.constructQueryParsed.mockResolvedValue({
        result: '<http://example.org/resource> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Class> .',
        duration: 10
      });
      executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: vId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(200);
      expect(mockExecutor.constructQueryParsed).toHaveBeenCalledWith(version.queryString, { acceptHeader: 'text/turtle' });
    });

    it('executes ASK query', async () => {
      const vId = 'urn:sqlib:query-version:ask';
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'ASK { ?s ?p ?o }', queryType: QueryTypeIri.ask } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(version)
        .mockReturnValueOnce(backend);
      
      const mockExecutor = createMockExecutor();
      mockExecutor.askQuery.mockResolvedValue({ result: true, duration: 10 });
      executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);

      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: vId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ head: {}, boolean: true });
      expect(mockExecutor.askQuery).toHaveBeenCalledWith(version.queryString, { acceptHeader: 'application/sparql-results+json' });
    });

    it('executes UPDATE query with INSERT', async () => {
      const vId = 'urn:sqlib:query-version:insert';
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }', queryType: QueryTypeIri.update } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(version)
        .mockReturnValueOnce(backend);
      
      const mockExecutor = createMockExecutor();
      mockExecutor.update.mockResolvedValue({ result: undefined, duration: 10 });
      executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: vId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(204);
      expect(mockExecutor.update).toHaveBeenCalledWith(version.queryString);
      expect(res.body).toBe('');
    });

    it('executes UPDATE query with DELETE', async () => {
      const vId = 'urn:sqlib:query-version:delete';
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'DELETE DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }', queryType: QueryTypeIri.update } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(version)
        .mockReturnValueOnce(backend);
      
      const mockExecutor = createMockExecutor();
      mockExecutor.update.mockResolvedValue({ result: undefined, duration: 10 });
      executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: vId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(204);
      expect(mockExecutor.update).toHaveBeenCalledWith(version.queryString);
      expect(res.body).toBe('');
    });

    it('falls back to detected query type when stored value is invalid', async () => {
      const vId = 'urn:sqlib:query-version:unknown';
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: 'UNKNOWN' } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(version)
        .mockReturnValueOnce(backend);
      const mockExecutor = createMockExecutor();
      mockExecutor.selectQueryParsed.mockResolvedValue({ result: {}, duration: 2 });
      executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: vId, backendId: backend.$id } 
      });
      
      expect(res.statusCode).toBe(200);
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalled();
    });
  });

  // Section 5: Error Handling
  describe('Error Handling', () => {
    it('handles executor errors gracefully', async () => {
      const vId = 'urn:sqlib:query-version:error';
      const version = { $id: vId, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select } as any;
      
      hoisted.mockGet
        .mockReturnValueOnce(version)
        .mockReturnValueOnce(backend);
      
      const mockExecutor = createMockExecutor();
      mockExecutor.selectQueryParsed.mockRejectedValue(new Error('Connection timeout'));
      executorFactoryInstance.getExecutorForNode.mockResolvedValue(mockExecutor);
      
      const res = await app.inject({ 
        method: 'POST', 
        url: '/execute/', 
        payload: { targetId: vId, backendId: backend.$id } 
      });
      
      // Error handler should process this
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(JSON.parse(res.body)).toHaveProperty('error');
    });
  });
});
