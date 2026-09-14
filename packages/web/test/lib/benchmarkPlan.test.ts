import { describe, it, expect } from 'vitest';
import type { BenchmarkExperimentVersion } from '@sparql-query-lib/contracts';
import {
  NO_ARGUMENTS_IRI,
  emptyPlan,
  emptySettings,
  expandPlan,
  estimateDurationMs,
  factorCount,
  formatDuration,
  formatMs,
  formatOffset,
  passCountsOf,
  passProfile,
  percentile,
  planFromVersion,
  planToSubjectSpecs,
  requestPhases,
  runStatistics,
  toPassIndex,
  toRequestRows,
  toTimelineLanes,
  type BenchmarkPlan,
  type RawIterationObservation,
  type RawObservation,
} from '@/lib/benchmarkPlan';

const CASE_A = 'urn:sqlib:query-version:a';
const CASE_B = 'urn:sqlib:query-version:b';
const BACKEND_1 = 'urn:sqlib:backend:1';
const BACKEND_2 = 'urn:sqlib:backend:2';
const ARGS_1 = 'urn:sqlib:argument-set:1';
const ARGS_2 = 'urn:sqlib:argument-set:2';
const RULE_SET_CASE = 'urn:sqlib:rule-set-version:a';
const TUPLES_1 = 'urn:sqlib:tuple-set:1';
const GRAPH_1 = 'urn:sqlib:data-graph:1';
const GRAPH_2 = 'urn:sqlib:data-graph:2';

function planWith(overrides: Partial<BenchmarkPlan> = {}): BenchmarkPlan {
  return {
    ...emptyPlan(),
    cases: [
      { id: 'c1', subjectType: 'query', subjectId: 'q1', subjectName: 'A', versionId: CASE_A, versionNumber: 1 },
      { id: 'c2', subjectType: 'query', subjectId: 'q2', subjectName: 'B', versionId: CASE_B, versionNumber: 3 },
    ],
    backendIds: [BACKEND_1, BACKEND_2],
    argumentSetIds: [ARGS_1],
    ...overrides,
  };
}

describe('expansion arithmetic', () => {
  it('multiplies the axes and the measured repeats', () => {
    const plan = planWith();
    plan.settings.repeats = 20;

    const expansion = expandPlan(plan);

    expect(expansion.requests).toBe(2 * 2 * 1 * 20);
    expect(expansion.formula).toBe('2 × 2 × 1 × 20');
  });

  /*
   * A plan naming no backend runs each case against its query's own default,
   * which is one backend. Counting it as zero would print "0 requests" for a
   * plan that runs perfectly well — and the footer is the number the user is
   * deciding on.
   */
  it('counts an unnamed axis as one, not zero', () => {
    const expansion = expandPlan(planWith({ backendIds: [], argumentSetIds: [] }));

    expect(expansion.requests).toBe(2);
    expect(expansion.formula).toBe('2 × 1 × 1 × 1');
  });

  it('ignores half-filled cases', () => {
    const plan = planWith();
    plan.cases.push({
      id: 'c3', subjectType: 'query', subjectId: 'q3', subjectName: 'C', versionId: null, versionNumber: null,
    });

    expect(expandPlan(plan).factors[0].count).toBe(2);
  });

  // Warmup runs are discarded, so counting them would inflate the decision.
  it('leaves warmup runs out of the count', () => {
    const plan = planWith();
    plan.settings.repeats = 5;
    plan.settings.warmupRuns = 3;

    expect(expandPlan(plan).requests).toBe(2 * 2 * 1 * 5);
  });

  /*
   * The rule-set axes only appear when a rule-set case does, so every plan
   * without one prints the formula it always has. A rules plan is graphs ×
   * tuple sets rather than backends × argument sets.
   */
  it('adds the rule set axes only when a rule set case is in the plan', () => {
    const plan = planWith({
      cases: [{
        id: 'c1', subjectType: 'ruleSet', subjectId: 'r1', subjectName: 'R', versionId: RULE_SET_CASE, versionNumber: 1,
      }],
      backendIds: [],
      argumentSetIds: [],
      tupleSetIds: [TUPLES_1],
      dataGraphIds: [GRAPH_1, GRAPH_2],
    });

    const expansion = expandPlan(plan);

    expect(expansion.factors.map((f) => f.label)).toEqual([
      'cases', 'backends', 'argument sets', 'tuple sets', 'data graphs', 'repeats',
    ]);
    expect(expansion.requests).toBe(2);
    expect(expandPlan(planWith()).factors.map((f) => f.label)).toEqual([
      'cases', 'backends', 'argument sets', 'repeats',
    ]);
  });

  /*
   * The factors are no longer at fixed positions, which is why the plan column
   * reads them by name: the two rule-set axes are inserted before `repeats`, so
   * a reader that indexed `factors[3]` for the repeat count printed the
   * tuple-set count the moment a rules case joined the plan.
   */
  it('finds a factor by label whether or not the rule set axes are present', () => {
    const queries = expandPlan(planWith({ settings: { ...emptySettings(), repeats: 7 } }));
    expect(factorCount(queries, 'repeats')).toBe(7);
    expect(factorCount(queries, 'data graphs')).toBe(1);

    const rules = expandPlan(planWith({
      cases: [{
        id: 'c1', subjectType: 'ruleSet', subjectId: 'r1', subjectName: 'R', versionId: RULE_SET_CASE, versionNumber: 1,
      }],
      tupleSetIds: [TUPLES_1],
      dataGraphIds: [GRAPH_1, GRAPH_2],
      settings: { ...emptySettings(), repeats: 7 },
    }));
    expect(factorCount(rules, 'repeats')).toBe(7);
    expect(factorCount(rules, 'data graphs')).toBe(2);
  });

  it('estimates only when a previous run gave it a number', () => {
    expect(estimateDurationMs(100, null)).toBeNull();
    expect(estimateDurationMs(100, 40)).toBe(4000);
  });
});

describe('plan ↔ subject specs', () => {
  it('fans each axis back out onto every case', () => {
    const specs = planToSubjectSpecs(planWith(), () => [ARGS_1]);

    expect(specs).toEqual([
      { subject: CASE_A, backends: [BACKEND_1, BACKEND_2], inputs: [ARGS_1] },
      { subject: CASE_B, backends: [BACKEND_1, BACKEND_2], inputs: [ARGS_1] },
    ]);
  });

  /*
   * Argument sets belong to their target query. Writing one query's set onto
   * another query's spec would make a plan the runner cannot execute, so a set
   * is skipped where it does not belong.
   */
  it('skips an argument set the case cannot take', () => {
    const plan = planWith({ argumentSetIds: [ARGS_1, ARGS_2] });
    const specs = planToSubjectSpecs(plan, (subjectId) => (subjectId === 'q1' ? [ARGS_1] : [ARGS_2]));

    expect(specs[0].inputs).toEqual([ARGS_1]);
    expect(specs[1].inputs).toEqual([ARGS_2]);
  });

  /*
   * The failure #246 §4 describes: promotion wrote an `ArgumentSetVersion` IRI
   * into a set-IRI axis, no case claimed it, and the next save on the plan
   * screen dropped it — the benchmark kept running, unparameterised, without
   * saying so. An id nobody disowns round-trips instead.
   */
  it('keeps an input no case claims rather than dropping it on save', () => {
    const legacyVersionIri = 'urn:sqlib:argument-set-version:1';
    const plan = planWith({ argumentSetIds: [ARGS_1, legacyVersionIri] });

    const specs = planToSubjectSpecs(plan, () => [ARGS_1]);

    expect(specs[0].inputs).toEqual([ARGS_1, legacyVersionIri]);
    expect(specs[1].inputs).toEqual([ARGS_1, legacyVersionIri]);
  });

  it('still refuses a set another case in the plan claims', () => {
    const plan = planWith({ argumentSetIds: [ARGS_1, ARGS_2] });

    const specs = planToSubjectSpecs(plan, (subjectId) => (subjectId === 'q1' ? [ARGS_1] : [ARGS_2]));

    expect(specs[0].inputs).toEqual([ARGS_1]);
    expect(specs[1].inputs).toEqual([ARGS_2]);
  });

  it('sends the no-arguments marker rather than an empty list', () => {
    const specs = planToSubjectSpecs(planWith({ argumentSetIds: [] }), () => []);

    expect(specs[0].inputs).toEqual([NO_ARGUMENTS_IRI]);
  });

  it('gives a query group no backends — its nodes resolve their own', () => {
    const plan = planWith({
      cases: [{
        id: 'c1', subjectType: 'queryGroup', subjectId: 'g1', subjectName: 'G', versionId: CASE_A, versionNumber: 1,
      }],
    });

    expect(planToSubjectSpecs(plan, () => [])[0].backends).toBeUndefined();
  });

  /*
   * A rule set collapses the backend axis and brings two of its own. The plan
   * keeps them apart from the argument axis so that fanning out cannot write a
   * tuple set onto a query's spec.
   */
  it('gives a rule set its own two axes and no backends', () => {
    const plan = planWith({
      cases: [{
        id: 'c1', subjectType: 'ruleSet', subjectId: 'r1', subjectName: 'R', versionId: RULE_SET_CASE, versionNumber: 1,
      }],
      tupleSetIds: [TUPLES_1],
      dataGraphIds: [GRAPH_1, GRAPH_2],
    });

    const specs = planToSubjectSpecs(plan, () => [ARGS_1]);

    expect(specs).toEqual([{
      subject: RULE_SET_CASE,
      inputs: [TUPLES_1],
      dataGraphs: [GRAPH_1, GRAPH_2],
    }]);
  });

  it('sends a rule set with no tuple set as unparameterised', () => {
    const plan = planWith({
      cases: [{
        id: 'c1', subjectType: 'ruleSet', subjectId: 'r1', subjectName: 'R', versionId: RULE_SET_CASE, versionNumber: 1,
      }],
    });

    expect(planToSubjectSpecs(plan, () => [])[0].inputs).toEqual([NO_ARGUMENTS_IRI]);
  });

  /*
   * A mixed plan is the case the split axes exist for: the query keeps its
   * argument sets and backends, the rule set keeps its tuple sets and graphs,
   * and neither borrows the other's.
   */
  it('keeps the two tabular axes apart in a mixed plan', () => {
    const plan = planWith({
      cases: [
        { id: 'c1', subjectType: 'query', subjectId: 'q1', subjectName: 'A', versionId: CASE_A, versionNumber: 1 },
        { id: 'c2', subjectType: 'ruleSet', subjectId: 'r1', subjectName: 'R', versionId: RULE_SET_CASE, versionNumber: 1 },
      ],
      argumentSetIds: [ARGS_1],
      tupleSetIds: [TUPLES_1],
      dataGraphIds: [GRAPH_1],
    });

    const specs = planToSubjectSpecs(plan, () => [ARGS_1]);

    expect(specs[0]).toEqual({ subject: CASE_A, backends: [BACKEND_1, BACKEND_2], inputs: [ARGS_1] });
    expect(specs[1]).toEqual({ subject: RULE_SET_CASE, inputs: [TUPLES_1], dataGraphs: [GRAPH_1] });
  });

  const ruleSetVersion = {
    id: 'urn:sqlib:benchmark-version:2',
    isPartOf: 'urn:sqlib:benchmark-experiment:1',
    version: 1,
    subjectSpecs: [{ subject: RULE_SET_CASE, inputs: [TUPLES_1], dataGraphs: [GRAPH_1] }],
  } as BenchmarkExperimentVersion;

  it('round-trips a rule set benchmark without dropping its axes', () => {
    const plan = planFromVersion(ruleSetVersion, () => ({
      subjectType: 'ruleSet', subjectId: 'r1', subjectName: 'R', versionNumber: 1,
    }));

    expect(plan.tupleSetIds).toEqual([TUPLES_1]);
    expect(plan.dataGraphIds).toEqual([GRAPH_1]);
    expect(plan.argumentSetIds).toEqual([]);
    expect(planToSubjectSpecs(plan, () => [])).toEqual(ruleSetVersion.subjectSpecs);
  });

  /*
   * The benchmark editor cannot index rule sets yet, so a benchmark authored
   * through the API describes as nothing. A `dataGraphs` list is evidence in
   * the plan itself — only a rule set has that axis — and reading the kind off
   * it keeps the case from being saved back as a query with backends fanned
   * onto it.
   */
  it('reads the kind off the graph axis when the subject cannot be described', () => {
    const plan = planFromVersion(ruleSetVersion, () => null);

    expect(plan.cases[0].subjectType).toBe('ruleSet');
    expect(plan.tupleSetIds).toEqual([TUPLES_1]);
    expect(plan.dataGraphIds).toEqual([GRAPH_1]);
  });

  it('reads a stored version back as axes', () => {
    const version = {
      id: 'urn:sqlib:benchmark-version:1',
      isPartOf: 'urn:sqlib:benchmark-experiment:1',
      version: 2,
      subjectSpecs: [
        { subject: CASE_A, backends: [BACKEND_1], inputs: [ARGS_1] },
        { subject: CASE_B, backends: [BACKEND_1, BACKEND_2], inputs: [ARGS_1, ARGS_2] },
      ],
      repeats: 4,
      randomizeOrder: true,
    } as BenchmarkExperimentVersion;

    const plan = planFromVersion(version, (iri) => (iri === CASE_A
      ? { subjectType: 'query', subjectId: 'q1', subjectName: 'A', versionNumber: 1 }
      : null));

    expect(plan.backendIds).toEqual([BACKEND_1, BACKEND_2]);
    expect(plan.argumentSetIds).toEqual([ARGS_1, ARGS_2]);
    expect(plan.settings.repeats).toBe(4);
    expect(plan.settings.randomizeOrder).toBe(true);
    expect(plan.cases[0].subjectName).toBe('A');
    // A subject this library cannot name still lists, so the plan is not
    // silently a case short.
    expect(plan.cases[1].subjectName).toBeNull();
    expect(plan.cases[1].versionId).toBe(CASE_B);
  });
});

describe('requests', () => {
  const lookups = {
    caseLabel: (iri: string) => (iri === CASE_A ? 'Case A' : 'Case B'),
    backendLabel: (iri: string) => (iri === BACKEND_1 ? 'GraphDB' : 'Fuseki'),
    argumentLabel: () => '50 search terms',
    dataGraphLabel: (iri: string) => (iri === GRAPH_1 ? 'Roads' : 'Rails'),
  };

  const observations: RawObservation[] = [
    {
      subject: CASE_A, backend: BACKEND_1, argumentSet: ARGS_1, runIndex: 0,
      durationMs: 100, backendDurationMs: 70, resultCount: 12, success: true,
      timestamp: '2026-08-09T02:00:00.000Z',
    },
    {
      refSubject: CASE_B, refBackend: BACKEND_2, refArgumentSet: NO_ARGUMENTS_IRI, runIndex: 0,
      durationMs: 400, resultCount: 3, success: true,
      timestamp: '2026-08-09T02:00:02.000Z',
    },
    {
      subject: CASE_A, backend: BACKEND_2, argumentSet: ARGS_1, runIndex: 1,
      durationMs: 30000, success: false, errorType: 'timeout', errorMessage: 'timed out',
      timestamp: '2026-08-09T02:00:04.000Z',
    },
  ];

  // Both spellings reach the UI for the same field, depending on which endpoint
  // returned the observation.
  it('reads ref-prefixed and expanded relations alike', () => {
    const rows = toRequestRows(observations, lookups);

    expect(rows[0].caseLabel).toBe('Case A');
    expect(rows[1].caseLabel).toBe('Case B');
    expect(rows[1].backendLabel).toBe('Fuseki');
  });

  it('offsets every request from the first one', () => {
    const rows = toRequestRows(observations, lookups);

    expect(rows[0].offsetMs).toBe(0);
    expect(rows[1].offsetMs).toBe(2000);
    expect(formatOffset(rows[2].offsetMs)).toBe('+00:04.000');
  });

  it('reads the no-arguments marker as no argument', () => {
    expect(toRequestRows(observations, lookups)[1].argumentLabel).toBe('—');
  });

  /*
   * The plan names a set and the set floats, so the version the run resolved it
   * to is the only record of which values produced a number (#246). Both
   * spellings again, and absent where there is nothing to pin.
   */
  it('carries the argument set version the run pinned', () => {
    const pinned = 'urn:sqlib:argument-set-version:7';
    const rows = toRequestRows([
      { ...observations[0], argumentSetVersion: pinned },
      { ...observations[1] },
      { ...observations[2], refArgumentSetVersion: pinned },
    ], lookups);

    expect(rows[0].argumentVersionId).toBe(pinned);
    expect(rows[1].argumentVersionId).toBeNull();
    expect(rows[2].argumentVersionId).toBe(pinned);
  });

  /*
   * A 30-second timeout is a sample describing the timeout setting, not the
   * store. Averaging it in would make the policy look like a measurement.
   */
  it('counts failures and keeps them out of the percentiles', () => {
    const stats = runStatistics(toRequestRows(observations, lookups));

    expect(stats.requests).toBe(3);
    expect(stats.failed).toBe(1);
    expect(stats.p95).toBe(400);
    expect(stats.meanMs).toBe(250);
  });

  it('gives every backend a lane and every request a visible tick', () => {
    const lanes = toTimelineLanes(toRequestRows(observations, lookups));

    expect(lanes.map((lane) => lane.label)).toEqual(['GraphDB', 'Fuseki']);
    expect(lanes[1].segments).toHaveLength(2);
    for (const lane of lanes) {
      for (const segment of lane.segments) expect(segment.width).toBeGreaterThan(0);
    }
  });

  /*
   * A rules run's requests differ by the graph they ran over, which the run
   * view could not read at all before this: the axis reached the runner and the
   * observation, and stopped at the reader.
   */
  describe('the graph axis', () => {
    const NOT_APPLICABLE = 'https://sparql-query-lib/NotApplicableBackend';

    /** Two graphs, two repeats each, as the runner expands them. */
    const rulesRun: RawObservation[] = [
      {
        subject: RULE_SET_CASE, backend: NOT_APPLICABLE, argumentSet: TUPLES_1,
        dataGraph: GRAPH_1, dataGraphVersion: `${GRAPH_1}:v2`, runIndex: 1,
        durationMs: 100, resultCount: 40, success: true,
        timestamp: '2026-09-07T02:00:00.000Z',
      },
      {
        subject: RULE_SET_CASE, backend: NOT_APPLICABLE, argumentSet: TUPLES_1,
        refDataGraph: GRAPH_2, refDataGraphVersion: `${GRAPH_2}:v1`, runIndex: 1,
        durationMs: 300, resultCount: 90, success: true,
        timestamp: '2026-09-07T02:00:01.000Z',
      },
    ];

    it('reads the graph and its pinned version, in both spellings', () => {
      const rows = toRequestRows(rulesRun, lookups);

      expect(rows[0].dataGraphId).toBe(GRAPH_1);
      expect(rows[0].dataGraphLabel).toBe('Roads');
      expect(rows[0].dataGraphVersionId).toBe(`${GRAPH_1}:v2`);
      expect(rows[1].dataGraphLabel).toBe('Rails');
      expect(rows[1].dataGraphVersionId).toBe(`${GRAPH_2}:v1`);
    });

    /*
     * `runIndex` counts repeats *within* a combination, so two graphs produce
     * two requests agreeing on everything else. Without the graph in the key
     * they are one row as far as the table and the selection are concerned.
     */
    it('keeps two graphs of one repetition apart', () => {
      const rows = toRequestRows(rulesRun, lookups);

      expect(rows[0].key).not.toBe(rows[1].key);
      expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    });

    /* A query has no graph, so the column stays off rather than reading "—". */
    it('leaves the graph null on a query request', () => {
      const rows = toRequestRows(observations, lookups);
      expect(rows.every((row) => row.dataGraphId === null)).toBe(true);
      expect(rows.every((row) => row.dataGraphLabel === null)).toBe(true);
    });

    /*
     * Every rules request records the same not-applicable backend, so lanes
     * keyed on the backend alone would draw one lane and say nothing about the
     * thing the run varied.
     */
    it('lanes a rules run by graph rather than by its one in-process backend', () => {
      const lanes = toTimelineLanes(toRequestRows(rulesRun, lookups));

      expect(lanes.map((lane) => lane.label)).toEqual(['Roads', 'Rails']);
    });

    /*
     * Nothing constrains two data graphs to different names, and a lane list
     * the view keys on the label would draw one lane where the run had two.
     */
    it('gives two identically named graphs two lanes', () => {
      const lanes = toTimelineLanes(toRequestRows(rulesRun, {
        ...lookups,
        dataGraphLabel: () => 'Snapshot',
      }));

      expect(lanes).toHaveLength(2);
      expect(new Set(lanes.map((lane) => lane.key)).size).toBe(2);
    });

    it('still lanes a graphless run by backend', () => {
      const lanes = toTimelineLanes(toRequestRows(observations, lookups));
      expect(lanes.map((lane) => lane.label)).toEqual(['GraphDB', 'Fuseki']);
    });
  });

  /*
   * The passes of the fixpoint loop. The rows reached the store and the route
   * in #393 and stopped at the reader — a rules run drew one duration per
   * request and could not say whether it was slow once or slow eleven times.
   */
  describe('passes', () => {
    const NOT_APPLICABLE = 'https://sparql-query-lib/NotApplicableBackend';
    const OBS_1 = 'urn:sqlib:benchmark-observation:1';
    const OBS_2 = 'urn:sqlib:benchmark-observation:2';

    /** One combination, two repeats — what §5 aggregates across. */
    const twoRepeats: RawObservation[] = [
      {
        id: OBS_1, subject: RULE_SET_CASE, backend: NOT_APPLICABLE, argumentSet: TUPLES_1,
        dataGraph: GRAPH_1, runIndex: 1, durationMs: 400, resultCount: 40, success: true,
        timestamp: '2026-09-07T02:00:00.000Z',
      },
      {
        id: OBS_2, subject: RULE_SET_CASE, backend: NOT_APPLICABLE, argumentSet: TUPLES_1,
        dataGraph: GRAPH_1, runIndex: 2, durationMs: 380, resultCount: 40, success: true,
        timestamp: '2026-09-07T02:00:01.000Z',
      },
    ];

    const passesOf = (observation: string, durations: number[]): RawIterationObservation[] =>
      durations.map((durationMs, i) => ({
        id: `${observation}:pass:${i + 1}`,
        subjectObservation: observation,
        runIndex: 1,
        iterationIndex: i + 1,
        stratum: 0,
        durationMs,
        resultCount: i === durations.length - 1 ? 0 : 10,
        tripleCount: 30 + i * 10,
        tupleCount: null,
        rulesEvaluated: 3,
      }));

    it('carries the observation IRI the passes join through', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      expect(rows[0].observationId).toBe(OBS_1);
      // The execute response's rows have no id, and simply have no passes.
      expect(toRequestRows(observations, lookups)[0].observationId).toBeNull();
    });

    it('attaches each pass to the request that produced it', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      const index = toPassIndex(
        [...passesOf(OBS_1, [100, 60, 20]), ...passesOf(OBS_2, [90, 55])],
        rows,
      );

      expect(index.get(rows[0].key)).toHaveLength(3);
      expect(index.get(rows[1].key)).toHaveLength(2);
    });

    /*
     * The route sorts, the run response does not promise to, and a sequence
     * read out of order says nothing about where the time went.
     */
    it('orders passes by ordinal whatever order they arrived in', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      const shuffled = [...passesOf(OBS_1, [100, 60, 20])].reverse();

      const index = toPassIndex(shuffled, rows);
      expect(index.get(rows[0].key)!.map((pass) => pass.index)).toEqual([1, 2, 3]);
    });

    /* The bar answers "which pass of this run", so it scales within the run. */
    it('scales each pass against the slowest of its own request', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      const index = toPassIndex([...passesOf(OBS_1, [100, 50]), ...passesOf(OBS_2, [10, 5])], rows);

      expect(index.get(rows[0].key)!.map((pass) => pass.percent)).toEqual([100, 50]);
      expect(index.get(rows[1].key)!.map((pass) => pass.percent)).toEqual([100, 50]);
    });

    /*
     * A pass naming an observation this run does not show has no row to hang
     * under, and inventing one would claim a request the table never drew.
     */
    it('drops a pass whose request is not in the run', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      const index = toPassIndex(passesOf('urn:sqlib:benchmark-observation:elsewhere', [10]), rows);

      expect(index.size).toBe(0);
    });

    it('reads the delta and the running total apart', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      const passes = toPassIndex(passesOf(OBS_1, [100, 60]), rows).get(rows[0].key)!;

      expect(passes.map((pass) => pass.derived)).toEqual([10, 0]);
      expect(passes.map((pass) => pass.triples)).toEqual([30, 40]);
    });

    it('marks the slowest pass and totals the time inside the loop', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      const index = toPassIndex(passesOf(OBS_1, [40, 120, 20]), rows);

      const profile = passProfile(rows[0], rows, index)!;
      expect(profile.slowestIndex).toBe(2);
      expect(profile.totalMs).toBe(180);
    });

    /*
     * §5's canary. Nine passes once and twelve another time is a finding about
     * the rule set, so the counts are reported rather than averaged into a
     * number describing neither run.
     */
    it('reports repeats that disagree on their pass count', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      const index = toPassIndex([...passesOf(OBS_1, [40, 30, 20]), ...passesOf(OBS_2, [40, 30])], rows);

      const profile = passProfile(rows[0], rows, index)!;
      expect(profile.repeatCounts).toEqual([3, 2]);
      expect(profile.countsVary).toBe(true);
    });

    it('says nothing where every repeat took the same number', () => {
      const rows = toRequestRows(twoRepeats, lookups);
      const index = toPassIndex([...passesOf(OBS_1, [40, 30]), ...passesOf(OBS_2, [45, 25])], rows);

      expect(passProfile(rows[0], rows, index)!.countsVary).toBe(false);
    });

    /*
     * Two graphs of one repetition agree on case, backend, input and run index,
     * so a combination that ignored the graph would pool passes measured over
     * different data and report them as repeats of one thing.
     */
    it('keeps two graphs of one repetition in separate combinations', () => {
      const rows = toRequestRows([
        twoRepeats[0],
        { ...twoRepeats[1], dataGraph: GRAPH_2, runIndex: 1 },
      ], lookups);

      expect(rows[0].combinationKey).not.toBe(rows[1].combinationKey);

      const index = toPassIndex([...passesOf(OBS_1, [40, 30, 20]), ...passesOf(OBS_2, [40, 30])], rows);
      expect(passProfile(rows[0], rows, index)!.repeatCounts).toEqual([3]);
    });

    /* A query has no loop, so the column, the block and the row all stay off. */
    it('finds no passes on a query request', () => {
      const rows = toRequestRows(observations, lookups);
      const index = toPassIndex([], rows);

      expect(passCountsOf(rows, index)).toEqual([]);
      expect(passProfile(rows[0], rows, index)).toBeNull();
    });
  });

  it('splits a request into the two phases the runner times', () => {
    const rows = toRequestRows(observations, lookups);

    const split = requestPhases(rows[0]);
    expect(split.map((phase) => phase.ms)).toEqual([70, 30]);

    // No backend duration reported — there is nothing to split, so one bar.
    expect(requestPhases(rows[1])).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('reads percentiles by nearest rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 95)).toBeNull();
  });

  it('switches to seconds where milliseconds stop being readable', () => {
    expect(formatMs(4.2)).toBe('4.2ms');
    expect(formatMs(890)).toBe('890ms');
    expect(formatMs(1240)).toBe('1.24s');
    expect(formatMs(null)).toBe('—');
  });

  it('prints a wall clock', () => {
    expect(formatDuration(41_000)).toBe('41s');
    expect(formatDuration(221_000)).toBe('3m 41s');
    expect(formatDuration(120_000)).toBe('2m');
    expect(formatDuration(null)).toBe('—');
  });
});
