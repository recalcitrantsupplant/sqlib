/**
 * The export bundle: a library's parameterised queries, compiled and frozen.
 *
 * `sqlib export` compiles each query once — with the full SPARQL parser, on the
 * server, where the parser already lives — and writes the results here. The bundle
 * is then a static asset: bundle it, or serve it from a CDN, and run it with
 * {@link fromBundle} and no sqlib server anywhere.
 *
 * Two properties make that safe to do:
 *
 * - **The templates are verified.** Every template in a bundle passed the API's
 *   adversarial equivalence check against the AST path before it was written out,
 *   so the splice this runtime performs is known to agree with what the server
 *   would have produced.
 * - **The bundle is generated-only.** A slot is a span into `template.text`, so
 *   editing that text by hand silently moves every slot after the edit.
 *   {@link assertValidBundle} catches structural corruption on load, and
 *   {@link verifyBundleIntegrity} catches *any* edit by re-hashing the text.
 */

import { isSafeVariableName } from './sparql-terms.js';
import type { EmptyArgumentMode, QueryTemplate } from './query-template.js';
import type { WireArgumentSet } from './arguments.js';
import type { ExecutionParameter } from './limit-offset.js';

/** The query forms an exported bundle can carry. UPDATE is deliberately absent. */
export type ExportedQueryType = 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE';

/**
 * A `LIMIT`/`OFFSET` placeholder, located in the compiled text.
 *
 * On the request path page parameters are substituted by regular expression over
 * the query the author wrote, because `LIMIT 0001` is unmistakable there. A
 * bundle cannot do that: `template.text` is the *generated* rendering, and the
 * generator reads `0001` as the integer 1 and writes it back as `1`, taking the
 * placeholder with it. So the export records where each placeholder ended up and
 * the runtime splices by span, exactly as it does for a parameter slot.
 *
 * The span covers the whole clause — the keyword included — so the replacement is
 * `LIMIT 25` rather than a bare number, and an unsupplied parameter simply leaves
 * the placeholder text in place, which is what the server does too.
 */
export interface PageParameterSpan {
  /** The parameter name, as `limits`/`offsets` payloads spell it. */
  name: string;
  kind: 'limit' | 'offset';
  start: number;
  end: number;
}

/**
 * A worked example: a payload known to fit the query.
 *
 * Examples come from the library's own tests — a `TestCase` already carries
 * arguments, and it carries them in the shape the runtime takes, so an example
 * is a test with its assertion machinery stripped off. They exist to be run:
 * by a person clicking one in the demo page, or by a language model reading the
 * bundle to learn how the library is called.
 */
export interface QueryExample {
  /** Display name: the case's own name, else `<test name> #<position>`. */
  name: string;
  /** At most one argument set per parameter slot — a `CallPayload.arguments`. */
  arguments: WireArgumentSet[];
  limits?: ExecutionParameter[];
  offsets?: ExecutionParameter[];
  /**
   * The test's recorded answer, carried only when exported with `--expected`.
   * Reference material, never an assertion: the endpoint a bundle is pointed at
   * holds different data from the one the test was written against.
   */
  expected?: string;
  expectedFormat?: string;
  /**
   * True when the source case seeded its own data. The arguments are still a
   * valid payload; only the expectation is meaningless away from that seed.
   */
  dataDependent?: boolean;
  /** Provenance: the Test and TestCase the example was read from. */
  sourceTest?: string;
  sourceCase?: string;
}

/** One compiled query, as written by `sqlib export`. */
export interface ExportedQuery {
  /** The compiled template: canonical text plus each parameter slot's span. */
  template: QueryTemplate;
  queryType: ExportedQueryType;
  /** Parameter names usable as `limits` / `offsets`, from the stored version. */
  limitParameters: string[];
  offsetParameters: string[];
  /**
   * Where those parameters sit in {@link QueryTemplate.text}. A name may appear
   * more than once — a paged query repeated across a UNION — and every occurrence
   * is listed. Absent on a query that paginates by neither.
   */
  pageParameters?: PageParameterSpan[];
  /**
   * Declared variables per parameter slot, in slot order, each sorted — the
   * query's signature. Present so an app (or generated typings) can describe the
   * call without reading spans out of the template.
   */
  inferredInputs: string[][];
  /** `sha256-<hex>` of `template.text`; see {@link verifyBundleIntegrity}. */
  textHash: string;
  /** The QueryVersion this was compiled from. Provenance only, never resolved. */
  sourceVersion?: string;
  /**
   * The stable Query this was compiled from. Provenance, and the key the export
   * uses to find the tests that become {@link ExportedQuery.examples}.
   */
  sourceQuery?: string;
  /** Runnable examples, in the order the export found them. */
  examples?: QueryExample[];
  /** The library tags the query carries, for filtering a rendered library. */
  tags?: string[];
  description?: string;
}

/** One node of an exported query group: a query in this bundle, run in place. */
export interface ExportedGroupNode {
  /** Key into {@link ExportBundle.queries} — the compiled query this node runs. */
  query: string;
  /** Provenance: the QueryNode IRI this was exported from. Never resolved. */
  sourceNode?: string;
}

/** One upstream variable feeding one downstream variable, across an edge. */
export interface GroupVariableMapping {
  source: string;
  target: string;
}

/**
 * A chaining edge: the upstream node's rows fill one of the downstream node's
 * parameter slots.
 *
 * The mapping is resolved at export time, from the edge's stored
 * `variableMappings` or the default name-then-position pairing the server uses,
 * so the runtime only ever renames columns it has been told to rename.
 */
export interface ExportedGroupEdge {
  /** Node key the rows come from. */
  from: string;
  /** Node key they are spliced into. */
  to: string;
  /**
   * The slot they fill, as its variables in declaration order. This is how the
   * edge finds its slot: the target query may declare several, and a slot is
   * identified by the variables it binds, exactly as an argument set is.
   */
  targetVars: string[];
  /** Upstream variable → downstream variable, at most one entry per target. */
  mappings: GroupVariableMapping[];
  /** The author's policy when the upstream supplies no rows. */
  whenEmpty?: EmptyArgumentMode;
  /** Provenance: the QueryEdge IRI. Never resolved. */
  sourceEdge?: string;
}

/**
 * A query group, compiled for client-side execution: a DAG of this bundle's
 * queries, each downstream node taking its rows from the nodes above it.
 *
 * Only SELECT→VALUES chaining is carried. A group whose edges move RDF or a
 * boolean, or whose nodes are rule sets or ETL jobs, is not exported at all —
 * the export says so rather than shipping a group that would run differently
 * here than it does on the server. See `docs/guides/static-export.md`.
 */
export interface ExportedGroup {
  name?: string;
  description?: string;
  /** Nodes keyed by a slug unique within the group. */
  nodes: Record<string, ExportedGroupNode>;
  edges: ExportedGroupEdge[];
  /** The node whose result is the group's result — what fed its end node. */
  resultNode: string;
  /** The library tags the group carries, for filtering a rendered library. */
  tags?: string[];
  /** Provenance: the QueryGroup and the QueryGroupVersion compiled from. */
  sourceGroup?: string;
  sourceVersion?: string;
}

/** One column of an exported ETL job's mapping: a SQL column to a variable. */
export interface ExportedEtlColumn {
  /** The SQL output column, by its alias. */
  columnName: string;
  /** The variable it binds, without `?`. */
  targetVariable: string;
  termType: 'uri' | 'literal';
  datatypeIri?: string;
  lang?: string;
  /** For IRIs, e.g. `http://ex/customer/{value}`; the value is URI-encoded. */
  iriTemplate?: string;
  /** `undef` leaves the variable unbound; `skipRow` drops the row. */
  nullPolicy: 'undef' | 'skipRow';
}

/**
 * An ETL job, ready to run with no server: SQL rows in, one CONSTRUCT per chunk.
 *
 * The template is compiled exactly as a query's is, and has exactly one slot —
 * the one each chunk's rows fill. The SQL is carried as text and is run by
 * whatever runs the bundle (the `sqlib` CLI runs it in DuckDB). The job's
 * backend is not carried: where the SQL reads from and where the RDF goes are
 * decided where the job runs.
 */
export interface ExportedEtlJob {
  /** The CONSTRUCT template, with the one slot each chunk's rows fill. */
  template: QueryTemplate;
  /** `sha256-<hex>` of `template.text`; see {@link verifyBundleIntegrity}. */
  textHash: string;
  sql: string;
  columns: ExportedEtlColumn[];
  /** Rows per CONSTRUCT, as the job stores it. */
  chunkSize?: number;
  name?: string;
  description?: string;
  /** Provenance: the EtlJob, EtlJobVersion and column mapping version. */
  sourceJob?: string;
  sourceVersion?: string;
  sourceColumnMappingVersion?: string;
}

/**
 * A SHACL 1.2 rule set, as the SRL document the server would export for it.
 *
 * Carried as text, not compiled: compiling and layering a rule set needs the
 * `srl` package, which a runner of rule sets has anyway, and the document is
 * what an author can read and diff. DATA blocks are inside the document.
 */
export interface ExportedRuleSet {
  /** The SRL document: rules and DATA blocks, IRIs written out in full. */
  srl: string;
  /** `sha256-<hex>` of `srl`; see {@link verifyBundleIntegrity}. */
  textHash: string;
  ruleCount: number;
  dataBlockCount: number;
  /** Initial named-tuple rows, when the rule-tuples extension is on for it. */
  tupleSeeds?: string;
  tuplesEnabled?: boolean;
  name?: string;
  description?: string;
  tags?: string[];
  /** Provenance: the RuleSet and RuleSetVersion. */
  sourceRuleSet?: string;
  sourceVersion?: string;
}

/** A library subset, compiled for client-side execution. */
export interface ExportBundle {
  /**
   * Bundle format version. Bumped only for a breaking change to this shape —
   * a removal, a changed meaning, or a field becoming load-bearing. Adding an
   * *optional* field is additive and does not bump it, which is only true
   * because the reader ignores fields it does not know: a bundle written by a
   * newer exporter has to keep loading here. Do not make the validator reject
   * unknown fields. `test/bundleFormat.test.ts` pins both halves against a
   * committed bundle.
   */
  version: 1;
  library: { id: string; name?: string };
  /** Compiled queries, keyed by a stable slug unique within the bundle. */
  queries: Record<string, ExportedQuery>;
  /**
   * Compiled query groups, keyed by a stable slug unique within the bundle.
   * Absent from a bundle exported before groups were carried, and from one
   * whose library has none — a reader must treat it as optional.
   */
  groups?: Record<string, ExportedGroup>;
  /**
   * ETL jobs, keyed by a slug unique among them. Optional, like groups: a
   * bundle from an older exporter, or one exported without them, has none.
   */
  etlJobs?: Record<string, ExportedEtlJob>;
  /** Rule sets, keyed by a slug unique among them. Optional. */
  ruleSets?: Record<string, ExportedRuleSet>;
  /** ISO timestamp of the export, for provenance. Never used at runtime. */
  generatedAt?: string;
  /** Tags the export was filtered by, if any. Provenance only. */
  tags?: string[];
}

/** Raised when a bundle is malformed, corrupt, or of an unsupported version. */
export class InvalidBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBundleError';
  }
}

const QUERY_TYPES = new Set<string>(['SELECT', 'ASK', 'CONSTRUCT', 'DESCRIBE']);

function fail(message: string): never {
  throw new InvalidBundleError(message);
}

/**
 * Check a template's spans really describe its text.
 *
 * This is the cheap half of the integrity story and it runs on every load. It
 * cannot tell you the text is *the* exported text — that is what the hash is for —
 * but it does catch the failure that actually happens: an edit that leaves the
 * spans pointing at the wrong offsets, which would otherwise splice a VALUES block
 * into the middle of some unrelated token.
 */
function assertValidPageParameters(query: ExportedQuery, where: string): void {
  const spans = query.pageParameters;
  if (spans === undefined) return;
  if (!Array.isArray(spans)) fail(`${where}: pageParameters must be an array.`);

  const text = query.template.text;
  for (const span of spans) {
    const at = `${where}: page parameter '${String(span?.name)}'`;
    if (span.kind !== 'limit' && span.kind !== 'offset') fail(`${at} has an unknown kind.`);
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start >= span.end) {
      fail(`${at} has invalid bounds.`);
    }
    if (span.start < 0 || span.end > text.length) fail(`${at} lies outside the template text.`);
    const keyword = span.kind === 'limit' ? 'LIMIT' : 'OFFSET';
    if (!new RegExp(`^${keyword}\\b`, 'i').test(text.slice(span.start, span.end))) {
      fail(`${at} does not start at a ${keyword} keyword; the bundle has been edited.`);
    }
    // A page span overlapping a slot would let one splice corrupt the other.
    for (const slot of query.template.slots) {
      if (span.start < slot.end && slot.start < span.end) {
        fail(`${at} overlaps a parameter slot.`);
      }
    }
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      fail(`${where}: page parameter spans overlap each other.`);
    }
  }
}

function assertValidTemplate(template: QueryTemplate, where: string): void {
  if (!template || typeof template !== 'object') fail(`${where}: template is missing.`);
  if (typeof template.text !== 'string' || template.text.length === 0) {
    fail(`${where}: template.text must be a non-empty string.`);
  }
  if (!Array.isArray(template.slots)) fail(`${where}: template.slots must be an array.`);
  if (!Array.isArray(template.prefixes)) fail(`${where}: template.prefixes must be an array.`);

  let previousEnd = 0;
  template.slots.forEach((slot, index) => {
    const at = `${where}: slot ${index}`;
    if (!Number.isInteger(slot.start) || !Number.isInteger(slot.end)) {
      fail(`${at} has non-integer bounds.`);
    }
    if (slot.start < 0 || slot.end > template.text.length || slot.start >= slot.end) {
      fail(`${at} spans [${slot.start}, ${slot.end}) which is outside the template text.`);
    }
    if (slot.start < previousEnd) {
      fail(`${at} overlaps the previous slot; slots must be ordered and disjoint.`);
    }
    previousEnd = slot.end;
    if (!Array.isArray(slot.vars) || slot.vars.length === 0) {
      fail(`${at} declares no variables.`);
    }
    if (!slot.vars.every(isSafeVariableName)) {
      fail(`${at} declares a variable name the runtime cannot emit.`);
    }
    if (new Set(slot.vars).size !== slot.vars.length) {
      fail(`${at} declares a duplicate variable.`);
    }
    // Every recorded span must actually be the inline-data block it claims to be,
    // or splicing would replace arbitrary query text.
    if (!/^VALUES\b/i.test(template.text.slice(slot.start, slot.end))) {
      fail(`${at} does not start at a VALUES keyword; the bundle has been edited.`);
    }
  });
}

/**
 * Validate a bundle's shape. Called by {@link fromBundle}; safe to call directly
 * on a bundle you just fetched.
 */
/**
 * Check the examples can actually be applied to the query they sit on.
 *
 * Only the arity is checked here, because that is the property that rots: a
 * query gains or loses a parameter slot and every example written against the
 * old signature becomes unusable. Everything finer is checked by
 * `applyTemplateArguments` when the example is run, with better messages.
 */
function assertValidExamples(query: ExportedQuery, where: string): void {
  const examples = query.examples;
  if (examples === undefined) return;
  if (!Array.isArray(examples)) fail(`${where}: examples must be an array.`);

  examples.forEach((example, index) => {
    const at = `${where}: example ${index}`;
    if (!example || typeof example !== 'object') fail(`${at} is not an object.`);
    if (typeof example.name !== 'string' || example.name.length === 0) {
      fail(`${at} has no name.`);
    }
    if (!Array.isArray(example.arguments)) fail(`${at} has no arguments array.`);
    if (example.arguments.length > query.template.slots.length) {
      fail(
        `${at} ('${example.name}') supplies ${example.arguments.length} argument sets but the query has only ${query.template.slots.length} parameter slots.`,
      );
    }
  });
}

/** True when two variable lists are the same names in the same order. */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/**
 * Check a group really describes a runnable walk over this bundle's queries.
 *
 * The properties worth checking are the ones a walker cannot recover from and
 * would otherwise discover halfway through a run, after firing requests: a node
 * naming a query that is not here, an edge naming a slot the target does not
 * declare, a cycle. Everything else — a mapping that renames a column nothing
 * binds, say — merely produces an unbound cell, which is a legal UNDEF.
 */
function assertValidGroup(
  group: ExportedGroup,
  queries: Record<string, ExportedQuery>,
  where: string,
): void {
  if (!group || typeof group !== 'object') fail(`${where} is not an object.`);
  if (!group.nodes || typeof group.nodes !== 'object') fail(`${where} is missing its nodes map.`);
  if (!Array.isArray(group.edges)) fail(`${where}: edges must be an array.`);

  const nodeKeys = Object.keys(group.nodes);
  if (nodeKeys.length === 0) fail(`${where} has no nodes.`);

  for (const [key, node] of Object.entries(group.nodes)) {
    const at = `${where}: node '${key}'`;
    if (!node || typeof node !== 'object') fail(`${at} is not an object.`);
    if (typeof node.query !== 'string' || !queries[node.query]) {
      fail(`${at} names query '${String(node?.query)}', which the bundle does not carry.`);
    }
  }

  if (typeof group.resultNode !== 'string' || !group.nodes[group.resultNode]) {
    fail(`${where}: resultNode '${String(group.resultNode)}' is not one of its nodes.`);
  }

  group.edges.forEach((edge, index) => {
    const at = `${where}: edge ${index}`;
    if (!edge || typeof edge !== 'object') fail(`${at} is not an object.`);
    const source = group.nodes[edge.from];
    const target = group.nodes[edge.to];
    if (!source) fail(`${at} comes from '${String(edge.from)}', which is not one of its nodes.`);
    if (!target) fail(`${at} goes to '${String(edge.to)}', which is not one of its nodes.`);
    if (edge.from === edge.to) fail(`${at} is a self-loop.`);

    // Rows only come out of a SELECT. The server refuses to build a group that
    // chains anything else, so a bundle carrying one has been assembled by hand.
    const sourceQuery = queries[source.query];
    if (sourceQuery.queryType !== 'SELECT') {
      fail(`${at} chains a ${sourceQuery.queryType}, which produces no rows to splice.`);
    }

    if (!Array.isArray(edge.targetVars) || edge.targetVars.length === 0) {
      fail(`${at} declares no target variables.`);
    }
    if (!edge.targetVars.every(isSafeVariableName)) {
      fail(`${at} declares a variable name the runtime cannot emit.`);
    }
    if (new Set(edge.targetVars).size !== edge.targetVars.length) {
      fail(`${at} declares a duplicate target variable.`);
    }
    const targetQuery = queries[target.query];
    if (!targetQuery.template.slots.some((slot) => sameOrder(slot.vars, edge.targetVars))) {
      fail(
        `${at} fills [${edge.targetVars.join(', ')}], which query '${target.query}' does not declare as a parameter slot.`,
      );
    }

    if (!Array.isArray(edge.mappings)) fail(`${at}: mappings must be an array.`);
    const targets = new Set<string>();
    for (const mapping of edge.mappings) {
      if (typeof mapping?.source !== 'string' || typeof mapping?.target !== 'string') {
        fail(`${at} has a mapping that is not a source/target pair.`);
      }
      if (!edge.targetVars.includes(mapping.target)) {
        fail(`${at} maps to '${mapping.target}', which is not one of its target variables.`);
      }
      if (targets.has(mapping.target)) fail(`${at} maps to '${mapping.target}' twice.`);
      targets.add(mapping.target);
    }

    if (
      edge.whenEmpty !== undefined &&
      edge.whenEmpty !== 'unconstrained' &&
      edge.whenEmpty !== 'propagateEmpty' &&
      edge.whenEmpty !== 'require'
    ) {
      fail(`${at} has an unknown whenEmpty mode '${String(edge.whenEmpty)}'.`);
    }
  });

  // Kahn's algorithm: a cycle is the one structural fault that would make a walk
  // never terminate rather than merely fail.
  const indegree = new Map<string, number>(nodeKeys.map((key) => [key, 0]));
  for (const edge of group.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const ready = nodeKeys.filter((key) => indegree.get(key) === 0);
  let visited = 0;
  while (ready.length > 0) {
    const key = ready.shift()!;
    visited++;
    for (const edge of group.edges) {
      if (edge.from !== key) continue;
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) ready.push(edge.to);
    }
  }
  if (visited !== nodeKeys.length) fail(`${where} contains a cycle, so it cannot be walked.`);
}

function assertValidEtlJob(job: ExportedEtlJob, where: string): void {
  if (!job || typeof job !== 'object') fail(`${where} is not an object.`);
  assertValidTemplate(job.template, where);
  if (job.template.slots.length !== 1) {
    fail(`${where}: the template needs exactly one parameter slot for the rows; it has ${job.template.slots.length}.`);
  }
  if (typeof job.textHash !== 'string' || !job.textHash.startsWith('sha256-')) {
    fail(`${where}: textHash must be a 'sha256-<hex>' string.`);
  }
  if (typeof job.sql !== 'string' || job.sql.trim().length === 0) fail(`${where}: sql must be a non-empty string.`);
  if (!Array.isArray(job.columns) || job.columns.length === 0) fail(`${where}: columns must be a non-empty array.`);
  const slotVars = new Set(job.template.slots[0].vars);
  job.columns.forEach((column, index) => {
    const at = `${where}: column ${index}`;
    if (!column || typeof column !== 'object') fail(`${at} is not an object.`);
    if (typeof column.columnName !== 'string' || column.columnName.length === 0) fail(`${at} has no columnName.`);
    if (column.termType !== 'uri' && column.termType !== 'literal') fail(`${at} has an unknown termType.`);
    if (column.nullPolicy !== 'undef' && column.nullPolicy !== 'skipRow') fail(`${at} has an unknown nullPolicy.`);
    // A column bound to a variable the slot does not declare would be dropped
    // from every row without a word.
    if (!slotVars.has(column.targetVariable)) {
      fail(`${at} binds ?${String(column.targetVariable)}, which the template's slot does not declare.`);
    }
  });
  if (job.chunkSize !== undefined && (!Number.isInteger(job.chunkSize) || job.chunkSize < 1)) {
    fail(`${where}: chunkSize must be a positive integer.`);
  }
}

function assertValidRuleSet(ruleSet: ExportedRuleSet, where: string): void {
  if (!ruleSet || typeof ruleSet !== 'object') fail(`${where} is not an object.`);
  if (typeof ruleSet.srl !== 'string' || ruleSet.srl.trim().length === 0) fail(`${where}: srl must be a non-empty string.`);
  if (typeof ruleSet.textHash !== 'string' || !ruleSet.textHash.startsWith('sha256-')) {
    fail(`${where}: textHash must be a 'sha256-<hex>' string.`);
  }
  if (ruleSet.tupleSeeds !== undefined && typeof ruleSet.tupleSeeds !== 'string') {
    fail(`${where}: tupleSeeds must be a string.`);
  }
}

/** Check an optional map member is an object, then each of its entries. */
function assertValidMap<T>(
  map: Record<string, T> | undefined,
  member: string,
  label: string,
  check: (entry: T, where: string) => void,
): void {
  if (map === undefined) return;
  if (!map || typeof map !== 'object') fail(`Bundle ${member} must be an object.`);
  for (const [name, entry] of Object.entries(map)) check(entry, `${label} '${name}'`);
}

export function assertValidBundle(bundle: unknown): asserts bundle is ExportBundle {
  if (!bundle || typeof bundle !== 'object') fail('Bundle must be an object.');
  const candidate = bundle as ExportBundle;
  if (candidate.version !== 1) {
    fail(`Unsupported bundle version ${String(candidate.version)}; this runtime reads version 1.`);
  }
  if (!candidate.library || typeof candidate.library.id !== 'string') {
    fail('Bundle is missing library.id.');
  }
  if (!candidate.queries || typeof candidate.queries !== 'object') {
    fail('Bundle is missing its queries map.');
  }
  for (const [name, query] of Object.entries(candidate.queries)) {
    const where = `Query '${name}'`;
    if (!query || typeof query !== 'object') fail(`${where} is not an object.`);
    if (!QUERY_TYPES.has(query.queryType)) {
      fail(`${where} has unsupported queryType '${String(query.queryType)}'.`);
    }
    assertValidTemplate(query.template, where);
    assertValidPageParameters(query, where);
    if (!Array.isArray(query.inferredInputs)) fail(`${where}: inferredInputs must be an array.`);
    if (query.inferredInputs.length !== query.template.slots.length) {
      fail(
        `${where}: inferredInputs describes ${query.inferredInputs.length} slots but the template has ${query.template.slots.length}.`,
      );
    }
    if (typeof query.textHash !== 'string' || !query.textHash.startsWith('sha256-')) {
      fail(`${where}: textHash must be a 'sha256-<hex>' string.`);
    }
    assertValidExamples(query, where);
  }

  if (candidate.groups !== undefined) {
    if (!candidate.groups || typeof candidate.groups !== 'object') {
      fail('Bundle groups must be an object.');
    }
    for (const [name, group] of Object.entries(candidate.groups)) {
      assertValidGroup(group, candidate.queries, `Group '${name}'`);
    }
  }
  assertValidMap(candidate.etlJobs, 'etlJobs', 'ETL job', assertValidEtlJob);
  assertValidMap(candidate.ruleSets, 'ruleSets', 'Rule set', assertValidRuleSet);
}

/** Hash a template text the way {@link ExportedQuery.textHash} spells it. */
export async function hashTemplateText(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new InvalidBundleError(
      'Web Crypto is unavailable, so bundle integrity cannot be verified in this environment.',
    );
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256-${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Re-hash every template and compare against the recorded hash.
 *
 * Optional at runtime and asynchronous, because it needs Web Crypto. Worth calling
 * once after fetching a bundle you did not build in the same step — from a CDN, or
 * out of a repository where someone might have "fixed" the query text by hand.
 * The export command and its CI check call it unconditionally.
 */
export async function verifyBundleIntegrity(bundle: ExportBundle): Promise<void> {
  for (const [name, query] of Object.entries(bundle.queries)) {
    const actual = await hashTemplateText(query.template.text);
    if (actual !== query.textHash) {
      throw new InvalidBundleError(
        `Query '${name}' does not match its recorded hash: the template text has been edited, which invalidates its parameter slot offsets. Re-export the bundle.`,
      );
    }
  }
  for (const [name, job] of Object.entries(bundle.etlJobs ?? {})) {
    if ((await hashTemplateText(job.template.text)) !== job.textHash) {
      throw new InvalidBundleError(
        `ETL job '${name}' does not match its recorded hash: the template text has been edited, which invalidates its parameter slot offsets. Re-export the bundle.`,
      );
    }
  }
  for (const [name, ruleSet] of Object.entries(bundle.ruleSets ?? {})) {
    if ((await hashTemplateText(ruleSet.srl)) !== ruleSet.textHash) {
      throw new InvalidBundleError(
        `Rule set '${name}' does not match its recorded hash: the SRL document has been edited. Re-export the bundle.`,
      );
    }
  }
}
