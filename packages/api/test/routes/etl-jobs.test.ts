import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Fastify from 'fastify';
import etlJobRoutes from '../../src/routes/etl-jobs.js';
import { setupValidator } from '../../src/lib/validator-setup.js';

/**
 * The DuckDB gate, resolved before collection.
 *
 * This used to be `!new DuckDbService().isAvailable()`, which is false at
 * collection time for *every* run: the constructor kicks off an async import
 * and `available` is still false when `describe.skipIf` reads it. So the whole
 * integration block was skipped everywhere, including where DuckDB was
 * installed. Gating on the import itself — the same way
 * `DuckDbService.sandbox.test.ts` does — is a fact known synchronously.
 */
let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}


const hoisted = vi.hoisted(() => ({
  listEtlJobs: vi.fn(),
  getEtlJob: vi.fn(),
  createEtlJob: vi.fn(),
  createEtlJobVersion: vi.fn(),
  createColumnMapping: vi.fn(),
  annotateEtlJobVersion: vi.fn(),
  preview: vi.fn(),
  getExecutionOutput: vi.fn(),
  listExecutions: vi.fn(),
}));

vi.mock('../../src/lib/EtlService.js', () => ({
  etlService: {
    listEtlJobs: hoisted.listEtlJobs,
    getEtlJob: hoisted.getEtlJob,
    createEtlJob: hoisted.createEtlJob,
    createEtlJobVersion: hoisted.createEtlJobVersion,
    createColumnMapping: hoisted.createColumnMapping,
    annotateEtlJobVersion: hoisted.annotateEtlJobVersion,
    preview: hoisted.preview,
    getExecutionOutput: hoisted.getExecutionOutput,
    listExecutions: hoisted.listExecutions,
  },
}));

describe('ETL Jobs Routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    setupValidator(app);
    await app.register(etlJobRoutes, { prefix: '/etl-jobs' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /etl-jobs', () => {
    it('creates a new ETL job', async () => {
      hoisted.createEtlJob.mockResolvedValue({
        id: 'etl-job-1',
        name: 'Test ETL Job',
        description: 'A test ETL job',
        libraryIds: ['test-lib-id'],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/etl-jobs',
        payload: {
          name: 'Test ETL Job',
          description: 'A test ETL job',
          libraryId: 'test-lib-id',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        id: expect.any(String),
        name: 'Test ETL Job',
        description: 'A test ETL job',
        libraryIds: ['test-lib-id'],
      });
    });

    it('validates required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/etl-jobs',
        payload: {
          description: 'Missing name',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /etl-jobs/executions/:executionId/output', () => {
    it('streams the file the execution wrote, in the format it was written', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-output-'));
      const location = path.join(dir, 'exec-1.nt');
      await fs.writeFile(location, '<a> <b> <c> .\n<d> <e> <f> .\n');
      hoisted.getExecutionOutput.mockResolvedValue({ location, contentType: 'application/n-triples' });

      try {
        const response = await app.inject({ method: 'GET', url: '/etl-jobs/executions/exec-1/output' });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('application/n-triples');
        expect(response.body).toBe('<a> <b> <c> .\n<d> <e> <f> .\n');
        expect(hoisted.getExecutionOutput).toHaveBeenCalledWith('exec-1');
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('is 404 for an execution that wrote nothing', async () => {
      hoisted.getExecutionOutput.mockResolvedValue(null);

      const response = await app.inject({ method: 'GET', url: '/etl-jobs/executions/exec-2/output' });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('has no output');
    });

    it('is 404 when the recorded file is gone', async () => {
      hoisted.getExecutionOutput.mockResolvedValue({
        location: path.join(os.tmpdir(), 'etl-output-does-not-exist', 'exec-3.nt'),
        contentType: 'application/n-triples',
      });

      const response = await app.inject({ method: 'GET', url: '/etl-jobs/executions/exec-3/output' });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('no longer on disk');
    });
  });

  describe('GET /etl-jobs/:id/executions', () => {
    it('lists the job’s runs, and says which produced nothing new', async () => {
      hoisted.getEtlJob.mockResolvedValue({ id: 'job-1', name: 'Cities', libraryIds: ['lib-1'] });
      hoisted.listExecutions.mockResolvedValue([
        {
          id: 'run-2',
          etlJobVersionId: 'v1',
          columnMappingVersionId: 'm1',
          status: 'completed',
          startedAt: '2026-09-13T12:00:00.000Z',
          totalRows: 412,
          outputTupleSetVersionId: 'tsv-3',
          outputReused: true,
        },
        {
          id: 'run-1',
          etlJobVersionId: 'v1',
          columnMappingVersionId: 'm1',
          status: 'completed',
          startedAt: '2026-09-13T11:00:00.000Z',
          totalRows: 412,
          outputTupleSetVersionId: 'tsv-3',
          outputReused: false,
        },
      ]);

      const response = await app.inject({ method: 'GET', url: '/etl-jobs/job-1/executions' });

      expect(response.statusCode).toBe(200);
      // The fields have to survive the response schema, which is the half a
      // service-level test cannot check.
      expect(response.json()).toMatchObject([
        { id: 'run-2', outputTupleSetVersionId: 'tsv-3', outputReused: true },
        { id: 'run-1', outputTupleSetVersionId: 'tsv-3', outputReused: false },
      ]);
      expect(hoisted.listExecutions).toHaveBeenCalledWith('job-1', 50);
    });

    it('passes the caller’s limit through', async () => {
      hoisted.getEtlJob.mockResolvedValue({ id: 'job-1', name: 'Cities', libraryIds: ['lib-1'] });
      hoisted.listExecutions.mockResolvedValue([]);

      const response = await app.inject({ method: 'GET', url: '/etl-jobs/job-1/executions?limit=5' });

      expect(response.statusCode).toBe(200);
      expect(hoisted.listExecutions).toHaveBeenCalledWith('job-1', 5);
    });

    it('refuses a limit outside the range the route bounds', async () => {
      hoisted.getEtlJob.mockResolvedValue({ id: 'job-1', name: 'Cities', libraryIds: ['lib-1'] });

      const response = await app.inject({ method: 'GET', url: '/etl-jobs/job-1/executions?limit=5000' });

      expect(response.statusCode).toBe(400);
      expect(hoisted.listExecutions).not.toHaveBeenCalled();
    });

    it('404s on a job that does not exist, rather than answering with an empty history', async () => {
      hoisted.getEtlJob.mockResolvedValue(null);

      const response = await app.inject({ method: 'GET', url: '/etl-jobs/nope/executions' });

      expect(response.statusCode).toBe(404);
      expect(hoisted.listExecutions).not.toHaveBeenCalled();
    });
  });

  describe('GET /etl-jobs/:id', () => {
    it('returns 404 for non-existent job', async () => {
      hoisted.getEtlJob.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/etl-jobs/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('not found');
    });
  });

  describe('POST /etl-jobs/:id/versions', () => {
    it('validates required fields for version creation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/etl-jobs/test-id/versions',
        payload: {
          sql: 'SELECT 1',
          // missing sparqlTemplate
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  /*
   * A version's note is the only field a later write touches — its SQL,
   * template and backend are the snapshot. Saving collects no comment, so this
   * route is how an ETL version gets one at all.
   */
  describe('PATCH /etl-jobs/versions/:versionId', () => {
    const version = {
      id: 'version-1',
      isPartOf: 'job-1',
      version: 2,
      sql: 'SELECT 1',
      sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      backendId: 'backend-1',
    };

    it('writes the note onto the version', async () => {
      hoisted.annotateEtlJobVersion.mockResolvedValue({ ...version, comment: 'why this changed' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/etl-jobs/versions/version-1',
        payload: { comment: 'why this changed' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).comment).toBe('why this changed');
      expect(hoisted.annotateEtlJobVersion).toHaveBeenCalledWith('version-1', 'why this changed');
    });

    it('clears the note when the comment is null', async () => {
      hoisted.annotateEtlJobVersion.mockResolvedValue(version);

      const response = await app.inject({
        method: 'PATCH',
        url: '/etl-jobs/versions/version-1',
        payload: { comment: null },
      });

      expect(response.statusCode).toBe(200);
      expect(hoisted.annotateEtlJobVersion).toHaveBeenCalledWith('version-1', null);
    });

    it('refuses to rewrite the version itself', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/etl-jobs/versions/version-1',
        payload: { sql: 'SELECT 2' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for a version that does not exist', async () => {
      hoisted.annotateEtlJobVersion.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PATCH',
        url: '/etl-jobs/versions/missing',
        payload: { comment: 'anything' },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toContain('not found');
    });
  });

  describe.skipIf(!duckdbAvailable)('POST /etl-jobs/preview', () => {
    it('previews SQL and returns inferred mappings', async () => {
        hoisted.preview.mockResolvedValue({
          schema: [
            { columnName: 'name', duckdbType: 'VARCHAR', nullable: false },
            { columnName: 'age', duckdbType: 'INTEGER', nullable: false },
            { columnName: 'active', duckdbType: 'BOOLEAN', nullable: false },
          ],
          rows: [
            { name: 'Alice', age: 25, active: true },
          ],
          inferredMapping: {
            columns: [
              {
                columnName: 'name',
                targetVariable: 'name',
                termType: 'literal',
                datatypeIri: 'http://www.w3.org/2001/XMLSchema#string',
                nullPolicy: 'undef',
              },
              {
                columnName: 'age',
                targetVariable: 'age',
                termType: 'literal',
                datatypeIri: 'http://www.w3.org/2001/XMLSchema#integer',
                nullPolicy: 'undef',
              },
              {
                columnName: 'active',
                targetVariable: 'active',
                termType: 'literal',
                datatypeIri: 'http://www.w3.org/2001/XMLSchema#boolean',
                nullPolicy: 'undef',
              },
            ],
          },
        });

        const response = await app.inject({
          method: 'POST',
          url: '/etl-jobs/preview',
          payload: {
            sql: "SELECT 'Alice' as name, 25 as age, true as active",
            limit: 10,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body.schema).toHaveLength(3);
        expect(body.schema[0]).toMatchObject({
          columnName: 'name',
          duckdbType: expect.any(String),
          nullable: expect.any(Boolean),
        });

        expect(body.rows).toHaveLength(1);
        expect(body.rows[0]).toMatchObject({
          name: 'Alice',
          age: 25,
          active: true,
        });

        expect(body.inferredMapping).toBeDefined();
        expect(body.inferredMapping.columns).toHaveLength(3);
        expect(body.inferredMapping.columns[0]).toMatchObject({
          columnName: 'name',
          targetVariable: 'name',
          termType: 'literal',
          datatypeIri: expect.stringContaining('string'),
          nullPolicy: 'undef',
        });
    });

    it('returns 400 for invalid SQL', async () => {
      hoisted.preview.mockRejectedValue(new Error('Invalid SQL'));
      const response = await app.inject({
        method: 'POST',
        url: '/etl-jobs/preview',
        payload: {
          sql: 'INVALID SQL QUERY',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });
  });

  describe('POST /etl-jobs/versions/:versionId/column-mappings', () => {
    it('validates column mapping structure', async () => {
      hoisted.createColumnMapping.mockResolvedValue({
        id: 'etl-mapping-1',
        name: 'Test Mapping',
        etlJobVersionId: 'test-version',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/etl-jobs/versions/test-version/column-mappings',
        payload: {
          name: 'Test Mapping',
          columns: [
            {
              columnName: 'test',
              targetVariable: 'testVar',
              termType: 'literal',
              nullPolicy: 'undef',
            },
          ],
        },
      });

      // Will fail because version doesn't exist, but validates schema
      expect([201, 404, 500]).toContain(response.statusCode);
    });

    it('validates termType enum', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/etl-jobs/versions/test-version/column-mappings',
        payload: {
          name: 'Test Mapping',
          columns: [
            {
              columnName: 'test',
              targetVariable: 'testVar',
              termType: 'invalid', // Should only be 'uri' or 'literal'
              nullPolicy: 'undef',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates nullPolicy enum', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/etl-jobs/versions/test-version/column-mappings',
        payload: {
          name: 'Test Mapping',
          columns: [
            {
              columnName: 'test',
              targetVariable: 'testVar',
              termType: 'literal',
              nullPolicy: 'invalid', // Should only be 'undef' or 'skipRow'
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
