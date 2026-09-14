/**
 * The benchmark plan, swept rather than sampled.
 *
 * A plan is a product of axes — cases × backends × argument sets × repeats —
 * which is the shape `canvasCellMatrix` exploits: finite discriminators, a
 * pure function over them, and an answer that can be predicted independently.
 * `benchmarkPlan.test.ts` covers the same arithmetic with hand-picked cases;
 * this covers the whole product, so a rule that changes for one combination
 * cannot pass by not having been thought of.
 *
 * The oracle deliberately does **not** call `expandPlan` to predict
 * `expandPlan`. It re-states the rules from the prose in `benchmarkPlan.ts` —
 * the floors, what warmup does and does not count toward, the two round-trip
 * asymmetries — the way `harness/canvasCells.ts` re-states the edge rules
 * rather than importing them. An oracle that shares the implementation's
 * mistake agrees with it.
 */
import { describe, it, expect } from 'vitest';
import {
  emptyPlan,
  emptySettings,
  expandPlan,
  completeCases,
  planToSubjectSpecs,
  planFromVersion,
  percentile,
  runStatistics,
  NO_ARGUMENTS_IRI,
  type BenchmarkPlan,
  type PlanCase,
  type PlanSettings,
  type SubjectKind,
} from '@/lib/benchmarkPlan';
import type { BenchmarkExperimentVersion } from '@sparql-query-lib/contracts';

/**
 * Pinned so a change that makes a class of plan unreachable is noticed.
 * 216 cells, less the 36 that would vary a subject type no case exists to have.
 */
const TOTAL_CELLS = 216;
const REALIZED_CELLS = 180;

type ArgumentsClass = 'none' | 'one' | 'noArgumentsMarker' | 'two';

interface Cell {
  cases: 0 | 1 | 2;
  backends: 0 | 1 | 2;
  argumentSets: ArgumentsClass;
  subjectType: SubjectKind;
  repeats: null | 1 | 3;
}

type Realization =
  | { status: 'realized'; plan: BenchmarkPlan }
  | { status: 'unrealizable'; reason: string };

const ARGUMENT_CLASSES: readonly ArgumentsClass[] = ['none', 'one', 'noArgumentsMarker', 'two'];
const SUBJECT_TYPES: readonly SubjectKind[] = ['query', 'queryGroup'];

/** The full product. Conditioning is expressed by `realize`, not by pruning. */
function allCells(): Cell[] {
  const cells: Cell[] = [];
  for (const cases of [0, 1, 2] as const) {
    for (const backends of [0, 1, 2] as const) {
      for (const argumentSets of ARGUMENT_CLASSES) {
        for (const subjectType of SUBJECT_TYPES) {
          for (const repeats of [null, 1, 3] as const) {
            cells.push({ cases, backends, argumentSets, subjectType, repeats });
          }
        }
      }
    }
  }
  return cells;
}

const describeCell = (cell: Cell) =>
  `cases:${cell.cases}/backends:${cell.backends}/args:${cell.argumentSets}`
  + `/${cell.subjectType}/repeats:${String(cell.repeats)}`;

const argumentIdsFor = (kind: ArgumentsClass): string[] => {
  switch (kind) {
    case 'none': return [];
    case 'one': return ['urn:sqlib:argument-set:a1'];
    case 'noArgumentsMarker': return [NO_ARGUMENTS_IRI];
    case 'two': return ['urn:sqlib:argument-set:a1', 'urn:sqlib:argument-set:a2'];
  }
};

function completeCase(index: number, subjectType: SubjectKind): PlanCase {
  return {
    id: `case-${index}`,
    subjectType,
    subjectId: `urn:sqlib:subject:s${index}`,
    subjectName: `Subject ${index}`,
    versionId: `urn:sqlib:subject-version:s${index}v1`,
    versionNumber: 1,
  };
}

/** Build a cell by driving the module's own constructors, never by hand. */
function realize(cell: Cell): Realization {
  if (cell.cases === 0 && cell.subjectType !== 'query') {
    return { status: 'unrealizable', reason: 'with no cases there is no subject type to vary' };
  }

  const plan = emptyPlan();
  for (let index = 0; index < cell.cases; index++) {
    plan.cases.push(completeCase(index, cell.subjectType));
  }
  plan.backendIds = Array.from({ length: cell.backends }, (_, i) => `urn:sqlib:backend:b${i}`);
  plan.argumentSetIds = argumentIdsFor(cell.argumentSets);
  plan.settings = { ...emptySettings(), repeats: cell.repeats };
  return { status: 'realized', plan };
}

/* ------------------------------------------------------------------ *
 * The oracle — the rules restated, not the code re-run
 * ------------------------------------------------------------------ */

/**
 * How many requests a plan is, according to the documented rules:
 *
 * - a case is counted only when it names both a subject and a version;
 * - an unnamed backend axis means "each query's default", which is one, not
 *   zero, and the same for argument sets;
 * - `repeats` is the load multiplier, floored at one;
 * - **cases have no such floor** — a plan with nothing to ask is zero
 *   requests, not one. That asymmetry is deliberate and pinned below;
 * - warmup runs are discarded, so they multiply nothing.
 */
function expectedRequests(cell: Cell): number {
  const caseCount = cell.cases;
  const backendCount = Math.max(1, cell.backends);
  const argumentCount = Math.max(1, argumentIdsFor(cell.argumentSets).length);
  const repeatCount = Math.max(1, cell.repeats ?? 1);
  return caseCount * backendCount * argumentCount * repeatCount;
}

/** Every `PlanSettings` field except `repeats`, with a value that differs from the default. */
const NON_MULTIPLYING_SETTINGS: ReadonlyArray<[keyof PlanSettings, unknown]> = [
  ['executionStrategy', 'Parallel'],
  ['timeWindow', 'PT1M'],
  ['maxConcurrency', 8],
  ['warmupRuns', 5],
  ['cooldownMs', 250],
  ['timeoutMs', 30_000],
  ['retryCount', 2],
  ['retryDelayMs', 100],
  ['randomizeOrder', true],
  ['abortOnError', true],
];

/** A stored version, the way the API would hold what `planToSubjectSpecs` writes. */
function versionFrom(plan: BenchmarkPlan): BenchmarkExperimentVersion {
  return {
    id: 'urn:sqlib:benchmark-version:v1',
    version: 1,
    subjectSpecs: planToSubjectSpecs(plan, () => plan.argumentSetIds),
    ...plan.settings,
  } as unknown as BenchmarkExperimentVersion;
}

describe('benchmark plan matrix', () => {
  it('every cell is realized or explained', () => {
    const cells = allCells();
    const realized = cells.filter((cell) => realize(cell).status === 'realized');
    const unrealizable = cells.filter((cell) => realize(cell).status === 'unrealizable');

    expect(realized.length + unrealizable.length).toBe(cells.length);
    expect(cells.length).toBe(TOTAL_CELLS);
    expect(realized.length).toBe(REALIZED_CELLS);
  });

  it('a realized cell is actually the cell it claims to be', () => {
    // The realization builds plans rather than asserting on them, so a change
    // to the constructors could quietly produce something other than the cell
    // asked for, and the sweep would report coverage it does not have.
    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const { plan } = realization;
      const where = describeCell(cell);

      expect(completeCases(plan).length, where).toBe(cell.cases);
      expect(plan.backendIds.length, where).toBe(cell.backends);
      expect(plan.argumentSetIds, where).toEqual(argumentIdsFor(cell.argumentSets));
      expect(plan.settings.repeats, where).toBe(cell.repeats);
      for (const planCase of plan.cases) expect(planCase.subjectType, where).toBe(cell.subjectType);
    }
  });

  it('expands to the product of its axes on every cell', () => {
    const failures: string[] = [];
    let checked = 0;

    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      checked++;

      const expansion = expandPlan(realization.plan);
      const expected = expectedRequests(cell);
      if (expansion.requests !== expected) {
        failures.push(`${describeCell(cell)} :: ${expansion.requests} requests, expected ${expected}`);
      }
      // Support is not stored yet, so nothing can be excluded. Pinned as the
      // known incompleteness it is: when a support matrix lands, this is the
      // assertion that has to be rewritten rather than quietly outgrown.
      if (expansion.excluded !== 0) {
        failures.push(`${describeCell(cell)} :: excluded ${expansion.excluded}, expected 0`);
      }
      for (const factor of expansion.factors) {
        if (factor.label !== 'cases' && factor.count < 1) {
          failures.push(`${describeCell(cell)} :: ${factor.label} counted ${factor.count}, below its floor of 1`);
        }
      }
    }

    expect(failures).toEqual([]);
    // A property that never generates a case passes vacuously.
    expect(checked).toBe(REALIZED_CELLS);
  });

  it('floors every axis at one except cases, which may be zero', () => {
    // The asymmetry is deliberate and worth stating on its own: a plan with no
    // backend named still runs, against each query's default, so counting that
    // axis as zero would print "0 requests" for a plan that works. A plan with
    // nothing to ask really is nothing to run.
    const noCases = realize({ cases: 0, backends: 0, argumentSets: 'none', subjectType: 'query', repeats: 1 });
    const oneCase = realize({ cases: 1, backends: 0, argumentSets: 'none', subjectType: 'query', repeats: 1 });
    if (noCases.status !== 'realized' || oneCase.status !== 'realized') throw new Error('unrealized');

    expect(expandPlan(noCases.plan).requests).toBe(0);
    expect(expandPlan(oneCase.plan).requests).toBe(1);
    expect(expandPlan(noCases.plan).factors.find((f) => f.label === 'cases')?.count).toBe(0);
    expect(expandPlan(noCases.plan).factors.find((f) => f.label === 'backends')?.count).toBe(1);
  });

  it('prints a formula that multiplies back to the count', () => {
    const failures: string[] = [];
    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;

      const expansion = expandPlan(realization.plan);
      // Split on the same separator the formula is joined with, and undo the
      // thousands grouping, so a formula that reads well but says something
      // else than the count is caught.
      const product = expansion.formula
        .split(' × ')
        .map((part) => Number(part.replace(/,/g, '')))
        .reduce((total, n) => total * n, 1);

      if (product !== expansion.requests) {
        failures.push(`${describeCell(cell)} :: "${expansion.formula}" multiplies to ${product}, not ${expansion.requests}`);
      }
      if (expansion.formula.includes('excluded')) {
        failures.push(`${describeCell(cell)} :: formula claims exclusions with excluded=0`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('is unchanged by every setting except repeats', () => {
    // Warmup is the one worth naming: it is real work the runner does, and it
    // deliberately multiplies nothing, because warmup results are discarded.
    // The rest are policy — how the requests are issued, not how many.
    const failures: string[] = [];
    let checked = 0;

    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const baseline = expandPlan(realization.plan).requests;

      for (const [field, value] of NON_MULTIPLYING_SETTINGS) {
        const altered: BenchmarkPlan = {
          ...realization.plan,
          settings: { ...realization.plan.settings, [field]: value } as PlanSettings,
        };
        checked++;
        const requests = expandPlan(altered).requests;
        if (requests !== baseline) {
          failures.push(`${describeCell(cell)} :: ${String(field)}=${String(value)} changed ${baseline} to ${requests}`);
        }
      }
    }

    expect(failures).toEqual([]);
    expect(checked).toBe(REALIZED_CELLS * NON_MULTIPLYING_SETTINGS.length);
  });

  it('round-trips through a stored version, widening only where documented', () => {
    /*
     * Two asymmetries are by design, and this is where they are stated:
     *
     * 1. A group spec carries no backends — a group resolves its own — so a
     *    queryGroup plan's backend axis does not survive the round trip.
     * 2. A case with no argument sets is written with the no-arguments marker
     *    rather than an empty list, because that is what the runner reads as
     *    "once, unparameterised". So `none` comes back as the marker.
     *
     * Anything else that fails to come back is a defect, not a convention.
     */
    const failures: string[] = [];
    let checked = 0;

    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const { plan } = realization;
      const where = describeCell(cell);
      checked++;

      const back = planFromVersion(versionFrom(plan), (iri) => {
        const original = plan.cases.find((c) => c.versionId === iri);
        if (!original) return null;
        return {
          subjectType: original.subjectType,
          subjectId: original.subjectId!,
          subjectName: original.subjectName!,
          versionNumber: original.versionNumber,
        };
      });

      const versionIds = (p: BenchmarkPlan) => completeCases(p).map((c) => c.versionId);
      if (JSON.stringify(versionIds(back)) !== JSON.stringify(versionIds(plan))) {
        failures.push(`${where} :: cases came back as ${JSON.stringify(versionIds(back))}`);
      }

      const expectedBackends = cell.cases === 0 || cell.subjectType === 'queryGroup' ? [] : plan.backendIds;
      if (JSON.stringify(back.backendIds) !== JSON.stringify(expectedBackends)) {
        failures.push(`${where} :: backends came back as ${JSON.stringify(back.backendIds)}, expected ${JSON.stringify(expectedBackends)}`);
      }

      const expectedArguments = cell.cases === 0
        ? []
        : cell.argumentSets === 'none' ? [NO_ARGUMENTS_IRI] : plan.argumentSetIds;
      if (JSON.stringify(back.argumentSetIds) !== JSON.stringify(expectedArguments)) {
        failures.push(`${where} :: argument sets came back as ${JSON.stringify(back.argumentSetIds)}, expected ${JSON.stringify(expectedArguments)}`);
      }

      // `repeats: null` means "once" and is stored as such, so it reads back
      // as 1 rather than null. Every other setting is carried verbatim.
      if (back.settings.repeats !== (cell.repeats ?? 1)) {
        failures.push(`${where} :: repeats came back as ${String(back.settings.repeats)}`);
      }
      if (back.settings.executionStrategy !== plan.settings.executionStrategy) {
        failures.push(`${where} :: executionStrategy came back as ${back.settings.executionStrategy}`);
      }
    }

    expect(failures).toEqual([]);
    expect(checked).toBe(REALIZED_CELLS);
  });

  it('re-expands to the same count after a round trip', () => {
    // The count is what the user decided on, so it is the thing that must not
    // move. Where the round trip widens (a group losing its backends), the
    // count moves with it, and the oracle above says by how much.
    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      if (cell.subjectType === 'queryGroup' && cell.backends > 0) continue;

      const { plan } = realization;
      const back = planFromVersion(versionFrom(plan), (iri) => {
        const original = plan.cases.find((c) => c.versionId === iri);
        if (!original) return null;
        return {
          subjectType: original.subjectType,
          subjectId: original.subjectId!,
          subjectName: original.subjectName!,
          versionNumber: original.versionNumber,
        };
      });

      expect(expandPlan(back).requests, describeCell(cell)).toBe(expandPlan(plan).requests);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The statistics a run reports, over the same kind of sweep
 * ------------------------------------------------------------------ */

interface Row {
  ok: boolean;
  totalMs: number | null;
  offsetMs: number;
}

const row = (ok: boolean, totalMs: number | null, offsetMs = 0): Row => ({ ok, totalMs, offsetMs });

describe('run statistics', () => {
  const SHAPES: ReadonlyArray<[string, Row[]]> = [
    ['empty', []],
    ['one success', [row(true, 10)]],
    ['one failure', [row(false, null)]],
    ['successes only', [row(true, 30), row(true, 10), row(true, 20)]],
    ['failures only', [row(false, null), row(false, 5)]],
    ['mixed', [row(true, 10, 0), row(false, 900, 5), row(true, 40, 10), row(true, 20, 20)]],
    ['one of each', [row(true, 7, 0), row(false, null, 3)]],
  ];

  it('counts every request as either succeeded or failed', () => {
    for (const [name, rows] of SHAPES) {
      const stats = runStatistics(rows as never);
      const succeeded = rows.filter((r) => r.ok && typeof r.totalMs === 'number').length;
      expect(stats.requests, name).toBe(rows.length);
      expect(stats.failed, name).toBe(rows.filter((r) => !r.ok).length);
      expect(stats.failed + succeeded, name).toBeLessThanOrEqual(rows.length);
    }
  });

  it('orders its percentiles and excludes failures from them', () => {
    for (const [name, rows] of SHAPES) {
      const stats = runStatistics(rows as never);
      if (stats.p50 == null) {
        // No successful sample means no percentile to report, rather than a
        // zero that would read as a very fast run.
        expect(stats.p95, name).toBeNull();
        expect(stats.p99, name).toBeNull();
        expect(stats.meanMs, name).toBeNull();
        continue;
      }
      expect(stats.p50!, name).toBeLessThanOrEqual(stats.p95!);
      expect(stats.p95!, name).toBeLessThanOrEqual(stats.p99!);

      // A failure's duration describes the timeout setting rather than the
      // store, so it may never become the statistic.
      const succeeded = rows.filter((r) => r.ok && typeof r.totalMs === 'number').map((r) => r.totalMs!);
      expect(stats.p99!, name).toBeLessThanOrEqual(Math.max(...succeeded));
      expect(stats.meanMs!, name).toBeCloseTo(succeeded.reduce((a, b) => a + b, 0) / succeeded.length, 6);
    }
  });

  it('reports a wall clock no shorter than its longest request', () => {
    for (const [name, rows] of SHAPES) {
      const stats = runStatistics(rows as never);
      if (rows.length === 0) {
        expect(stats.wallClockMs, name).toBeNull();
        continue;
      }
      const longest = Math.max(...rows.map((r) => r.offsetMs + Math.max(0, r.totalMs ?? 0)));
      expect(stats.wallClockMs, name).toBe(longest);
    }
  });

  it('takes percentiles by nearest rank', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10], 50)).toBe(10);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
    // Out-of-range percentiles clamp rather than reading off the end.
    expect(percentile([10, 20], 0)).toBe(10);
  });
});
