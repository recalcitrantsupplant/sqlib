<script setup lang="ts">
/**
 * A dependency edge, drawn along the lane dagre reserved for it.
 *
 * VueFlow's built-in edges route themselves from one node's handle to another's
 * and know nothing about the rest of the graph, which is fine when edges join
 * adjacent ranks and hopeless when they skip several: every skip edge takes the
 * same shortest path and they stack into one unreadable ribbon. Dagre has
 * already solved this during layout — it threads each long edge through dummy
 * nodes, which reserves horizontal space per edge — so the fix is to draw the
 * path it computed instead of inventing another one.
 *
 * The waypoints are smoothed rather than joined with straight segments: a
 * corner is where two edges look joined when they merely cross.
 *
 * An edge on a cycle that stops the rules stratifying also carries a label: the
 * body pattern and the head template that unified to make it. That pair is
 * what has to change for the cycle to break, so it is written on the line
 * rather than left for the inspector.
 */
import { computed } from 'vue';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@vue-flow/core';
import type { LayoutPoint } from '@/composables/useAutoLayout';
import { smoothPolylinePath } from '@/lib/edgePaths';
import { bowPoints, labelPlacement, labelTransform } from '@/lib/cycleEdges';

const props = defineProps<EdgeProps>();

const edgeData = computed(
  () => (props.data ?? {}) as {
    layoutPoints?: LayoutPoint[];
    bow?: number;
    cycleLabel?: string;
    /** For one of a two-way pair: straight across between the nodes' facing sides. */
    endpoints?: [LayoutPoint, LayoutPoint];
  },
);

const points = computed<LayoutPoint[]>(() => {
  const across = edgeData.value.endpoints;
  if (across) return across;
  const laid = edgeData.value.layoutPoints;
  if (laid && laid.length >= 2) {
    /*
     * Dagre's first and last points sit on the node's own border box, which is
     * the same place VueFlow's handles are — but the handle is where the arrow
     * must land, so the ends come from VueFlow and the middle from dagre.
     */
    return [
      { x: props.sourceX, y: props.sourceY },
      ...laid.slice(1, -1),
      { x: props.targetX, y: props.targetY },
    ];
  }
  return [
    { x: props.sourceX, y: props.sourceY },
    { x: props.targetX, y: props.targetY },
  ];
});

const bow = computed(() => edgeData.value.bow ?? 0);
const path = computed(() => smoothPolylinePath(bowPoints(points.value, bow.value)));

const label = computed(() => {
  const text = edgeData.value.cycleLabel;
  if (!text) return null;
  // Anchored by its inner edge, so it grows away from the line it names.
  return { text, transform: labelTransform(labelPlacement(points.value, bow.value)) };
});
</script>

<template>
  <BaseEdge :id="id" :path="path" :style="style" :marker-end="markerEnd" />
  <EdgeLabelRenderer v-if="label">
    <div class="cycle-label" data-testid="stratification-cycle-label" :style="{ transform: label.transform }">
      {{ label.text }}
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.cycle-label {
  position: absolute;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius);
  background: var(--danger-surface);
  color: var(--danger);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
}
</style>
