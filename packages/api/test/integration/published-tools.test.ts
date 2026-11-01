/**
 * Queries as tools, against a real API instance (`docs/guides/publishing-tools.md`).
 *
 * The first instance is the author's: a library with a slug, a backend, and
 * query versions that carry `tool` objects, which is where a `tool` object is
 * checked and carried forward. The tools are collected when a server starts,
 * so a second instance over the same store is the one that serves them, and a
 * third runs with `MCP_CATALOGUE=published`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** A parsed response body: whatever `JSON.parse` gives. */
type Json = ReturnType<typeof JSON.parse>;

describe('published tools, against a real API instance', () => {
  let author: FastifyInstance;
  const teardowns: Array<() => Promise<void>> = [];
  let outputDir: string;
  const ids: Record<string, string> = {};

  const previousEnv: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in previousEnv)) previousEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  /** Another server over the same store, as a restart would be. */
  async function startServer(): Promise<FastifyInstance> {
    const { configureApp } = await import('../../src/index.js');
    const app = Fastify({ logger: false });
    const { teardown } = await configureApp(app as never, { enableCacheMonitoring: false, registerSwagger: false });
    // The first server's teardown also shuts the store every server shares,
    // so it runs last; the others only close their instance.
    teardowns.push(teardowns.length === 0 ? teardown : () => app.close());
    await app.ready();
    return app;
  }

  const send = async (app: FastifyInstance, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Json };
  };

  const saveVersion = (queryId: string, queryVersion: Json) =>
    send(author, 'POST', `/queries/${encodeURIComponent(queryId)}/versions`, { queryVersion });

  const BY_CITY =
    'PREFIX ex: <http://example.org/> SELECT ?name WHERE { VALUES ?city { UNDEF } ?person ex:city ?city ; ex:name ?name . } ORDER BY ?name LIMIT 0001';
  const byCityTool = {
    name: 'people-in-city',
    description: 'The people who live in a city.',
    params: { city: { kind: 'string', list: true, required: true }, '1': { kind: 'integer' } },
  };

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'published-tools-'));
    setEnv('FEATURE_QUERIES', 'true');
    setEnv('FEATURE_BACKENDS', 'true');
    setEnv('FEATURE_DATA_GRAPHS', 'true');
    setEnv('INTERNAL_BACKEND_TYPE', 'oxigraph-memory');
    setEnv('OXIGRAPH_STORAGE_DIR', path.join(outputDir, 'oxigraph'));
    setEnv('MCP_CATALOGUE', undefined);
    const { oxigraphStoreManager } = await import('../../src/lib/OxigraphStoreManager.js');
    await oxigraphStoreManager.initialize(path.join(outputDir, 'oxigraph'));
    author = await startServer();

    const library = await send(author, 'POST', '/libraries', { name: 'People', slug: 'people' });
    expect(library.status).toBe(201);
    ids.library = library.body.id;

    const dataGraph = await send(author, 'POST', '/data-graphs', { name: 'People', isPartOf: [ids.library] });
    ids.dataGraph = dataGraph.body.id;
    await send(author, 'POST', `/data-graphs/${encodeURIComponent(ids.dataGraph)}/versions`, {
      contentString:
        '@prefix ex: <http://example.org/> . ex:alice ex:name "Alice" ; ex:city "Perth" . ex:bob ex:name "Bob" ; ex:city "Darwin" . ex:cara ex:name "Cara" ; ex:city "Perth" .',
      contentFormat: 'text/turtle',
    });
    const backend = await send(author, 'POST', '/backends', {
      name: 'People store',
      backendType: 'oxigraphMemory',
      oxigraphConfig: JSON.stringify({ storeType: 'ephemeral', mode: 'ephemeral', sources: [{ dataGraphId: ids.dataGraph }] }),
    });
    expect(backend.status).toBe(201);
    ids.backend = backend.body.id;

    const query = await send(author, 'POST', '/queries', {
      name: 'People in a city',
      isPartOf: [ids.library],
      defaultBackend: ids.backend,
    });
    ids.query = query.body.id;

    const unpublished = await send(author, 'POST', '/queries', { name: 'Everyone', isPartOf: [ids.library] });
    ids.unpublished = unpublished.body.id;
    await saveVersion(ids.unpublished, { queryString: 'SELECT * WHERE { ?s ?p ?o }' });
  }, 120_000);

  afterAll(async () => {
    for (const teardown of teardowns.reverse()) await teardown();
    await fs.rm(outputDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('refuses a slug another library holds', async () => {
    const clash = await send(author, 'POST', '/libraries', { name: 'Other', slug: 'people' });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toContain(ids.library);
    const badPattern = await send(author, 'POST', '/libraries', { name: 'Other', slug: 'Not A Slug' });
    expect(badPattern.status).toBe(400);
  });

  it('checks a tool object against the version\'s inputs, naming the key', async () => {
    const wrong = await saveVersion(ids.query, {
      queryString: BY_CITY,
      tool: { ...byCityTool, params: { town: { kind: 'string' } } },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('tool.params.town names no input of this version. Its inputs are: ?city, LIMIT 1');
  });

  it('stores the tool object, and carries it to a version that sends none', async () => {
    const first = await saveVersion(ids.query, { queryString: BY_CITY, tool: byCityTool });
    expect(first.status).toBe(201);
    expect(first.body.queryVersion.tool).toEqual(byCityTool);

    const second = await saveVersion(ids.query, { queryString: BY_CITY.replace('ORDER BY ?name', 'ORDER BY DESC(?name)') });
    expect(second.status).toBe(201);
    expect(second.body.queryVersion.tool).toEqual(byCityTool);
    ids.pinned = second.body.queryVersion.id;
  });

  it('refuses new text that drops an input the carried tool names', async () => {
    const dropped = await saveVersion(ids.query, {
      queryString: 'PREFIX ex: <http://example.org/> SELECT ?name WHERE { ?person ex:name ?name } LIMIT 0001',
    });
    expect(dropped.status).toBe(400);
    expect(dropped.body.error).toMatch(/^tool\.params\.city names no input of this version\. Its inputs are: LIMIT 1\. The tool object was copied from version 2/);
  });

  describe('a server started after the tools were saved', () => {
    let server: FastifyInstance;

    beforeAll(async () => {
      server = await startServer();
    }, 120_000);

    it('answers a reading tool on GET, a list spreading over rows', async () => {
      const perth = await send(server, 'GET', '/tools/people/people-in-city?city=Perth&1=10');
      expect(perth.status).toBe(200);
      expect(perth.body.results.bindings.map((b: Json) => b.name.value)).toEqual(['Cara', 'Alice']);

      const both = await send(server, 'GET', '/tools/people/people-in-city?city=Perth&city=Darwin&1=10');
      expect(both.body.results.bindings.map((b: Json) => b.name.value)).toEqual(['Cara', 'Bob', 'Alice']);

      const limited = await send(server, 'GET', '/tools/people/people-in-city?city=Perth&1=1');
      expect(limited.body.results.bindings).toHaveLength(1);
    });

    it('refuses a missing required parameter and an unknown one before anything runs', async () => {
      const missing = await send(server, 'GET', '/tools/people/people-in-city');
      expect(missing.status).toBe(400);
      expect(missing.body.error).toContain('city');

      const unknown = await send(server, 'GET', '/tools/people/people-in-city?city=Perth&colour=red');
      expect(unknown.status).toBe(400);
    });

    it('publishes an OpenAPI document with one operation per tool', async () => {
      const document = await send(server, 'GET', '/tools/people/openapi.json');
      expect(document.status).toBe(200);
      expect(document.body.openapi).toBe('3.1.0');
      expect(Object.keys(document.body.paths)).toEqual(['/tools/people/people-in-city']);
      expect(document.body.paths['/tools/people/people-in-city'].get.parameters.map((p: Json) => p.name)).toEqual([
        '1',
        'city',
        'backendId',
      ]);
    });

    it('decorates the instance with the catalogue for the MCP server', () => {
      const published = (server as unknown as { sqlibPublished: { catalogue: { specs: Json[] }; mode: string } }).sqlibPublished;
      expect(published.mode).toBe('both');
      expect(published.catalogue.specs).toEqual([
        expect.objectContaining({
          slug: 'people',
          name: 'people-in-city',
          targetId: ids.pinned,
          readOnly: true,
          defaultBackendId: ids.backend,
          inputs: { tables: [['city']], limits: ['1'], offsets: [] },
        }),
      ]);
    });

    it('keeps the authoring routes', async () => {
      expect((await send(server, 'GET', '/queries')).status).toBe(200);
    });
  });

  describe('publishAll, and MCP_CATALOGUE=published', () => {
    let server: FastifyInstance;

    beforeAll(async () => {
      // Every entry is published now: the unpublished query gets a default tool.
      const updated = await send(author, 'PUT', `/libraries/${encodeURIComponent(ids.library)}`, { publishAll: true });
      expect(updated.status).toBe(200);
      setEnv('MCP_CATALOGUE', 'published');
      server = await startServer();
    }, 120_000);

    afterAll(() => setEnv('MCP_CATALOGUE', undefined));

    it('publishes a default tool for an entry that declares none', async () => {
      const published = (server as unknown as { sqlibPublished: { catalogue: { specs: Json[] } } }).sqlibPublished;
      expect(published.catalogue.specs.map((spec: Json) => spec.name).sort()).toEqual(['Everyone', 'people-in-city']);
    });

    it('answers 404 for every authoring route', async () => {
      expect((await send(server, 'GET', '/queries')).status).toBe(404);
      expect((await send(server, 'POST', '/libraries', { name: 'x' })).status).toBe(404);
    });

    it('runs only the pinned versions through /execute', async () => {
      const unpinned = await send(server, 'POST', '/execute', { targetId: ids.query, backendId: ids.backend });
      expect(unpinned.status).toBe(403);

      const tool = await send(server, 'GET', '/tools/people/people-in-city?city=Darwin&1=10');
      expect(tool.status).toBe(200);
      expect(tool.body.results.bindings.map((b: Json) => b.name.value)).toEqual(['Bob']);
    });
  });
});
