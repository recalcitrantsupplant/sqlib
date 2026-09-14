/**
 * Which inputs a test's subject kind accepts, swept rather than sampled.
 *
 * `subjectKinds.ts` is one table read by two consumers that must not drift:
 * `TestVersionWriter` refuses a version with it, and `TestWorkArea` decides
 * which slots to render with it. `TestVersionWriter.test.ts` covers it with
 * roughly one hand-written case per rule, which is enough to check the rules
 * that exist and nothing about the ones that do not: a fourth subject kind or
 * a fifth input slot would add untested combinations silently, because nothing
 * iterates the domain and no count is pinned.
 *
 * This takes the product — kind × backend × the per-case slots × how many
 * cases and whether they agree — and judges each cell against an oracle that
 * re-states the rules from the module's header prose rather than importing
 * `INPUTS_FOR_SUBJECT_KIND`. Importing the table to predict the table would
 * only prove the function reads it.
 *
 * It lives here rather than in `packages/types` because `packages/types` has
 * no test runner (its `test` script is a TODO) and because the pairing being
 * asserted — the writer's refusal and the UI's slots — is a web concern. The
 * compile-time half of the guard lives in `packages/types/src/subjectKinds.ts`,
 * which is where its own `tsc` will evaluate it.
 */
import { describe, it, expect } from 'vitest';
import {
  SUBJECT_KINDS,
  INPUTS_FOR_SUBJECT_KIND,
  checkSubjectKindInputs,
  isSubjectKind,
  type SubjectKind,
  type SubjectKindCaseInputs,
} from '@sparql-query-lib/types';

/** Pinned so a kind or a slot added without extending the sweep is noticed. */
const TOTAL_CELLS = 384;
const REALIZED_CELLS = 376;

/**
 * The rules, restated from the header of `subjectKinds.ts`:
 *
 * - a **rule set** runs in-process against a base graph, so there is no
 *   endpoint to name, and its tabular input is a tuple seed rather than an
 *   argument set;
 * - a **query** runs against exactly one store, which is a data graph on the
 *   case or a backend on the version, never both and never neither;
 * - a **query group** names its own backends per node and takes what its start
 *   node declares, which is arguments and data graphs — two independent slots,
 *   so a case may carry either or both;
 * - an **ETL job** reads rows with SQL and constructs RDF from them, so its
 *   tabular input is neither an argument set nor tuple seeds but a SQL fixture,
 *   and it names no backend because the job version carries one a test never
 *   runs against.
 */
const ORACLE: Record<SubjectKind, {
  backend: boolean;
  dataGraph: boolean;
  argumentSet: boolean;
  tupleSeeds: boolean;
  sqlFixture: boolean;
  exclusiveStore: boolean;
}> = {
  ruleSet: { backend: false, dataGraph: true, argumentSet: false, tupleSeeds: true, sqlFixture: false, exclusiveStore: false },
  query: { backend: true, dataGraph: true, argumentSet: true, tupleSeeds: false, sqlFixture: false, exclusiveStore: true },
  queryGroup: { backend: false, dataGraph: true, argumentSet: true, tupleSeeds: false, sqlFixture: false, exclusiveStore: false },
  etlJob: { backend: false, dataGraph: true, argumentSet: false, tupleSeeds: false, sqlFixture: true, exclusiveStore: false },
};

type Arrangement = 'one' | 'twoSame' | 'twoMixed';

interface CaseShape {
  dataGraph: boolean;
  argumentSet: boolean;
  tupleSeeds: boolean;
  sqlFixture: boolean;
}

interface Cell {
  kind: SubjectKind;
  backend: boolean;
  shape: CaseShape;
  arrangement: Arrangement;
}

type Realization =
  | { status: 'realized'; version: { backend?: string | null }; cases: SubjectKindCaseInputs[] }
  | { status: 'unrealizable'; reason: string };

const CASE_SHAPES: readonly CaseShape[] = [false, true].flatMap((dataGraph) =>
  [false, true].flatMap((argumentSet) =>
    [false, true].flatMap((tupleSeeds) =>
      [false, true].map((sqlFixture) => ({ dataGraph, argumentSet, tupleSeeds, sqlFixture })))));

const ARRANGEMENTS: readonly Arrangement[] = ['one', 'twoSame', 'twoMixed'];
const isEmptyShape = (shape: CaseShape) =>
  !shape.dataGraph && !shape.argumentSet && !shape.tupleSeeds && !shape.sqlFixture;

/** The full product. Conditioning is expressed by `realize`, not by pruning. */
function allCells(): Cell[] {
  const cells: Cell[] = [];
  for (const kind of SUBJECT_KINDS) {
    for (const backend of [false, true]) {
      for (const shape of CASE_SHAPES) {
        for (const arrangement of ARRANGEMENTS) {
          cells.push({ kind, backend, shape, arrangement });
        }
      }
    }
  }
  return cells;
}

const describeShape = (shape: CaseShape) =>
  [shape.dataGraph && 'graph', shape.argumentSet && 'args', shape.tupleSeeds && 'seeds',
    shape.sqlFixture && 'fixture']
    .filter(Boolean).join('+') || 'bare';

const describeCell = (cell: Cell) =>
  `${cell.kind}/backend:${cell.backend}/${describeShape(cell.shape)}/${cell.arrangement}`;

const caseFrom = (shape: CaseShape): SubjectKindCaseInputs => ({
  dataGraphVersion: shape.dataGraph ? 'urn:sqlib:data-graph-version:g1' : null,
  argumentSetVersion: shape.argumentSet ? 'urn:sqlib:argument-set-version:a1' : null,
  tupleSeeds: shape.tupleSeeds ? 'TUPLE("a")' : null,
  sqlFixture: shape.sqlFixture ? "CREATE TABLE t AS SELECT 1 AS id" : null,
});

const BARE: CaseShape = { dataGraph: false, argumentSet: false, tupleSeeds: false, sqlFixture: false };

function realize(cell: Cell): Realization {
  if (cell.arrangement === 'twoMixed' && isEmptyShape(cell.shape)) {
    return { status: 'unrealizable', reason: 'with nothing in the shape, a mixed pair is the same two cases as a matching one' };
  }
  const first = caseFrom(cell.shape);
  const cases = cell.arrangement === 'one'
    ? [first]
    : cell.arrangement === 'twoSame'
      ? [first, caseFrom(cell.shape)]
      : [first, caseFrom(BARE)];
  return {
    status: 'realized',
    version: { backend: cell.backend ? 'urn:sqlib:backend:b1' : null },
    cases,
  };
}

/**
 * Which refusals a cell earns, as tags rather than sentences.
 *
 * Predicting the exact wording would make this a change-detector for prose.
 * The tags say *how many* refusals and *about what*, which is the part a
 * consumer depends on.
 */
function expectedViolations(cell: Cell, cases: SubjectKindCaseInputs[]): string[] {
  const allowed = ORACLE[cell.kind];
  const out: string[] = [];

  if (cell.backend && !allowed.backend) out.push('version:backend');

  cases.forEach((testCase, index) => {
    if (testCase.dataGraphVersion && !allowed.dataGraph) out.push(`case${index}:dataGraph`);
    if (testCase.argumentSetVersion && !allowed.argumentSet) out.push(`case${index}:argumentSet`);
    if (testCase.tupleSeeds?.trim() && !allowed.tupleSeeds) out.push(`case${index}:tupleSeeds`);
    if (testCase.sqlFixture?.trim() && !allowed.sqlFixture) out.push(`case${index}:sqlFixture`);
  });

  if (allowed.exclusiveStore) {
    const withGraph = cases.filter((testCase) => Boolean(testCase.dataGraphVersion)).length;
    if (cell.backend && withGraph > 0) out.push('exclusive:both');
    if (!cell.backend && withGraph !== cases.length) out.push('exclusive:incomplete');
  }
  return out;
}

describe('subject kind input matrix', () => {
  it('the shipped table says what the header prose says', () => {
    // The oracle is only worth judging against if it is a genuine restatement.
    // This is the one place the two are compared directly; everywhere else the
    // oracle stands on its own.
    for (const kind of SUBJECT_KINDS) {
      expect(INPUTS_FOR_SUBJECT_KIND[kind], kind).toEqual(ORACLE[kind]);
    }
    expect(Object.keys(INPUTS_FOR_SUBJECT_KIND).sort()).toEqual([...SUBJECT_KINDS].sort());
  });

  it('the domain array and the type guard agree on what a kind is', () => {
    for (const kind of SUBJECT_KINDS) expect(isSubjectKind(kind), kind).toBe(true);
    for (const notAKind of ['etljob', 'benchmark', '', 'Query', null, 7, undefined]) {
      expect(isSubjectKind(notAKind), String(notAKind)).toBe(false);
    }
  });

  it('every cell is realized or explained', () => {
    const cells = allCells();
    const realized = cells.filter((cell) => realize(cell).status === 'realized');
    const unrealizable = cells.filter((cell) => realize(cell).status === 'unrealizable');

    expect(realized.length + unrealizable.length).toBe(cells.length);
    expect(cells.length).toBe(TOTAL_CELLS);
    expect(realized.length).toBe(REALIZED_CELLS);
    // Four kinds today. If that changes, the counts above are wrong rather
    // than merely stale, and this says so first.
    expect(SUBJECT_KINDS.length).toBe(4);
  });

  it('a realized cell is actually the cell it claims to be', () => {
    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      const where = describeCell(cell);

      expect(realization.cases.length, where).toBe(cell.arrangement === 'one' ? 1 : 2);
      expect(Boolean(realization.version.backend), where).toBe(cell.backend);
      expect(Boolean(realization.cases[0].dataGraphVersion), where).toBe(cell.shape.dataGraph);
      expect(Boolean(realization.cases[0].argumentSetVersion), where).toBe(cell.shape.argumentSet);
      expect(Boolean(realization.cases[0].tupleSeeds), where).toBe(cell.shape.tupleSeeds);
      expect(Boolean(realization.cases[0].sqlFixture), where).toBe(cell.shape.sqlFixture);
    }
  });

  it('refuses exactly the combinations the rules forbid', () => {
    const failures: string[] = [];
    let checked = 0;
    let refusals = 0;

    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;
      checked++;

      const problems = checkSubjectKindInputs(cell.kind, realization.version, realization.cases);
      const expected = expectedViolations(cell, realization.cases);
      refusals += problems.length;

      if ((problems.length === 0) !== (expected.length === 0)) {
        failures.push(
          `${describeCell(cell)} :: ${problems.length ? 'refused' : 'accepted'}, expected `
          + `${expected.length ? 'refusal' : 'acceptance'} (${expected.join(', ') || 'no violations'})`
          + (problems.length ? `\n    said: ${problems.join(' | ')}` : ''),
        );
        continue;
      }
      if (problems.length !== expected.length) {
        failures.push(
          `${describeCell(cell)} :: ${problems.length} problems, expected ${expected.length}`
          + ` (${expected.join(', ')})\n    said: ${problems.join(' | ')}`,
        );
      }
    }

    expect(failures).toEqual([]);
    // A property that never generates a case passes vacuously; and a sweep in
    // which nothing is ever refused would pass while checking nothing.
    expect(checked).toBe(REALIZED_CELLS);
    expect(refusals).toBeGreaterThan(100);
  });

  it('every refusal names a slot and says why', () => {
    // A refusal is read at the moment of saving a test, so "not valid" is the
    // least useful sentence available. Every forbidden slot carries a reason
    // today; this is what fails when a new kind forbids one without saying why.
    const SLOT_WORDS = ['a backend', 'a data graph', 'an argument set', 'tuple seeds', 'a SQL fixture'];
    const STORE_REFUSALS = [
      'names both a backend and a data graph',
      'has nowhere to run',
      'Every case needs a data graph',
    ];
    const failures: string[] = [];

    for (const cell of allCells()) {
      const realization = realize(cell);
      if (realization.status !== 'realized') continue;

      for (const problem of checkSubjectKindInputs(cell.kind, realization.version, realization.cases)) {
        const isSlotRefusal = SLOT_WORDS.some((word) => problem.includes(`names ${word}`));
        if (!isSlotRefusal) {
          // The exclusive-store messages are whole-version reasoning rather
          // than a slot refusal, and explain themselves in their own words.
          // Listed rather than prefix-matched: they do not share a prefix, and
          // a fourth one should have to be looked at rather than absorbed.
          const isStoreRefusal = STORE_REFUSALS.some((phrase) => problem.includes(phrase));
          if (!isStoreRefusal) {
            failures.push(`${describeCell(cell)} :: unrecognised refusal: ${problem}`);
          }
          continue;
        }
        if (!problem.includes(', but ')) {
          failures.push(`${describeCell(cell)} :: refusal names a slot without a reason: ${problem}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('names the offending row the way the caller names rows', () => {
    // The writer and the UI number their rows differently; the module takes a
    // describer so neither has to know about the other.
    const problems = checkSubjectKindInputs(
      'queryGroup',
      {},
      [{ tupleSeeds: null }, { tupleSeeds: 'TUPLE(?x) { (1) }' }],
      (index) => `Row ${index + 100}`,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Row 101');
  });

  it('reads a whitespace-only tuple seed as no seed at all', () => {
    // `.trim()` is load-bearing: a query is forbidden tuple seeds, so a stray
    // newline in the box would otherwise refuse a version that carries nothing.
    for (const blank of ['', '   ', '\n', '\t\n ']) {
      expect(
        checkSubjectKindInputs('query', { backend: 'urn:sqlib:backend:b1' }, [{ tupleSeeds: blank }]),
        JSON.stringify(blank),
      ).toEqual([]);
    }
    expect(
      checkSubjectKindInputs('query', { backend: 'urn:sqlib:backend:b1' }, [{ tupleSeeds: ' TUPLE("a") ' }]),
    ).toHaveLength(1);
  });

  it('judges the exclusive store over the whole version, not case by case', () => {
    const backend = { backend: 'urn:sqlib:backend:b1' };
    const graph = { dataGraphVersion: 'urn:sqlib:data-graph-version:g1' };

    // Hermetic: every case has a graph, no backend.
    expect(checkSubjectKindInputs('query', {}, [graph, graph])).toEqual([]);
    // Integration: a backend, no graphs.
    expect(checkSubjectKindInputs('query', backend, [{}, {}])).toEqual([]);
    // Half and half is the case the whole-version rule exists to catch: it
    // would run half in an ephemeral store and half against an endpoint, and
    // the report could not say truthfully which it was.
    expect(checkSubjectKindInputs('query', {}, [graph, {}])).toHaveLength(1);
    expect(checkSubjectKindInputs('query', {}, [graph, {}])[0]).toContain('Every case needs a data graph');
    expect(checkSubjectKindInputs('query', {}, [{}, {}])[0]).toContain('nowhere to run');
    expect(checkSubjectKindInputs('query', backend, [graph])[0]).toContain('both a backend and a data graph');
  });
});
