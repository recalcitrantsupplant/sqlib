import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The chunk loop in `executeEtlJob`, which had no coverage at all before #201
 * rewrote it. What it drives is mocked — the source of rows is
 * `DuckDbService.streamChunks`, exercised for real in DuckDbService.test.ts —
 * so what these assert is the loop itself: how far it reads, what it counts,
 * and when it stops.
 */
const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  streamChunks: vi.fn(),
  applyArguments: vi.fn(),
  constructQueryParsed: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
  }),
}));

vi.mock('../../src/lib/DuckDbService.js', () => ({
  duckDbService: { streamChunks: hoisted.streamChunks },
  mapDuckDbTypeToXsd: () => 'http://www.w3.org/2001/XMLSchema#string',
}));

vi.mock('../../src/lib/parser.js', () => ({
  SparqlQueryParser: vi.fn(function () {
    return { applyArguments: hoisted.applyArguments };
  }),
}));

vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: vi.fn(function () {
    return { getExecutorForBackendId: async () => ({ constructQueryParsed: hoisted.constructQueryParsed }) };
  }),
}));

import { EtlService } from '../../src/lib/EtlService.js';

const JOB = 'urn:sqlib:etl-job:job-1';
const VERSION = 'urn:sqlib:etl-job-version:version-1';
const MAPPING = 'urn:sqlib:etl-column-mapping-version:mapping-1';

/** A stream of `count` chunks of `size` rows, recording how many were taken. */
function chunksOf(count: number, size: number) {
  const taken = { chunks: 0 };
  hoisted.streamChunks.mockImplementation(async function* () {
    for (let i = 0; i < count; i++) {
      taken.chunks++;
      yield {
        rows: Array.from({ length: size }, (_, r) => ({ name: `row-${i * size + r}` })),
        timing: { initMs: 0, connectionMs: 0, queryMs: 0, serializeMs: 0, totalMs: 0 },
      };
    }
  });
  return taken;
}

describe('EtlService.executeEtlJob chunk loop', () => {
  let service: EtlService;
  let outputDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = new EtlService();
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-output-'));
    process.env.ETL_OUTPUT_DIR = outputDir;

    hoisted.get.mockImplementation((id: string) => {
      if (id === JOB) return { $id: JOB, currentVersion: VERSION };
      if (id === VERSION) {
        return {
          $id: VERSION,
          sql: 'SELECT name FROM t',
          sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
          backendId: 'urn:sqlib:backend:b',
          currentColumnMappingVersion: MAPPING,
          chunkSize: 2,
        };
      }
      if (id === MAPPING) {
        return {
          $id: MAPPING,
          columns: JSON.stringify([
            { sourceColumn: 'name', targetVariable: 'name', mappingType: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#string' },
          ]),
        };
      }
      return null;
    });
    hoisted.create.mockResolvedValue(undefined);
    hoisted.update.mockResolvedValue(undefined);
    hoisted.applyArguments.mockReturnValue('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');
    hoisted.constructQueryParsed.mockResolvedValue({ result: '<a> <b> <c> .', contentType: 'application/n-triples' });
  });

  afterEach(async () => {
    delete process.env.ETL_OUTPUT_DIR;
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('counts the chunks it actually read', async () => {
    chunksOf(3, 2);

    const result = await service.executeEtlJob('job-1', {});

    expect(result.status).toBe('completed');
    expect(result.totalRows).toBe(6);
    // Three chunks read, three reported. The old loop returned `chunkIndex + 1`
    // after the loop had already advanced past the last chunk, so it said four.
    expect(result.totalChunks).toBe(3);
    expect(result.completedChunks).toBe(3);
  });

  it('writes each chunk to the output file as it is constructed, holding none of it', async () => {
    chunksOf(3, 2);
    // What has reached the file by the time each chunk's RDF comes back.
    const onDiskWhenConstructed: number[] = [];
    hoisted.constructQueryParsed.mockImplementation(async () => {
      const files = await fs.readdir(outputDir);
      const written = files.length
        ? (await fs.readFile(path.join(outputDir, files[0]), 'utf8')).split('\n').filter(Boolean).length
        : 0;
      onDiskWhenConstructed.push(written);
      return { result: '<a> <b> <c> .', contentType: 'application/n-triples' };
    });

    const result = await service.executeEtlJob('job-1', {});

    // Chunk n's result was on disk before chunk n+1 was constructed: nothing
    // waited for the end of the run.
    expect(onDiskWhenConstructed).toEqual([0, 1, 2]);
    expect(result.outputFormat).toBe('application/n-triples');
    expect(result.outputLocation).toBe(path.join(outputDir, `${result.executionId}.nt`));
    expect(await fs.readFile(result.outputLocation!, 'utf8')).toBe('<a> <b> <c> .\n'.repeat(3));
    expect(hoisted.update).toHaveBeenLastCalledWith('EtlExecution', expect.any(String), expect.objectContaining({
      status: 'completed',
      outputFormat: 'application/n-triples',
      outputLocation: result.outputLocation,
    }));
  });

  it('serves the file it wrote, and nothing outside the output directory', async () => {
    chunksOf(1, 2);
    const result = await service.executeEtlJob('job-1', {});
    const executionUrn = hoisted.update.mock.calls.at(-1)![1] as string;
    hoisted.get.mockImplementation((id: string) => (
      id === executionUrn
        ? { $id: executionUrn, outputFormat: 'application/n-triples', outputLocation: result.outputLocation }
        : null
    ));

    await expect(service.getExecutionOutput(result.executionId)).resolves.toEqual({
      location: result.outputLocation,
      contentType: 'application/n-triples',
    });

    hoisted.get.mockImplementation((id: string) => (
      id === executionUrn ? { $id: executionUrn, outputLocation: '/etc/passwd' } : null
    ));
    await expect(service.getExecutionOutput(result.executionId)).rejects.toThrow('outside the ETL output directory');
  });

  it('leaves no file behind when the run fails', async () => {
    chunksOf(3, 2);
    hoisted.constructQueryParsed
      .mockResolvedValueOnce({ result: '<a> <b> <c> .', contentType: 'application/n-triples' })
      .mockRejectedValueOnce(new Error('backend went away'));

    await expect(service.executeEtlJob('job-1', {})).rejects.toThrow('backend went away');

    expect(await fs.readdir(outputDir)).toEqual([]);
    expect(hoisted.update).toHaveBeenLastCalledWith('EtlExecution', expect.any(String), expect.objectContaining({
      status: 'failed',
      errorMessage: 'backend went away',
    }));
  });

  it('records no output for a run that constructed nothing', async () => {
    chunksOf(0, 0);

    const result = await service.executeEtlJob('job-1', {});

    expect(result.outputLocation).toBeUndefined();
    expect(await fs.readdir(outputDir)).toEqual([]);
  });

  it('reports nothing read for an empty source query', async () => {
    chunksOf(0, 0);

    const result = await service.executeEtlJob('job-1', {});

    expect(result.totalRows).toBe(0);
    expect(result.totalChunks).toBe(0);
  });

  it('stops the stream after one chunk on a dry run', async () => {
    const taken = chunksOf(10, 2);

    const result = await service.executeEtlJob('job-1', { dryRun: true });

    expect(taken.chunks).toBe(1);
    expect(result.totalRows).toBe(2);
    expect(result.totalChunks).toBe(1);
  });

  it('stops at the first chunk boundary past maxRows', async () => {
    const taken = chunksOf(10, 2);

    const result = await service.executeEtlJob('job-1', { maxRows: 3 });

    // Chunks are whole: 3 rows means two chunks of two, then stop.
    expect(taken.chunks).toBe(2);
    expect(result.totalRows).toBe(4);
  });

  it('streams the source query once, at the configured chunk size', async () => {
    chunksOf(1, 2);

    await service.executeEtlJob('job-1', { chunkSize: 500 });

    expect(hoisted.streamChunks).toHaveBeenCalledTimes(1);
    // The third argument is the fixture channel a *test* run uses; a job
    // execution reads whatever its SQL names, so it passes none.
    expect(hoisted.streamChunks).toHaveBeenCalledWith('SELECT name FROM t', 500, { fixtureSql: undefined });
  });

  it('marks the execution failed when the stream throws', async () => {
    hoisted.streamChunks.mockImplementation(async function* () {
      yield {
        rows: [{ name: 'row-0' }],
        timing: { initMs: 0, connectionMs: 0, queryMs: 0, serializeMs: 0, totalMs: 0 },
      };
      throw new Error('INTERRUPT Error: Interrupted!');
    });

    await expect(service.executeEtlJob('job-1', {})).rejects.toThrow('Interrupted');
    expect(hoisted.update).toHaveBeenCalledWith(
      'EtlExecution',
      expect.any(String),
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
