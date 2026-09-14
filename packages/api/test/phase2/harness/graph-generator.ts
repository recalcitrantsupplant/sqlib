/**
 * The bounded random-DAG generator behind Phase 2 Layer B (docs §2.3).
 *
 * Generated graphs are deliberately restricted to the shapes the engine is
 * supposed to handle - the legality matrix already covers the illegal ones
 * exhaustively and deterministically, so spending fuzz budget rediscovering
 * them would be waste. What varies here is the part a hand-written scenario
 * cannot cover: composition. Chain depth, fan-out, fan-in onto a shared input,
 * which upstream happens to be empty, renames, external parameters in every
 * spelling the wire contract allows, and `whenEmpty` on every edge.
 */
import fc from 'fast-check';
import {
  FILTER_TEMPLATES, SOURCE_TEMPLATES, PAIR_TEMPLATES, PAIR_SOURCE_TEMPLATES, type QueryTemplate,
} from './query-templates.js';
import type { EdgeSpec, GraphSpec, NodeSpec, DeclaredPort, WhenEmpty } from './group-harness.js';
import { START, END } from './group-harness.js';
import type { ArgumentSet, OracleEdge, OracleGraph, OracleNode, Row } from './reference-interpreter.js';

/**
 * Two parallel corpora, one per arity. Within a corpus every source can feed
 * every filter, which is what keeps a randomly wired chain legal by
 * construction; mixing arities across an edge is an arity mismatch, and the
 * legality matrix and mutation suite already cover that deterministically.
 *
 * Arity 2 exists because edge variable mappings are invisible below it: with one
 * variable a side, every pairing rule produces the same answer.
 */
const ARITY_1 = {
  sources: SOURCE_TEMPLATES.filter(t => t.inputSlots.length === 0 && t.outputVars.length === 1),
  filters: FILTER_TEMPLATES.filter(t => t.inputSlots.length === 1 && t.inputSlots[0].length === 1),
};
const ARITY_2 = {
  sources: PAIR_SOURCE_TEMPLATES.filter(t => t.inputSlots.length === 0 && t.outputVars.length === 2),
  filters: PAIR_TEMPLATES.filter(t => t.inputSlots.length === 1 && t.inputSlots[0].length === 2),
};

const WHEN_EMPTY: (WhenEmpty | undefined)[] = [undefined, 'unconstrained', 'propagateEmpty', 'require'];

/**
 * The shapes an edge's explicit variable mapping can take. `malformed` and
 * `unknownVars` are the interesting ones: the first must fall back to the
 * default pairing, the second survives as an empty mapping and therefore binds
 * nothing - which turns every row into an all-UNDEF row and runs headlong into
 * the §1.1 wildcard rules.
 */
export type MappingShape = 'default' | 'identity' | 'reversed' | 'partial' | 'malformed' | 'unknownVars';
const MAPPING_SHAPES: MappingShape[] = ['default', 'identity', 'reversed', 'partial', 'malformed', 'unknownVars'];

/** Build the JSON an edge persists for the given shape, or undefined for none. */
function mappingJson(shape: MappingShape, sourceVars: string[], targetVars: string[]): string | undefined {
  const pair = (i: number, j: number) => ({ source: sourceVars[i], target: targetVars[j] });
  switch (shape) {
    case 'default':
      return undefined;
    case 'identity':
      return JSON.stringify(targetVars.map((_, i) => pair(i, i)));
    case 'reversed':
      return JSON.stringify(targetVars.map((_, i) => pair(sourceVars.length - 1 - i, i)));
    case 'partial':
      return JSON.stringify([pair(0, 0)]);
    case 'malformed':
      return 'not json at all';
    case 'unknownVars':
      return JSON.stringify([{ source: 'nosuchsource', target: 'nosuchtarget' }]);
  }
}

/** The five wire shapes an external argument can take (§1.1). */
export type ExternalShape = 'rows' | 'emptySet' | 'wildcardRow' | 'nullCell' | 'absent' | 'reorderedRows';
// `reorderedRows` is appended rather than inserted so the existing shapes keep
// their indices and a recorded seed still means what it meant before.
const EXTERNAL_SHAPES: ExternalShape[] = ['rows', 'emptySet', 'wildcardRow', 'nullCell', 'absent', 'reorderedRows'];

export interface GeneratedCase {
  /** What gets POSTed to build the group. */
  spec: GraphSpec;
  /** The same graph as the oracle sees it. */
  oracle: OracleGraph;
  /** Argument sets to send on the execution request, if any. */
  externalArguments?: ArgumentSet[];
  /** Human-readable shape, printed with a counterexample. */
  describe: string;
}

interface RawCase {
  /** Every edge in one generated graph shares an arity; see the corpora above. */
  arityTwo: boolean;
  sourceIndex: number;
  /** For each chained node: which earlier nodes feed it, and its template. */
  layers: {
    templateIndex: number;
    parents: number[];
    whenEmptyIndex: number[];
    mappingIndex: number[];
  }[];
  /** Whether the first chained node also takes an external parameter. */
  externalShapeIndex: number;
  useExternalParameter: boolean;
  /** Feed the head node's slot from the argument set alone, with no edge. */
  externalOnlyHead: boolean;
}

// Indices are drawn against the larger corpus and taken modulo the one actually
// in use, so the same draw stays meaningful whichever arity it lands on.
const CORPUS_MAX = Math.max(
  ARITY_1.sources.length, ARITY_2.sources.length, ARITY_1.filters.length, ARITY_2.filters.length,
);

const rawCaseArbitrary = fc.record({
  arityTwo: fc.boolean(),
  sourceIndex: fc.nat({ max: CORPUS_MAX - 1 }),
  layers: fc.array(
    fc.record({
      templateIndex: fc.nat({ max: CORPUS_MAX - 1 }),
      // Parent slots are resolved modulo the number of available predecessors,
      // which keeps every generated graph acyclic by construction.
      parents: fc.array(fc.nat({ max: 15 }), { minLength: 1, maxLength: 2 }),
      whenEmptyIndex: fc.array(fc.nat({ max: WHEN_EMPTY.length - 1 }), { minLength: 2, maxLength: 2 }),
      mappingIndex: fc.array(fc.nat({ max: MAPPING_SHAPES.length - 1 }), { minLength: 2, maxLength: 2 }),
    }),
    // Plus the source node, this bounds a graph at 6 executable nodes.
    { minLength: 1, maxLength: 5 },
  ),
  externalShapeIndex: fc.nat({ max: EXTERNAL_SHAPES.length - 1 }),
  useExternalParameter: fc.boolean(),
  externalOnlyHead: fc.boolean(),
});

/**
 * Bound rows for an external parameter, chosen to match the variable's meaning
 * so a `rows` case actually constrains something instead of degenerating into
 * "no row ever joins".
 */
const EXTERNAL_VALUES: Record<string, string[]> = {
  thing: ['http://example.org/t1', 'http://example.org/t3'],
  group: ['http://example.org/g1', 'http://example.org/g2'],
  label: ['http://example.org/t1', 'http://example.org/t2'],
  name: ['http://example.org/g1'],
  rank: ['http://example.org/r1', 'http://example.org/r2'],
};

function externalArgumentSet(shape: ExternalShape, vars: string[]): ArgumentSet | null {
  const valuesFor = (name: string) => EXTERNAL_VALUES[name] ?? EXTERNAL_VALUES.thing;
  switch (shape) {
    case 'rows': {
      const rowCount = Math.min(...vars.map(name => valuesFor(name).length));
      const bindings: Row[] = Array.from({ length: rowCount }, (_, index) => {
        const row: Row = {};
        for (const name of vars) row[name] = { type: 'uri' as const, value: valuesFor(name)[index] };
        return row;
      });
      return { head: { vars }, arguments: { bindings } };
    }
    case 'emptySet':
      return { head: { vars }, arguments: { bindings: [] } };
    case 'wildcardRow':
      return { head: { vars }, arguments: { bindings: [{}] } };
    case 'nullCell':
      // Spelled as explicit nulls rather than omitted keys: the contract says
      // the two are the same thing, and the fuzzer is where that gets checked
      // rather than assumed.
      return {
        head: { vars },
        arguments: { bindings: [Object.fromEntries(vars.map(name => [name, null])) as Row] },
      };
    case 'reorderedRows': {
      // The `rows` bindings under a head that declares the same variables in
      // the opposite order — the §1.3 order mismatch. Bindings are keyed by
      // name, so reversing only the head is exactly "declared in the wrong
      // order" and nothing else.
      //
      // On an arity-1 slot this is byte-identical to `rows` and the case
      // degenerates harmlessly. That is the whole reason the coverage tally
      // read `wrongOrder: 0` for so long: it was inexpressible while the
      // corpus was arity-1, and only arity-2 slots make it reachable (#49).
      const rows = externalArgumentSet('rows', vars)!;
      return { head: { vars: [...vars].reverse() }, arguments: rows.arguments };
    }
    case 'absent':
      return null;
  }
}

/** Turn a raw draw into a buildable spec plus the oracle's view of it. */
export function materialize(raw: RawCase): GeneratedCase {
  const corpus = raw.arityTwo ? ARITY_2 : ARITY_1;
  // Normally the head node is a source: no input slot, nothing upstream. When
  // the draw asks for an externally-fed head it is a *filter* instead, so its
  // slot is supplied by the argument set alone — the shape the deterministic
  // §1.3 case in `graph-mutations.test.ts` uses. Every other graph feeds each
  // slot from a parent edge, and a fed slot never consults `externalArguments`,
  // so without this the order-sensitive check has nothing to fire on (#49).
  const externalOnlyHead = raw.externalOnlyHead && raw.useExternalParameter;
  const source: QueryTemplate = externalOnlyHead
    ? corpus.filters[raw.sourceIndex % corpus.filters.length]
    : corpus.sources[raw.sourceIndex % corpus.sources.length];
  const nodes: NodeSpec[] = [{ key: 'n0', query: source.key }];
  const oracleNodes: OracleNode[] = [{ key: 'n0', template: source }];
  const edges: EdgeSpec[] = [{ from: START, to: 'n0', flow: 'CONTROL_FLOW' }];
  const oracleEdges: OracleEdge[] = [];
  const declaredPorts: DeclaredPort[] = [];
  const templates: QueryTemplate[] = [source];

  raw.layers.forEach((layer, index) => {
    const key = `n${index + 1}`;
    const template = corpus.filters[layer.templateIndex % corpus.filters.length];
    const slotVars = template.inputSlots[0];
    nodes.push({ key, query: template.key });
    oracleNodes.push({ key, template });
    templates.push(template);

    // Fan-in: each parent is an earlier node, deduped, all landing on the one
    // input tuple so the union-and-dedupe path is exercised.
    const parentKeys = Array.from(new Set(layer.parents.map(p => p % (index + 1))));
    parentKeys.forEach((parentIndex, slot) => {
      const parent = templates[parentIndex];
      const whenEmpty = WHEN_EMPTY[layer.whenEmptyIndex[slot] ?? 0];
      const mappingShape = MAPPING_SHAPES[layer.mappingIndex[slot] ?? 0];
      const variableMappings = mappingJson(mappingShape, parent.outputVars, slotVars);
      edges.push({
        from: `n${parentIndex}`, to: key, flow: 'VARIABLE_BINDINGS',
        source: { node: `n${parentIndex}`, port: 'outputTuple' },
        target: { node: key, input: 0 },
        ...(whenEmpty ? { whenEmpty } : {}),
        ...(variableMappings !== undefined ? { variableMappings } : {}),
      });
      oracleEdges.push({
        from: `n${parentIndex}`, to: key,
        sourceVars: parent.outputVars,
        targetVars: slotVars,
        whenEmpty,
        variableMappings,
      });
    });
  });

  const resultNode = `n${raw.layers.length}`;

  // Optionally hang an external parameter off the StartNode, feeding the first
  // chained node alongside whatever upstream already feeds it.
  let externalArguments: ArgumentSet[] | undefined;
  const shape = EXTERNAL_SHAPES[raw.externalShapeIndex];
  if (raw.useExternalParameter) {
    // With an externally-fed head the set goes to n0's own slot and carries no
    // VARIABLE_BINDINGS edge: the interpreter only consults `externalArguments`
    // for a slot nothing else fed (a `fromStart` edge consumes the matching set
    // and populates `byTuple` first, after which the order-sensitive check is
    // unreachable). Otherwise it hangs off the StartNode as before.
    const target = externalOnlyHead ? oracleNodes[0] : oracleNodes[1];
    const slotVars = target.template.inputSlots[0];
    if (!externalOnlyHead) {
      declaredPorts.push({ key: 'startParam', type: 'QueryOutputTuple', vars: slotVars, attachTo: START, attachAs: 'outputs' });
      edges.push({
        from: START, to: target.key, flow: 'VARIABLE_BINDINGS',
        source: { declared: 'startParam' }, target: { node: target.key, input: 0 },
      });
      oracleEdges.push({
        from: START, to: target.key, fromStart: true,
        sourceVars: slotVars, targetVars: slotVars,
      });
    }
    const set = externalArgumentSet(shape, slotVars);
    if (set) externalArguments = [set];
  }

  edges.push({
    from: resultNode, to: END, flow: 'VARIABLE_BINDINGS',
    source: { node: resultNode, port: 'outputTuple' },
    target: { node: resultNode, port: 'outputTuple' },
  });

  const describe = [
    `arity=${raw.arityTwo ? 2 : 1}`,
    `source=${source.key}`,
    ...raw.layers.map((layer, index) =>
      `n${index + 1}=${corpus.filters[layer.templateIndex % corpus.filters.length].key}` +
      `<-[${Array.from(new Set(layer.parents.map(p => p % (index + 1)))).join(',')}]` +
      `(${layer.whenEmptyIndex.map(i => WHEN_EMPTY[i] ?? 'default').join('/')})` +
      `(${layer.mappingIndex.map(i => MAPPING_SHAPES[i]).join('/')})`),
    raw.useExternalParameter ? `external=${shape}` : 'external=none',
  ].join(' ');

  return {
    spec: { nodes, edges, declaredPorts },
    oracle: { nodes: oracleNodes, edges: oracleEdges, resultNode, externalArguments },
    externalArguments,
    describe,
  };
}

export const caseArbitrary = rawCaseArbitrary.map(materialize);
