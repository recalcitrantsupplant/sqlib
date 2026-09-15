/**
 * The benchmark plan, and how a run reads back out of it.
 *
 * A benchmark is a set of **axes that multiply**. Cases × backends × argument
 * sets × load, minus the combinations recorded as unsupported, is the number of
 * requests the run will make — and knowing that number before pressing Run is
 * the single most useful thing on the Plan screen.
 *
 * Everything here is pure. The work area holds the state and the API calls; the
 * arithmetic that has to be right lives here where it can be tested without a
 * component.
 *
 * ## Where this model meets the API
 *
 * The persisted shape is a list of `subjectSpecs`, each carrying its *own*
 * backends and inputs. The design treats backends and argument sets as
 * benchmark-level axes that apply across every case, so the two shapes are
 * mapped rather than matched:
 *
 * - reading, a spec's `backends`/`inputs` are unioned across specs into axes;
 * - writing, each axis is fanned back out onto every spec it is valid for.
 *
 * That round-trips any plan this UI can author. A plan hand-written against the
 * API with genuinely per-spec backends widens on the way in, which is visible
 * (the axis shows every backend) rather than silent.
 */

import type { BenchmarkExperimentVersion } from '@sparql-query-lib/contracts';

/** The argument-set IRI the runner reads as "run this case with no arguments". */
export const NO_ARGUMENTS_IRI = 'https://sparql-query-lib/NoArguments';

/**
 * The backend IRI a run records where the subject has no store to name.
 *
 * A rule set evaluates in-process and a query group's nodes name their own
 * backends, so their observations carry this rather than a `Backend`. Reading
 * it as a backend id would print the raw IRI in the run's backend column.
 */
export const NOT_APPLICABLE_BACKEND_IRI = 'https://sparql-query-lib/NotApplicableBackend';

/* ------------------------------------------------------------------ *
 * Plan
 * ------------------------------------------------------------------ */

/**
 * What a case runs.
 *
 * A rule set collapses the backend axis (it evaluates in-process) and takes two
 * inputs of its own: tuple sets on the tabular axis, data graphs on the graph
 * axis. The two multiply rather than pair up.
 */
export type SubjectKind = 'query' | 'queryGroup' | 'ruleSet';

/**
 * A case: one question the benchmark asks.
 *
 * The spec's case is an *intent* plus a per-backend support matrix, and owns
 * its implementations. The API has no such object — the nearest thing it stores
 * is a subject spec pointing at a library query version — so a case here is
 * that pointer, and the intent/support fields the editor draws are marked as
 * not yet persisted rather than invented.
 */
export interface PlanCase {
  /** Local row id. Not persisted; a plan is rebuilt from the version on load. */
  id: string;
  subjectType: SubjectKind;
  subjectId: string | null;
  /** Resolved for display; the version IRI is what is persisted. */
  subjectName: string | null;
  versionId: string | null;
  versionNumber: number | null;
}

/** Policy — the settings that never multiply (§2.1). */
export interface PlanSettings {
  repeats: number | null;
  executionStrategy: string;
  timeWindow: string | null;
  maxConcurrency: number | null;
  warmupRuns: number | null;
  cooldownMs: number | null;
  timeoutMs: number | null;
  retryCount: number | null;
  retryDelayMs: number | null;
  randomizeOrder: boolean;
  abortOnError: boolean;
}

export interface BenchmarkPlan {
  cases: PlanCase[];
  backendIds: string[];
  argumentSetIds: string[];
  /**
   * The tabular axis for rule-set cases, kept apart from `argumentSetIds`.
   *
   * The API stores one `inputs` list per spec whose member type follows the
   * subject kind — an argument set for a query, a tuple set for a rule set. A
   * plan holds them as two axes because they are two lists of candidates a UI
   * would offer separately, and because unioning them would let a tuple set be
   * fanned onto a query spec, which is exactly the "plan the runner cannot
   * execute" the guard below exists to prevent.
   */
  tupleSetIds: string[];
  /** The graph axis: data graphs rule-set cases run over. */
  dataGraphIds: string[];
  settings: PlanSettings;
}

export function emptySettings(): PlanSettings {
  return {
    repeats: 1,
    executionStrategy: 'Sequential',
    timeWindow: null,
    maxConcurrency: null,
    warmupRuns: null,
    cooldownMs: null,
    timeoutMs: null,
    retryCount: null,
    retryDelayMs: null,
    randomizeOrder: false,
    abortOnError: false,
  };
}

export function emptyPlan(): BenchmarkPlan {
  return {
    cases: [],
    backendIds: [],
    argumentSetIds: [],
    tupleSetIds: [],
    dataGraphIds: [],
    settings: emptySettings(),
  };
}

/** Cases that name both a subject and a version. The rest are half-filled rows. */
export function completeCases(plan: BenchmarkPlan): PlanCase[] {
  return plan.cases.filter((c) => c.subjectId && c.versionId);
}

export interface SubjectSpecPayload {
  subject: string;
  backends?: string[];
  inputs: string[];
  dataGraphs?: string[];
}

/**
 * Fan the axes back out onto one spec per case.
 *
 * `argumentSetsFor` answers which of the plan's argument sets that case can
 * actually take — sets are scoped to a target in the API, so a set belonging to
 * another query must not be written onto this one. A case left with none is
 * sent with the no-arguments marker rather than an empty list, which is what
 * the runner reads as "once, unparameterised".
 *
 * ## Why an unrecognised input is kept rather than dropped
 *
 * The guard's evidence is another case *claiming* the id. An id no case in the
 * plan claims is not another subject's set as far as this plan can see: it is
 * an id this screen cannot classify — an `ArgumentSetVersion` IRI written by an
 * older promotion path (issue #246 §4), a set whose list failed to load, a plan
 * authored against the API. Filtering those out silently rewrote the benchmark
 * on the next save: editing anything on the plan screen dropped the arguments
 * and fell back to `NO_ARGUMENTS_IRI`, so the benchmark went on running but
 * stopped measuring what it was built to measure. Round-tripping an id nobody
 * disowns is the safer half of that trade.
 */
export function planToSubjectSpecs(
  plan: BenchmarkPlan,
  argumentSetsFor: (subjectId: string) => string[],
): SubjectSpecPayload[] {
  const cases = completeCases(plan);
  const queryCases = cases.filter((c) => c.subjectType !== 'ruleSet');
  const claimed = new Set(queryCases.flatMap((c) => argumentSetsFor(c.subjectId!)));
  return cases.map((c) => {
    /*
     * A rule set takes the other two axes: tuple sets on `inputs`, data graphs
     * on `dataGraphs`, and no backends at all. Neither is scoped to a subject
     * the way an argument set is scoped to its query — a tuple set is a
     * free-standing table and a data graph free-standing content — so there is
     * nothing to filter them against.
     */
    if (c.subjectType === 'ruleSet') {
      return {
        subject: c.versionId!,
        inputs: plan.tupleSetIds.length > 0 ? [...plan.tupleSetIds] : [NO_ARGUMENTS_IRI],
        ...(plan.dataGraphIds.length > 0 ? { dataGraphs: [...plan.dataGraphIds] } : {}),
      };
    }
    const allowed = new Set(argumentSetsFor(c.subjectId!));
    const inputs = plan.argumentSetIds.filter(
      (id) => id === NO_ARGUMENTS_IRI || allowed.has(id) || !claimed.has(id),
    );
    return {
      subject: c.versionId!,
      // Group nodes resolve their own backends, so a group spec carries none.
      backends: c.subjectType === 'query' ? [...plan.backendIds] : undefined,
      inputs: inputs.length > 0 ? inputs : [NO_ARGUMENTS_IRI],
    };
  });
}

/** The settings half of a version payload. */
export function settingsToPayload(settings: PlanSettings) {
  return { ...settings };
}

/**
 * Read a stored version back as a plan.
 *
 * `describeSubject` resolves a version IRI to something displayable; it returns
 * null for a subject this library cannot see, and the case still lists so the
 * plan is not silently short of a row.
 */
export function planFromVersion(
  version: BenchmarkExperimentVersion,
  describeSubject: (versionIri: string) => {
    subjectType: SubjectKind;
    subjectId: string;
    subjectName: string;
    versionNumber: number | null;
  } | null,
): BenchmarkPlan {
  const backendIds: string[] = [];
  const argumentSetIds: string[] = [];
  const tupleSetIds: string[] = [];
  const dataGraphIds: string[] = [];
  const cases: PlanCase[] = [];

  (version.subjectSpecs ?? []).forEach((spec, index) => {
    const described = describeSubject(spec.subject);
    /*
     * A `dataGraphs` list is evidence in the plan itself: only a rule-set
     * subject has that axis. It matters because the editor cannot yet index
     * rule sets, so `describeSubject` returns null for one authored through the
     * API — and a case that reads back as a query would be saved with backends
     * fanned onto it. The API refuses that at freeze rather than running the
     * wrong benchmark, but reading the kind off the evidence keeps a plan whose
     * axis is visible from ever getting there.
     */
    const subjectType = described?.subjectType
      ?? ((spec.dataGraphs?.length ?? 0) > 0 ? 'ruleSet' : 'query');
    cases.push({
      id: `case-${index}`,
      subjectType,
      subjectId: described?.subjectId ?? null,
      subjectName: described?.subjectName ?? null,
      versionId: spec.subject,
      versionNumber: described?.versionNumber ?? null,
    });
    for (const backend of spec.backends ?? []) {
      if (!backendIds.includes(backend)) backendIds.push(backend);
    }
    // Which axis a spec's `inputs` belong to is decided by the subject kind:
    // a rule set's are tuple sets. A subject this library cannot describe
    // defaults to `query`, so its inputs read as argument sets — the same
    // fallback the case row itself takes.
    const inputAxis = subjectType === 'ruleSet' ? tupleSetIds : argumentSetIds;
    for (const input of spec.inputs ?? []) {
      if (!inputAxis.includes(input)) inputAxis.push(input);
    }
    for (const dataGraph of spec.dataGraphs ?? []) {
      if (!dataGraphIds.includes(dataGraph)) dataGraphIds.push(dataGraph);
    }
  });

  return {
    cases,
    backendIds,
    argumentSetIds,
    tupleSetIds,
    dataGraphIds,
    settings: {
      repeats: version.repeats ?? 1,
      executionStrategy: version.executionStrategy ?? 'Sequential',
      timeWindow: version.timeWindow ?? null,
      maxConcurrency: version.maxConcurrency ?? null,
      warmupRuns: version.warmupRuns ?? null,
      cooldownMs: version.cooldownMs ?? null,
      timeoutMs: version.timeoutMs ?? null,
      retryCount: version.retryCount ?? null,
      retryDelayMs: version.retryDelayMs ?? null,
      randomizeOrder: version.randomizeOrder ?? false,
      abortOnError: version.abortOnError ?? false,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Expansion arithmetic
 * ------------------------------------------------------------------ */

export interface ExpansionFactor {
  label: string;
  count: number;
}

export interface Expansion {
  /** Total requests the run will make, after exclusions. */
  requests: number;
  factors: ExpansionFactor[];
  /** Combinations recorded as unsupported. Always 0 until support is stored. */
  excluded: number;
  /** `6 × 4 × 12 × 20 − 1,440 excluded`, ready to print. */
  formula: string;
}

const NBSP_TIMES = ' × ';

function grouped(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * How many requests this plan is.
 *
 * Warmup runs are deliberately outside the count: they are discarded, so
 * counting them would inflate the number the user is deciding on. The measured
 * repeat count is the load multiplier — one load profile reads as a constant,
 * which is exactly what a single `repeats` value is (§2.1).
 */
export function expandPlan(plan: BenchmarkPlan): Expansion {
  const cases = completeCases(plan);
  const caseCount = cases.length;
  const backendCount = plan.backendIds.length;
  const argumentCount = plan.argumentSetIds.length;
  const repeatCount = Math.max(1, plan.settings.repeats ?? 1);
  const hasRuleSetCase = cases.some((c) => c.subjectType === 'ruleSet');

  const factors: ExpansionFactor[] = [
    { label: 'cases', count: caseCount },
    // A plan with no backend named runs against each query's default, which is
    // one backend — not zero. Counting it as zero would print "0 requests" for
    // a plan that runs perfectly well.
    { label: 'backends', count: Math.max(1, backendCount) },
    { label: 'argument sets', count: Math.max(1, argumentCount) },
    /*
     * The rule-set axes appear only when a rule-set case does, so a plan
     * without one prints the same three-factor formula it always has.
     *
     * The product is an upper bound on a plan that mixes kinds — a backend
     * multiplies a query's requests but not a rule set's, and a data graph the
     * reverse — which is the approximation this function already makes for
     * query groups, whose nodes name their own backends. Splitting the formula
     * per kind is a display change and belongs with the editor that can author
     * a mixed plan in the first place.
     */
    ...(hasRuleSetCase
      ? [
        { label: 'tuple sets', count: Math.max(1, plan.tupleSetIds.length) },
        { label: 'data graphs', count: Math.max(1, plan.dataGraphIds.length) },
      ]
      : []),
    { label: 'repeats', count: repeatCount },
  ];

  const excluded = 0;
  const product = factors.reduce((total, f) => total * f.count, 1);
  const requests = Math.max(0, product - excluded);

  const formula = factors.map((f) => grouped(f.count)).join(NBSP_TIMES)
    + (excluded > 0 ? ` − ${grouped(excluded)} excluded` : '');

  return { requests, factors, excluded, formula };
}

/**
 * One factor's count, by label.
 *
 * The rule-set axes appear in the middle of the list only when a rule-set case
 * does, so the factors are no longer at fixed positions: a reader that indexed
 * `factors[3]` for the repeat count printed the tuple-set count instead the
 * moment a rules case joined the plan. Naming the factor is the fix.
 */
export function factorCount(expansion: Expansion, label: string): number {
  return expansion.factors.find((factor) => factor.label === label)?.count ?? 1;
}

/**
 * An estimate, or null.
 *
 * Derived from what the last run of this benchmark actually cost per request —
 * there is no other honest source. Before a first run there is no estimate, and
 * the footer says so rather than printing a guess.
 */
export function estimateDurationMs(requests: number, meanRequestMs: number | null): number | null {
  if (meanRequestMs == null || !Number.isFinite(meanRequestMs) || requests <= 0) return null;
  return requests * meanRequestMs;
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

/**
 * One observation as the API returns it.
 *
 * Two spellings reach the UI for the same field: the persistence layer emits
 * `refBackend` for a relation and `backend` once expanded, and the execute
 * response and the list endpoint do not agree. Both are read.
 */
export interface RawObservation {
  /**
   * The observation's own IRI.
   *
   * The join key for the second-level tables: a `BenchmarkIterationObservation`
   * names its request through `subjectObservation`, so a pass can only be put
   * beside the request that produced it if the request carries this.
   */
  id?: string;
  subject?: string;
  refSubject?: string;
  backend?: string;
  refBackend?: string;
  argumentSet?: string;
  refArgumentSet?: string;
  argumentSetVersion?: string;
  refArgumentSetVersion?: string;
  /**
   * The graph axis, on the observations a rule-set case produces.
   *
   * Absent on every query and query-group observation — they have a backend
   * where a rule set has a graph — and on a rules run whose spec named no
   * graph, which the runner executes against an empty base graph.
   */
  dataGraph?: string;
  refDataGraph?: string;
  dataGraphVersion?: string;
  refDataGraphVersion?: string;
  runIndex?: number;
  durationMs?: number;
  backendDurationMs?: number | null;
  queueDelayMs?: number | null;
  resultCount?: number | null;
  success?: boolean;
  errorMessage?: string | null;
  errorType?: string | null;
  timestamp?: string;
  [key: string]: unknown;
}

/** One request in the run — one row of the requests table, one tick on a lane. */
export interface RequestRow {
  key: string;
  /**
   * The combination this request repeats — its key without the repeat number.
   *
   * `runIndex` counts repeats *within* a combination, so the requests sharing
   * this string are the repeats of one thing measured several times. That is
   * the grouping passes are aggregated across, and the grouping the pass-count
   * canary compares.
   */
  combinationKey: string;
  /**
   * The `BenchmarkObservation` this row was built from.
   *
   * Null on the execute response's un-expanded rows, which carry no `id`. A
   * request without one simply has no passes to show — the second-level tables
   * are joined through it.
   */
  observationId: string | null;
  /** ms from the first request in the run. */
  offsetMs: number;
  caseId: string | null;
  caseLabel: string;
  backendId: string | null;
  backendLabel: string;
  argumentLabel: string;
  /**
   * The `ArgumentSetVersion` the run resolved `argumentSet` to, where the
   * observation records one.
   *
   * The plan names a set, which floats: this is the only record of which values
   * a given request actually ran, and the reason two runs of one frozen
   * benchmark version can be compared at all (issue #246). Null on the
   * no-arguments sentinel, and on observations recorded before the pin existed.
   */
  argumentVersionId: string | null;
  /**
   * The data graph this request ran over, where the subject has that axis.
   *
   * Null on a query, on a query group, and on a rule set whose plan named no
   * graph — the runner reads an absent graph as the empty base graph, which is
   * what a rule set whose DATA blocks are its whole input wants. Null is
   * therefore "no graph axis here", not "unknown".
   */
  dataGraphId: string | null;
  dataGraphLabel: string | null;
  /**
   * The `DataGraphVersion` the run resolved `dataGraphId` to.
   *
   * The same pin as `argumentVersionId`, for the same reason: a plan names a
   * floating `DataGraph`, so only the observation records which content a
   * number was measured against.
   */
  dataGraphVersionId: string | null;
  runIndex: number | null;
  /** Server-side time, where the runner captured it. Null otherwise. */
  ttfbMs: number | null;
  totalMs: number | null;
  rows: number | null;
  ok: boolean;
  status: string;
  errorMessage: string | null;
}

export interface RequestLookups {
  caseLabel: (iri: string) => string;
  backendLabel: (iri: string) => string;
  argumentLabel: (iri: string) => string;
  dataGraphLabel: (iri: string) => string;
}

function firstDefined(...values: (string | undefined)[]): string | null {
  for (const value of values) if (value) return value;
  return null;
}

export function toRequestRows(observations: RawObservation[], lookups: RequestLookups): RequestRow[] {
  const times = observations
    .map((o) => (o.timestamp ? Date.parse(o.timestamp) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  const origin = times.length > 0 ? Math.min(...times) : 0;

  return observations.map((observation, index) => {
    const caseId = firstDefined(observation.subject, observation.refSubject);
    const backendId = firstDefined(observation.backend, observation.refBackend);
    const argumentId = firstDefined(observation.argumentSet, observation.refArgumentSet);
    const argumentVersionId = firstDefined(
      observation.argumentSetVersion,
      observation.refArgumentSetVersion,
    );
    const dataGraphId = firstDefined(observation.dataGraph, observation.refDataGraph);
    const dataGraphVersionId = firstDefined(
      observation.dataGraphVersion,
      observation.refDataGraphVersion,
    );
    const started = observation.timestamp ? Date.parse(observation.timestamp) : Number.NaN;
    const ok = observation.success !== false;
    /*
     * The graph belongs in the combination because `runIndex` counts repeats
     * *within* one: the runner expands `dataGraphs × inputs × repeats` and
     * numbers 1..repeats inside each. Two graphs therefore produce two requests
     * agreeing on case, backend, input and run index, which without the graph
     * here are one key — a duplicate `:key` in the table, and a click that
     * selects whichever the lookup happens to find first.
     */
    const combinationKey = `${caseId ?? 'case'}|${backendId ?? 'backend'}|${argumentId ?? 'args'}|${dataGraphId ?? 'graph'}`;

    return {
      key: `${combinationKey}|${observation.runIndex ?? index}`,
      combinationKey,
      observationId: observation.id ?? null,
      offsetMs: Number.isFinite(started) ? started - origin : 0,
      caseId,
      caseLabel: caseId ? lookups.caseLabel(caseId) : 'Unknown case',
      backendId,
      backendLabel: backendId ? lookups.backendLabel(backendId) : 'Unknown backend',
      argumentLabel: argumentId === NO_ARGUMENTS_IRI || !argumentId
        ? '—'
        : lookups.argumentLabel(argumentId),
      argumentVersionId,
      dataGraphId,
      dataGraphLabel: dataGraphId ? lookups.dataGraphLabel(dataGraphId) : null,
      dataGraphVersionId,
      runIndex: observation.runIndex ?? null,
      ttfbMs: typeof observation.backendDurationMs === 'number' ? observation.backendDurationMs : null,
      totalMs: typeof observation.durationMs === 'number' ? observation.durationMs : null,
      rows: typeof observation.resultCount === 'number' ? observation.resultCount : null,
      ok,
      status: ok ? 'ok' : (observation.errorType || 'failed'),
      errorMessage: observation.errorMessage ?? null,
    };
  });
}

export interface TimelineSegment {
  /** Percent of the run's wall clock. */
  left: number;
  width: number;
}

export interface TimelineLane {
  /**
   * Identity, distinct from the label.
   *
   * Two data graphs may carry the same name — nothing constrains that — and a
   * lane list keyed on the label would then draw one lane where the run had
   * two. The label is for reading; this is for the `v-for`.
   */
  key: string;
  backendId: string | null;
  label: string;
  segments: TimelineSegment[];
}

/**
 * One lane per execution context, one tick per request.
 *
 * That context is the backend, except where the subject has no store to name
 * and a data graph instead. A rules run would otherwise put every request on
 * one "In-process" lane and show nothing, when what its requests differ by is
 * the graph they ran over; splitting on the graph draws the same picture the
 * backend lanes draw for a query run.
 *
 * This doubles as the proof that the order really was interleaved: lanes that
 * fill left-to-right one after another are a blocked run whatever the setting
 * claimed (§5).
 */
export function toTimelineLanes(requests: RequestRow[]): TimelineLane[] {
  if (requests.length === 0) return [];
  const span = Math.max(
    1,
    ...requests.map((r) => r.offsetMs + Math.max(0, r.totalMs ?? 0)),
  );

  const lanes = new Map<string, TimelineLane>();
  for (const request of requests) {
    /*
     * Only a rule-set request carries a graph, and its backend is always the
     * not-applicable sentinel, so the backend stays in the key: a mixed plan
     * keeps its store lanes and its graph lanes apart.
     */
    const key = `${request.backendId ?? '\u0000unknown'}|${request.dataGraphId ?? ''}`;
    let lane = lanes.get(key);
    if (!lane) {
      lane = {
        key,
        backendId: request.backendId,
        label: request.dataGraphLabel ?? request.backendLabel,
        segments: [],
      };
      lanes.set(key, lane);
    }
    const left = (request.offsetMs / span) * 100;
    // A 4ms request in a 4-minute run is 0.0017% wide, which is nothing. The
    // floor keeps every request visible — the lane is a census, not a chart.
    const width = Math.max(0.35, ((request.totalMs ?? 0) / span) * 100);
    lane.segments.push({ left, width: Math.min(width, Math.max(0, 100 - left)) });
  }
  return [...lanes.values()];
}

/** Percentile by nearest-rank, which is what p95 means when N is small. */
export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export interface RunStatistics {
  requests: number;
  failed: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  meanMs: number | null;
  wallClockMs: number | null;
}

/**
 * Failures are counted, never averaged into the statistic (§6). A timeout
 * contributes a 30-second sample that describes the timeout setting rather than
 * the store, so it is excluded from the percentiles and reported on its own.
 */
export function runStatistics(requests: RequestRow[]): RunStatistics {
  const succeeded = requests.filter((r) => r.ok && typeof r.totalMs === 'number');
  const durations = succeeded.map((r) => r.totalMs!);
  const span = requests.length > 0
    ? Math.max(...requests.map((r) => r.offsetMs + Math.max(0, r.totalMs ?? 0)))
    : null;

  return {
    requests: requests.length,
    failed: requests.filter((r) => !r.ok).length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    meanMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    wallClockMs: span,
  };
}

/**
 * Where a request's time went.
 *
 * The design asks for DNS / connect / TLS / waiting / transfer. The runner
 * captures two numbers — total, and the backend's own time — so this returns
 * the two it can prove and the caller says the rest is not captured. Inventing
 * a TLS slice out of a subtraction would be a chart of an assumption.
 */
export interface RequestPhase {
  name: string;
  ms: number;
  percent: number;
  tone: 'server' | 'client';
}

export function requestPhases(request: RequestRow): RequestPhase[] {
  const total = request.totalMs;
  if (total == null || total <= 0) return [];
  if (request.ttfbMs == null) {
    return [{ name: 'Total', ms: total, percent: 100, tone: 'server' }];
  }
  const server = Math.min(request.ttfbMs, total);
  const rest = Math.max(0, total - server);
  return [
    { name: 'Waiting on the store', ms: server, percent: (server / total) * 100, tone: 'server' },
    { name: 'Transfer and client', ms: rest, percent: (rest / total) * 100, tone: 'client' },
  ];
}

/* ------------------------------------------------------------------ *
 * Passes of the fixpoint loop
 * ------------------------------------------------------------------ */

/**
 * One `BenchmarkIterationObservation` as the API returns it.
 *
 * One spelling only, unlike `RawObservation`: both doors onto these rows —
 * `GET /benchmark-experiments/runs/:id/iteration-observations` and the run
 * response — hand back what `toRestApi` made of the LDKit entity, whose
 * property is `subjectObservation`. Reading a second spelling here would be
 * reading for a shape nothing produces.
 */
export interface RawIterationObservation {
  id?: string;
  subjectObservation?: string;
  runIndex?: number;
  iterationIndex?: number;
  stratum?: number | null;
  durationMs?: number;
  resultCount?: number | null;
  tripleCount?: number | null;
  tupleCount?: number | null;
  rulesEvaluated?: number | null;
  [key: string]: unknown;
}

/** One pass of the fixpoint loop, ready to draw. */
export interface PassRow {
  key: string;
  /** 1-based and global across strata, as the executor counts them (§1). */
  index: number;
  /** Which layer the ordinal belongs to. Null on a trace recorded without it. */
  stratum: number | null;
  durationMs: number;
  /** Percent of the slowest pass of the same request — the bar's width. */
  percent: number;
  /** Triples this pass derived: its delta, not the graph's size (§3). */
  derived: number | null;
  /** The inference graph's size once the pass finished. */
  triples: number | null;
  tuples: number | null;
  rulesEvaluated: number | null;
}

/** Passes by request key — what `toPassIndex` builds and the views read. */
export type PassIndex = Map<string, PassRow[]>;

/**
 * Attach every pass to the request that produced it.
 *
 * A pass names its request by observation IRI, so this is a join rather than a
 * grouping, and a pass whose parent is not among these requests is dropped:
 * there is no row to draw it under, and inventing one would claim a request the
 * run does not show.
 *
 * Sorted by ordinal here rather than trusted from the wire. The route sorts,
 * but the run response does not promise to, and a sequence read out of order
 * says nothing about where the time went.
 */
export function toPassIndex(
  iterations: RawIterationObservation[],
  requests: RequestRow[],
): PassIndex {
  const byObservation = new Map<string, string>();
  for (const request of requests) {
    if (request.observationId) byObservation.set(request.observationId, request.key);
  }

  const index: PassIndex = new Map();
  for (const iteration of iterations) {
    const parent = iteration.subjectObservation
      ? byObservation.get(iteration.subjectObservation)
      : undefined;
    if (!parent) continue;
    if (typeof iteration.iterationIndex !== 'number') continue;

    const rows = index.get(parent) ?? [];
    rows.push({
      key: `${parent}|${iteration.iterationIndex}`,
      index: iteration.iterationIndex,
      stratum: typeof iteration.stratum === 'number' ? iteration.stratum : null,
      durationMs: typeof iteration.durationMs === 'number' ? iteration.durationMs : 0,
      percent: 0,
      derived: typeof iteration.resultCount === 'number' ? iteration.resultCount : null,
      triples: typeof iteration.tripleCount === 'number' ? iteration.tripleCount : null,
      tuples: typeof iteration.tupleCount === 'number' ? iteration.tupleCount : null,
      rulesEvaluated: typeof iteration.rulesEvaluated === 'number' ? iteration.rulesEvaluated : null,
    });
    index.set(parent, rows);
  }

  for (const rows of index.values()) {
    rows.sort((a, b) => a.index - b.index);
    // Relative to the slowest pass of this request, not of the run: the
    // question the bar answers is which pass of *this* run was the expensive
    // one, and scaling across requests would flatten a fast run to nothing.
    const slowest = Math.max(...rows.map((row) => row.durationMs), 0);
    for (const row of rows) {
      row.percent = slowest > 0 ? (row.durationMs / slowest) * 100 : 0;
    }
  }
  return index;
}

/**
 * How many passes each of these requests took, skipping those that recorded
 * none.
 *
 * The pass count is a measurement rather than a plan value — the data decides
 * it — so it is reported per request and never averaged (§5).
 */
export function passCountsOf(requests: RequestRow[], index: PassIndex): number[] {
  const counts: number[] = [];
  for (const request of requests) {
    const rows = index.get(request.key);
    if (rows && rows.length > 0) counts.push(rows.length);
  }
  return counts;
}

/** The passes of one request, with what its sibling repeats did. */
export interface PassProfile {
  passes: PassRow[];
  /** Summed pass time. Never more than the request's own duration. */
  totalMs: number;
  /** Ordinal of the slowest pass, so the list can mark it. */
  slowestIndex: number;
  /** Pass counts across every repeat of this request's combination (§5). */
  repeatCounts: number[];
  /**
   * Repeats of one request that disagree on their pass count.
   *
   * §5's canary, and the same role `resultCount` plays at the request level: a
   * rule set that took nine passes once and twelve another time was not
   * measuring the same thing twice, so the view says so rather than averaging
   * the two into a number describing neither.
   */
  countsVary: boolean;
}

/**
 * Everything the request panel needs about one request's passes, or null where
 * it has none — a query, a query group, or a rules run recorded before the
 * iteration table existed.
 */
export function passProfile(
  request: RequestRow,
  requests: RequestRow[],
  index: PassIndex,
): PassProfile | null {
  const passes = index.get(request.key);
  if (!passes || passes.length === 0) return null;

  const repeats = requests.filter((other) => other.combinationKey === request.combinationKey);
  const repeatCounts = passCountsOf(repeats, index);
  const slowest = passes.reduce((worst, row) => (row.durationMs > worst.durationMs ? row : worst), passes[0]);

  return {
    passes,
    totalMs: passes.reduce((sum, row) => sum + row.durationMs, 0),
    slowestIndex: slowest.index,
    repeatCounts,
    countsVary: new Set(repeatCounts).size > 1,
  };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** `4.2ms`, `890ms`, `1.24s` — the mockup's scale, so columns stay comparable. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 10) return `${Math.round(ms)}ms`;
  return `${Number(ms.toFixed(1))}ms`;
}

/** `3m 41s` for a wall clock, `~11m` for an estimate. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** `+02:14.881` — offset from the start of the run. */
export function formatOffset(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `+${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatCount(n: number): string {
  return grouped(n);
}
