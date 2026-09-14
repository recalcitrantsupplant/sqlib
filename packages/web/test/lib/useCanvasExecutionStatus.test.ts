import { describe, it, expect } from 'vitest';
import { nextTick, ref } from 'vue';
import type { Node } from '@vue-flow/core';
import { useCanvasExecutionStatus } from '../../src/composables/useCanvasExecutionStatus';
import type { NodeExecutionDetail } from '../../src/composables/queryGroupTypes';

const NODE_A = 'urn:sqlib:node:a';
const NODE_B = 'urn:sqlib:node:b';

function makeFixture() {
  const nodes = ref<Node[]>([
    { id: NODE_A, position: { x: 0, y: 0 }, data: { kind: 'query' } },
    { id: NODE_B, position: { x: 0, y: 0 }, data: { kind: 'query' } },
  ]);
  const nodeExecutions = ref<NodeExecutionDetail[]>([]);
  const failedNodeId = ref<string | null>(null);
  const isExecuting = ref(false);
  const status = useCanvasExecutionStatus({ nodeExecutions, failedNodeId, isExecuting, nodes });
  return { nodes, nodeExecutions, failedNodeId, isExecuting, status };
}

describe('useCanvasExecutionStatus', () => {
  it('decorates nodes with status, duration and row counts', async () => {
    const { nodes, nodeExecutions } = makeFixture();
    nodeExecutions.value = [
      { nodeId: NODE_A, status: 'ok', durationMs: 12, rowCount: 4 },
      { nodeId: NODE_B, status: 'ok', durationMs: 90, tripleCount: 7 },
    ];
    await nextTick();

    expect((nodes.value[0].data as any).execution).toMatchObject({
      status: 'ok', durationMs: 12, count: 4, countLabel: 'rows',
    });
    // A CONSTRUCT node reports triples, and must not be labelled rows.
    expect((nodes.value[1].data as any).execution).toMatchObject({ count: 7, countLabel: 'triples' });
  });

  it('marks the slowest node so the time sink is visible', async () => {
    const { nodes, nodeExecutions, status } = makeFixture();
    nodeExecutions.value = [
      { nodeId: NODE_A, status: 'ok', durationMs: 12 },
      { nodeId: NODE_B, status: 'ok', durationMs: 90 },
    ];
    await nextTick();

    expect(status.slowestNodeId.value).toBe(NODE_B);
    expect((nodes.value[1].data as any).execution.isSlowest).toBe(true);
    expect((nodes.value[0].data as any).execution.isSlowest).toBe(false);
    expect(status.totalDurationMs.value).toBe(102);
  });

  it('surfaces a failed node and its error', async () => {
    const { nodes, nodeExecutions, failedNodeId } = makeFixture();
    nodeExecutions.value = [
      { nodeId: NODE_A, status: 'ok', durationMs: 5 },
      { nodeId: NODE_B, status: 'failed', durationMs: 3, error: 'backend refused' },
    ];
    failedNodeId.value = NODE_B;
    await nextTick();

    expect((nodes.value[1].data as any).execution).toMatchObject({
      status: 'failed', error: 'backend refused', isFailedNode: true,
    });
  });

  it('still flags the failed node when it never reported a detail entry', async () => {
    // The engine stops at the first failure, so the named node can be absent from
    // the details array entirely - it must not go unmarked.
    const { nodes, failedNodeId } = makeFixture();
    failedNodeId.value = NODE_A;
    await nextTick();

    expect((nodes.value[0].data as any).execution).toMatchObject({ status: 'failed', isFailedNode: true });
  });

  it('clears decorations for a new run', async () => {
    const { nodes, nodeExecutions } = makeFixture();
    nodeExecutions.value = [{ nodeId: NODE_A, status: 'ok', durationMs: 5 }];
    await nextTick();
    expect((nodes.value[0].data as any).execution).not.toBeNull();

    nodeExecutions.value = [];
    await nextTick();
    expect((nodes.value[0].data as any).execution).toBeNull();
  });
});
