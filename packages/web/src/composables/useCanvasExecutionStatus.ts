import { computed, watch, type Ref } from 'vue';
import type { Node } from '@vue-flow/core';
import type { NodeExecutionDetail } from './queryGroupTypes';

/**
 * Puts per-node execution results from `/execute?nodeDetail=` onto the canvas, so
 * "which node was slow" and "which node broke the run" are visible where the graph
 * is, rather than only in a response body.
 */

export type NodeExecutionState = {
  status: 'running' | 'ok' | 'failed';
  durationMs?: number;
  /** Rows for a SELECT, triples for a CONSTRUCT/DESCRIBE. */
  count?: number;
  countLabel?: 'rows' | 'triples';
  error?: string;
  isFailedNode: boolean;
};

type Options = {
  nodeExecutions: Ref<NodeExecutionDetail[]>;
  failedNodeId: Ref<string | null>;
  isExecuting: Ref<boolean>;
  nodes: Ref<Node[]>;
};

export function useCanvasExecutionStatus({ nodeExecutions, failedNodeId, isExecuting, nodes }: Options) {
  const executionByNode = computed(() => {
    const byNode = new Map<string, NodeExecutionState>();
    for (const detail of nodeExecutions.value) {
      if (!detail?.nodeId) continue;
      // 'pending' never reaches the client: a node is only reported once started.
      const status: NodeExecutionState['status'] =
        detail.status === 'failed' ? 'failed' : detail.status === 'ok' ? 'ok' : 'running';
      const hasRows = typeof detail.rowCount === 'number';
      byNode.set(detail.nodeId, {
        status,
        durationMs: detail.durationMs,
        count: hasRows ? detail.rowCount : detail.tripleCount,
        countLabel: hasRows ? 'rows' : typeof detail.tripleCount === 'number' ? 'triples' : undefined,
        error: detail.error,
        isFailedNode: failedNodeId.value === detail.nodeId,
      });
    }

    // The engine stops at the first failure, so a named node may have no entry of
    // its own if it failed before reporting.
    const failed = failedNodeId.value;
    if (failed && !byNode.has(failed)) {
      byNode.set(failed, { status: 'failed', isFailedNode: true });
    }
    return byNode;
  });

  /** Slowest node of the run, for a quick "where did the time go" read. */
  const slowestNodeId = computed(() => {
    let slowest: { id: string; ms: number } | null = null;
    for (const [id, state] of executionByNode.value) {
      if (typeof state.durationMs !== 'number') continue;
      if (!slowest || state.durationMs > slowest.ms) slowest = { id, ms: state.durationMs };
    }
    return slowest?.id ?? null;
  });

  const totalDurationMs = computed(() =>
    nodeExecutions.value.reduce((sum, detail) => sum + (detail.durationMs ?? 0), 0)
  );

  const applyDecorations = () => {
    const byNode = executionByNode.value;
    for (const node of nodes.value) {
      const execution = byNode.get(node.id) ?? null;
      const data = (node.data ?? {}) as Record<string, unknown>;
      const next = execution
        ? { ...execution, isSlowest: node.id === slowestNodeId.value }
        : null;
      // Only write when it actually changed, or VueFlow re-renders on every tick.
      if (JSON.stringify(data.execution ?? null) !== JSON.stringify(next)) {
        node.data = { ...data, execution: next };
      }
    }
  };

  watch([executionByNode, nodes, isExecuting], () => applyDecorations(), { immediate: true });

  return { executionByNode, slowestNodeId, totalDurationMs, applyDecorations };
}
