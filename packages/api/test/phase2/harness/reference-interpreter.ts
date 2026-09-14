/**
 * The oracle: a deliberately naive reference interpreter for query group
 * execution (docs §2.3).
 *
 * It walks the DAG in topological order, executes each node's query on its own,
 * and does the positional VALUES substitution by dumb string templating. It does
 * NOT call `SparqlQueryParser.applyArguments`, `ExecutionEngine`, or
 * `GraphBuilder` - an oracle that shares the implementation's code shares the
 * implementation's bugs, and would have agreed with every defect Phase 1 fixed.
 *
 * The one thing it does share is the SPARQL executor, because "send this string
 * to Oxigraph" is transport, not semantics. Every decision that Phase 1 actually
 * decided - what an empty input means, what `whenEmpty` overrides, how renames
 * map, how fan-in merges - is re-implemented here from the query-group
 * specification, not imported.
 */
import { OxigraphSparqlExecutor } from '../../../src/server/OxigraphSparqlExecutor.js';
import type { QueryTemplate } from './query-templates.js';
import type { WhenEmpty } from './group-harness.js';

export interface Cell {
  type: 'uri' | 'literal';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

export type Row = Record<string, Cell | null | undefined>;

export interface ArgumentSet {
  head: { vars: string[] };
  arguments: { bindings: Row[] };
}

/** A node as the oracle sees it: a template plus how its inputs are supplied. */
export interface OracleNode {
  key: string;
  template: QueryTemplate;
}

export interface OracleEdge {
  from: string;
  to: string;
  /** Variable names the source contributes, in tuple order. */
  sourceVars: string[];
  /** Variable names of the target's input slot, in tuple order. */
  targetVars: string[];
  whenEmpty?: WhenEmpty;
  /** The edge's persisted explicit mapping, verbatim (may be malformed). */
  variableMappings?: string;
  /** True when the source is the StartNode rather than an executed node. */
  fromStart?: boolean;
}

/**
 * How an edge pairs source variables with target variables.
 *
 * Unlike the §1.1 rules, this one has no prose specification to re-derive from -
 * explicit edge mappings are a later feature - so what is written here is the
 * intended contract stated plainly rather than an independent derivation. It
 * still earns its keep: it pins the rule in one readable place and fails if the
 * engine drifts from it, which is what the arity-1-only corpus could not do
 * (with one variable a side, every pairing rule agrees).
 *
 * The contract:
 *   - A well-formed explicit mapping wins. Entries naming a variable that is not
 *     on the relevant side are dropped, as is a second entry claiming a target
 *     already taken. A mapping that survives as empty maps nothing - it does not
 *     silently fall back.
 *   - Anything unparseable, or parsing to a non-array, falls back to the default.
 *   - The default pairs exact name matches first, then pairs whatever is left on
 *     each side by position.
 */
export function resolveMappings(
  raw: string | undefined,
  sourceVars: string[],
  targetVars: string[],
): Array<{ source: string; target: string }> {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const takenTargets = new Set<string>();
        const out: Array<{ source: string; target: string }> = [];
        for (const entry of parsed) {
          const source = entry?.source;
          const target = entry?.target;
          if (typeof source !== 'string' || typeof target !== 'string') continue;
          if (!sourceVars.includes(source) || !targetVars.includes(target)) continue;
          if (takenTargets.has(target)) continue;
          takenTargets.add(target);
          out.push({ source, target });
        }
        return out;
      }
    } catch {
      // Unparseable: fall through to the default pairing.
    }
  }

  const out: Array<{ source: string; target: string }> = [];
  const unmatchedSource = new Set(sourceVars);
  const unmatchedTarget = new Set(targetVars);
  for (const target of targetVars) {
    if (!unmatchedSource.has(target)) continue;
    unmatchedSource.delete(target);
    unmatchedTarget.delete(target);
    out.push({ source: target, target });
  }
  const sources = sourceVars.filter(name => unmatchedSource.has(name));
  const targets = targetVars.filter(name => unmatchedTarget.has(name));
  for (let i = 0; i < Math.min(sources.length, targets.length); i++) {
    out.push({ source: sources[i], target: targets[i] });
  }
  return out;
}

export interface OracleGraph {
  nodes: OracleNode[];
  edges: OracleEdge[];
  /** Key of the node whose result the EndNode returns. */
  resultNode: string;
  /** Argument sets supplied on the execution request. */
  externalArguments?: ArgumentSet[];
}

export type OracleResult =
  | { kind: 'bindings'; rows: Row[] }
  | { kind: 'rdf'; triples: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'update' }
  | { kind: 'error'; reason: 'require' | 'wrongOrder' | 'mixedWildcard'; detail: string };

/** Escape a literal lexical form for insertion into a SPARQL string. */
const escapeLiteral = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

/** Render one cell as a VALUES term. A missing cell is UNDEF, per the contract. */
const renderCell = (cell: Cell | null | undefined): string => {
  if (cell == null) return 'UNDEF';
  if (cell.type === 'uri') return `<${cell.value}>`;
  if (cell['xml:lang']) return `"${escapeLiteral(cell.value)}"@${cell['xml:lang']}`;
  if (cell.datatype) return `"${escapeLiteral(cell.value)}"^^<${cell.datatype}>`;
  return `"${escapeLiteral(cell.value)}"`;
};

/** True when every declared cell of the row is UNDEF. */
const isAllUndef = (row: Row, vars: string[]): boolean => vars.every(v => row[v] == null);

/**
 * Locate the parameter slots in a query by their written form.
 *
 * Templates spell every slot as `VALUES (?a ?b) { (UNDEF UNDEF) }` on one line
 * (see query-templates.ts), which is what lets this be a regex rather than a
 * second parser. A slot in any other shape is author data as far as the oracle
 * is concerned - the same reservation rule §1.1 states.
 */
const SLOT = /VALUES\s*\(([^)]*)\)\s*\{\s*\(([^)]*)\)\s*\}/g;

interface Slot {
  match: string;
  vars: string[];
}

const findSlots = (query: string): Slot[] => {
  const slots: Slot[] = [];
  for (const match of query.matchAll(SLOT)) {
    const vars = match[1].trim().split(/\s+/).map(v => v.replace(/^\?/, '')).filter(Boolean);
    const terms = match[2].trim().split(/\s+/).filter(Boolean);
    if (terms.length !== vars.length || !terms.every(t => t === 'UNDEF')) continue;
    slots.push({ match: match[0], vars });
  }
  return slots;
};

/** How an input resolves for one slot. */
type Resolution =
  | { kind: 'rows'; rows: Row[] }
  | { kind: 'removed' }
  | { kind: 'zeroRow' }
  | { kind: 'require' }
  | { kind: 'mixedWildcard' };

/**
 * The §1.1 decision table, written out as data rather than derived from the
 * engine. `supplied` is undefined when nothing arrived at all.
 */
function resolveSlot(supplied: Row[] | undefined, vars: string[], whenEmpty: WhenEmpty | undefined): Resolution {
  if (supplied === undefined) {
    // Nothing arrived: an absent external parameter. Default is "no opinion".
    const mode = whenEmpty ?? 'unconstrained';
    if (mode === 'require') return { kind: 'require' };
    return mode === 'unconstrained' ? { kind: 'removed' } : { kind: 'zeroRow' };
  }

  const wildcardRows = supplied.filter(row => isAllUndef(row, vars));
  if (supplied.length > 1 && wildcardRows.length > 0) {
    // A wildcard row mixed with real rows would dissolve every other row, so
    // the contract rejects it rather than silently matching everything.
    return { kind: 'mixedWildcard' };
  }
  const isWildcard = supplied.length === 1 && wildcardRows.length === 1;

  if (supplied.length === 0 || isWildcard) {
    // The pure singleton wildcard is an explicit "no constraint"; a zero-row set
    // is an explicit "match nothing". `whenEmpty` overrides either.
    const mode = whenEmpty ?? (isWildcard ? 'unconstrained' : 'propagateEmpty');
    if (mode === 'require') return { kind: 'require' };
    return mode === 'unconstrained' ? { kind: 'removed' } : { kind: 'zeroRow' };
  }

  return { kind: 'rows', rows: supplied };
}

const renderSlot = (vars: string[], resolution: Resolution): string => {
  if (resolution.kind === 'removed') return '';
  const header = `VALUES (${vars.map(v => `?${v}`).join(' ')})`;
  if (resolution.kind === 'zeroRow') return `${header} {}`;
  const rows = resolution.rows
    .map(row => `(${vars.map(v => renderCell(row[v])).join(' ')})`)
    .join(' ');
  return `${header} { ${rows} }`;
};

/** Dedupe preserving first-seen order, keyed the way the engine keys it. */
const unionRows = (a: Row[], b: Row[], vars: string[]): Row[] => {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of [...a, ...b]) {
    // Build the key over vars in tuple order so it matches a JSON.stringify of
    // rows assembled in that same order.
    const normalized: Row = {};
    for (const v of vars) if (row[v] != null) normalized[v] = row[v];
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

const signature = (vars: string[]): string => vars.map(v => v.replace(/^\?/, '')).sort().join('|');

export class ReferenceInterpreter {
  constructor(private readonly executor: OxigraphSparqlExecutor) {}

  async run(graph: OracleGraph): Promise<OracleResult> {
    const order = topoOrder(graph);
    const results = new Map<string, OracleResult>();
    const external = graph.externalArguments ?? [];

    for (const key of order) {
      const node = graph.nodes.find(n => n.key === key)!;
      const inbound = graph.edges.filter(e => e.to === key);

      // 1. Gather what each input tuple was supplied, merging fan-in by union.
      const byTuple = new Map<string, { rows: Row[]; vars: string[]; whenEmpty?: WhenEmpty }>();
      for (const edge of inbound) {
        let sourceRows: Row[];
        if (edge.fromStart) {
          const match = external.find(set => signature(set.head.vars) === signature(edge.sourceVars));
          if (!match) continue; // Nothing supplied for this parameter.
          sourceRows = match.arguments.bindings;
        } else {
          const upstream = results.get(edge.from);
          if (!upstream || upstream.kind !== 'bindings') continue;
          sourceRows = upstream.rows;
        }

        const mappings = resolveMappings(edge.variableMappings, edge.sourceVars, edge.targetVars);
        const mapped = sourceRows.map(row => {
          const out: Row = {};
          for (const { source, target } of mappings) {
            const cell = row[source];
            if (cell != null) out[target] = cell;
          }
          return out;
        });

        const tupleKey = signature(edge.targetVars);
        const existing = byTuple.get(tupleKey);
        byTuple.set(tupleKey, existing
          ? { rows: unionRows(existing.rows, mapped, edge.targetVars), vars: edge.targetVars, whenEmpty: existing.whenEmpty ?? edge.whenEmpty }
          : { rows: mapped, vars: edge.targetVars, whenEmpty: edge.whenEmpty });
      }

      // 2. Resolve each parameter slot and substitute by string templating.
      let query = node.template.sparql;
      for (const slot of findSlots(query)) {
        const fromEdge = byTuple.get(signature(slot.vars));
        let supplied: Row[] | undefined;
        let whenEmpty: WhenEmpty | undefined;

        if (fromEdge) {
          supplied = fromEdge.rows;
          whenEmpty = fromEdge.whenEmpty;
        } else {
          const ext = external.find(set => signature(set.head.vars) === signature(slot.vars));
          if (ext) {
            const wrongOrder = ext.head.vars.length === slot.vars.length
              && !ext.head.vars.every((v, i) => v === slot.vars[i]);
            if (wrongOrder) {
              return { kind: 'error', reason: 'wrongOrder', detail: `[${ext.head.vars.join(', ')}]` };
            }
            supplied = ext.arguments.bindings;
          }
        }

        const resolution = resolveSlot(supplied, slot.vars, whenEmpty);
        if (resolution.kind === 'require' || resolution.kind === 'mixedWildcard') {
          return { kind: 'error', reason: resolution.kind, detail: `[${slot.vars.join(', ')}]` };
        }
        query = query.replace(slot.match, renderSlot(slot.vars, resolution));
      }

      results.set(key, await this.executeNode(node.template, query));
    }

    return results.get(graph.resultNode)!;
  }

  private async executeNode(template: QueryTemplate, query: string): Promise<OracleResult> {
    if (template.kind === 'boolean') {
      const { result } = await this.executor.askQuery(query);
      return { kind: 'boolean', value: result as boolean };
    }
    if (template.kind === 'update') {
      await this.executor.update(query);
      return { kind: 'update' };
    }
    if (template.kind === 'rdf') {
      const { result } = await this.executor.constructQueryParsed(query, { acceptHeader: 'application/n-triples' });
      return { kind: 'rdf', triples: String(result).split('\n').map(l => l.trim()).filter(Boolean) };
    }
    const { result } = await this.executor.selectQueryParsed(query);
    const parsed = result as { results?: { bindings?: Row[] } };
    return { kind: 'bindings', rows: parsed.results?.bindings ?? [] };
  }
}

/** Kahn over the spec's own edges; the oracle does not reuse the engine's. */
function topoOrder(graph: OracleGraph): string[] {
  const indegree = new Map<string, number>(graph.nodes.map(n => [n.key, 0]));
  for (const edge of graph.edges) {
    if (edge.fromStart) continue;
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
  }
  const queue = graph.nodes.filter(n => (indegree.get(n.key) || 0) === 0).map(n => n.key);
  const order: string[] = [];
  while (queue.length) {
    const key = queue.shift()!;
    order.push(key);
    for (const edge of graph.edges) {
      if (edge.fromStart || edge.from !== key) continue;
      const remaining = (indegree.get(edge.to) || 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) queue.push(edge.to);
    }
  }
  if (order.length !== graph.nodes.length) throw new Error('Oracle was given a cyclic graph');
  return order;
}

/** Compare two results as multisets, so row order never decides a failure. */
export function resultsEqual(a: OracleResult, b: OracleResult): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'boolean' && b.kind === 'boolean') return a.value === b.value;
  if (a.kind === 'update') return true;
  if (a.kind === 'rdf' && b.kind === 'rdf') {
    return JSON.stringify([...a.triples].sort()) === JSON.stringify([...b.triples].sort());
  }
  if (a.kind === 'bindings' && b.kind === 'bindings') {
    const norm = (rows: Row[]) => rows
      .map(row => JSON.stringify(Object.keys(row).sort().map(k => [k, row[k]])))
      .sort();
    return JSON.stringify(norm(a.rows)) === JSON.stringify(norm(b.rows));
  }
  return false;
}
