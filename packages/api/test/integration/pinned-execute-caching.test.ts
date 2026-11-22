/**
 * `GET /execute` with every input pinned (#206), against a real API instance:
 * an ETag, a year's `immutable` lifetime, and `304` without running.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

type Json = ReturnType<typeof JSON.parse>;

describe('GET /execute with pinned inputs', () => {
  let app: FastifyInstance;
  let teardown: () => Promise<void>;
  let outputDir: string;
  const ids: Record<string, string> = {};
  const previousEnv: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in previousEnv)) previousEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  const send = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Json };
  };

  const executeUrl = (targetId: string, backendId: string) =>
    `/execute?targetId=${encodeURIComponent(targetId)}&backendId=${encodeURIComponent(backendId)}`;

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pinned-execute-'));
    setEnv('FEATURE_QUERIES', 'true');
    setEnv('FEATURE_BACKENDS', 'true');
    setEnv('FEATURE_DATA_GRAPHS', 'true');
    setEnv('INTERNAL_BACKEND_TYPE', 'oxigraph-memory');
    setEnv('OXIGRAPH_STORAGE_DIR', path.join(outputDir, 'oxigraph'));
    const { oxigraphStoreManager } = await import('../../src/lib/OxigraphStoreManager.js');
    await oxigraphStoreManager.initialize(path.join(outputDir, 'oxigraph'));
    const { configureApp } = await import('../../src/index.js');
    app = Fastify({ logger: false });
    ({ teardown } = await configureApp(app as never, { enableCacheMonitoring: false, registerSwagger: false }));
    await app.ready();

    const library = await send('POST', '/libraries', { name: 'Pinned', slug: 'pinned' });
    ids.library = library.body.id;
    const dataGraph = await send('POST', '/data-graphs', { name: 'People', isPartOf: [ids.library] });
    ids.dataGraph = dataGraph.body.id;
    const graphVersion = await send('POST', `/data-graphs/${encodeURIComponent(ids.dataGraph)}/versions`, {
      contentString: '@prefix ex: <http://example.org/> . ex:alice ex:name "Alice" . ex:bob ex:name "Bob" .',
      contentFormat: 'text/turtle',
    });
    ids.dataGraphVersion = graphVersion.body.id ?? graphVersion.body.$id;

    const pinnedBackend = await send('POST', '/backends', {
      name: 'Pinned store',
      backendType: 'oxigraphMemory',
      oxigraphConfig: JSON.stringify({ storeType: 'ephemeral', mode: 'readOnly', sources: [{ dataGraphVersionId: ids.dataGraphVersion }] }),
    });
    ids.pinnedBackend = pinnedBackend.body.id;
    const trackingBackend = await send('POST', '/backends', {
      name: 'Tracking store',
      backendType: 'oxigraphMemory',
      oxigraphConfig: JSON.stringify({ storeType: 'ephemeral', mode: 'readOnly', sources: [{ dataGraphId: ids.dataGraph }] }),
    });
    ids.trackingBackend = trackingBackend.body.id;

    const query = await send('POST', '/queries', { name: 'Names', isPartOf: [ids.library] });
    ids.query = query.body.id;
    const version = await send('POST', `/queries/${encodeURIComponent(ids.query)}/versions`, {
      queryVersion: { queryString: 'PREFIX ex: <http://example.org/> SELECT ?name WHERE { ?p ex:name ?name } ORDER BY ?name' },
    });
    ids.queryVersion = version.body.queryVersion?.id;
  });

  afterAll(async () => {
    await teardown?.();
    await fs.rm(outputDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('has the fixtures it needs', () => {
    expect(ids.dataGraphVersion).toBeTruthy();
    expect(ids.queryVersion).toBeTruthy();
    expect(ids.pinnedBackend).toBeTruthy();
  });

  it('caches a query version on a store of data-graph versions', async () => {
    const response = await app.inject({ method: 'GET', url: executeUrl(ids.queryVersion, ids.pinnedBackend) });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Alice');
    expect(response.headers.etag).toMatch(/^"p1-/);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers.vary).toContain('Accept');
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const first = await app.inject({ method: 'GET', url: executeUrl(ids.queryVersion, ids.pinnedBackend) });
    const second = await app.inject({
      method: 'GET',
      url: executeUrl(ids.queryVersion, ids.pinnedBackend),
      headers: { 'if-none-match': first.headers.etag as string },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });

  it('gives another ETag for another media type', async () => {
    const json = await app.inject({ method: 'GET', url: executeUrl(ids.queryVersion, ids.pinnedBackend) });
    const csv = await app.inject({
      method: 'GET',
      url: executeUrl(ids.queryVersion, ids.pinnedBackend),
      headers: { accept: 'text/csv' },
    });
    expect(csv.headers.etag).toBeDefined();
    expect(csv.headers.etag).not.toBe(json.headers.etag);
  });

  it('keeps no-store for a query named by its stable id', async () => {
    const response = await app.inject({ method: 'GET', url: executeUrl(ids.query, ids.pinnedBackend) });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('keeps no-store for a store that tracks a data graph', async () => {
    const response = await app.inject({ method: 'GET', url: executeUrl(ids.queryVersion, ids.trackingBackend) });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
