/**
 * Cases of a benchmark version, and how a run selects some of them (issue #251).
 *
 * A case is one cell of a version's plan: a subject on one backend, with one
 * input and, for a rule set, one data graph. Its repeats and warmups belong to
 * it. A client that restarts a store or waits for a CPU to cool between parts
 * of a pass does so between cases, so the case is the unit a run selects.
 *
 * Every case has an id derived from the four references that define it. The id
 * needs no storage, so a version saved before cases had ids has them too, and
 * the same cell has the same id in every version that holds it.
 *
 * A subject spec may also carry a `caseId` label. The label names every case
 * the spec expands to, so a client can select a group of cases by one name.
 */
import { createHash } from 'node:crypto';
import type { BenchmarkSubjectSpec } from './BenchmarkExperimentService.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { BENCHMARK_NOT_APPLICABLE_BACKEND_IRI, BENCHMARK_NO_ARGUMENTS_IRI } from '../constants/benchmarks.js';

/** The shape a spec label must have. The route schema states the same pattern. */
export const CASE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The most keys a run's `context` may hold. */
export const MAX_RUN_CONTEXT_KEYS = 64;
/** The most bytes a run's `context` may take as JSON. */
export const MAX_RUN_CONTEXT_BYTES = 8192;

export type BenchmarkCase = {
  caseId: string;
  /** The label of the spec this case comes from, where the spec has one. */
  specCaseId: string | null;
  subject: string;
  backend: string;
  input: string;
  dataGraph: string | null;
};

/**
 * The id of the case these four references define.
 *
 * The first 16 hex digits of a SHA-256 over the references. A version holds a
 * few hundred cases at most, so 64 bits make a collision within one version
 * negligible.
 */
export function caseIdFor(subject: string, backend: string, input: string, dataGraph: string | null): string {
  return createHash('sha256')
    .update(JSON.stringify([subject, backend, input, dataGraph]))
    .digest('hex')
    .slice(0, 16);
}

/**
 * The case an observation belongs to. An observation records the same four
 * references a case is defined by.
 */
export function caseIdOfObservation(observation: {
  subject: string;
  backend: string;
  argumentSet: string;
  dataGraph?: string | null;
}): string {
  return caseIdFor(observation.subject, observation.backend, observation.argumentSet, observation.dataGraph ?? null);
}

/**
 * The cases a version's specs expand to, in plan order.
 *
 * The expansion order is the runner's: backends, then data graphs, then
 * inputs. A subject that is missing or of an unsupported type expands to no
 * cases; `assertBenchmarkVersionDependencies` reports it.
 */
export function enumerateCases(specs: BenchmarkSubjectSpec[]): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    if (!spec?.subject) continue;
    const subjectType = getCacheCoordinator().get(spec.subject)?.['@type'];
    if (subjectType !== 'QueryVersion' && subjectType !== 'QueryGroupVersion' && subjectType !== 'RuleSetVersion') continue;
    const inputs = spec.inputs?.length ? spec.inputs : [BENCHMARK_NO_ARGUMENTS_IRI];
    const backends = subjectType === 'QueryVersion' ? (spec.backends ?? []) : [BENCHMARK_NOT_APPLICABLE_BACKEND_IRI];
    const dataGraphs: Array<string | null> = subjectType === 'RuleSetVersion' && spec.dataGraphs?.length ? spec.dataGraphs : [null];
    for (const backend of backends) {
      for (const dataGraph of dataGraphs) {
        for (const input of inputs) {
          const caseId = caseIdFor(spec.subject, backend, input, dataGraph);
          if (seen.has(caseId)) continue;
          seen.add(caseId);
          cases.push({ caseId, specCaseId: spec.caseId ?? null, subject: spec.subject, backend, input, dataGraph });
        }
      }
    }
  }
  return cases;
}

/**
 * Problems with the specs' labels: a label used twice, or a label equal to
 * the id of a case, which would make a selector mean two things.
 */
export function caseLabelIssues(specs: BenchmarkSubjectSpec[]): string[] {
  const issues: string[] = [];
  const labels = new Set<string>();
  for (const spec of specs) {
    const label = spec?.caseId;
    if (label === undefined || label === null) continue;
    if (!CASE_LABEL_PATTERN.test(label)) {
      issues.push(`Case label ${JSON.stringify(label)} must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter or digit`);
      continue;
    }
    if (labels.has(label)) {
      issues.push(`Case label ${label} is used by more than one subject spec`);
    }
    labels.add(label);
  }
  const caseIds = new Set(enumerateCases(specs).map((item) => item.caseId));
  for (const label of labels) {
    if (caseIds.has(label)) {
      issues.push(`Case label ${label} is also the id of a case`);
    }
  }
  return issues;
}

/** A selector that names no case of the version. */
export class UnknownCaseError extends Error {
  constructor(readonly unknown: string[]) {
    super(`Unknown case${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
    this.name = 'UnknownCaseError';
  }
}

/**
 * The ids of the cases a selection names, in plan order.
 *
 * A selector is a case id or a spec label. Throws `UnknownCaseError` when a
 * selector names nothing, so a typing error refuses the run before any
 * request goes out.
 */
export function resolveCaseSelection(cases: BenchmarkCase[], selectors: string[]): Set<string> {
  const selected = new Set<string>();
  const unknown: string[] = [];
  for (const selector of selectors) {
    const matches = cases.filter((item) => item.caseId === selector || item.specCaseId === selector);
    if (!matches.length) {
      unknown.push(selector);
      continue;
    }
    for (const match of matches) selected.add(match.caseId);
  }
  if (unknown.length) throw new UnknownCaseError(unknown);
  return selected;
}

/** A `context` that is over a cap. */
export class RunContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunContextError';
  }
}

export type RunContext = Record<string, string | number | boolean | null>;

/**
 * The `context` a run records, after the caps are checked.
 *
 * The route schema limits the shape to a flat object of scalar values. The
 * byte cap is checked here, because JSON Schema cannot state it.
 */
export function validateRunContext(context: RunContext | undefined | null): RunContext | undefined {
  if (context === undefined || context === null) return undefined;
  const keys = Object.keys(context);
  if (keys.length > MAX_RUN_CONTEXT_KEYS) {
    throw new RunContextError(`context has ${keys.length} keys; the most is ${MAX_RUN_CONTEXT_KEYS}`);
  }
  const json = JSON.stringify(context);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_RUN_CONTEXT_BYTES) {
    throw new RunContextError(`context is ${bytes} bytes as JSON; the most is ${MAX_RUN_CONTEXT_BYTES}`);
  }
  return context;
}
