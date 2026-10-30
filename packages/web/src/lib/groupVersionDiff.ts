/**
 * What changed between two versions of a query group.
 *
 * A saved version mints fresh ids for its nodes and edges, so two versions of
 * the same drawing share none. Nodes are matched by what they are instead: the
 * same kind, name, query and settings first; then the same kind and name (an
 * edited node); then the same kind and query (a renamed node). Edges are
 * matched by the nodes they join and their flow type. What is left on either
 * side was added or removed.
 */
import { ioModelOf, type GraphEdgeState, type GraphNodeState, type QueryGroupGraphState } from '../composables/useQueryGroupGraph';
import { canvasNodeLabel } from '../composables/queryGroupNodeLabel';
import { variablesForPort } from '../composables/queryGroupIoModel';

export interface DiffChange {
  name: string;
  changes: string[];
}

export interface GroupVersionDiff {
  nodes: { added: string[]; removed: string[]; changed: DiffChange[] };
  edges: { added: string[]; removed: string[]; changed: DiffChange[] };
  inputs: { added: string[]; removed: string[] };
  same: boolean;
}

const KIND_NOUN: Record<string, string> = {
  query: 'query',
  dynamic: 'dynamic query',
  ruleset: 'rule set',
  patch: 'patch',
  start: 'start',
  end: 'end',
};

const FLOW_LABEL: Record<string, string> = {
  CONTROL_FLOW: 'control flow',
  VARIABLE_BINDINGS: 'bindings',
  RDF_GRAPH: 'RDF graph',
  BOOLEAN: 'boolean',
  QUERY_ID: 'query id',
};

const refOf = (node: GraphNodeState) => node.ruleSetVersionId ?? node.queryVersionId ?? node.queryId ?? null;

/** "v3" from a version IRI that ends ":v3", or null. */
const versionOf = (id: string | null) => {
  const match = id?.match(/:v(\d+)$/);
  return match ? `v${match[1]}` : null;
};

interface Described {
  node: GraphNodeState;
  name: string;
  ref: string | null;
}

const describe = (state: QueryGroupGraphState): Described[] =>
  state.nodes.map((node) => ({ node, name: canvasNodeLabel(node, state.iriMap), ref: refOf(node) }));

const settingsKey = (entry: Described) => JSON.stringify([
  entry.node.kind,
  entry.name,
  entry.ref,
  entry.node.backendId ?? null,
  entry.node.mediaType ?? null,
]);

const nodeTitle = (entry: Described) => (entry.node.kind === 'start' || entry.node.kind === 'end'
  ? entry.name
  : `${entry.name} (${KIND_NOUN[entry.node.kind] ?? entry.node.kind})`);

function nodeChanges(before: Described, after: Described, refName: (id: string | null) => string): string[] {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`renamed from “${before.name}”`);
  if (before.ref !== after.ref) {
    const was = versionOf(before.ref);
    const now = versionOf(after.ref);
    const sameQuery = before.ref && after.ref && before.ref.replace(/:v\d+$/, '') === after.ref.replace(/:v\d+$/, '');
    changes.push(sameQuery && was && now
      ? `query ${was} → ${now}`
      : `runs ${refName(after.ref)} instead of ${refName(before.ref)}`);
  }
  if ((before.node.backendId ?? null) !== (after.node.backendId ?? null)) changes.push('backend changed');
  if ((before.node.mediaType ?? null) !== (after.node.mediaType ?? null)) {
    changes.push(`result format ${before.node.mediaType ?? 'default'} → ${after.node.mediaType ?? 'default'}`);
  }
  return changes;
}

/** The group's inputs: each start tuple's variables, as "?a ?b". */
function groupInputs(state: QueryGroupGraphState): string[] {
  const start = state.nodes.find((node) => node.kind === 'start');
  if (!start) return [];
  const model = ioModelOf(state);
  return start.outputs
    .filter((port) => port.entityType === 'QueryInputTuple')
    .map((port) => (variablesForPort(port.id, model) ?? []).map((variable) => `?${variable.variableName}`).join(' '))
    .filter(Boolean);
}

/** Pair entries of `left` and `right` that agree on `key`, removing them from both. */
function pairBy(
  left: Described[],
  right: Described[],
  key: (entry: Described) => string | null,
  pairs: Array<[Described, Described]>,
) {
  for (const before of [...left]) {
    const k = key(before);
    if (k === null) continue;
    const index = right.findIndex((after) => key(after) === k);
    if (index < 0) continue;
    pairs.push([before, right[index]!]);
    right.splice(index, 1);
    left.splice(left.indexOf(before), 1);
  }
}

export function diffGroupVersions(
  before: QueryGroupGraphState,
  after: QueryGroupGraphState,
  refName: (id: string | null) => string = (id) => id ?? 'nothing',
): GroupVersionDiff {
  const left = describe(before);
  const right = describe(after);
  const pairs: Array<[Described, Described]> = [];
  pairBy(left, right, settingsKey, pairs);
  pairBy(left, right, (entry) => JSON.stringify([entry.node.kind, entry.name]), pairs);
  pairBy(left, right, (entry) => (entry.ref ? JSON.stringify([entry.node.kind, entry.ref]) : null), pairs);

  const changedNodes = pairs
    .map(([was, now]) => ({ name: nodeTitle(now), changes: nodeChanges(was, now, refName) }))
    .filter((entry) => entry.changes.length > 0);

  // Edges compare by the matched nodes, so name each node by its pair.
  const pairName = new Map<string, string>();
  const title = new Map<string, string>();
  pairs.forEach(([was, now], index) => {
    pairName.set(`a:${was.node.id}`, `p${index}`);
    pairName.set(`b:${now.node.id}`, `p${index}`);
  });
  for (const entry of describe(before)) title.set(`a:${entry.node.id}`, entry.name);
  for (const entry of describe(after)) title.set(`b:${entry.node.id}`, entry.name);
  const end = (side: 'a' | 'b', id: string) => pairName.get(`${side}:${id}`) ?? `${side}:${id}`;
  const edgeKey = (side: 'a' | 'b', edge: GraphEdgeState) => `${end(side, edge.source)}|${end(side, edge.target)}|${edge.flowType}`;
  const edgeTitle = (side: 'a' | 'b', edge: GraphEdgeState) =>
    `${title.get(`${side}:${edge.source}`) ?? '?'} → ${title.get(`${side}:${edge.target}`) ?? '?'} (${FLOW_LABEL[edge.flowType] ?? edge.flowType})`;

  const afterEdges = [...after.edges];
  const removedEdges: string[] = [];
  const changedEdges: DiffChange[] = [];
  for (const edge of before.edges) {
    const index = afterEdges.findIndex((candidate) => edgeKey('b', candidate) === edgeKey('a', edge));
    if (index < 0) {
      removedEdges.push(edgeTitle('a', edge));
      continue;
    }
    const match = afterEdges.splice(index, 1)[0]!;
    const changes: string[] = [];
    if ((edge.variableMappings ?? null) !== (match.variableMappings ?? null)) changes.push('variable mapping changed');
    if ((edge.whenEmpty ?? null) !== (match.whenEmpty ?? null)) changes.push(`when empty: ${edge.whenEmpty ?? 'default'} → ${match.whenEmpty ?? 'default'}`);
    if (changes.length > 0) changedEdges.push({ name: edgeTitle('b', match), changes });
  }

  const inputsBefore = groupInputs(before);
  const inputsAfter = groupInputs(after);
  const diff: GroupVersionDiff = {
    nodes: { added: right.map(nodeTitle), removed: left.map(nodeTitle), changed: changedNodes },
    edges: { added: afterEdges.map((edge) => edgeTitle('b', edge)), removed: removedEdges, changed: changedEdges },
    inputs: {
      added: inputsAfter.filter((tuple) => !inputsBefore.includes(tuple)),
      removed: inputsBefore.filter((tuple) => !inputsAfter.includes(tuple)),
    },
    same: false,
  };
  diff.same = [
    diff.nodes.added, diff.nodes.removed, diff.nodes.changed,
    diff.edges.added, diff.edges.removed, diff.edges.changed,
    diff.inputs.added, diff.inputs.removed,
  ].every((list) => list.length === 0);
  return diff;
}
