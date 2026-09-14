/**
 * `POST /tuple-sets/:id/versions/from-etl` — a version materialized by running
 * an ETL job version's SQL, rather than uploaded by hand (issue #211).
 *
 * `createTupleSetVersion` itself — normalisation, caps, freezing — is covered
 * by `tuple-sets.crud.test.ts`, and is mocked here. What these assert is the
 * half this adds: resolving the job version and its mapping, turning rows into
 * a SPARQL Results JSON document through the same conversion the SPARQL load
 * path uses, and refusing to store a table that outgrew the cap.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import tupleSetRoutes from '../../src/routes/tuple-sets.js';
import { TupleContentError } from '../../src/lib/tupleContent.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext, LibraryMode } from '../../src/auth/types.js';

const SET_ID = 'urn:sqlib:tuple-set:s1';
const SET_LIBRARY_ID = 'urn:sqlib:library:tuples';
const JOB_LIBRARY_ID = 'urn:sqlib:library:pipelines';
const JOB_ID = 'urn:sqlib:etl-job:j1';
const JOB_VERSION_ID = 'urn:sqlib:etl-job-version:v1';
const MAPPING_ID = 'urn:sqlib:etl-column-mapping-version:m1';
const OTHER_MAPPING_ID = 'urn:sqlib:etl-column-mapping-version:m0';
/** Same SQL and same mapping as `JOB_VERSION_ID`, so it produces the same hash. */
const TWIN_JOB_VERSION_ID = 'urn:sqlib:etl-job-version:v2';
const CURRENT_VERSION_ID = 'urn:sqlib:tuple-set-version:current';

const { entities, hoisted } = vi.hoisted(() => ({
  entities: new Map<string, unknown>(),
  hoisted: {
    tupleSet: { get: vi.fn(), list: vi.fn() },
    tupleSetVersion: { get: vi.fn(), list: vi.fn() },
    mockCreateVersion: vi.fn(),
    streamChunks: vi.fn(),
    /** The run log's writes — `etlRunLog.ts` goes through these two. */
    createEntity: vi.fn(),
    updateEntity: vi.fn(),
  },
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    TupleSet: hoisted.tupleSet,
    TupleSetVersion: hoisted.tupleSetVersion,
  }),
  getCacheCoordinator: () => ({
    get: (id: string) => entities.get(id) ?? null,
    create: hoisted.createEntity,
    update: hoisted.updateEntity,
  }),
}));

/** The `EtlExecution` this run opened, as the sink wrote it. */
function loggedExecution(): Record<string, unknown> {
  expect(hoisted.createEntity).toHaveBeenCalledTimes(1);
  const [type, payload] = hoisted.createEntity.mock.calls[0];
  expect(type).toBe('EtlExecution');
  return payload as Record<string, unknown>;
}

/** How that record was closed — the last update to it. */
function loggedOutcome(): Record<string, unknown> {
  const executionId = loggedExecution().$id;
  const updates = hoisted.updateEntity.mock.calls.filter(
    ([type, id]) => type === 'EtlExecution' && id === executionId,
  );
  expect(updates.length).toBeGreaterThan(0);
  return updates[updates.length - 1][2] as Record<string, unknown>;
}

vi.mock('../../src/lib/TupleSetVersionWriter.js', () => ({
  createTupleSetVersion: hoisted.mockCreateVersion,
  annotateTupleSetVersion: vi.fn(),
  // Small enough that a few dozen rows cross it, so the cap test exercises the
  // guard rather than a megabyte of generated fixture.
  MAX_TUPLE_SET_VERSION_BYTES: 1024,
}));

/** The rows are mocked; `DuckDbService.test.ts` exercises the real reader. */
vi.mock('../../src/lib/DuckDbService.js', () => ({
  duckDbService: { streamChunks: hoisted.streamChunks },
  mapDuckDbTypeToXsd: () => 'http://www.w3.org/2001/XMLSchema#string',
}));

const COLUMNS = [
  {
    columnName: 'city',
    targetVariable: 'city',
    termType: 'uri',
    iriTemplate: 'http://ex/city/{value}',
    nullPolicy: 'undef',
  },
  {
    columnName: 'population',
    targetVariable: 'population',
    termType: 'literal',
    datatypeIri: 'http://www.w3.org/2001/XMLSchema#integer',
    nullPolicy: 'undef',
  },
];

entities.set(SET_LIBRARY_ID, { $id: SET_LIBRARY_ID, '@type': 'Library', name: 'Tuples' });
entities.set(JOB_LIBRARY_ID, { $id: JOB_LIBRARY_ID, '@type': 'Library', name: 'Pipelines' });
const SET_ENTITY = { $id: SET_ID, '@type': 'TupleSet', name: 'Cities', isPartOf: [SET_LIBRARY_ID] };
entities.set(SET_ID, SET_ENTITY);
entities.set(JOB_ID, { $id: JOB_ID, '@type': 'EtlJob', name: 'Cities', isPartOf: [JOB_LIBRARY_ID] });
entities.set(JOB_VERSION_ID, {
  $id: JOB_VERSION_ID,
  '@type': 'EtlJobVersion',
  isPartOf: JOB_ID,
  sql: 'SELECT city, population FROM cities',
  sparqlTemplate: 'INSERT { ?s ?p ?o } WHERE {}',
  backendId: 'urn:sqlib:backend:b1',
  currentColumnMappingVersion: MAPPING_ID,
  chunkSize: 2,
});
entities.set(TWIN_JOB_VERSION_ID, {
  $id: TWIN_JOB_VERSION_ID,
  '@type': 'EtlJobVersion',
  isPartOf: JOB_ID,
  sql: 'SELECT city, population FROM cities',
  sparqlTemplate: 'INSERT { ?s ?p ?o } WHERE {}',
  backendId: 'urn:sqlib:backend:b1',
  currentColumnMappingVersion: MAPPING_ID,
  chunkSize: 2,
});
entities.set(MAPPING_ID, {
  $id: MAPPING_ID,
  '@type': 'EtlColumnMappingVersion',
  columns: JSON.stringify(COLUMNS),
});
entities.set(OTHER_MAPPING_ID, {
  $id: OTHER_MAPPING_ID,
  '@type': 'EtlColumnMappingVersion',
  columns: JSON.stringify([COLUMNS[1]]),
});

/** A stream yielding `chunks` of already-shaped DuckDB rows. */
function rowsInChunks(chunks: Record<string, unknown>[][]): void {
  hoisted.streamChunks.mockImplementation(async function* () {
    for (const rows of chunks) {
      yield { rows, timing: { initMs: 0, connectionMs: 0, queryMs: 0, serializeMs: 0, totalMs: 0 } };
    }
  });
}

function post(payload: Record<string, unknown>, setId = SET_ID) {
  return app.inject({
    method: 'POST',
    url: `/tuple-sets/${encodeURIComponent(setId)}/versions/from-etl`,
    payload,
  });
}

let app: FastifyInstance;

describe('POST /tuple-sets/:id/versions/from-etl', () => {
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
    await app.register(tupleSetRoutes, { prefix: '/tuple-sets' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.tupleSet.get.mockReturnValue({ $id: SET_ID, '@type': 'TupleSet', name: 'Cities' });
    hoisted.mockCreateVersion.mockImplementation(async (tupleSetId: string, body: Record<string, unknown>) => ({
      $id: 'urn:sqlib:tuple-set-version:v1',
      '@type': 'TupleSetVersion',
      isPartOf: tupleSetId,
      version: 1,
      contentString: body.contentString,
      sourceFormat: body.sourceFormat,
      tupleColumns: ['city', 'population'],
      rowCount: 2,
    }));
    rowsInChunks([[{ city: 'paris', population: 2 }], [{ city: 'rome', population: 3 }]]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the SQL and hands the writer an SRJ document with ETL provenance', async () => {
    const res = await post({ etlJobVersionId: JOB_VERSION_ID, comment: 'nightly' });

    expect(res.statusCode, res.payload).toBe(201);
    expect(hoisted.mockCreateVersion).toHaveBeenCalledTimes(1);
    const [tupleSetId, input] = hoisted.mockCreateVersion.mock.calls[0];
    expect(tupleSetId).toBe(SET_ID);
    expect(input.sourceFormat).toBe('etl-results');
    expect(input.comment).toBe('nightly');

    // Every chunk's rows, in stream order, typed by the mapping.
    expect(JSON.parse(input.contentString)).toEqual({
      head: { vars: ['city', 'population'] },
      results: {
        bindings: [
          {
            city: { type: 'uri', value: 'http://ex/city/paris' },
            population: { type: 'literal', value: '2', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
          },
          {
            city: { type: 'uri', value: 'http://ex/city/rome' },
            population: { type: 'literal', value: '3', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
          },
        ],
      },
    });

    expect(input.source).toMatchObject({
      etlJobVersionId: JOB_VERSION_ID,
      columnMappingVersionId: MAPPING_ID,
    });
    expect(input.source.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof input.source.executedAt).toBe('string');
    expect(hoisted.streamChunks).toHaveBeenCalledWith('SELECT city, population FROM cities', 2);
  });

  it('pins the mapping version when one is named, rather than the job version’s current one', async () => {
    const res = await post({ etlJobVersionId: JOB_VERSION_ID, columnMappingVersionId: OTHER_MAPPING_ID });

    expect(res.statusCode, res.payload).toBe(201);
    const [, input] = hoisted.mockCreateVersion.mock.calls[0];
    expect(input.source.columnMappingVersionId).toBe(OTHER_MAPPING_ID);
    expect(JSON.parse(input.contentString).head.vars).toEqual(['population']);
  });

  it('404s on a tuple set that does not exist', async () => {
    hoisted.tupleSet.get.mockReturnValue(null);

    const res = await post({ etlJobVersionId: JOB_VERSION_ID });

    expect(res.statusCode).toBe(404);
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  it('404s on an ETL job version that does not exist', async () => {
    const res = await post({ etlJobVersionId: 'urn:sqlib:etl-job-version:missing' });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('urn:sqlib:etl-job-version:missing');
    expect(hoisted.streamChunks).not.toHaveBeenCalled();
  });

  it('404s on a mapping version that does not exist', async () => {
    const res = await post({
      etlJobVersionId: JOB_VERSION_ID,
      columnMappingVersionId: 'urn:sqlib:etl-column-mapping-version:missing',
    });

    expect(res.statusCode).toBe(404);
    expect(hoisted.streamChunks).not.toHaveBeenCalled();
  });

  it('refuses a job version with no mapping at all — nothing says what the columns are', async () => {
    const bare = 'urn:sqlib:etl-job-version:bare';
    entities.set(bare, {
      $id: bare,
      '@type': 'EtlJobVersion',
      sql: 'SELECT 1',
      sparqlTemplate: '',
      backendId: 'urn:sqlib:backend:b1',
    });

    const res = await post({ etlJobVersionId: bare });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('no current column mapping version');
    expect(hoisted.streamChunks).not.toHaveBeenCalled();
  });

  it('refuses a mapping that maps no columns', async () => {
    const empty = 'urn:sqlib:etl-column-mapping-version:empty';
    entities.set(empty, { $id: empty, '@type': 'EtlColumnMappingVersion', columns: '[]' });

    const res = await post({ etlJobVersionId: JOB_VERSION_ID, columnMappingVersionId: empty });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('maps no columns');
    expect(hoisted.streamChunks).not.toHaveBeenCalled();
  });

  it('fails loudly when the result outgrows the per-version cap, rather than storing part of it', async () => {
    rowsInChunks([
      Array.from({ length: 50 }, (_, i) => ({ city: `city-${i}`, population: i })),
    ]);

    const res = await post({ etlJobVersionId: JOB_VERSION_ID });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('1024-byte limit');
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  /**
   * The route guard covers the tuple set in the path; the ETL job version is
   * the second entity, and running its stored SQL is an execution. A caller who
   * may write the tuple set but not execute in the job's library must not get
   * that SQL run for them.
   */
  describe('the job version’s library is checked, not just the tuple set’s', () => {
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
      await instance.register(tupleSetRoutes, { prefix: '/tuple-sets' });
      await instance.ready();
      return instance;
    }

    const contextWith = (libraries: Map<string, Set<LibraryMode>>): AuthContext => ({
      subject: 'urn:sqlib:principal:user:someone',
      principals: ['urn:sqlib:principal:user:someone'],
      issuer: 'https://issuer.test/',
      tokenType: 'user',
      grants: { admin: false, libraries, backends: new Map() },
      claims: {},
      fullAccess: false,
      mode: 'required',
    });

    it('refuses a caller with write on the tuple set but no execute on the job', async () => {
      const instance = await appAs(contextWith(new Map([
        [SET_LIBRARY_ID, new Set<LibraryMode>(['read', 'write'])],
      ])));

      const res = await instance.inject({
        method: 'POST',
        url: `/tuple-sets/${encodeURIComponent(SET_ID)}/versions/from-etl`,
        payload: { etlJobVersionId: JOB_VERSION_ID },
      });

      expect(res.statusCode).toBe(403);
      // Refused before the SQL reached DuckDB, not after.
      expect(hoisted.streamChunks).not.toHaveBeenCalled();
      expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
      await instance.close();
    });

    it('admits a caller holding both', async () => {
      const instance = await appAs(contextWith(new Map([
        [SET_LIBRARY_ID, new Set<LibraryMode>(['read', 'write'])],
        [JOB_LIBRARY_ID, new Set<LibraryMode>(['execute'])],
      ])));

      const res = await instance.inject({
        method: 'POST',
        url: `/tuple-sets/${encodeURIComponent(SET_ID)}/versions/from-etl`,
        payload: { etlJobVersionId: JOB_VERSION_ID },
      });

      expect(res.statusCode, res.payload).toBe(201);
      await instance.close();
    });
  });

  /**
   * Version churn — #211's fourth point.
   *
   * These run the sink twice: the first call's own `resultHash` becomes the
   * set's current version, which is what the second call compares against. So
   * the hash is the one the sink really produces rather than a constant copied
   * into the fixture, and a change to how the document is built cannot make the
   * test agree with itself while disagreeing with the server.
   */
  describe('an unchanged re-run cuts no version', () => {
    /** The set as the writer would have left it after one successful run. */
    function withCurrentVersion(stored: Record<string, unknown>): void {
      entities.set(CURRENT_VERSION_ID, {
        $id: CURRENT_VERSION_ID,
        '@type': 'TupleSetVersion',
        isPartOf: SET_ID,
        version: 1,
        rowCount: 2,
        tupleColumns: ['city', 'population'],
        sourceFormat: 'etl-results',
        contentString: JSON.stringify({ head: { vars: ['city', 'population'] }, results: { bindings: [] } }),
        ...stored,
      });
      entities.set(SET_ID, { ...SET_ENTITY, currentVersion: CURRENT_VERSION_ID });
    }

    /** Run once and report the hash the sink computed for the current rows. */
    async function firstRun(): Promise<string> {
      const res = await post({ etlJobVersionId: JOB_VERSION_ID });
      expect(res.statusCode, res.payload).toBe(201);
      const [, input] = hoisted.mockCreateVersion.mock.calls[0];
      const hash = input.source.resultHash as string;
      vi.clearAllMocks();
      rowsInChunks([[{ city: 'paris', population: 2 }], [{ city: 'rome', population: 3 }]]);
      return hash;
    }

    afterEach(() => {
      entities.delete(CURRENT_VERSION_ID);
      entities.set(SET_ID, SET_ENTITY);
    });

    it('answers 200 with the version that already holds the rows', async () => {
      const hash = await firstRun();
      withCurrentVersion({
        sourceResultHash: hash,
        sourceEtlJobVersion: JOB_VERSION_ID,
        sourceColumnMappingVersion: MAPPING_ID,
      });

      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      expect(res.statusCode, res.payload).toBe(200);
      expect(res.json().id).toBe(CURRENT_VERSION_ID);
      expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
      // The SQL still ran: the hash is what running produces. What the rule
      // saves is storage, which is what the library cap bounds.
      expect(hoisted.streamChunks).toHaveBeenCalledTimes(1);
    });

    it('cuts a version when the table changed', async () => {
      const hash = await firstRun();
      withCurrentVersion({
        sourceResultHash: hash,
        sourceEtlJobVersion: JOB_VERSION_ID,
        sourceColumnMappingVersion: MAPPING_ID,
      });
      rowsInChunks([[{ city: 'paris', population: 2 }], [{ city: 'rome', population: 4 }]]);

      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      expect(res.statusCode, res.payload).toBe(201);
      expect(hoisted.mockCreateVersion).toHaveBeenCalledTimes(1);
    });

    it('cuts a version when the same rows come from a different job version', async () => {
      const hash = await firstRun();
      withCurrentVersion({
        sourceResultHash: hash,
        sourceEtlJobVersion: TWIN_JOB_VERSION_ID,
        sourceColumnMappingVersion: MAPPING_ID,
      });

      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      // Identical bytes, different claim: reusing the twin's version would
      // attribute these rows to a job version that did not produce them.
      expect(res.statusCode, res.payload).toBe(201);
      expect(hoisted.mockCreateVersion).toHaveBeenCalledTimes(1);
    });

    it('cuts a version when the current one records no hash', async () => {
      await firstRun();
      withCurrentVersion({
        sourceEtlJobVersion: JOB_VERSION_ID,
        sourceColumnMappingVersion: MAPPING_ID,
      });

      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      expect(res.statusCode, res.payload).toBe(201);
      expect(hoisted.mockCreateVersion).toHaveBeenCalledTimes(1);
    });
  });

  it('reports a SQL failure as a 502 naming the source', async () => {
    hoisted.streamChunks.mockImplementation(async function* () {
      throw new Error('Catalog Error: Table with name cities does not exist!');
      // eslint-disable-next-line no-unreachable
      yield undefined;
    });

    const res = await post({ etlJobVersionId: JOB_VERSION_ID });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("Failed to run the ETL job's SQL");
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  /**
   * The run log (issue #211). This sink runs a job version's SQL exactly as
   * `/etl-jobs/:id/execute` does, and until now left no record of having done
   * so — which matters most for the run that stores nothing, since the
   * unchanged re-snapshot rule means the version chain is silent by design.
   */
  describe('the job’s run log', () => {
    // The re-run case installs a current version; clearing it here rather than
    // at the end of that test means a failure there cannot leak into the next.
    afterEach(() => {
      entities.delete(CURRENT_VERSION_ID);
      entities.set(SET_ID, SET_ENTITY);
    });

    it('opens a record naming the job version, the mapping and the set it writes into', async () => {
      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      expect(res.statusCode, res.payload).toBe(201);
      const execution = loggedExecution();
      expect(execution).toMatchObject({
        etlJobVersion: JOB_VERSION_ID,
        columnMappingVersion: MAPPING_ID,
        status: 'running',
      });
      expect(typeof execution.startedAt).toBe('string');
      // The set is on the record from the start, so a run that fails still
      // says where it was going.
      expect(JSON.parse(execution.executionConfig as string)).toEqual({
        chunkSize: 2,
        sink: 'tuple-set',
        tupleSetId: SET_ID,
      });
    });

    it('closes it with the version it cut, the rows read and the chunks read', async () => {
      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      expect(res.statusCode, res.payload).toBe(201);
      expect(loggedOutcome()).toMatchObject({
        status: 'completed',
        totalRows: 2,
        completedChunks: 2,
        totalChunks: 2,
        outputTupleSetVersion: 'urn:sqlib:tuple-set-version:v1',
        outputReused: false,
      });
    });

    it('records an unchanged re-run as a run that produced nothing new', async () => {
      const first = await post({ etlJobVersionId: JOB_VERSION_ID });
      expect(first.statusCode, first.payload).toBe(201);
      const [, input] = hoisted.mockCreateVersion.mock.calls[0];
      const hash = input.source.resultHash as string;
      vi.clearAllMocks();
      rowsInChunks([[{ city: 'paris', population: 2 }], [{ city: 'rome', population: 3 }]]);

      entities.set(CURRENT_VERSION_ID, {
        $id: CURRENT_VERSION_ID,
        '@type': 'TupleSetVersion',
        isPartOf: SET_ID,
        version: 1,
        rowCount: 2,
        tupleColumns: ['city', 'population'],
        sourceFormat: 'etl-results',
        contentString: '{}',
        sourceResultHash: hash,
        sourceEtlJobVersion: JOB_VERSION_ID,
        sourceColumnMappingVersion: MAPPING_ID,
      });
      entities.set(SET_ID, { ...SET_ENTITY, currentVersion: CURRENT_VERSION_ID });

      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      expect(res.statusCode, res.payload).toBe(200);
      // The run is in the history even though the chain did not move: this is
      // the record that says the pipeline ran at all.
      expect(loggedOutcome()).toMatchObject({
        status: 'completed',
        totalRows: 2,
        outputTupleSetVersion: CURRENT_VERSION_ID,
        outputReused: true,
      });
    });

    it('records a run that read the whole table and then could not store it', async () => {
      hoisted.mockCreateVersion.mockRejectedValueOnce(
        new TupleContentError('Library tuple set storage would reach 17000000 bytes, over the 16777216-byte limit'),
      );

      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      expect(res.statusCode, res.payload).toBe(400);
      expect(loggedOutcome()).toMatchObject({
        status: 'failed',
        errorMessage: expect.stringContaining('over the 16777216-byte limit'),
      });
    });

    it('records a run whose SQL failed, with the failure it reported', async () => {
      hoisted.streamChunks.mockImplementation(async function* () {
        throw new Error('Catalog Error: Table with name cities does not exist!');
        // eslint-disable-next-line no-unreachable
        yield undefined;
      });

      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      expect(res.statusCode).toBe(502);
      expect(loggedOutcome()).toMatchObject({
        status: 'failed',
        errorMessage: expect.stringContaining('Catalog Error'),
      });
    });

    it('reports the run’s own failure even when the log cannot be written', async () => {
      hoisted.streamChunks.mockImplementation(async function* () {
        throw new Error('Catalog Error: Table with name cities does not exist!');
        // eslint-disable-next-line no-unreachable
        yield undefined;
      });
      hoisted.updateEntity.mockRejectedValue(new Error('store unavailable'));

      const res = await post({ etlJobVersionId: JOB_VERSION_ID });

      // The caller asked about their SQL, not about our bookkeeping.
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toContain("Failed to run the ETL job's SQL");
    });

    it('opens no record for a request that ran no SQL', async () => {
      const res = await post({ etlJobVersionId: 'urn:sqlib:etl-job-version:missing' });

      expect(res.statusCode).toBe(404);
      // A typo is not an execution of anything.
      expect(hoisted.createEntity).not.toHaveBeenCalled();
    });
  });
});
