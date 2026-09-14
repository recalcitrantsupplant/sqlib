import { describe, it, expect } from 'vitest';
import { nextTick, ref } from 'vue';
import type { Edge, Node } from '@vue-flow/core';
import { useCanvasValidation } from '../../src/composables/useCanvasValidation';
import type { ValidationIssue } from '../../src/composables/queryGroupTypes';
import type { QueryGroupGraphState } from '../../src/composables/useQueryGroupGraph';

const NODE_A = 'urn:sqlib:node:a';
const NODE_B = 'urn:sqlib:node:b';
const EDGE_1 = 'urn:sqlib:edge:1';
const INPUT_TUPLE = 'urn:sqlib:input-tuple:1';

function makeFixture() {
  const nodes = ref<Node[]>([
    { id: NODE_A, position: { x: 0, y: 0 }, data: { kind: 'query' } },
    { id: NODE_B, position: { x: 0, y: 0 }, data: { kind: 'query' } },
  ]);
  const edges = ref<Edge[]>([{ id: EDGE_1, source: NODE_A, target: NODE_B }]);
  const graphState = ref({
    nodes: [
      { id: NODE_A, inputs: [], outputs: [] },
      { id: NODE_B, inputs: [{ id: INPUT_TUPLE, label: 'in', entityType: 'QueryInputTuple', direction: 'input' }], outputs: [] },
    ],
    edges: [],
    ioEntities: {},
    iriMap: {},
  } as unknown as QueryGroupGraphState);
  const validationIssues = ref<ValidationIssue[]>([]);
  const validation = useCanvasValidation({ validationIssues, nodes, edges, graphState });
  return { nodes, edges, graphState, validationIssues, validation };
}

describe('useCanvasValidation', () => {
  it('decorates the node an issue names', async () => {
    const { nodes, validationIssues } = makeFixture();
    validationIssues.value = [
      { level: 'error', message: 'boom', entityType: 'node', entityId: NODE_A, code: 'NODE_MISSING' },
    ];
    await nextTick();

    expect((nodes.value[0].data as any).validation).toMatchObject({ errors: 1, warnings: 0, level: 'error' });
    expect((nodes.value[1].data as any).validation).toBeNull();
  });

  it('marks an edge with a class matching the worst issue level', async () => {
    const { edges, validationIssues } = makeFixture();
    validationIssues.value = [
      { level: 'warning', message: 'soft', entityId: EDGE_1 },
      { level: 'error', message: 'hard', entityId: EDGE_1 },
    ];
    await nextTick();

    // Two issues on one edge: error wins, and the class reflects that.
    expect(edges.value[0].class).toContain('has-validation-error');
    expect(edges.value[0].class).not.toContain('has-validation-warning');
  });

  it('shows an I/O entity issue on the node that owns the port', async () => {
    // A tuple id is not a canvas element, so without this the badge would vanish.
    const { nodes, validationIssues, validation } = makeFixture();
    validationIssues.value = [
      { level: 'error', message: 'bad tuple', entityType: 'tuple', entityId: INPUT_TUPLE },
    ];
    await nextTick();

    expect((nodes.value[1].data as any).validation).toMatchObject({ errors: 1 });
    expect(validation.resolveTarget(validationIssues.value[0])).toEqual({
      type: 'io', id: INPUT_TUPLE, parentNodeId: NODE_B,
    });
  });

  it('keeps issues that name nothing on the canvas visible as graph-level', async () => {
    const { validationIssues, validation } = makeFixture();
    validationIssues.value = [
      { level: 'error', message: 'cycle detected', entityType: 'graph', entityId: null },
      { level: 'error', message: 'unknown thing', entityId: 'urn:sqlib:node:gone' },
    ];
    await nextTick();

    expect(validation.graphLevelIssues.value).toHaveLength(2);
    expect(validation.resolveTarget(validationIssues.value[0])).toBeNull();
  });

  it('clears decorations when issues are resolved', async () => {
    const { nodes, edges, validationIssues } = makeFixture();
    validationIssues.value = [
      { level: 'error', message: 'boom', entityId: NODE_A },
      { level: 'error', message: 'bang', entityId: EDGE_1 },
    ];
    await nextTick();
    expect((nodes.value[0].data as any).validation).not.toBeNull();

    validationIssues.value = [];
    await nextTick();

    expect((nodes.value[0].data as any).validation).toBeNull();
    expect(edges.value[0].class).not.toContain('has-validation-error');
  });

  it('counts errors and warnings across the whole graph', async () => {
    const { validationIssues, validation } = makeFixture();
    validationIssues.value = [
      { level: 'error', message: 'a', entityId: NODE_A },
      { level: 'warning', message: 'b', entityId: NODE_B },
      { level: 'warning', message: 'c', entityId: null },
    ];
    await nextTick();

    expect(validation.errorCount.value).toBe(1);
    expect(validation.warningCount.value).toBe(2);
  });
});
