<script lang="ts">
/**
 * The stratification DAG: one rule per node, one dependency per edge, laid out
 * top-down by stratum.
 *
 * Extracted from the modal because the same picture is now wanted in two sizes
 * — inline in the right-hand panel while you edit, and full screen when you
 * want to study it — and two copies of a graph is how two graphs drift apart.
 * The component draws nodes it is given; deciding what a node *is* (a rule of
 * the open document, or a rule version of a saved rule set) stays with the
 * caller.
 */
export interface StratificationNode {
  id: string;
  /** What the rule asserts — its head predicate, or its name. */
  label: string;
  /** 0-based, as the stratifier reports it. */
  stratum: number | null;
  monotonicity: 'monotone' | 'negation' | null;
  /** The spec's `SL.once`: fired once per execution, not to fixpoint. */
  runOnce?: boolean;
  /** Where it is in the document, when it came from one. */
  line?: number | null;
}

/** A dependency an edge could not usefully be drawn for. */
interface SelfDependency {
  negated: boolean;
}

export interface StratificationGraphEdge {
  from: string;
  to: string;
  /**
   * `closed` is a positive dependency the stratifier promoted because the rule
   * reading it runs once: it demands the same "complete first" ordering a
   * negated dependency does, so it is drawn the same way.
   */
  label?: 'positive' | 'negative' | 'closed';
}
</script>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  MarkerType,
  VueFlow,
  useVueFlow,
  type Edge,
  type Node,
  type NodeMouseEvent,
} from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { Check, CircleSlash, RotateCw } from '@lucide/vue';
import { useCssToken } from '@/composables/useCssToken';
import { stratumColor } from '@/composables/useStratumPalette';
import { stratumLabel } from '@/lib/srlStratumGutter';
import { useAutoLayout, type LayoutPoint } from '../../composables/useAutoLayout';
import CanvasSurface from '../shared/CanvasSurface.vue';
import StratificationEdge from './StratificationEdge.vue';

const props = withDefaults(defineProps<{
  nodes: StratificationNode[];
  edges: StratificationGraphEdge[];
  selectedId?: string | null;
  /** Distinct per instance: two VueFlow instances sharing an id share state. */
  flowId?: string;
  /**
   * Draw a stratum band behind each rank. The bands are the same signal the
   * editor gutter carries, in the same palette, so a rule's colour means one
   * thing wherever you meet it.
   */
  showBands?: boolean;
}>(), {
  selectedId: null,
  flowId: 'stratification',
  showBands: false,
});

const emit = defineEmits<{
  (e: 'select', id: string): void;
  /** How tall the laid-out graph is, so a caller can size its canvas to fit. */
  (e: 'content-height', height: number): void;
}>();

const { layout } = useAutoLayout();
const { setCenter, onInit, viewport } = useVueFlow(props.flowId);
const graphPattern = useCssToken('--graph-pattern', '#e9ecef');

/*
 * The surface owns the box now, so the element the fit arithmetic measures is
 * read back off it rather than held here. A computed rather than a mirror:
 * `onMounted` reads it, and a watcher writing a mirror has a flush order to be
 * wrong about.
 */
const surfaceRef = ref<InstanceType<typeof CanvasSurface> | null>(null);
const wrapper = computed<HTMLElement | null>(() => surfaceRef.value?.surfaceEl ?? null);
const flowNodes = ref<Node[]>([]);
const flowEdges = ref<Edge[]>([]);

/*
 * A railroad diagram, not a whiteboard.
 *
 * The graph lives in a right-hand panel a few hundred pixels wide, so a node is
 * only as big as a head predicate and its two marks need. Everything else about
 * a rule — its source, what it depends on and why — is in the inspector below,
 * which is the thing the space saved here goes to.
 */
const NODE_SIZE = { width: 152, height: 52 };

/*
 * How much room the laid-out graph wants, so the panel can give the canvas that
 * and no more. Reported rather than taken: a graph two ranks deep should not
 * hold the same height open as one eight ranks deep, and the inspector below is
 * what wants the space back.
 */
const contentHeight = ref(0);

/** Breathing room around the graph, and the unit the fit and the height agree in. */
const FIT_PADDING = 12;

/** Room kept clear on the right for the zoom cluster. */
const CONTROLS_GUTTER = 34;

/**
 * How far the fit may shrink before it stops.
 *
 * A node carries two lines of small text, so past about three-quarters scale it
 * stops being a diagram and becomes a picture of one. Below this the graph is
 * left at readable size and the canvas pans, which is the trade every map makes
 * — an unreadable whole is worth less than a legible part you can move around.
 */
const MIN_READABLE_ZOOM = 0.72;

/*
 * Registered here rather than declared in the template, so VueFlow gets one
 * stable component identity: a fresh object every render remounts every edge.
 */
const edgeTypes = markRaw({ routed: StratificationEdge });

/**
 * Nodes are sized to their own label rather than to the widest one: a fixed
 * width either truncates `ex:transitiveClosure` or leaves `ex:p` swimming, and
 * a graph of uniformly wide boxes is a graph that needs panning to read.
 * 7.3px is the advance of the 12px mono face; 50 is chip, gaps and padding.
 */
const nodeWidth = (node: StratificationNode, marks: number): number => {
  const width = 50 + node.label.length * 7.3;
  /*
   * The floor is what the *second* line needs, not the first: "monotone · L11"
   * is the common case, and a node sized to a short head predicate clips it —
   * which costs the line reference, the one thing on the node you navigate by.
   */
  const floor = 118 + marks * 17;
  return Math.round(Math.min(NODE_SIZE.width + 78, Math.max(floor, width)));
};

/**
 * Fitting a small graph is what made the inline view look brainstormed-on: with
 * three rules on screen VueFlow's fit happily zooms to max-zoom and the boxes
 * fill the panel. So fit by hand — never magnify past 1:1, and centre what is
 * left rather than leaving it pinned to a corner, which is what `fitView` does
 * once its own zoom is clamped.
 */
/**
 * What is on the canvas: the node boxes *and* the routes between them.
 *
 * Fitting to the nodes alone crops the drawing, because a skip edge's lane is
 * outside the box it leaves and the one it arrives at — that is the whole point
 * of the lane. Measuring the nodes only is what left long edges sliced off at
 * the top of the panel.
 */
const drawnBounds = () => {
  if (!flowNodes.value.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of flowNodes.value) {
    const width = parseFloat(String((node.style as Record<string, unknown>)?.width ?? 0)) || 0;
    const height = parseFloat(String((node.style as Record<string, unknown>)?.height ?? 0)) || 0;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  }

  for (const edge of flowEdges.value) {
    for (const point of (edge.data as { layoutPoints?: LayoutPoint[] } | undefined)?.layoutPoints ?? []) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};

/**
 * Fit by width, never below legibility.
 *
 * Width is the axis the panel cannot give more of; height it can, because the
 * canvas asks for what this zoom implies (see `rebuild`). Deciding zoom from
 * width alone also keeps the two from chasing each other: the height depends on
 * the zoom, so the zoom must not depend on the height.
 */
const fitZoom = (boxWidth: number) => {
  const el = wrapper.value;
  if (!el || boxWidth <= 0) return 1;
  const available = Math.max(el.clientWidth - FIT_PADDING * 2 - CONTROLS_GUTTER, 1);
  return Math.max(MIN_READABLE_ZOOM, Math.min(1, available / boxWidth));
};

const fitGraph = (duration = 0) => {
  const el = wrapper.value;
  const box = drawnBounds();
  if (!el || !box) return;

  const pad = FIT_PADDING;
  const zoom = fitZoom(box.width);

  /*
   * Centred while it fits, pinned to its top-left corner once it does not.
   *
   * A graph too big for the canvas has to be read from somewhere, and the only
   * defensible somewhere is where it starts: the first rank, and the edge the
   * stratum labels are on. Centring an oversized graph instead crops it evenly
   * at both ends, which loses the beginning as well — and the beginning is the
   * half you can navigate from.
   */
  const overflowsWidth = box.width * zoom + pad * 2 + CONTROLS_GUTTER > el.clientWidth;
  const centreX = overflowsWidth
    ? box.minX - pad / zoom + el.clientWidth / zoom / 2
    : (box.minX + box.maxX) / 2 + CONTROLS_GUTTER / 2 / zoom;
  // The viewport centre that puts `box.minY`, plus one padding, on the top edge.
  const centreY = box.minY - pad / zoom + el.clientHeight / zoom / 2;
  setCenter(centreX, centreY, { zoom, duration });
};

const rebuild = async () => {
  if (!props.nodes.length) {
    flowNodes.value = [];
    flowEdges.value = [];
    return;
  }

  const known = new Set(props.nodes.map((node) => node.id));

  /*
   * A rule that reads what it writes is drawn as a mark on the node, not as an
   * edge. A self-edge has nowhere to go: dagre parks it in a loop beside the
   * node and every renderer draws it as a lobe crossing whatever else is there
   * — a lot of noise for a fact one glyph states, and recursion is common
   * enough in a rule set (this is what fixpoint evaluation is *for*) that the
   * noise is not rare either.
   *
   * Resolved before the nodes are built, because a node has to be wide enough
   * for the marks it will carry.
   */
  const drawable = props.edges.filter((edge) => known.has(edge.from) && known.has(edge.to));
  const loops = new Map<string, SelfDependency>();
  for (const edge of drawable) {
    if (edge.from !== edge.to) continue;
    const existing = loops.get(edge.from);
    loops.set(edge.from, { negated: (existing?.negated ?? false) || edge.label === 'negative' });
  }

  const baseNodes: Node[] = props.nodes.map((node) => {
    const selfDependency = loops.get(node.id) ?? null;
    const marks = (selfDependency ? 1 : 0) + (node.runOnce ? 1 : 0);
    return {
      id: node.id,
      type: 'stratification',
      data: { ...node, selfDependency },
      position: { x: 0, y: 0 },
      style: {
        width: `${nodeWidth(node, marks)}px`,
        height: `${NODE_SIZE.height}px`,
        backgroundColor: stratumColor(node.stratum),
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-panel)',
        color: 'var(--ink)',
      },
    };
  });

  /*
   * One line per pair. Two rules can depend on each other for several reasons
   * at once — the inspector lists them — and drawing one line per reason puts
   * identical strokes on top of each other, which reads as one line anyway and
   * costs a reserved lane each. A negated reason wins the styling, because
   * "there is negation between these two" is the fact that changes the stratum.
   */
  const merged = new Map<string, { from: string; to: string; label?: string }>();
  for (const edge of drawable) {
    if (edge.from === edge.to) continue;
    const key = `${edge.from}\u0000${edge.to}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { from: edge.from, to: edge.to, label: edge.label });
      continue;
    }
    if (edge.label === 'negative') existing.label = 'negative';
    else if (edge.label === 'closed' && existing.label !== 'negative') existing.label = 'closed';
  }

  const baseEdges: Edge[] = [...merged.values()]
    .map((edge, index) => ({
      // The arrow points the way evaluation flows: the rule depended on comes
      // first, the rule that depends on it second.
      id: `${edge.to}-${edge.from}-${index}`,
      source: edge.to,
      target: edge.from,
      // Drawn along the lane dagre reserved — see StratificationEdge.vue.
      type: 'routed',
      /*
       * The head is coloured with the stroke, not left at the default: a red
       * dashed line ending in a grey arrow is a legend and a drawing that
       * disagree, and the arrow is the half a reader looks at.
       */
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edge.label === 'negative' ? 'var(--danger)' : 'var(--graph-edge)',
        width: 14,
        height: 14,
      },
      style: {
        stroke: edge.label === 'negative' ? 'var(--danger)' : 'var(--graph-edge)',
        strokeWidth: 1.4,
        strokeDasharray: edge.label === 'positive' ? undefined : '4 3',
      },
    }));

  const { nodes: laidOutNodes, edges: laidOutEdges, bounds } = layout(baseNodes, baseEdges, {
    direction: 'TB',
    rankAccessor: (node) => (node.data as { stratum?: number | null })?.stratum,
    nodeSize: NODE_SIZE,
    /*
     * Tighter than a whiteboard would be. Rank separation is what a skip edge's
     * lane is carved out of, so it cannot go to nothing — but 140px of it was
     * spending the panel's scarcest axis on white space between two rows.
     */
    rankSep: 64,
    nodeSep: 24,
    margin: { x: 20, y: 16 },
    withEdgePoints: true,
  });

  flowNodes.value = laidOutNodes;
  flowEdges.value = laidOutEdges;

  /*
   * The height to ask for is the height the graph will *render* at, not the
   * height dagre laid it out at.
   *
   * A dense graph is wide — dagre reserves a lane per skip edge — so the fit
   * zoom is decided by the width the panel has, and asking for the unscaled
   * height would leave exactly that much empty grid under the drawing. Zoom is
   * therefore derived from width alone here, which also keeps this out of a
   * loop with `fitGraph`: that reads the height this sets.
   */
  const pad = FIT_PADDING;
  const box = drawnBounds() ?? { width: bounds.width, height: bounds.height };
  contentHeight.value = Math.round(box.height * fitZoom(box.width) + pad * 2);
  emit('content-height', contentHeight.value);

  await nextTick();
  fitGraph(200);
};

watch(() => [props.nodes, props.edges], rebuild, { deep: true, immediate: true });
onInit(() => nextTick(() => fitGraph()));

/*
 * Re-fit whenever the canvas changes size.
 *
 * Two things need this. The canvas is sized *from* the graph, so the fit that
 * asks for a height necessarily runs before that height exists — and VueFlow
 * reads its own cached dimensions when it centres, which are still the old
 * ones. And the panel divider can be dragged at any time, after which a fit
 * computed at the old width is simply wrong. One observer answers both.
 */
let resizeObserver: ResizeObserver | null = null;
let refitFrame: number | null = null;

onMounted(() => {
  const el = wrapper.value;
  if (!el || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => {
    // Coalesced to a frame: a drag on the divider fires this continuously, and
    // re-centring per event is animation the user did not ask for.
    if (refitFrame !== null) cancelAnimationFrame(refitFrame);
    refitFrame = requestAnimationFrame(() => {
      refitFrame = null;
      fitGraph();
    });
  });
  resizeObserver.observe(el);
});

onBeforeUnmount(() => {
  if (refitFrame !== null) cancelAnimationFrame(refitFrame);
  resizeObserver?.disconnect();
  resizeObserver = null;
});

/**
 * One band per stratum, behind the nodes.
 *
 * Derived from the laid-out node positions rather than from a second layout
 * pass, so a band cannot end up describing a rank the graph no longer has. The
 * geometry is flow-space; the template converts it with the live viewport
 * transform, which is what keeps a band under its rules through pan and zoom.
 */
const bandGeometry = computed(() => {
  if (!props.showBands) return [];
  const byStratum = new Map<number, { top: number; bottom: number }>();
  for (const node of flowNodes.value) {
    const stratum = (node.data as { stratum?: number | null })?.stratum ?? 0;
    const top = node.position.y;
    const height = parseFloat(String((node.style as Record<string, unknown>)?.height ?? 0)) || 0;
    const existing = byStratum.get(stratum);
    byStratum.set(stratum, {
      top: existing ? Math.min(existing.top, top) : top,
      bottom: existing ? Math.max(existing.bottom, top + height) : top + height,
    });
  }
  return [...byStratum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stratum, box]) => ({
      stratum,
      top: box.top,
      height: box.bottom - box.top,
      color: stratumColor(stratum),
      label: stratumLabel(stratum),
    }));
});

/** Flow space to screen space, so the bands track pan and zoom. */
const bandStyle = (band: { top: number; height: number; color: string }) => {
  const { y, zoom } = viewport.value;
  const pad = 10 * zoom;
  return {
    top: `${y + band.top * zoom - pad}px`,
    height: `${band.height * zoom + pad * 2}px`,
    background: `linear-gradient(to right, ${band.color}, transparent)`,
  };
};

const handleNodeClick = (event: NodeMouseEvent) => {
  if (event.node?.id) emit('select', event.node.id);
};
</script>

<template>
  <!--
    The canvas archetype's surface (design system §6): the same box query groups
    draws its graph in, in the `subtle` tone and with the controls stepped down
    for a panel-sized graph.
  -->
  <CanvasSurface
    ref="surfaceRef"
    tone="subtle"
    dense
    :empty="!nodes.length"
    empty-title="No rules to stratify yet."
    data-testid="stratification-graph"
  >
    <!--
      Behind the flow, not inside it: the bands are chrome that says which rank
      you are looking at, and making them nodes would put them in the graph's
      own hit-testing and selection.
    -->
    <template v-if="showBands" #underlay>
      <div
        v-for="band in bandGeometry"
        :key="band.stratum"
        class="stratum-band"
        :style="bandStyle(band)"
      ><span class="stratum-band-label">{{ band.label }}</span></div>
    </template>
    <!--
      Fitted by hand in onInit rather than with fit-view-on-init: the built-in
      fit takes no maxZoom, so a one-node graph gets magnified to fill the panel.
    -->
    <VueFlow
      :id="flowId"
      v-model:nodes="flowNodes"
      v-model:edges="flowEdges"
      :fit-view-on-init="false"
      :min-zoom="0.25"
      :max-zoom="2"
      :nodes-draggable="false"
      :edges-updatable="false"
      :nodes-connectable="false"
      :zoom-on-double-click="false"
      class="stratification-flow"
      :edge-types="edgeTypes"
      @node-click="handleNodeClick"
    >
      <Background :pattern-color="graphPattern" :gap="16" />
      <!-- Bottom-right: bottom-left is where the stratum band labels are. -->
      <Controls position="bottom-right" :show-interactive="false" />

      <template #node-stratification="slotProps">
        <!--
          Two lines: what the rule asserts, then the marks that qualify it. The
          stratum is a chip rather than a word because the band behind the node
          already says it in colour — the chip is what makes the colour legible
          to someone who cannot use it.
        -->
        <div class="strat-node" :class="{ selected: slotProps.data.id === selectedId }">
          <div class="node-top">
            <span
              class="stratum-chip"
              :title="`Stratum ${stratumLabel(slotProps.data.stratum)}`"
            >{{ stratumLabel(slotProps.data.stratum) }}</span>
            <span class="node-title" :title="slotProps.data.label">{{ slotProps.data.label }}</span>
          </div>
          <div class="node-meta">
            <span v-if="slotProps.data.monotonicity === 'negation'" class="mono negation">
              <CircleSlash :size="11" />negation
            </span>
            <span v-else class="mono"><Check :size="11" />monotone</span>
            <!--
              Recursion is stated on the node rather than drawn as a loop back
              into it: the fact is "this rule reads what it writes", and a lobe
              crossing its neighbours says that no more clearly than a glyph.
            -->
            <RotateCw
              v-if="slotProps.data.selfDependency"
              class="node-mark"
              :class="{ negation: slotProps.data.selfDependency.negated }"
              :size="11"
              :aria-label="slotProps.data.selfDependency.negated ? 'recursive under negation' : 'recursive'"
              :title="slotProps.data.selfDependency.negated
                ? 'Reads its own output under negation — this is what makes the rule set unstratifiable'
                : 'Reads what it writes: it runs to fixpoint on its own output'"
            />
            <span
              v-if="slotProps.data.runOnce"
              class="node-once"
              title="Runs exactly once, not to fixpoint (SL.once)"
            >once</span>
            <span v-if="slotProps.data.line" class="node-line">L{{ slotProps.data.line }}</span>
          </div>
        </div>
      </template>
    </VueFlow>
  </CanvasSurface>
</template>

<style scoped>
/*
 * The Vue Flow stylesheets, the positioned box, the underlay the bands sit in
 * and the stepped-down controls are `CanvasSurface`'s. What is left is what
 * only a stratification graph draws: the bands themselves and the node.
 */

.stratum-band {
  position: absolute;
  left: 0;
  width: 46%;
}

.stratum-band-label {
  position: absolute;
  top: 50%;
  left: 7px;
  color: var(--ink-secondary);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  transform: translateY(-50%);
}

.stratification-flow {
  width: 100%;
  height: 100%;
}

.strat-node {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: var(--space-3) var(--space-4);
}

.strat-node.selected {
  outline: 2px solid var(--action);
  outline-offset: -2px;
  border-radius: var(--radius-panel);
}

.node-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.node-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stratum-chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.node-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  overflow: hidden;
  min-width: 0;
  margin-top: var(--space-2);
  white-space: nowrap;
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.node-mark {
  flex-shrink: 0;
  color: var(--ink-secondary);
}

.node-mark.negation {
  color: var(--danger);
}

.mono {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mono.negation {
  color: var(--danger);
}

.node-once {
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
}

.node-line {
  color: var(--ink-muted);
  font-family: var(--font-mono, ui-monospace, monospace);
}

</style>
