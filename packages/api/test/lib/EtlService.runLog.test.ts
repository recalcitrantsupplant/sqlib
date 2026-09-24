/**
 * `EtlService.listExecutions` — the job's run log, read back (issue #211).
 *
 * The log had a writer and a by-id reader and no way to ask "what has this
 * pipeline been doing", which is the question a scheduled pipeline makes
 * urgent: an unchanged re-run cuts no version, so the version chain cannot
 * answer it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
}));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: hoisted.get,
    list: hoisted.list,
  }),
});

import { EtlService } from '../../src/lib/EtlService.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const JOB = 'urn:sqlib:etl-job:job-1';
const OTHER_JOB = 'urn:sqlib:etl-job:job-2';
const V1 = 'urn:sqlib:etl-job-version:v1';
const V2 = 'urn:sqlib:etl-job-version:v2';
const OTHER_V = 'urn:sqlib:etl-job-version:other';
const MAPPING = 'urn:sqlib:etl-column-mapping-version:m1';

function execution(id: string, version: string, startedAt: string, rest: Record<string, unknown> = {}) {
  return {
    $id: `urn:sqlib:etl-execution:${id}`,
    '@type': 'EtlExecution',
    etlJobVersion: version,
    columnMappingVersion: MAPPING,
    status: 'completed',
    startedAt,
    ...rest,
  };
}

describe('EtlService.listExecutions', () => {
  let service: EtlService;
  let executions: Record<string, unknown>[];

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EtlService();
    executions = [
      execution('a', V1, '2026-09-13T10:00:00.000Z'),
      execution('b', V2, '2026-09-13T12:00:00.000Z'),
      execution('c', V1, '2026-09-13T11:00:00.000Z'),
      execution('d', OTHER_V, '2026-09-13T13:00:00.000Z'),
    ];
    hoisted.list.mockImplementation((type: string) => {
      if (type === 'EtlJobVersion') {
        return [
          { $id: V1, isPartOf: JOB },
          { $id: V2, isPartOf: JOB },
          { $id: OTHER_V, isPartOf: OTHER_JOB },
        ];
      }
      if (type === 'EtlExecution') return executions;
      return [];
    });
  });

  it('returns the runs of every version of the job, newest first', async () => {
    const result = await service.listExecutions('job-1');

    // 'd' belongs to another job's version, and the rest are in start order
    // reversed rather than store order.
    expect(result.map((run) => run.id)).toEqual(['b', 'c', 'a']);
    expect(result.map((run) => run.etlJobVersionId)).toEqual(['v2', 'v1', 'v1']);
  });

  it('bounds the answer with the limit, keeping the newest end', async () => {
    const result = await service.listExecutions('job-1', 2);

    expect(result.map((run) => run.id)).toEqual(['b', 'c']);
  });

  it('is empty for a job that has never run, rather than everyone else’s runs', async () => {
    const result = await service.listExecutions('job-2');

    expect(result.map((run) => run.id)).toEqual(['d']);
    expect(await service.listExecutions('job-3')).toEqual([]);
  });

  it('reports a run that read no rows as none, not as unknown', async () => {
    executions = [execution('a', V1, '2026-09-13T10:00:00.000Z', { totalRows: 0, completedChunks: 0 })];

    const [run] = await service.listExecutions('job-1');

    // `|| undefined` would erase the emptiest result there is — which is the
    // one worth looking into.
    expect(run.totalRows).toBe(0);
    expect(run.completedChunks).toBe(0);
  });

  it('says which tuple set version a tabular run ended at, and whether it cut it', async () => {
    executions = [
      execution('a', V1, '2026-09-13T10:00:00.000Z', {
        outputTupleSetVersion: 'urn:sqlib:tuple-set-version:tsv-1',
        outputReused: false,
      }),
      execution('b', V1, '2026-09-13T11:00:00.000Z', {
        outputTupleSetVersion: 'urn:sqlib:tuple-set-version:tsv-1',
        outputReused: true,
      }),
    ];

    const [reRun, firstRun] = await service.listExecutions('job-1');

    expect(firstRun).toMatchObject({ outputTupleSetVersionId: 'tsv-1', outputReused: false });
    // The second run produced the same table: same version, nothing cut.
    expect(reRun).toMatchObject({ outputTupleSetVersionId: 'tsv-1', outputReused: true });
  });

  it('leaves the output fields off a run that wrote a file instead', async () => {
    executions = [
      execution('a', V1, '2026-09-13T10:00:00.000Z', {
        outputFormat: 'application/n-quads',
        outputLocation: '/var/etl/a.nq',
      }),
    ];

    const [run] = await service.listExecutions('job-1');

    expect(run.outputFormat).toBe('application/n-quads');
    expect(run.outputTupleSetVersionId).toBeUndefined();
    expect(run.outputReused).toBeUndefined();
  });
});
