/**
 * docs/guides/rest-api-walkthrough.md, executed.
 *
 * Issue #467 asked for one tested client-facing path rather than another
 * architecture document: register a query, pin a version, execute it with
 * arguments, run an ETL job and download the RDF it wrote. The request bodies
 * are not duplicated here — they are read out of that page, so a body that
 * drifts from what the API accepts fails this test instead of misleading the
 * next client to copy it.
 *
 * The instance is the real one: `configureApp` from `src/index.ts`, the same
 * function `start()` calls, with real routes, real schema validation, a real
 * in-process store and real DuckDB. No repository doubles, so nothing here can
 * pass against an envelope the server does not actually produce — which is how
 * the reported mistakes (a `queryVersion` wrapper, a version id at
 * `response.queryVersion.id`, `limits` as an array) went unnoticed downstream.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import oxigraph from 'oxigraph';

const DOC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/guides/rest-api-walkthrough.md',
);

/**
 * The JSON block under `<!-- example: name -->` in the document, with
 * `{{placeholder}}` resolved from ids earlier calls returned.
 *
 * Substitution happens on the raw text before parsing, so a placeholder works
 * inside a nested JSON string too — which `oxigraphConfig` is.
 */
function example(markdown: string, name: string, values: Record<string, string> = {}): unknown {
  const marker = new RegExp(`<!-- example: ${name} -->\\s*\`\`\`json\\n([\\s\\S]*?)\`\`\``);
  const match = markdown.match(marker);
  if (!match) {
    throw new Error(`No example named "${name}" in ${DOC}`);
  }
  const resolved = match[1].replace(/\{\{(\w+)\}\}/g, (_whole, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Example "${name}" uses {{${key}}}, which nothing has provided`);
    }
    // The value is interpolated into JSON source, including inside the escaped
    // JSON string `oxigraphConfig` is, so it must not carry a quote or a
    // backslash of its own. Minted ids never do; asserting it keeps a future
    // id scheme from producing a silently malformed body.
    if (/["\\]/.test(value)) {
      throw new Error(`Cannot substitute ${key}: ${value}`);
    }
    return value;
  });
  return JSON.parse(resolved);
}

describe('the worked REST example, against a real API instance', () => {
  let app: FastifyInstance;
  let teardown: () => Promise<void>;
  let outputDir: string;
  let markdown: string;

  const previousEnv: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string) => {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  };

  beforeAll(async () => {
    markdown = await fs.readFile(DOC, 'utf8');

    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rest-example-etl-'));
    // The deployment the document describes, minus the paths that belong to a
    // container: the flags it says to turn on, and a writable output directory.
    setEnv('ETL_OUTPUT_DIR', outputDir);
    setEnv('FEATURE_QUERIES', 'true');
    setEnv('FEATURE_BACKENDS', 'true');
    setEnv('FEATURE_DATA_GRAPHS', 'true');
    setEnv('FEATURE_ETL', 'true');
    setEnv('INTERNAL_BACKEND_TYPE', 'oxigraph-memory');
    // Keep the run's serialized stores out of the working tree: the store
    // manager is a singleton whose default is `./storage/oxigraph`, relative to
    // the package, and nothing in the boot path points it elsewhere for an
    // in-memory internal backend.
    setEnv('OXIGRAPH_STORAGE_DIR', path.join(outputDir, 'oxigraph'));
    const { oxigraphStoreManager } = await import('../../src/lib/OxigraphStoreManager.js');
    await oxigraphStoreManager.initialize(path.join(outputDir, 'oxigraph'));

    const { configureApp } = await import('../../src/index.js');
    app = Fastify({ logger: false });
    ({ teardown } = await configureApp(app as never, {
      enableCacheMonitoring: false,
      registerSwagger: false,
    }));
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await teardown?.();
    await fs.rm(outputDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('runs the document end to end: pinned execution, then an ETL run whose RDF parses', async () => {
    const ids: Record<string, string> = {};
    const post = async (url: string, name: string) => {
      const response = await app.inject({ method: 'POST', url, payload: example(markdown, name, ids) as object });
      return { status: response.statusCode, body: response.json() as Record<string, never> };
    };

    // §1–§3: a library, data, and a store hydrated from it.
    const library = await post('/libraries', 'createLibrary');
    expect(library.status).toBe(201);
    ids.libraryId = library.body.id;

    const dataGraph = await post('/data-graphs', 'createDataGraph');
    expect(dataGraph.status).toBe(201);
    ids.dataGraphId = dataGraph.body.id;

    const dataGraphVersion = await post(
      `/data-graphs/${encodeURIComponent(ids.dataGraphId)}/versions`,
      'createDataGraphVersion',
    );
    expect(dataGraphVersion.status).toBe(201);
    expect(dataGraphVersion.body).toMatchObject({ version: 1, tripleCount: 6 });

    const backend = await post('/backends', 'createBackend');
    expect(backend.status).toBe(201);
    ids.backendId = backend.body.id;

    // §4: the query, then the version that carries the SPARQL.
    const query = await post('/queries', 'createQuery');
    expect(query.status).toBe(201);
    ids.queryId = query.body.id;

    const version = await post(`/queries/${encodeURIComponent(ids.queryId)}/v`, 'createQueryVersion');
    expect(version.status).toBe(201);
    // The claim the document makes twice: the id is under `queryVersion`, and
    // the response is not the entity itself.
    expect(version.body.id).toBeUndefined();
    ids.queryVersionId = (version.body.queryVersion as unknown as { id: string }).id;
    expect(ids.queryVersionId).toMatch(/^urn:sqlib:query-version:/);
    // `LIMIT 0001` declared a limit parameter; that is what `limits` binds.
    expect((version.body.limitParameters as unknown as unknown[]).length).toBe(1);

    // §5: the pinned version, with an argument and a bound limit.
    const pinned = await post('/execute', 'executePinnedVersion');
    expect(pinned.status).toBe(200);
    const names = (bindings: unknown) =>
      (bindings as { name: { value: string } }[]).map(binding => binding.name.value);
    expect(names((pinned.body.results as unknown as { bindings: unknown }).bindings)).toEqual(['Alice', 'Cara']);

    const badLimits = await post('/execute', 'executeBadLimits');
    expect(badLimits.status).toBe(400);
    expect(badLimits.body.error).toBe('"limits" must be of type array');

    const limitOne = await post('/execute', 'executePinnedVersionLimitOne');
    expect(limitOne.status).toBe(200);
    expect(names((limitOne.body.results as unknown as { bindings: unknown }).bindings)).toEqual(['Alice']);

    // §6: a newer version moves the query, and pins nothing.
    const second = await post(`/queries/${encodeURIComponent(ids.queryId)}/v`, 'createSecondQueryVersion');
    expect(second.status).toBe(201);
    const reread = await app.inject({ method: 'GET', url: `/queries/${encodeURIComponent(ids.queryId)}` });
    expect(reread.json()).toMatchObject({
      currentVersionNumber: 2,
      currentVersion: (second.body.queryVersion as unknown as { id: string }).id,
    });

    const followsCurrent = await post('/execute', 'executeQueryFollowsCurrent');
    expect(followsCurrent.status).toBe(200);
    // Version 2 selects subjects, not names: executing the query id followed it.
    expect(followsCurrent.body.head as unknown).toEqual({ vars: ['s'] });

    const stillPinned = await post('/execute', 'executePinnedVersion');
    expect(stillPinned.status).toBe(200);
    expect(names((stillPinned.body.results as unknown as { bindings: unknown }).bindings)).toEqual(['Alice', 'Cara']);

    // §7: the ETL job, its output file, and the triples in it.
    const job = await post('/etl-jobs', 'createEtlJob');
    expect(job.status).toBe(201);
    ids.etlJobId = job.body.id;

    const jobVersion = await post(`/etl-jobs/${encodeURIComponent(ids.etlJobId)}/versions`, 'createEtlJobVersion');
    expect(jobVersion.status).toBe(201);
    ids.etlJobVersionId = jobVersion.body.id;

    const mapping = await post(
      `/etl-jobs/versions/${encodeURIComponent(ids.etlJobVersionId)}/column-mappings`,
      'createColumnMapping',
    );
    expect(mapping.status).toBe(201);

    const execution = await post(`/etl-jobs/${encodeURIComponent(ids.etlJobId)}/execute`, 'executeEtlJob');
    expect(execution.status).toBe(200);
    expect(execution.body).toMatchObject({
      status: 'completed',
      outputFormat: 'application/n-quads',
      totalRows: 8,
      totalChunks: 3,
      completedChunks: 3,
    });
    ids.executionId = execution.body.executionId;
    // The run wrote where the deployment said to write, not somewhere else.
    expect(execution.body.outputLocation as unknown as string).toContain(outputDir);

    const output = await app.inject({
      method: 'GET',
      url: `/etl-jobs/executions/${encodeURIComponent(ids.executionId)}/output`,
    });
    expect(output.statusCode).toBe(200);
    expect(output.headers['content-type']).toContain('application/n-quads');

    // Parsed as RDF rather than matched as text: what a consumer does with it.
    const store = new oxigraph.Store();
    store.load(output.body, { format: 'application/n-quads' });
    expect(store.size).toBe(24); // three triples per person, eight people

    const asked = (sparql: string) => store.query(sparql) as boolean;
    expect(asked(`
      PREFIX ex: <http://example.org/>
      ASK { <http://example.org/person/alice> a ex:Person ; ex:name "Alice" ; ex:city "Perth" }
    `)).toBe(true);
    expect(asked(`
      PREFIX ex: <http://example.org/>
      ASK { <http://example.org/person/hana> a ex:Person ; ex:name "Hana" ; ex:city "Darwin" }
    `)).toBe(true);
    // The last chunk is the remainder, and it is in the file like any other.
    expect(asked(`
      PREFIX ex: <http://example.org/>
      ASK { <http://example.org/person/gus> ex:city "Hobart" }
    `)).toBe(true);
  }, 180_000);

  it('rejects query tags that do not name tag entities, as the document warns', async () => {
    const library = await app.inject({
      method: 'POST',
      url: '/libraries',
      payload: { name: 'Tag check' },
    });
    const libraryId = library.json().id as string;

    const freeText = await app.inject({
      method: 'POST',
      url: '/queries',
      payload: { name: 'Tagged with free text', isPartOf: [libraryId], tags: ['demo'] },
    });
    expect(freeText.statusCode).toBeGreaterThanOrEqual(400);

    const danglingIri = await app.inject({
      method: 'POST',
      url: '/queries',
      payload: { name: 'Tagged with an invented IRI', isPartOf: [libraryId], tags: ['urn:sqlib:tag:nothing-here'] },
    });
    expect(danglingIri.statusCode).toBeGreaterThanOrEqual(400);

    // Omitting tags is what works.
    const untagged = await app.inject({
      method: 'POST',
      url: '/queries',
      payload: { name: 'Untagged', isPartOf: [libraryId] },
    });
    expect(untagged.statusCode).toBe(201);
  }, 60_000);
});
