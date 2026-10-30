/**
 * Graph policies: which graphs a caller may read on a backend.
 *
 * Grants answer "may you use this backend at all?". A graph policy answers
 * "which graphs on it may you read?", and its answer comes from data, so it is
 * a query: a saved SELECT, pinned by version, that runs on an auth backend and
 * projects the reserved dataset names.
 *
 * | Projected      | Fills                              |
 * | -------------- | ---------------------------------- |
 * | `?graph`       | both parts                         |
 * | `?defaultGraph`| the default graph (`FROM`)         |
 * | `?namedGraph`  | the named graphs (`FROM NAMED`)    |
 *
 * The policy reads the caller through two reserved VALUES slots, which sqlib
 * fills and no caller can set:
 *
 * - `VALUES ?authUser { UNDEF }`: one row, the caller's user or client
 *   principal IRI;
 * - `VALUES ?authGroup { UNDEF }`: one row per group principal IRI. A caller
 *   with no groups gets zero rows, which matches nothing.
 *
 * Three rules keep it safe:
 *
 * - **No policy, no restriction.** A backend without one runs as before.
 * - **Fail closed.** A policy that errors refuses the request with a generic
 *   message. A policy that returns nothing gives no graphs. A part the policy
 *   does not project gives no graphs too: unlike a caller's dataset, an absent
 *   part of a policy never means "everything".
 * - **Narrow only.** The policy dataset is intersected with the caller's
 *   dataset and any `DATASET` edge (`intersectDatasets`), so nothing a caller
 *   sends can widen it.
 *
 * The policy narrows reads only. Who may update a backend is the `update`
 * grant's question, and an update may write any graph.
 */
import { LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { applyExecutionArguments, type WireArgumentSet } from '../lib/executionArguments.js';
import { SparqlQueryParser } from '../lib/parser.js';
import { detectSparqlOperation } from '../lib/queryTypeDetector.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import type { SparqlDataset } from '../server/ISparqlExecutor.js';
import type { LdkitBackend } from '../persistence/schemas/BackendSchema.js';
import { getAuthConfig } from './config.js';
import { isGroupPrincipal } from './principals.js';
import type { AuthContext } from './types.js';

export const AUTH_USER_VARIABLE = 'authUser';
export const AUTH_GROUP_VARIABLE = 'authGroup';

/** The projected names a policy may use, and the dataset part each one fills. */
const POLICY_OUTPUTS = {
  graph: ['defaultGraphs', 'namedGraphs'],
  defaultGraph: ['defaultGraphs'],
  namedGraph: ['namedGraphs'],
} as const satisfies Record<string, ReadonlyArray<keyof SparqlDataset>>;

type PolicyOutput = keyof typeof POLICY_OUTPUTS;

function isPolicyOutput(name: string): name is PolicyOutput {
  return Object.prototype.hasOwnProperty.call(POLICY_OUTPUTS, name);
}

/**
 * Thrown when a policy cannot be evaluated. The message is generic on purpose:
 * the policy's text, its result and its errors stay on the server.
 */
export class GraphPolicyError extends Error {
  readonly statusCode = 503;

  constructor(readonly backendId: string, readonly cause?: unknown) {
    super(`The graph policy for backend ${backendId} could not be evaluated, so the request was refused.`);
    this.name = 'GraphPolicyError';
  }
}

/** Who the policy is asked about. */
export interface PolicySubject {
  user: string;
  groups: string[];
}

export function policySubjectOf(context: AuthContext): PolicySubject {
  return {
    user: context.subject,
    groups: context.principals.filter(isGroupPrincipal),
  };
}

/** The policy settings a backend record carries. */
export interface GraphPolicySettings {
  queryVersion: string;
  backend: string;
}

export function graphPolicyOf(backend: Partial<LdkitBackend> | null | undefined): GraphPolicySettings | null {
  if (!backend?.graphPolicyQueryVersion || !backend.graphPolicyBackend) return null;
  return { queryVersion: backend.graphPolicyQueryVersion, backend: backend.graphPolicyBackend };
}

/** The graph policy a backend names, read from the entity cache. */
export function graphPolicyForBackend(backendId: string): GraphPolicySettings | null {
  return graphPolicyOf(getCacheCoordinator().get(backendId) as LdkitBackend | null);
}

/**
 * The mode needed to read a backend's patch log.
 *
 * A patch holds the quads an update wrote, in every graph, so on a policed
 * backend it would show what the policy hides. Reading it there takes an
 * update mode, which already means "may write, so may see, the whole backend".
 */
export function patchLogReadMode(backendId: string): 'query:saved' | 'update:saved' {
  return graphPolicyForBackend(backendId) ? 'update:saved' : 'query:saved';
}

/**
 * Whether a backend holds authorization data. The library storage backend
 * counts: it holds sqlib's own auth graph, so a policy may read grants there.
 */
export function isAuthBackend(backendId: string | null | undefined): boolean {
  if (!backendId) return false;
  if (backendId === LIBRARY_STORAGE_BACKEND_ID) return true;
  const backend = getCacheCoordinator().get(backendId) as LdkitBackend | null;
  return backend?.authBackend === true;
}

/**
 * Why a query cannot be a graph policy, or null when it can.
 *
 * Checked when an administrator sets the policy, so a bad policy is refused
 * once rather than failing on every request.
 */
export function graphPolicyQueryProblem(queryString: string, parser = new SparqlQueryParser()): string | null {
  let operation;
  try {
    operation = detectSparqlOperation(queryString);
  } catch {
    return 'The graph policy query does not parse.';
  }
  if (operation !== QueryTypeIri.select) return 'A graph policy must be a SELECT query.';

  const outputs = parser.detectQueryOutputs(queryString) ?? [];
  if (outputs.length === 0) {
    return 'A graph policy must project ?graph, ?defaultGraph or ?namedGraph.';
  }
  const others = outputs.filter(name => !isPolicyOutput(name));
  if (others.length > 0) {
    return `A graph policy may project only ?graph, ?defaultGraph and ?namedGraph (found ${others.map(n => `?${n}`).join(', ')}).`;
  }

  const inputs = parser.detectInputs(queryString);
  if (inputs.limitParameters.length > 0 || inputs.offsetParameters.length > 0) {
    return 'A graph policy cannot declare LIMIT or OFFSET parameters.';
  }
  for (const group of inputs.valuesInputs) {
    if (group.length !== 1 || (group[0] !== AUTH_USER_VARIABLE && group[0] !== AUTH_GROUP_VARIABLE)) {
      return 'A graph policy may declare only the slots VALUES ?authUser { UNDEF } and VALUES ?authGroup { UNDEF }, '
        + `each on its own (found ${group.map(n => `?${n}`).join(' ')}).`;
    }
  }
  return null;
}

function iriRows(variable: string, values: readonly string[]): WireArgumentSet {
  return {
    head: { vars: [variable] },
    results: { bindings: values.map(value => ({ [variable]: { type: 'uri', value } })) },
  };
}

/** The policy text with its auth slots filled for one subject. */
export function bindPolicySubject(
  queryString: string,
  subject: PolicySubject,
  parser = new SparqlQueryParser(),
): string {
  const declared = new Set(parser.detectInputs(queryString).valuesInputs.flat());
  const argumentSets: WireArgumentSet[] = [];
  if (declared.has(AUTH_USER_VARIABLE)) argumentSets.push(iriRows(AUTH_USER_VARIABLE, [subject.user]));
  // Always sent when declared, even with no groups: an omitted slot would stay
  // UNDEF and match every group.
  if (declared.has(AUTH_GROUP_VARIABLE)) argumentSets.push(iriRows(AUTH_GROUP_VARIABLE, subject.groups));
  return applyExecutionArguments(queryString, { argumentSets }, parser);
}

type Bindings = Array<Record<string, { type?: string; value?: string } | undefined>>;

/**
 * The dataset a policy result allows. Both parts are always present: a part
 * nothing filled is an empty list, never "unrestricted".
 */
export function datasetFromPolicyResult(result: unknown): Required<SparqlDataset> {
  const bindings = (result as { results?: { bindings?: Bindings } } | null)?.results?.bindings;
  if (!Array.isArray(bindings)) throw new Error('The graph policy did not return SPARQL results JSON.');

  const dataset: Required<SparqlDataset> = { defaultGraphs: [], namedGraphs: [] };
  for (const row of bindings) {
    for (const [name, term] of Object.entries(row ?? {})) {
      if (!isPolicyOutput(name) || term?.type !== 'uri' || !term.value) continue;
      for (const part of POLICY_OUTPUTS[name]) {
        if (!dataset[part].includes(term.value)) dataset[part].push(term.value);
      }
    }
  }
  return dataset;
}

/** Runs a bound policy query on its auth backend and returns the SELECT result. */
export type PolicyRunner = (backendId: string, queryString: string) => Promise<unknown>;

/**
 * Runs the policy as sqlib itself: the caller holds no grant on the auth
 * backend and must not need one. Imported lazily, because the executor
 * factory imports this module.
 */
const defaultPolicyRunner: PolicyRunner = async (backendId, queryString) => {
  const { ExecutorFactory } = await import('../lib/orchestration/ExecutorFactory.js');
  const executor = await new ExecutorFactory({ internal: true }).getExecutorForBackendId(backendId);
  const { result } = await executor.selectQueryParsed(queryString, {
    acceptHeader: 'application/sparql-results+json',
  });
  return typeof result === 'string' ? JSON.parse(result) : result;
};

let policyRunner: PolicyRunner = defaultPolicyRunner;

/** Test seam. `null` restores the default runner. */
export function setGraphPolicyRunner(runner: PolicyRunner | null): void {
  policyRunner = runner ?? defaultPolicyRunner;
}

interface CacheEntry {
  dataset: Required<SparqlDataset>;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

/** Drops every cached policy result. Called when a backend or auth backend changes. */
export function clearGraphPolicyCache(): void {
  cache.clear();
}

const MAX_CACHED_POLICY_RESULTS = 10_000;

function cacheKey(backendId: string, policy: GraphPolicySettings, subject: PolicySubject): string {
  return JSON.stringify([backendId, policy.queryVersion, policy.backend, subject.user, [...subject.groups].sort()]);
}

/**
 * Evaluates a graph policy for one subject, without consulting the backend
 * record. `Test as` uses this directly; enforcement goes through
 * `graphPolicyDataset`.
 */
export async function evaluateGraphPolicy(
  backendId: string,
  policy: GraphPolicySettings,
  subject: PolicySubject,
  options: { useCache?: boolean } = {},
): Promise<Required<SparqlDataset>> {
  const useCache = options.useCache ?? true;
  const ttl = getAuthConfig().graphPolicyCacheSeconds * 1000;
  const key = cacheKey(backendId, policy, subject);
  if (useCache && ttl > 0) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.dataset;
  }

  let dataset: Required<SparqlDataset>;
  try {
    if (!isAuthBackend(policy.backend)) throw new Error(`Policy backend ${policy.backend} is not an auth backend.`);
    const version = getCacheCoordinator().get(policy.queryVersion) as { queryString?: string } | null;
    if (!version?.queryString) throw new Error(`Policy query version ${policy.queryVersion} not found.`);
    const problem = graphPolicyQueryProblem(version.queryString);
    if (problem) throw new Error(problem);
    const bound = bindPolicySubject(version.queryString, subject);
    dataset = datasetFromPolicyResult(await policyRunner(policy.backend, bound));
  } catch (error) {
    throw new GraphPolicyError(backendId, error);
  }

  if (useCache && ttl > 0) {
    // A crude bound: callers times backends is small, and a burst of distinct
    // subjects should cost policy runs, not memory.
    if (cache.size >= MAX_CACHED_POLICY_RESULTS) cache.clear();
    cache.set(key, { dataset, expires: Date.now() + ttl });
  }
  return dataset;
}

/**
 * The policy dataset for a caller on a backend, or undefined when the
 * backend has no policy. Throws `GraphPolicyError` when it cannot be
 * evaluated.
 */
export async function graphPolicyDataset(
  backendId: string,
  context: AuthContext,
): Promise<Required<SparqlDataset> | undefined> {
  const policy = graphPolicyForBackend(backendId);
  if (!policy) return undefined;
  return evaluateGraphPolicy(backendId, policy, policySubjectOf(context));
}

/**
 * True when query text names a `SERVICE`. A federated pattern reaches another
 * endpoint, or this one without the dataset, so a policy cannot narrow it.
 * Policed runs report it as a warning; they do not refuse it.
 *
 * A text check, not a parse: comments, strings and IRIs are blanked first so
 * that a literal "service" does not count.
 */
export function mentionsService(queryString: string): boolean {
  const blanked = queryString
    .replace(/<[^<>\s]*>/g, '<>')
    .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
    .replace(/#[^\n]*/g, '');
  return /\bSERVICE\b/i.test(blanked);
}
