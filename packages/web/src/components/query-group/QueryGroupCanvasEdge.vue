<script setup lang="ts">
/**
 * A canvas edge that stays visible when another edge joins the same two nodes.
 *
 * Two nodes are routinely joined twice — a control-flow edge saying "runs
 * after" alongside the data edge whose result it orders — and both leave the
 * same handle for the same one. VueFlow routes each edge from handle to handle
 * knowing nothing about its neighbours, so on a ranked layout, where those
 * handles line up, the second path lands exactly on the first: one line and two
 * labels stacked on the canvas where the group has two distinct dependencies.
 *
 * So an edge here draws itself in three ways, in order: along the lane dagre
 * reserved for it when the canvas was last arranged, which is what keeps an
 * edge that skips a rank from cutting through the cards between its ends; bowed
 * one lane off the direct line, alternating sides, when another edge already
 * joins the same two nodes; and otherwise as a plain step path.
 *
 * This is the stand-in for drawing an edge to the input it actually feeds. Once
 * inputs and outputs have handles of their own, edges will separate because
 * they end in different places, and the fanning here can go.
 */
import { computed } from 'vue';
import { BaseEdge, EdgeLabelRenderer, Position, getSmoothStepPath, type EdgeProps } from '@vue-flow/core';
import type { LayoutPoint } from '@/composables/useAutoLayout';
import { polylinePointAt, smoothPolylinePath } from '@/lib/edgePaths';

const props = defineProps<EdgeProps>();

/** How far off the direct line a parallel edge is drawn, at its widest. */
const LANE_WIDTH = 34;

const parallelIndex = computed(() => {
  const index = (props.data as { parallelIndex?: number } | undefined)?.parallelIndex;
  return typeof index === 'number' && Number.isFinite(index) ? index : 0;
});

/** 0 stays on the direct line; 1 goes one lane one way, 2 one lane the other. */
const laneOffset = computed(() => {
  const index = parallelIndex.value;
  if (index === 0) return 0;
  const lane = Math.ceil(index / 2);
  return index % 2 === 1 ? lane * LANE_WIDTH : -lane * LANE_WIDTH;
});

/*
 * The detour runs across the flow, not along it: a left-to-right layout is
 * separated by bowing up or down, a top-to-bottom one by bowing left or right.
 */
const isHorizontalFlow = computed(
  () => props.sourcePosition === Position.Left || props.sourcePosition === Position.Right,
);

/**
 * The route dagre reserved for this edge when the canvas was last arranged.
 *
 * A step path knows only its own two handles, so an edge that skips a rank
 * takes the shortest line to its target and drives straight through whatever
 * cards stand between them. Dagre threaded that edge through dummy nodes during
 * layout and so already knows a way round; drawing its waypoints is cheaper and
 * better than inventing a detour here. Dragging a node makes them stale, which
 * is why the canvas drops them on the first drag.
 */
const layoutRoute = computed<LayoutPoint[] | null>(() => {
  const laid = (props.data as { layoutPoints?: LayoutPoint[] } | undefined)?.layoutPoints;
  if (!laid || laid.length < 3) return null;
  /*
   * Dagre's end points sit on the node's border box; the handle is where the
   * arrow has to land. So the ends come from VueFlow and the middle from dagre.
   */
  return [
    { x: props.sourceX, y: props.sourceY },
    ...laid.slice(1, -1).map((point) => ({
      // Parallel edges share one dagre route, so they still need fanning.
      x: isHorizontalFlow.value ? point.x : point.x + laneOffset.value,
      y: isHorizontalFlow.value ? point.y + laneOffset.value : point.y,
    })),
    { x: props.targetX, y: props.targetY },
  ];
});

/*
 * Where along its own path an edge hangs its label. The edge beside it has a
 * label too, and a lane's worth of clearance is narrower than the words are
 * wide, so each parallel edge slides its label further back along the path.
 */
const labelFraction = computed(() => Math.max(0.2, 0.5 - parallelIndex.value * 0.12));

const straightSteppedPath = () =>
  getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 16,
  });

/**
 * A cubic that leaves and enters along the flow but bows `offset` across it.
 *
 * The step path cannot help here: with both handles on the same line it has no
 * corner to move, so every lane setting draws the same straight line. A curve
 * always has somewhere to go.
 */
const bowedPath = (offset: number): [string, number, number] => {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  const reach = Math.max(Math.abs(tx - sx), Math.abs(ty - sy)) * 0.4;
  const [c1, c2] = isHorizontalFlow.value
    ? [
      { x: sx + reach, y: sy + offset },
      { x: tx - reach, y: ty + offset },
    ]
    : [
      { x: sx + offset, y: sy + reach },
      { x: tx + offset, y: ty - reach },
    ];
  // The label sits on the curve it belongs to, clear of its neighbour's.
  const t = labelFraction.value;
  const at = (a: number, b: number, c: number, d: number) =>
    (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
  const labelX = at(sx, c1.x, c2.x, tx);
  const labelY = at(sy, c1.y, c2.y, ty);
  return [`M ${sx},${sy} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${tx},${ty}`, labelX, labelY];
};

/** Edge labels here are always plain text; anything else is not ours to draw. */
const labelText = computed(() => (typeof props.label === 'string' ? props.label : ''));

const path = computed<[string, number, number]>(() => {
  const route = layoutRoute.value;
  if (route) {
    const anchor = polylinePointAt(route, labelFraction.value);
    return [smoothPolylinePath(route), anchor.x, anchor.y];
  }
  if (laneOffset.value !== 0) return bowedPath(laneOffset.value);
  const [stepPath, labelX, labelY] = straightSteppedPath();
  return [stepPath, labelX, labelY];
});

</script>

<template>
  <BaseEdge
    :id="id"
    :path="path[0]"
    :style="style"
    :marker-end="markerEnd"
    :interaction-width="20"
  />
  <EdgeLabelRenderer v-if="labelText">
    <div
      class="edge-label"
      :style="{ transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)` }"
    >{{ labelText }}</div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.edge-label {
  position: absolute;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-body);
  line-height: 1.2;
  white-space: nowrap;
  /* The label is a caption on the line, never something to catch a click meant
     for the edge underneath it. */
  pointer-events: none;
}
</style>
