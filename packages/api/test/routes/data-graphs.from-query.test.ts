/**
 * `POST /data-graphs/:id/versions/from-query` — a version materialized by
 * running a CONSTRUCT/DESCRIBE query against a backend, rather than uploaded
 * by hand (issue #153). `createDataGraphVersion` itself — caps, freezing,
 * cache invalidation — is covered by `data-graphs.crud.test.ts`; these tests
 * are about resolving the query/argument-set/backend and running it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import dataGraphRoutes from '../../src/routes/data-graphs.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { DataGraphContentError } from '../../src/lib/dataGraphContent.js';

const GRAPH_ID = 'urn:sqlib:data-graph:g1';
const BACKEND_ID = 'urn:sqlib:backend:from-query-test';
const CONSTRUCT_VERSION_ID = 'urn:sqlib:query-version:construct';
const SELECT_VERSION_ID = 'urn:sqlib:query-version:select';

const BACKEND = {
  $id: BACKEND_ID,
  '@type': 'Backend',
  name: 'From-query test backend',
  backendType: BackendTypeIri.oxigraphEphemeral,
};

const { entities, hoisted } = vi.hoisted(() => ({
  entities: new Map<string, unknown>(),
  hoisted: {
    dataGraph: { get: vi.fn() },
    mockCreateVersion: vi.fn(),
  },
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({ DataGraph: hoisted.dataGraph }),
  getCacheCoordinator: () => ({ get: (id: string) => entities.get(id) ?? null }),
}));

vi.mock('../../src/lib/DataGraphVersionWriter.js', () => ({
  createDataGraphVersion: hoisted.mockCreateVersion,
}));

entities.set(BACKEND_ID, BACKEND);
entities.set(CONSTRUCT_VERSION_ID, {
  $id: CONSTRUCT_VERSION_ID,
  '@type': 'QueryVersion',
  queryString: 'CONSTRUCT { ?s <http://ex/p> ?o } WHERE { ?s <http://ex/p> ?o }',
  queryType: QueryTypeIri.construct,
});
entities.set(SELECT_VERSION_ID, {
  $id: SELECT_VERSION_ID,
  '@type': 'QueryVersion',
  queryString: 'SELECT * WHERE { ?s ?p ?o }',
  queryType: QueryTypeIri.select,
});

const SEED = '<http://ex/a> <http://ex/p> <http://ex/b> .\n<http://ex/c> <http://ex/p> <http://ex/d> .\n';

describe('POST /data-graphs/:id/versions/from-query', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      if (error.validation && Array.isArray(error.validation)) {
        return reply.status(statusCode).send({ error: error.validation[0]?.message ?? 'Validation failed' });
      }
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(dataGraphRoutes, { prefix: '/data-graphs' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.dataGraph.get.mockReturnValue({ $id: GRAPH_ID, '@type': 'DataGraph', name: 'Example data' });

    const fresh = oxigraphStoreManager.createEphemeralStore(BACKEND_ID);
    fresh.load(SEED, { format: 'application/n-quads' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the CONSTRUCT query and hands the writer a snapshot with source provenance', async () => {
    hoisted.mockCreateVersion.mockResolvedValue({
      $id: 'urn:sqlib:data-graph-version:v1',
      '@type': 'DataGraphVersion',
      isPartOf: GRAPH_ID,
      version: 1,
      contentString: SEED,
      contentFormat: 'application/n-quads',
      tripleCount: 2,
      byteSize: SEED.length,
      sourceQueryVersion: CONSTRUCT_VERSION_ID,
      sourceBackend: BACKEND_ID,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
      payload: { queryVersionId: CONSTRUCT_VERSION_ID, backendId: BACKEND_ID },
    });

    expect(res.statusCode, res.payload).toBe(201);
    expect(hoisted.mockCreateVersion).toHaveBeenCalledTimes(1);
    const [dataGraphId, input] = hoisted.mockCreateVersion.mock.calls[0];
    expect(dataGraphId).toBe(GRAPH_ID);
    expect(input.contentFormat).toBe('application/n-quads');
    expect(input.contentString).toContain('<http://ex/a>');
    expect(input.source).toMatchObject({
      queryVersionId: CONSTRUCT_VERSION_ID,
      argumentSetVersionId: null,
      backendId: BACKEND_ID,
    });
    expect(input.source.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof input.source.executedAt).toBe('string');
  });

  it('404s on a data graph that does not exist', async () => {
    hoisted.dataGraph.get.mockReturnValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
      payload: { queryVersionId: CONSTRUCT_VERSION_ID, backendId: BACKEND_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  it('404s on a query version that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
      payload: { queryVersionId: 'urn:sqlib:query-version:missing', backendId: BACKEND_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('urn:sqlib:query-version:missing');
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  it('refuses a query that is not CONSTRUCT/DESCRIBE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
      payload: { queryVersionId: SELECT_VERSION_ID, backendId: BACKEND_ID },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('CONSTRUCT or DESCRIBE');
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  it('404s on a backend that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
      payload: { queryVersionId: CONSTRUCT_VERSION_ID, backendId: 'urn:sqlib:backend:missing' },
    });

    expect(res.statusCode).toBe(404);
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  /**
   * The same rule #211 needed for the tuple-set sink, applied here because this
   * sink is the same shape.
   *
   * The first call's own `resultHash` becomes the graph's current version, so
   * the comparison is against the hash the sink really produces rather than a
   * constant copied into the fixture.
   */
  describe('an unchanged re-run cuts no version', () => {
    const CURRENT_VERSION_ID = 'urn:sqlib:data-graph-version:current';

    function withCurrentVersion(stored: Record<string, unknown>): void {
      entities.set(CURRENT_VERSION_ID, {
        $id: CURRENT_VERSION_ID,
        '@type': 'DataGraphVersion',
        isPartOf: GRAPH_ID,
        version: 1,
        contentString: SEED,
        contentFormat: 'application/n-quads',
        tripleCount: 2,
        byteSize: SEED.length,
        ...stored,
      });
      entities.set(GRAPH_ID, {
        $id: GRAPH_ID,
        '@type': 'DataGraph',
        name: 'Example data',
        currentVersion: CURRENT_VERSION_ID,
      });
    }

    async function firstRun(): Promise<string> {
      hoisted.mockCreateVersion.mockResolvedValue({
        $id: 'urn:sqlib:data-graph-version:v1',
        '@type': 'DataGraphVersion',
        isPartOf: GRAPH_ID,
        version: 1,
        contentString: SEED,
        contentFormat: 'application/n-quads',
        tripleCount: 2,
        byteSize: SEED.length,
      });
      const res = await app.inject({
        method: 'POST',
        url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
        payload: { queryVersionId: CONSTRUCT_VERSION_ID, backendId: BACKEND_ID },
      });
      expect(res.statusCode, res.payload).toBe(201);
      const [, input] = hoisted.mockCreateVersion.mock.calls[0];
      const hash = input.source.resultHash as string;
      hoisted.mockCreateVersion.mockClear();
      return hash;
    }

    afterEach(() => {
      entities.delete(CURRENT_VERSION_ID);
      entities.delete(GRAPH_ID);
    });

    it('answers 200 with the version that already holds the graph', async () => {
      const hash = await firstRun();
      withCurrentVersion({
        sourceResultHash: hash,
        sourceQueryVersion: CONSTRUCT_VERSION_ID,
        sourceBackend: BACKEND_ID,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
        payload: { queryVersionId: CONSTRUCT_VERSION_ID, backendId: BACKEND_ID },
      });

      expect(res.statusCode, res.payload).toBe(200);
      expect(res.json().id).toBe(CURRENT_VERSION_ID);
      expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
    });

    it('cuts a version when the same graph came from a different backend', async () => {
      const hash = await firstRun();
      withCurrentVersion({
        sourceResultHash: hash,
        sourceQueryVersion: CONSTRUCT_VERSION_ID,
        sourceBackend: 'urn:sqlib:backend:somewhere-else',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
        payload: { queryVersionId: CONSTRUCT_VERSION_ID, backendId: BACKEND_ID },
      });

      // "The same triples" and "the same store answered" are two claims, and
      // only the second one is what a pinned version's provenance says.
      expect(res.statusCode, res.payload).toBe(201);
      expect(hoisted.mockCreateVersion).toHaveBeenCalledTimes(1);
    });

    it('cuts a version when the current one records no hash', async () => {
      await firstRun();
      withCurrentVersion({
        sourceQueryVersion: CONSTRUCT_VERSION_ID,
        sourceBackend: BACKEND_ID,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
        payload: { queryVersionId: CONSTRUCT_VERSION_ID, backendId: BACKEND_ID },
      });

      expect(res.statusCode, res.payload).toBe(201);
      expect(hoisted.mockCreateVersion).toHaveBeenCalledTimes(1);
    });
  });

  it('turns a writer rejection (over the size cap) into a 400', async () => {
    hoisted.mockCreateVersion.mockRejectedValue(
      new DataGraphContentError('Data graph content is 999 bytes, over the 512-byte limit for one version'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/from-query`,
      payload: { queryVersionId: CONSTRUCT_VERSION_ID, backendId: BACKEND_ID },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('over the 512-byte limit');
  });
});
