import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, MockInstance } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';

const hoisted = vi.hoisted(() => {
  const createExecutor = () => ({
    selectQueryParsed: vi.fn(),
    constructQueryParsed: vi.fn(),
    askQuery: vi.fn(),
    update: vi.fn(),
    selectQueryStream: vi.fn(),
    constructQueryStream: vi.fn(),
    executorConfig: {},
  });

  return {
    createExecutor,
    executorInstance: createExecutor(),
    findByIri: vi.fn(),
    resolveAuth: vi.fn(),
    executorConfigs: [] as any[],
  };
});

describe('SPARQL proxy routes', () => {
  let app: FastifyInstance;
  let sparqlRoutes: any;
  let backendSpy: MockInstance<(iri: string) => Promise<any | null>>;
  let authSpy: MockInstance<(authEnvKey?: string | null | undefined) => any>;
  let executorSpy: any;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    // Don't add schemas here - the SPARQL routes have inline schemas with $id
    // that Fastify will automatically register
    sparqlRoutes = (await import('../../src/routes/sparql.js')).default;
    const backendModule = await import('../../src/persistence/utils/BackendUtils.js');
    backendSpy = vi.spyOn(backendModule.Backends, 'findByIri').mockImplementation(hoisted.findByIri);
    const authModule = await import('../../src/lib/backendAuth.js');
    authSpy = vi.spyOn(authModule, 'resolveBackendEnvAuth').mockImplementation(hoisted.resolveAuth);
    const executorModule = await import('../../src/server/HttpSparqlExecutor.js');
    executorSpy = vi.spyOn(executorModule, 'HttpSparqlExecutor').mockImplementation((function (config: any) {
      hoisted.executorConfigs.push(config);
      return hoisted.executorInstance;
    }) as any);
    await app.register(sparqlRoutes, { prefix: '' });
    await app.ready();
  });

  afterAll(async () => {
    backendSpy.mockRestore();
    authSpy.mockRestore();
    executorSpy.mockRestore();
    await app.close();
  });

  beforeEach(() => {
    hoisted.findByIri.mockReset();
    hoisted.resolveAuth.mockReset();
    hoisted.executorConfigs.length = 0;
    hoisted.executorInstance = hoisted.createExecutor();
    hoisted.resolveAuth.mockReturnValue({ usedMode: 'none' });
  });

  it('POST /sparql runs SELECT queries through HttpSparqlExecutor', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: BackendTypeIri.http,
      endpoint: 'https://example.org/sparql',
      authEnvKey: 'TEST',
    });
    hoisted.resolveAuth.mockReturnValue({
      username: 'user',
      password: 'pass',
      usedMode: 'basic',
    });
    const rows = {
      head: { vars: ['x'] },
      results: { bindings: [{ x: { type: 'literal', value: '1' } }] },
    };
    hoisted.executorInstance.selectQueryParsed.mockResolvedValue({
      result: rows,
      duration: 12.34,
      contentType: 'application/sparql-results+json',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: ' SELECT * WHERE { ?s ?p ?o } ',
        backendId: 'urn:backend:1',
      },
    });

    expect(hoisted.findByIri).toHaveBeenCalledWith('urn:backend:1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rows);
    expect(hoisted.resolveAuth).toHaveBeenCalledWith('TEST');
    expect(hoisted.executorConfigs[0]).toEqual({
      queryUrl: 'https://example.org/sparql',
      updateUrl: 'https://example.org/sparql',
      username: 'user',
      password: 'pass',
      authHeader: undefined,
      queryMethod: 'post',
    });
    expect(hoisted.executorInstance.selectQueryParsed).toHaveBeenCalledWith(
      ' SELECT * WHERE { ?s ?p ?o } ',
      { acceptHeader: undefined }
    );
  });

  it('POST /sparql maps UPDATE queries via executor.update', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: BackendTypeIri.http,
      endpoint: 'https://example.org/sparql',
    });
    hoisted.resolveAuth.mockReturnValue({ usedMode: 'none' });
    hoisted.executorInstance.update.mockResolvedValue({ result: undefined, duration: 12.34 });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }',
        backendId: 'urn:backend:2',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['server-timing']).toMatch(/db;dur=12\.34/);
    expect(res.body).toBe('');
    expect(hoisted.executorInstance.update).toHaveBeenCalledWith('INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }');
  });

  it('POST /sparql handles SELECT queries with PREFIX declarations', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: BackendTypeIri.http,
      endpoint: 'https://example.org/sparql',
    });
    hoisted.executorInstance.selectQueryParsed.mockResolvedValue({ head: { vars: [] }, results: { bindings: [] } });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'PREFIX foaf: <http://xmlns.com/foaf/0.1/> SELECT ?s WHERE { ?s foaf:name ?name }',
        backendId: 'urn:backend:prefix',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(hoisted.executorInstance.selectQueryParsed).toHaveBeenCalled();
  });

  it('POST /sparql supports LOAD updates', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: BackendTypeIri.http,
      endpoint: 'https://example.org/sparql',
    });
    hoisted.executorInstance.update.mockResolvedValue({ result: undefined, duration: 12.34 });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'LOAD <http://example.org/data.ttl> INTO GRAPH <http://example.org/graph>',
        backendId: 'urn:backend:load',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['server-timing']).toMatch(/db;dur=12\.34/);
    expect(res.body).toBe('');
    expect(hoisted.executorInstance.update).toHaveBeenCalledWith('LOAD <http://example.org/data.ttl> INTO GRAPH <http://example.org/graph>');
  });

  it('GET /sparql supports ASK queries', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: BackendTypeIri.http,
      endpoint: 'https://example.org/sparql',
    });
    hoisted.resolveAuth.mockReturnValue({ usedMode: 'header', authHeader: 'Bearer token' });
    hoisted.executorInstance.askQuery.mockResolvedValue({
      result: true,
      duration: 12.34,
      contentType: 'application/sparql-results+json',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/sparql',
      query: {
        query: 'ASK {?s ?p ?o}',
        backendId: 'urn:backend:3',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ head: {}, boolean: true });
    expect(hoisted.executorInstance.askQuery).toHaveBeenCalledWith('ASK {?s ?p ?o}', { acceptHeader: undefined });
    expect(hoisted.executorConfigs[0]).toEqual({
      queryUrl: 'https://example.org/sparql',
      updateUrl: 'https://example.org/sparql',
      username: undefined,
      password: undefined,
      authHeader: 'Bearer token',
      queryMethod: 'post',
    });
  });

  // Regression guard for the divergence Phase C1 fixed (#65). The
  // "backendId or endpoint is required" rule lived only in the zod schema's
  // `.superRefine`, which `produceJsonSchema()` dropped — so POST accepted the
  // body, the handler's zod parse threw, and fastify rendered a 500 for a
  // request the published contract called valid. GET had the rule spelled out
  // in a hand-written querystring schema and returned 400. Both now share one
  // schema, so both must reject at the gate.
  it.each([
    ['POST', { method: 'POST' as const, payload: { query: 'SELECT * WHERE { ?s ?p ?o }' } }],
    ['GET', { method: 'GET' as const, url: '/sparql?query=SELECT%20*%20WHERE%20%7B%3Fs%20%3Fp%20%3Fo%7D' }],
  ])('%s /sparql without backendId or endpoint is rejected at the gate, not by a throw', async (_label, opts) => {
    const res = await app.inject({ url: '/sparql', ...opts });

    expect(res.statusCode).toBe(400);
    expect(res.statusCode).not.toBe(500);
    expect(hoisted.executorConfigs).toHaveLength(0);
  });

  it('POST /sparql accepts both a backendId and an endpoint, preferring the endpoint', async () => {
    // C1 spelled "backendId or endpoint is required" as `oneOf`, which reads as
    // *exactly* one, so naming both was a 400 — although the zod rule it came
    // from is `||` and `resolveExecutor` has always taken the endpoint when both
    // are present. Phase C3 (#65) made it `anyOf`; the harness in
    // test/contracts/web-leaf-parity.test.ts found it because the web leaf
    // accepts a request the server was refusing.
    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'SELECT * WHERE { ?s ?p ?o }',
        backendId: 'urn:backend:1',
        endpoint: 'https://example.org/sparql',
      },
    });

    expect(res.statusCode).not.toBe(400);
    expect(hoisted.executorConfigs).toHaveLength(1);
    expect(hoisted.executorConfigs[0]).toMatchObject({ queryUrl: 'https://example.org/sparql' });
  });

  it('GET /sparql with an empty query is rejected at the gate', async () => {
    // `minLength: 1` was on the POST body schema but missing from the
    // hand-written GET querystring, so `?query=` reached the handler and threw.
    const res = await app.inject({
      method: 'GET',
      url: '/sparql?query=&backendId=urn:backend:1',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when backend cannot be found', async () => {
    hoisted.findByIri.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'SELECT * WHERE { ?s ?p ?o }',
        backendId: 'urn:backend:missing',
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Backend not found: urn:backend:missing' });
    expect(hoisted.executorConfigs).toHaveLength(0);
  });

  it('rejects unsupported backend types with 400', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: 'FILESYSTEM',
      endpoint: 'file:///tmp/data',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'SELECT * WHERE { ?s ?p ?o }',
        backendId: 'urn:backend:4',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Unsupported backend type: FILESYSTEM' });
  });

  it('rejects HTTP backends without endpoint metadata', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: BackendTypeIri.http,
      endpoint: undefined,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'SELECT * WHERE { ?s ?p ?o }',
        backendId: 'urn:backend:missing-endpoint',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'HTTP backend missing endpoint' });
    expect(hoisted.executorConfigs).toHaveLength(0);
  });

  it('POST /sparql executes DESCRIBE queries via construct pipeline', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: BackendTypeIri.http,
      endpoint: 'https://example.org/sparql',
    });

    // /sparql is an external-facing proxy: DESCRIBE/CONSTRUCT returns RDF (string) + Server-Timing header.
    const rdf = '<https://example.org/s> <https://example.org/p> "c" .\n';
    hoisted.executorInstance.constructQueryParsed.mockResolvedValue({
      result: rdf,
      duration: 12.34,
      contentType: 'application/n-triples',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: '  describe <https://example.org/resource> ',
        backendId: 'urn:backend:describe',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/n-triples');
    expect(res.headers['server-timing']).toMatch(/db;dur=12\.34/);
    expect(res.body).toBe(rdf);
    expect(hoisted.executorInstance.constructQueryParsed).toHaveBeenCalledWith(
      '  describe <https://example.org/resource> ',
      { acceptHeader: undefined }
    );
    expect(hoisted.executorInstance.selectQueryParsed).not.toHaveBeenCalled();
  });

  it('rejects unsupported query types with 400', async () => {
    hoisted.findByIri.mockResolvedValue({
      backendType: BackendTypeIri.http,
      endpoint: 'https://example.org/sparql',
    });
    hoisted.resolveAuth.mockReturnValue({ usedMode: 'none' });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'CONVERT {?s ?p ?o}',
        backendId: 'urn:backend:5',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Failed to parse SPARQL query/);
    expect(hoisted.executorInstance.selectQueryParsed).not.toHaveBeenCalled();
  });

  it('maps executor failures to 500 errors', async () => {
    hoisted.findByIri.mockImplementationOnce(async () => ({
      backendType: BackendTypeIri.http,
      endpoint: 'https://example.org/sparql',
    }));
    hoisted.resolveAuth.mockReturnValue({ usedMode: 'none' });
    // Moved inside the test block to ensure it's applied after beforeEach resets the executorInstance
    hoisted.executorInstance.selectQueryParsed.mockRejectedValue(new Error('boom'));

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'SELECT * WHERE { ?s ?p ?o }',
        backendId: 'urn:backend:6',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'boom' });
  });

  /*
   * The ad-hoc path carries arguments (issue: draft runs dropped them).
   *
   * A query in the editor has no version for `/execute` to name, so it runs as
   * text through here — and until this payload existed, its VALUES inputs ran
   * unbound, silently returning everything rather than the rows the panel was
   * showing.
   */
  describe('inline arguments', () => {
    const bindArgs = () => {
      hoisted.findByIri.mockResolvedValue({
        backendType: BackendTypeIri.http,
        endpoint: 'https://example.org/sparql',
      });
      hoisted.executorInstance.selectQueryParsed.mockResolvedValue({
        result: { head: { vars: [] }, results: { bindings: [] } },
        duration: 1,
        contentType: 'application/sparql-results+json',
      });
    };

    it('binds VALUES inputs before executing', async () => {
      bindArgs();

      const res = await app.inject({
        method: 'POST',
        url: '/sparql',
        payload: {
          query: 'SELECT ?city WHERE { VALUES (?city) { (UNDEF) } ?city ?p ?o }',
          backendId: 'urn:backend:args',
          arguments: [
            {
              head: { vars: ['city'] },
              arguments: {
                bindings: [{ city: { type: 'uri', value: 'http://example.org/city/Paris' } }],
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const executed = hoisted.executorInstance.selectQueryParsed.mock.calls[0][0] as string;
      expect(executed).toContain('http://example.org/city/Paris');
      expect(executed).not.toContain('UNDEF');
    });

    it('substitutes LIMIT and OFFSET parameters', async () => {
      bindArgs();

      const res = await app.inject({
        method: 'POST',
        url: '/sparql',
        payload: {
          // `LIMIT 0001` is the placeholder spelling: a name the parser reads
          // off the digits after the zeros.
          query: 'SELECT ?s WHERE { ?s ?p ?o } OFFSET 0002 LIMIT 0001',
          backendId: 'urn:backend:args',
          limits: [{ name: '1', value: 10 }],
          offsets: [{ name: '2', value: 5 }],
        },
      });

      expect(res.statusCode).toBe(200);
      const executed = hoisted.executorInstance.selectQueryParsed.mock.calls[0][0] as string;
      expect(executed).toContain('LIMIT 10');
      expect(executed).toContain('OFFSET 5');
    });

    it('answers 400 when the payload does not fit the query', async () => {
      bindArgs();

      const res = await app.inject({
        method: 'POST',
        url: '/sparql',
        payload: {
          // No VALUES clause to bind, so the argument set has nowhere to go.
          query: 'SELECT ?s WHERE { ?s ?p ?o }',
          backendId: 'urn:backend:args',
          arguments: [
            {
              head: { vars: ['city'] },
              arguments: {
                bindings: [{ city: { type: 'uri', value: 'http://example.org/city/Paris' } }],
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/Failed to apply arguments/);
      expect(hoisted.executorInstance.selectQueryParsed).not.toHaveBeenCalled();
    });

    it('rejects arguments on the GET querystring, which cannot carry them', async () => {
      bindArgs();

      const res = await app.inject({
        method: 'GET',
        url: '/sparql?query=SELECT%20*%20WHERE%20%7B%20%3Fs%20%3Fp%20%3Fo%20%7D&backendId=urn:backend:args&arguments=%5B%5D',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  it('maps backend lookup failures to 500 errors', async () => {
    hoisted.findByIri.mockImplementationOnce(async () => {
      throw new Error('repository unavailable');
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: {
        query: 'SELECT * WHERE { ?s ?p ?o }',
        backendId: 'urn:backend:error',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'repository unavailable' });
    expect(hoisted.executorConfigs).toHaveLength(0);
  });
});

afterAll(() => {
  vi.unmock('../../src/persistence/utils/BackendUtils.js');
  vi.unmock('../../src/lib/backendAuth.js');
  vi.unmock('../../src/server/HttpSparqlExecutor.js');
  vi.resetModules();
});
