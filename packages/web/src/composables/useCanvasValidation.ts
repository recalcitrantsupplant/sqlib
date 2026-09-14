import { computed, watch, type Ref } from 'vue';
import type { Edge, Node } from '@vue-flow/core';
import type { QueryGroupGraphState } from './useQueryGroupGraph';
import type { CanvasSelection, ValidationIssue } from './queryGroupTypes';

/**
 * Places `/validate` issues onto the canvas.
 *
 * Backend entity IRIs are the VueFlow node/edge ids for any saved version, so most
 * issues attach directly. Two cases need translation: an issue about an I/O entity
 * (a tuple or port) is shown on the node that owns it, and a graph-level issue has
 * no entity at all and is surfaced separately rather than dropped.
 */

export type EntityValidation = {
  errors: number;
  warnings: number;
  level: 'error' | 'warning';
  messages: string[];
};

export type ValidationTarget = {
  issue: ValidationIssue;
  selection: CanvasSelection;
};

type Options = {
  validationIssues: Ref<ValidationIssue[]>;
  nodes: Ref<Node[]>;
  edges: Ref<Edge[]>;
  graphState: Ref<QueryGroupGraphState | null>;
};

export function useCanvasValidation({ validationIssues, nodes, edges, graphState }: Options) {
  /** Owning node for each I/O entity id, so port-level issues land somewhere visible. */
  const ioOwnerByEntityId = computed(() => {
    const owners = new Map<string, string>();
    for (const node of graphState.value?.nodes ?? []) {
      for (const port of [...(node.inputs ?? []), ...(node.outputs ?? [])]) {
        if (port?.id) owners.set(port.id, node.id);
      }
    }
    return owners;
  });

  const nodeIds = computed(() => new Set(nodes.value.map((node) => node.id)));
  const edgeIds = computed(() => new Set(edges.value.map((edge) => edge.id)));

  /**
   * Where an issue should be shown, or null when it has no canvas home. Resolution
   * order matters: an id may name a node, an edge, or a port, and only the graph
   * knows which.
   */
  const resolveTarget = (issue: ValidationIssue): CanvasSelection => {
    const entityId = issue.entityId;
    if (!entityId) return null;
    if (nodeIds.value.has(entityId)) return { type: 'node', id: entityId };
    if (edgeIds.value.has(entityId)) return { type: 'edge', id: entityId };
    const owner = ioOwnerByEntityId.value.get(entityId);
    if (owner) return { type: 'io', id: entityId, parentNodeId: owner };
    return null;
  };

  /** Issue counts keyed by the canvas element that should display them. */
  const validationByEntity = computed(() => {
    const byEntity = new Map<string, EntityValidation>();
    const add = (id: string, issue: ValidationIssue) => {
      const existing = byEntity.get(id) ?? { errors: 0, warnings: 0, level: 'warning' as const, messages: [] };
      if (issue.level === 'error') existing.errors += 1;
      else existing.warnings += 1;
      existing.level = existing.errors > 0 ? 'error' : 'warning';
      existing.messages.push(issue.message);
      byEntity.set(id, existing);
    };

    for (const issue of validationIssues.value) {
      const target = resolveTarget(issue);
      if (!target) continue;
      if (target.type === 'io') {
        // Show it on the owning node; the inspector narrows to the port itself.
        if (target.parentNodeId) add(target.parentNodeId, issue);
      } else {
        add(target.id, issue);
      }
    }
    return byEntity;
  });

  /** Issues that name no canvas entity - they would otherwise vanish silently. */
  const graphLevelIssues = computed(() =>
    validationIssues.value.filter((issue) => resolveTarget(issue) === null)
  );

  const errorCount = computed(() => validationIssues.value.filter((i) => i.level === 'error').length);
  const warningCount = computed(() => validationIssues.value.filter((i) => i.level === 'warning').length);

  /**
   * Push decorations onto the live VueFlow arrays. Nodes read `data.validation`;
   * edges get a class, which avoids having to touch every place an edge is built.
   */
  const applyDecorations = () => {
    const byEntity = validationByEntity.value;

    for (const node of nodes.value) {
      const validation = byEntity.get(node.id) ?? null;
      const data = (node.data ?? {}) as Record<string, unknown>;
      if (data.validation !== validation) {
        node.data = { ...data, validation };
      }
    }

    for (const edge of edges.value) {
      const validation = byEntity.get(edge.id) ?? null;
      const base = (edge.class ?? '')
        .toString()
        .split(' ')
        .filter((name) => name && name !== 'has-validation-error' && name !== 'has-validation-warning');
      if (validation) base.push(validation.level === 'error' ? 'has-validation-error' : 'has-validation-warning');
      const next = base.join(' ');
      if (edge.class !== next) edge.class = next;
    }
  };

  watch(
    [validationByEntity, nodes, edges],
    () => applyDecorations(),
    { deep: false, immediate: true }
  );

  return {
    validationByEntity,
    graphLevelIssues,
    errorCount,
    warningCount,
    resolveTarget,
    applyDecorations,
  };
}
