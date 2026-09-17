/**
 * What a test's subject is, and which inputs that kind of subject accepts.
 *
 * The kinds themselves lived on `TestRunner` because it was the only thing that
 * cared. They moved here when the *input rules* needed a home: the writer has
 * to refuse a combination the runner cannot honour, and the two stating it
 * separately is how a test comes to validate one way and run another — the same
 * reasoning that put `effectiveCases` in one place.
 *
 * The rules are not arbitrary; each says something about the subject:
 *
 * - A **rule set** runs in-process against a base graph. There is no endpoint
 *   to name, and its tabular input is a tuple seed rather than an argument set.
 *   Wanting "fetch a graph with SPARQL, then run rules over it" is a query
 *   group, not a rule set with a backend.
 * - A **query** runs against exactly one store, and which one is the difference
 *   between a hermetic test and an integration one: a data graph on the case
 *   (loaded into an ephemeral store) or a backend on the version, never both
 *   and never neither.
 * - A **query group** names its backends itself, per node, so a backend on the
 *   test would be a value nothing reads. What the test supplies is what the
 *   group's start node declares, and a start node declares two independent
 *   kinds of input: tuples, filled by an argument set, and data graphs, filled
 *   by the case's data graph. They are separate slots rather than alternatives,
 *   so a case may carry both.
 * - An **ETL job** reads rows with SQL and constructs RDF from them. Its
 *   tabular input is neither an argument set nor tuple seeds but the rows its
 *   SQL reads, which a case supplies as a SQL fixture — statements run on the
 *   job's own DuckDB connection, on a database that exists only for that case.
 *   It names no backend for the same reason a query group does not: the job
 *   version carries one, and a test never runs against it.
 */
import type { FeatureFlagKey } from './featureFlags.js';

export type SubjectKind = 'query' | 'queryGroup' | 'ruleSet' | 'etlJob';

/**
 * Compile-time proof that a runtime array lists every member of its union.
 *
 * A copy of `packages/web/src/composables/exhaustiveDomain.ts`, which cannot be
 * imported here: `packages/types` is upstream of the web app and may not depend
 * on it. The guard has to live beside the array it guards, because the array is
 * what a sweep iterates, and an array that quietly falls behind its union
 * shrinks every matrix built from it while the suite stays green.
 *
 * A missing member turns the annotation into a tuple type, so `= true` stops
 * compiling and the error names what was left out.
 */
export type Covers<Union, Listed extends Union> = [Exclude<Union, Listed>] extends [never]
  ? true
  : ['domain array is missing union members:', Exclude<Union, Listed>];

export const SUBJECT_KINDS = ['query', 'queryGroup', 'ruleSet', 'etlJob'] as const satisfies readonly SubjectKind[];

export const _subjectKindsCover: Covers<SubjectKind, (typeof SUBJECT_KINDS)[number]> = true;

export function isSubjectKind(value: unknown): value is SubjectKind {
  return typeof value === 'string' && (SUBJECT_KINDS as readonly string[]).includes(value);
}

/**
 * The feature each kind of subject belongs to.
 *
 * A build with `FEATURE_ETL=0` has no ETL jobs to point a test at, and the API
 * refuses one, so the writer must not offer the kind either — a picker that
 * lists it leads to an empty chooser and a refusal. Stated here rather than in
 * the screen because the same answer is wanted wherever a subject is chosen.
 */
export const FEATURE_FOR_SUBJECT_KIND: Record<SubjectKind, FeatureFlagKey> = {
  query: 'queries',
  queryGroup: 'queryGroups',
  ruleSet: 'rulesSuite',
  etlJob: 'etl',
};

/** The entity type a subject of each kind must be. */
export const ENTITY_TYPE_FOR_SUBJECT_KIND: Record<SubjectKind, string> = {
  query: 'Query',
  queryGroup: 'QueryGroup',
  ruleSet: 'RuleSet',
  etlJob: 'EtlJob',
};

/**
 * Which input slots a subject kind accepts.
 *
 * Read by the writer to refuse a bad version, and by the UI to decide which
 * slots to show at all — a slot that cannot apply is absent rather than
 * disabled, because a greyed control reads as "broken" where the truth is "not
 * a thing here".
 */
export interface SubjectKindInputs {
  /** A live endpoint on the version. */
  backend: boolean;
  /**
   * A `DataGraphVersion` on each case.
   *
   * For a query or a rule set it seeds the store the subject runs against; for
   * a query group it fills the data graph input its start node declares, which
   * is why a group case may name one alongside an argument set.
   */
  dataGraph: boolean;
  /** An `ArgumentSetVersion` on each case. */
  argumentSet: boolean;
  /** Inline `TUPLE(…)` seeds on each case. */
  tupleSeeds: boolean;
  /**
   * DuckDB statements on each case, run before the subject's own SQL.
   *
   * The rows an ETL job reads. It is SQL rather than a table of values because
   * the ETL sandbox leaves no file or URL for a fixture to live in, and because
   * only DDL can say a column is `DECIMAL(18,4)` — which is most of what an ETL
   * job's typing is about.
   */
  sqlFixture: boolean;
  /**
   * True when the kind accepts two stores but must run against one.
   *
   * Only queries: a rule set has no backend to choose between, and a query
   * group has neither.
   */
  exclusiveStore: boolean;
}

export const INPUTS_FOR_SUBJECT_KIND: Record<SubjectKind, SubjectKindInputs> = {
  ruleSet: {
    backend: false,
    dataGraph: true,
    argumentSet: false,
    tupleSeeds: true,
    sqlFixture: false,
    exclusiveStore: false,
  },
  query: {
    backend: true,
    dataGraph: true,
    argumentSet: true,
    tupleSeeds: false,
    sqlFixture: false,
    exclusiveStore: true,
  },
  queryGroup: {
    backend: false,
    dataGraph: true,
    argumentSet: true,
    tupleSeeds: false,
    sqlFixture: false,
    exclusiveStore: false,
  },
  etlJob: {
    backend: false,
    // Seeds the ephemeral store the job's SPARQL template runs against, so a
    // template that joins against existing data is still testable. Optional:
    // most templates construct from their `VALUES` alone.
    dataGraph: true,
    argumentSet: false,
    tupleSeeds: false,
    sqlFixture: true,
    exclusiveStore: false,
  },
};

/** Human-readable slot names, for the messages a refusal has to be readable as. */
const SLOT_LABEL: Record<keyof Omit<SubjectKindInputs, 'exclusiveStore'>, string> = {
  backend: 'a backend',
  dataGraph: 'a data graph',
  argumentSet: 'an argument set',
  tupleSeeds: 'tuple seeds',
  sqlFixture: 'a SQL fixture',
};

/** Why this kind does not take that slot — the half of a refusal that teaches. */
const SLOT_REASON: Record<SubjectKind, Partial<Record<keyof typeof SLOT_LABEL, string>>> = {
  ruleSet: {
    backend: 'a rule set runs in-process against its base graph. To query a live endpoint first and run rules over what comes back, use a query group.',
    argumentSet: 'a rule set takes its tabular input as tuple seeds, not as an argument set.',
    sqlFixture: 'a SQL fixture supplies the rows an ETL job reads; a rule set takes tuple seeds.',
  },
  query: {
    tupleSeeds: 'tuple seeds are a rule set\'s input; a query takes an argument set.',
    sqlFixture: 'a SQL fixture supplies the rows an ETL job reads; a query takes an argument set.',
  },
  queryGroup: {
    backend: 'a query group\'s nodes name their own backends, so the test has none to name.',
    tupleSeeds: 'tuple seeds are a rule set\'s input; a query group takes an argument set.',
    sqlFixture: 'a SQL fixture supplies the rows an ETL job reads; a query group takes an argument set.',
  },
  etlJob: {
    backend: 'an ETL job version names its own backend, and a test never runs against it — the template runs against an ephemeral store so the run has no side effect.',
    argumentSet: 'an ETL job declares no parameters. Its tabular input is the rows its SQL reads, which a SQL fixture supplies.',
    tupleSeeds: 'tuple seeds are a rule set\'s input; an ETL job takes a SQL fixture.',
  },
};

/** One case's inputs, as the writer receives them and as they are stored. */
export interface SubjectKindCaseInputs {
  argumentSetVersion?: string | null;
  dataGraphVersion?: string | null;
  tupleSeeds?: string | null;
  sqlFixture?: string | null;
}

export interface SubjectKindVersionInputs {
  backend?: string | null;
}

/**
 * Check a version's inputs against what its subject kind accepts.
 *
 * Returns the reasons it is wrong, empty when it is right. Reasons rather than
 * a boolean because a refusal has to say which slot and why: "not valid" at the
 * moment of saving a test is the least useful sentence available.
 *
 * `describeCase` names the offending row the way the caller names rows, so the
 * writer's messages and the UI's can agree without this module knowing about
 * either.
 */
export function checkSubjectKindInputs(
  kind: SubjectKind,
  version: SubjectKindVersionInputs,
  cases: readonly SubjectKindCaseInputs[],
  describeCase: (index: number) => string = index => `Case ${index + 1}`,
): string[] {
  const allowed = INPUTS_FOR_SUBJECT_KIND[kind];
  const problems: string[] = [];

  const forbid = (slot: keyof typeof SLOT_LABEL, where: string, present: boolean) => {
    if (!present || allowed[slot]) return;
    const reason = SLOT_REASON[kind][slot];
    problems.push(`${where} names ${SLOT_LABEL[slot]}${reason ? `, but ${reason}` : '.'}`);
  };

  forbid('backend', 'This test', Boolean(version.backend));

  cases.forEach((testCase, index) => {
    const where = describeCase(index);
    forbid('dataGraph', where, Boolean(testCase.dataGraphVersion));
    forbid('argumentSet', where, Boolean(testCase.argumentSetVersion));
    forbid('tupleSeeds', where, Boolean(testCase.tupleSeeds?.trim()));
    forbid('sqlFixture', where, Boolean(testCase.sqlFixture?.trim()));
  });

  if (allowed.exclusiveStore) {
    // Judged over the whole version, not per case: hermetic-versus-integration
    // is recorded once per run and lands in every report, so a test that ran
    // half in an ephemeral store and half against an endpoint could not say
    // truthfully which it was.
    const withGraph = cases.filter(testCase => Boolean(testCase.dataGraphVersion));
    if (version.backend && withGraph.length > 0) {
      problems.push(
        'This test names both a backend and a data graph. A query runs against one store: '
        + 'drop the backend to run hermetically, or drop the data graph to run against the backend.',
      );
    }
    if (!version.backend && withGraph.length !== cases.length) {
      problems.push(
        withGraph.length === 0
          ? 'This test has nowhere to run. Name a backend, or give each case a data graph to run against hermetically.'
          : 'Every case needs a data graph when no backend is named, so that the whole test runs hermetically.',
      );
    }
  }

  return problems;
}
