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
 */
import { computed } from 'vue';
import { BaseEdge, type EdgeProps } from '@vue-flow/core';
import type { LayoutPoint } from '@/composables/useAutoLayout';
import { smoothPolylinePath } from '@/lib/edgePaths';

const props = defineProps<EdgeProps>();

const points = computed<LayoutPoint[]>(() => {
  const laid = (props.data as { layoutPoints?: LayoutPoint[] } | undefined)?.layoutPoints;
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

const path = computed(() => smoothPolylinePath(points.value));

</script>

<template>
  <BaseEdge :id="id" :path="path" :style="style" :marker-end="markerEnd" />
</template>
