/**
 * A throwaway server for the OGC CITE suite (`scripts/ci/ogc-cite.sh`).
 *
 * It loads the plain starter set (`docs/examples/ogc/plain`) into an
 * in-memory store through the API, as an author would, then starts a second
 * instance over the same store with `FEATURE_OGC=true` and listens. The
 * collections are collected when a server starts, so the second instance is
 * the one that serves them, as after a restart.
 *
 *   OGC_CITE_PORT=7740 SQLIB_OGC_BASE_URL=http://host.docker.internal:7740 \
 *     pnpm --filter @sparql-query-lib/api exec tsx scripts/ogc-cite-server.ts
 */
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, '../../../docs/examples/ogc/plain');
const port = Number(process.env.OGC_CITE_PORT ?? 7740);

process.env.INTERNAL_BACKEND_TYPE ||= 'oxigraph-memory';
process.env.CACHE_WRITE_THROUGH = 'true';
process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT ||= 'http://example.org/sparql';
process.env.FEATURE_OGC = 'true';
process.env.FEATURE_QUERIES = 'true';
process.env.FEATURE_BACKENDS = 'true';
process.env.FEATURE_DATA_GRAPHS = 'true';
process.env.OTEL_ENABLED ||= 'false';

async function start(): Promise<FastifyInstance> {
  const { configureApp } = await import('../src/index.js');
  const app = Fastify({ logger: false });
  await configureApp(app as never, { enableCacheMonitoring: false, registerSwagger: false });
  await app.ready();
  return app;
}

async function call(app: FastifyInstance, method: 'POST', url: string, payload: object): Promise<{ id?: string; queryVersion?: unknown }> {
  const response = await app.inject({ method, url, payload });
  if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.statusCode} ${response.body}`);
  return response.json();
}

async function main() {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'ogc-cite-'));
  process.env.OXIGRAPH_STORAGE_DIR = path.join(storage, 'oxigraph');
  const { oxigraphStoreManager } = await import('../src/lib/OxigraphStoreManager.js');
  await oxigraphStoreManager.initialize(process.env.OXIGRAPH_STORAGE_DIR);

  const author = await start();
  const library = await call(author, 'POST', '/libraries', { name: 'Survey', slug: 'survey', description: 'The OGC starter set.' });
  const graph = await call(author, 'POST', '/data-graphs', { name: 'Buildings', isPartOf: [library.id] });
  await call(author, 'POST', `/data-graphs/${encodeURIComponent(graph.id!)}/versions`, {
    contentString: await fs.readFile(path.join(examples, 'buildings.ttl'), 'utf8'),
    contentFormat: 'text/turtle',
  });
  const backend = await call(author, 'POST', '/backends', {
    name: 'Survey store',
    backendType: 'oxigraphMemory',
    oxigraphConfig: JSON.stringify({ storeType: 'ephemeral', mode: 'ephemeral', sources: [{ dataGraphId: graph.id }] }),
  });
  const query = await call(author, 'POST', '/queries', { name: 'Buildings', isPartOf: [library.id], defaultBackend: backend.id });
  await call(author, 'POST', `/queries/${encodeURIComponent(query.id!)}/versions`, {
    queryVersion: {
      queryString: await fs.readFile(path.join(examples, 'buildings.rq'), 'utf8'),
      ogc: JSON.parse(await fs.readFile(path.join(examples, 'buildings.ogc.json'), 'utf8')),
    },
  });

  const server = await start();
  await server.listen({ port, host: '0.0.0.0' });
  console.log(`OGC CITE server on port ${port}: /ogc/survey`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
