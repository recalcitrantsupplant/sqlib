/**
 * The nodes of a query group, as a benchmark case shows them.
 *
 * A query group case does not use the plan's backends: each node names its own
 * store, and the runner records one timing per node (`BenchmarkNodeObservation`).
 * The case editor lists the nodes in the order the engine runs them, each with
 * its name, its store and its p95 from the run in view.
 */

import type { QueryGroupVersionExpanded } from '@sparql-query-lib/contracts';
import { canvasNodeLabel } from '../composables/queryGroupNodeLabel';
import type { GraphNodeKind, GraphNodeState } from '../composables/useQueryGroupGraph';
import { parseCanvasData } from './queryGroupCanvasData';
import { percentile } from './benchmarkPlan';

export type GroupNodeKind = Exclude<GraphNodeKind, 'start' | 'end'>;

/**
 * Where a node runs.
 *
 * - `backend`: a registered backend, by id.
 * - `ephemeral`: a store that exists only for one execution of the group.
 * - `inProcess`: a rule set node, which the server evaluates itself.
 * - `none`: a node with no backend. The engine refuses to run it.
 */
export type GroupNodeTarget =
  | { kind: 'backend'; backendId: string }
  | { kind: 'ephemeral' }
  | { kind: 'inProcess' }
  | { kind: 'none' };

export interface GroupNodeRow {
  nodeId: string;
  /** 1-based position in the engine's run order, among execution nodes. */
  order: number;
  kind: GroupNodeKind;
  /** The author's label, else the query or rule set name, else the kind's name. */
  name: string;
  /** The query or rule set the node runs, when the name above is the author's label. */
  sourceName: string | null;
  /** The query version number the node runs. Null for rule set and dynamic nodes. */
  sourceVersion: number | null;
  /** The query version IRI, for a link. */
  sourceVersionId: string | null;
  /** The rule set version a rule set node runs. Null for every other kind. */
  ruleSetVersionId: string | null;
  target: GroupNodeTarget;
  queryString: string | null;
}

export interface GroupNodeCostRow extends GroupNodeRow {
  p95Ms: number | null;
  samples: number;
  failed: number;
}

/** The fields of a node observation this module reads. */
export interface RawNodeObservation {
  node?: string;
  durationMs?: number | string;
  success?: boolean | string;
}

type ExecutionNode = {
  id: string;
  nodeType?: string | null;
  queryId?: string | null;
  ruleSetVersion?: string | null;
  backendId?: string | null;
  backendConfig?: { type: string } | null;
};

function kindOf(node: ExecutionNode): GroupNodeKind {
  switch (node.nodeType) {
    case 'RuleSetNode': return 'ruleset';
    case 'PatchNode': return 'patch';
    case 'DynamicQueryNode': return 'dynamic';
    default: return node.ruleSetVersion ? 'ruleset' : 'query';
  }
}

function targetOf(node: ExecutionNode, kind: GroupNodeKind): GroupNodeTarget {
  if (kind === 'ruleset') return { kind: 'inProcess' };
  if (node.backendConfig?.type === 'ephemeral-oxigraph') return { kind: 'ephemeral' };
  if (node.backendId) return { kind: 'backend', backendId: node.backendId };
  return { kind: 'none' };
}

/**
 * Execution nodes in the order the engine runs them.
 *
 * The same Kahn walk as `ExecutionEngine.execute`: the start node and every
 * node with no incoming edge go first, in the order the version lists them,
 * and a node joins the queue when its last incoming edge is spent.
 */
function runOrder(expanded: QueryGroupVersionExpanded, executionIds: string[]): string[] {
  const ids = [
    ...(expanded.startNode?.id ? [expanded.startNode.id] : []),
    ...executionIds,
    ...(expanded.endNode?.id ? [expanded.endNode.id] : []),
  ];
  const known = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of expanded.edges ?? []) {
    const source = edge.sourceNodeId;
    const target = edge.targetNodeId;
    if (!source || !target || !known.has(source) || !known.has(target)) continue;
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
  }

  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const target of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  // A cycle leaves nodes out of the walk. The server refuses such a group, but
  // the list still names every node, after the ones it could order.
  for (const id of ids) if (!order.includes(id)) order.push(id);

  const execution = new Set(executionIds);
  return order.filter((id) => execution.has(id));
}

/** One row per execution node of a group version, in run order. */
export function groupNodeRows(expanded: QueryGroupVersionExpanded): GroupNodeRow[] {
  const nodes = (expanded.executionNodes ?? []) as ExecutionNode[];
  const iriMap = expanded.iriMap ?? {};
  const labels = parseCanvasData(expanded.queryGroupVersion?.canvasData).labels;
  const versions = new Map((expanded.queryVersions ?? []).map((version) => [version.id, version]));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return runOrder(expanded, nodes.map((node) => node.id)).map((nodeId, index) => {
    const node = byId.get(nodeId)!;
    const kind = kindOf(node);
    const queryVersionId = kind === 'ruleset' ? null : node.queryId ?? null;
    const label = labels.get(nodeId) ?? null;
    const graphNode = {
      id: nodeId,
      kind,
      label: label ?? '',
      queryId: queryVersionId,
      queryVersionId,
      ruleSetVersionId: node.ruleSetVersion ?? null,
    } as GraphNodeState;
    const fallback = canvasNodeLabel({ ...graphNode, label: '' }, iriMap);
    const version = queryVersionId ? versions.get(queryVersionId) : undefined;

    return {
      nodeId,
      order: index + 1,
      kind,
      name: label ?? fallback,
      sourceName: label && label !== fallback ? fallback : null,
      sourceVersion: kind === 'dynamic' ? null : version?.version ?? null,
      sourceVersionId: kind === 'dynamic' ? null : queryVersionId,
      ruleSetVersionId: kind === 'ruleset' ? node.ruleSetVersion ?? null : null,
      target: targetOf(node, kind),
      queryString: kind === 'dynamic' ? null : version?.queryString ?? null,
    };
  });
}

/** Each node's p95, request count and failures on the run in view. */
export function groupNodeCosts(
  rows: GroupNodeRow[],
  observations: RawNodeObservation[],
): GroupNodeCostRow[] {
  const byNode = new Map<string, RawNodeObservation[]>();
  for (const observation of observations) {
    if (!observation.node) continue;
    byNode.set(observation.node, [...(byNode.get(observation.node) ?? []), observation]);
  }
  return rows.map((row) => {
    const matching = byNode.get(row.nodeId) ?? [];
    const ok = matching.filter((o) => o.success === true || o.success === 'true');
    const durations = ok.map((o) => Number(o.durationMs)).filter((ms) => Number.isFinite(ms));
    return {
      ...row,
      p95Ms: percentile(durations, 95),
      samples: matching.length,
      failed: matching.length - ok.length,
    };
  });
}
