import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { TestRunResult } from '../../src/lib/TestRunner.js';
import type { LdkitTestRun } from '../../src/persistence/schemas/TestRunSchema.js';

/**
 * What a stored run keeps, what it forgets, and what it can be turned back into.
 *
 * Retention is the part worth testing hardest: it is a policy, it deletes
 * things, and its failure mode is silent — a history that quietly dropped the
 * run where a test went red still looks like a history.
 */

const hoisted = vi.hoisted(() => ({
  runs: [] as Record<string, any>[],
  cases: [] as Record<string, any>[],
  insertRun: vi.fn(),
  insertCase: vi.fn(),
  deleted: [] as string[],
}));

vi.mock('../../src/persistence/utils/TestRunUtils.js', () => ({
  TestRuns: {
    insert: async (entity: Record<string, any>) => {
      hoisted.insertRun(entity);
      hoisted.runs.push(entity);
    },
    delete: async (id: string) => {
      hoisted.deleted.push(id);
      hoisted.runs = hoisted.runs.filter(run => run.$id !== id);
    },
  },
  findAllTestRuns: async () => [...hoisted.runs],
  findTestRunById: async (id: string) => hoisted.runs.find(run => run.$id === id) ?? null,
}));

vi.mock('../../src/persistence/utils/TestRunCaseUtils.js', () => ({
  TestRunCases: {
    insert: async (entity: Record<string, any>) => {
      hoisted.insertCase(entity);
      hoisted.cases.push(entity);
    },
    delete: async (id: string) => {
      hoisted.deleted.push(id);
      hoisted.cases = hoisted.cases.filter(row => row.$id !== id);
    },
  },
  findAllTestRunCases: async () => [...hoisted.cases],
}));

const {
  RUN_HISTORY_LIMIT,
  TRANSITION_HISTORY_LIMIT,
  getTestRun,
  listTestRuns,
  recordTestRun,
  recordTestRuns,
  runsToForget,
  toReportEntry,
} = await import('../../src/lib/TestRunStore.js');
const { toCsv, toJUnitXml } = await import('../../src/lib/reportFormats/index.js');
const { resetReadOnly } = await import('../../src/config/readOnly.js');

const TEST_ID = 'urn:sqlib:test:t1';
const VERSION_ID = 'urn:sqlib:test-version:tv1';

function verdict(overrides: Record<string, unknown> = {}): TestRunResult {
  return {
    testId: TEST_ID,
    testVersionId: VERSION_ID,
    passed: true,
    message: '',
    expectationKind: 'bindings',
    hermetic: true,
    durationMs: 12,
    subjectVersionId: 'urn:sqlib:query-version:qv1',
    ranAt: '2026-09-07T00:00:00.000Z',
    cases: [
      {
        caseId: 'urn:sqlib:test-case:c1',
        name: 'Case 1',
        position: 0,
        passed: true,
        message: '',
        inputs: { argumentSetVersion: null, dataGraphVersion: null, dataGraphVersions: [] },
        durationMs: 12,
      },
    ],
    passedCount: 1,
    failedCount: 0,
    ...overrides,
  } as unknown as TestRunResult;
}

/** A stored run as retention sees it: an id, a test, a time and an outcome. */
function stored(index: number, outcome: string): LdkitTestRun {
  return {
    $id: `urn:sqlib:test-run:r${index}`,
    test: TEST_ID,
    outcome,
    ranAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  } as unknown as LdkitTestRun;
}

beforeEach(() => {
  hoisted.runs = [];
  hoisted.cases = [];
  hoisted.deleted = [];
  hoisted.insertRun.mockClear();
  hoisted.insertCase.mockClear();
});

describe('recording a run', () => {
  it('writes the dimensions the verdict depended on', async () => {
    await recordTestRun({
      result: verdict({
        cases: [
          {
            caseId: 'urn:sqlib:test-case:c1',
            name: 'first',
            position: 0,
            passed: false,
            message: 'one row missing',
            detail: { missing: ['?s'], unexpected: [], matched: 2 },
            result: 'a very large document',
            inputs: {
              argumentSetVersion: 'urn:sqlib:argument-set-version:as1',
              dataGraphVersion: 'urn:sqlib:data-graph-version:dg1',
              dataGraphVersions: ['urn:sqlib:data-graph-version:dg1'],
            },
            durationMs: 4,
          },
        ],
        passed: false,
        message: 'one row missing',
        passedCount: 0,
        failedCount: 1,
      }),
      subject: 'urn:sqlib:query:q1',
      backend: 'urn:sqlib:backend:b1',
      suite: TEST_ID,
    });

    const [run] = hoisted.runs;
    expect(run).toMatchObject({
      test: TEST_ID,
      testVersion: VERSION_ID,
      subject: 'urn:sqlib:query:q1',
      subjectVersion: 'urn:sqlib:query-version:qv1',
      backend: 'urn:sqlib:backend:b1',
      suite: TEST_ID,
      outcome: 'failed',
      hermetic: true,
      ranAt: '2026-09-07T00:00:00.000Z',
    });

    const [row] = hoisted.cases;
    expect(row).toMatchObject({
      isPartOf: run.$id,
      testCase: 'urn:sqlib:test-case:c1',
      outcome: 'failed',
      message: 'one row missing',
      argumentSetVersion: 'urn:sqlib:argument-set-version:as1',
      dataGraphVersions: ['urn:sqlib:data-graph-version:dg1'],
    });
    expect(JSON.parse(row.detail)).toEqual({ missing: ['?s'], unexpected: [], matched: 2 });
    // The produced document is a property of running, not of history.
    expect(row).not.toHaveProperty('result');
  });

  it('records a test that could not run as cantTell, not as a failure', async () => {
    await recordTestRun({
      result: verdict({ passed: false, cases: [], passedCount: 0, failedCount: 0, message: 'Test has no version to run', testVersionId: '' }),
      suite: 'selected tests',
    });
    expect(hoisted.runs[0].outcome).toBe('cantTell');
    expect(hoisted.runs[0].testVersion).toBeNull();
  });

  it('never lets a storage failure fail the run that produced it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hoisted.insertRun.mockImplementationOnce(() => {
      throw new Error('library store unreachable');
    });
    await expect(recordTestRun({ result: verdict(), suite: TEST_ID })).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a read-only deployment', () => {
  /*
   * The verdict is compute and the history is the write, so a read-only
   * deployment runs tests and files none of them (issue #26). The check lives
   * at the store rather than at the routes, so it holds for any caller.
   */
  const ORIGINAL = process.env.SQLIB_READ_ONLY;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SQLIB_READ_ONLY;
    else process.env.SQLIB_READ_ONLY = ORIGINAL;
    resetReadOnly();
  });

  it('records nothing, and says so by writing nothing', async () => {
    resetReadOnly({ SQLIB_READ_ONLY: 'true' } as NodeJS.ProcessEnv);

    expect(await recordTestRun({ result: verdict(), subject: 'urn:sqlib:query:q1' })).toBeNull();
    expect(await recordTestRuns([{ result: verdict(), subject: 'urn:sqlib:query:q1' }])).toEqual([]);

    expect(hoisted.insertRun).not.toHaveBeenCalled();
    expect(hoisted.insertCase).not.toHaveBeenCalled();
    expect(hoisted.runs).toEqual([]);
  });

  it('writes as usual once the flag is off again', async () => {
    resetReadOnly({} as NodeJS.ProcessEnv);
    await recordTestRun({ result: verdict(), subject: 'urn:sqlib:query:q1' });
    expect(hoisted.insertRun).toHaveBeenCalledTimes(1);
  });
});

describe('retention', () => {
  it('keeps the last N runs and forgets the plain repeats before them', () => {
    const runs = Array.from({ length: RUN_HISTORY_LIMIT + 5 }, (_, index) => stored(index, 'passed'));
    const forgotten = runsToForget(runs);
    // The first run survives as the start of the record; the repeats between it
    // and the window are what nothing would ever ask about.
    expect(forgotten.map(run => run.$id)).toEqual(
      runs.slice(1, 5).map(run => run.$id),
    );
  });

  it('keeps the run where a test went red, however long ago', () => {
    const runs = [
      ...Array.from({ length: 3 }, (_, index) => stored(index, 'passed')),
      stored(3, 'failed'),
      ...Array.from({ length: RUN_HISTORY_LIMIT + 10 }, (_, index) => stored(index + 4, 'failed')),
    ];
    const forgotten = runsToForget(runs).map(run => run.$id);
    expect(forgotten).not.toContain('urn:sqlib:test-run:r3');
    expect(forgotten).not.toContain('urn:sqlib:test-run:r0');
    expect(forgotten).toContain('urn:sqlib:test-run:r5');
  });

  it('stays bounded for a test that flaps, where every run is a transition', () => {
    const runs = Array.from({ length: 200 }, (_, index) => stored(index, index % 2 === 0 ? 'passed' : 'failed'));
    const kept = 200 - runsToForget(runs).length;
    expect(kept).toBeLessThanOrEqual(RUN_HISTORY_LIMIT + TRANSITION_HISTORY_LIMIT);
    expect(kept).toBeGreaterThanOrEqual(RUN_HISTORY_LIMIT);
  });

  it('deletes a forgotten run with its case rows, and only its own', async () => {
    // One test, many identical green runs: the oldest fall out of the window.
    for (let index = 0; index < RUN_HISTORY_LIMIT + 2; index += 1) {
      await recordTestRun({
        result: verdict({ ranAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }),
        suite: TEST_ID,
      });
    }
    expect(hoisted.runs).toHaveLength(RUN_HISTORY_LIMIT + 1); // + the first run, kept
    // Every surviving run still has exactly its own case row, and no row is
    // left pointing at a run that is gone.
    expect(hoisted.cases).toHaveLength(hoisted.runs.length);
    const runIds = new Set(hoisted.runs.map(run => run.$id));
    expect(hoisted.cases.every(row => runIds.has(row.isPartOf))).toBe(true);
  });

  it('prunes each test the batch touched, and leaves the others alone', async () => {
    const other = 'urn:sqlib:test:t2';
    await recordTestRuns([
      { result: verdict(), suite: 'w3c' },
      { result: verdict({ testId: other }), suite: 'w3c' },
    ]);
    expect(hoisted.runs.map(run => run.test).sort()).toEqual([TEST_ID, other].sort());
    expect(hoisted.deleted).toEqual([]);
  });
});

describe('reading history back', () => {
  it('lists one test\'s runs newest first, capped by limit', async () => {
    for (let index = 0; index < 3; index += 1) {
      await recordTestRun({
        result: verdict({ ranAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }),
        suite: TEST_ID,
      });
    }
    await recordTestRun({ result: verdict({ testId: 'urn:sqlib:test:t2' }), suite: 'other' });

    const runs = await listTestRuns(TEST_ID);
    expect(runs).toHaveLength(3);
    expect(runs.map(run => run.ranAt)).toEqual([
      '2026-01-01T00:02:00.000Z',
      '2026-01-01T00:01:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect((await listTestRuns(TEST_ID, 1)).map(run => run.ranAt)).toEqual(['2026-01-01T00:02:00.000Z']);
  });

  it('renders a stored run into the same report the live run produced', async () => {
    const result = verdict({
      passed: false,
      message: 'first: one row missing',
      passedCount: 1,
      failedCount: 1,
      cases: [
        {
          caseId: 'urn:sqlib:test-case:c1',
          name: 'first',
          position: 0,
          passed: false,
          message: 'one row missing',
          detail: { missing: ['?s'], unexpected: [], matched: 2 },
          result: 'not stored, not reported',
          inputs: {
            argumentSetVersion: 'urn:sqlib:argument-set-version:as1',
            dataGraphVersion: 'urn:sqlib:data-graph-version:dg1',
            dataGraphVersions: ['urn:sqlib:data-graph-version:dg1'],
          },
          durationMs: 4,
        },
        {
          caseId: 'urn:sqlib:test-case:c2',
          name: 'second',
          position: 1,
          passed: true,
          message: '',
          inputs: { argumentSetVersion: null, dataGraphVersion: null, dataGraphVersions: [] },
          durationMs: 8,
        },
      ],
    });
    const live = {
      suite: TEST_ID,
      entries: [{ result, subject: 'urn:sqlib:query:q1', backend: 'urn:sqlib:backend:b1' }],
    };

    const written = await recordTestRun({
      result,
      subject: 'urn:sqlib:query:q1',
      backend: 'urn:sqlib:backend:b1',
      suite: TEST_ID,
    });
    const read = await getTestRun(written!.$id);
    const rendered = { suite: TEST_ID, entries: [toReportEntry(read!)] };

    // Byte-for-byte, because a report of a past run that differs from the
    // report of that run is a report of something else.
    expect(toCsv(rendered)).toEqual(toCsv(live));
    expect(toJUnitXml(rendered)).toEqual(toJUnitXml(live));
  });

  it('answers null for a run id that names nothing', async () => {
    expect(await getTestRun('urn:sqlib:test-run:missing')).toBeNull();
  });
});
