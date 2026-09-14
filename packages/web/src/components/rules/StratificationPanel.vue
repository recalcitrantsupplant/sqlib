<script lang="ts">
import type { StratificationNode } from './StratificationGraph.vue';

/**
 * Stratification: the DAG and its inspector, in the right-hand panel.
 *
 * One graph, one place. This used to be two — a thin tab and a full-screen
 * modal reachable three ways — and two copies of the same picture is how two
 * pictures drift apart. Everything the modal held is here: the counts and the
 * no-cycles verdict, the canvas, and the per-rule inspector (source, what it
 * depends on and why, and the evaluation order).
 *
 * What did *not* come with it is the paragraph explaining what a dashed edge
 * means. Reading that is a once-ever act; a wall of explanation above a graph
 * you open twenty times a day is a tax. It lives behind the header `?` and in
 * the spec.
 */
export interface StratificationPanelNode extends StratificationNode {
  /** The rule as written, shown in the inspector's Source section. */
  code?: string;
}

export interface StratificationPanelEdge {
  from: string;
  to: string;
  label?: 'positive' | 'negative' | 'closed';
  reasons?: Array<{
    body?: { subject?: string; predicate?: string; object?: string };
    head?: { subject?: string; predicate?: string; object?: string };
  }>;
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, CircleSlash, CornerDownLeft, HelpCircle, Info, MoveRight } from '@lucide/vue';
import StratificationGraph from './StratificationGraph.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import { stratumColor } from '@/composables/useStratumPalette';
import { stratumLabel } from '@/lib/srlStratumGutter';
import { formatCompactAge } from '@/lib/time';

const EDGE_HELP = 'An edge points from the rule depended on to the rule that depends on it. Solid '
  + 'grey is a positive dependency. Dashed red is negated and dashed grey is closed — the rule '
  + 'reading it runs exactly once. Both force a later stratum. SRL spec § Stratification';

const props = withDefaults(defineProps<{
  nodes: StratificationPanelNode[];
  edges: StratificationPanelEdge[];
  issues?: string[];
  ruleCount: number;
  strataCount: number;
  /** When the analysis last landed — "computed 1m ago". */
  computedAt?: string | null;
}>(), {
  issues: () => [],
  computedAt: null,
});

const emit = defineEmits<{
  (e: 'go-to-line', line: number): void;
}>();

/*
 * The selection is owned above, not here: clicking a node and clicking the
 * footer's stratum chip are the same act on the same "current rule", and a
 * selection private to this panel would make them two.
 */
const selectedId = defineModel<string | null>('selectedId', { default: null });

watch(
  () => props.nodes,
  (nodes) => {
    if (selectedId.value && nodes.some((node) => node.id === selectedId.value)) return;
    selectedId.value = nodes[0]?.id ?? null;
  },
  { immediate: true, deep: true },
);

const selected = computed(() => props.nodes.find((node) => node.id === selectedId.value) ?? null);

/*
 * The canvas is as tall as the graph wants, between a floor and a ceiling.
 *
 * The floor keeps a one-rank graph from becoming a letterbox with the zoom
 * controls in it. The ceiling is the trade the deep case makes: past about six
 * ranks the graph is something you pan and zoom anyway, and taking more of the
 * panel to postpone that only takes it from the inspector.
 */
const MIN_CANVAS = 170;
const MAX_CANVAS = 380;
const graphHeight = ref(0);
const canvasHeight = computed(() =>
  Math.round(Math.min(MAX_CANVAS, Math.max(MIN_CANVAS, graphHeight.value))),
);

const nodeLabels = computed(() => new Map(props.nodes.map((node) => [node.id, node.label])));

const headline = computed(() => {
  const rules = `${props.ruleCount} ${props.ruleCount === 1 ? 'rule' : 'rules'}`;
  const strata = `${props.strataCount} ${props.strataCount === 1 ? 'stratum' : 'strata'}`;
  return `${rules} · ${strata}`;
});

const computedAge = computed(() => {
  if (!props.computedAt) return null;
  const age = formatCompactAge(props.computedAt);
  // `computed now ago` does not read; every other age does.
  return age === 'now' ? 'computed now' : `computed ${age} ago`;
});

/** What the selected rule reads that another rule writes, and how. */
const dependencies = computed(() => {
  const id = selectedId.value;
  if (!id) return [];
  return props.edges
    .filter((edge) => edge.from === id)
    .map((edge) => ({
      id: edge.to,
      label: nodeLabels.value.get(edge.to) ?? edge.to,
      negated: edge.label === 'negative',
      closed: edge.label === 'closed',
      reasons: edge.reasons ?? [],
    }));
});

/** Strata in evaluation order, as chips — stratum 1 runs first. */
const evaluationOrder = computed(() => {
  const byStratum = new Map<number, string[]>();
  for (const node of props.nodes) {
    const stratum = node.stratum ?? 0;
    byStratum.set(stratum, [...(byStratum.get(stratum) ?? []), node.label]);
  }
  return [...byStratum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stratum, labels]) => ({ stratum, labels }));
});

/** The selected rule's source, split so the extract can carry line numbers. */
const sourceLines = computed(() => (selected.value?.code ?? '').split('\n'));
const sourceFirstLine = computed(() => selected.value?.line ?? 1);

const formatTriple = (triple?: { subject?: string; predicate?: string; object?: string }) =>
  [triple?.subject, triple?.predicate, triple?.object].filter(Boolean).join(' ').trim();
</script>

<template>
  <div class="strat-pane" data-testid="rules-stratification">
    <div class="header-strip">
      <span class="headline">{{ headline }}</span>
      <span v-if="!issues.length && nodes.length" class="chip chip-ok" data-testid="stratification-verdict">
        <Check :size="11" />no cycles through negation
      </span>
      <span v-else-if="issues.length" class="chip chip-bad" data-testid="stratification-verdict">
        <CircleSlash :size="11" />does not stratify
      </span>
      <span v-if="computedAge" class="computed">{{ computedAge }}</span>
      <button class="help-dot" type="button" tabindex="-1" :title="EDGE_HELP">
        <HelpCircle :size="13" />
      </button>
    </div>

    <!--
      Sized to what it holds, not to what is left over.

      Nearly every rule set is two or three ranks deep, and a canvas that takes
      the whole panel spends most of it on empty grid while the inspector — the
      part that answers "why is this rule here?" — scrolls in a slot too short
      to read. So the graph asks for its own height and the inspector keeps the
      rest. The cap is what stops a genuinely deep graph from doing the reverse.
    -->
    <div class="canvas" :style="{ height: `${canvasHeight}px` }">
      <StratificationGraph
        flow-id="stratification-panel"
        :nodes="nodes"
        :edges="edges"
        :selected-id="selectedId"
        show-bands
        @select="(id) => (selectedId = id)"
        @content-height="(height) => (graphHeight = height)"
      />
    </div>

    <aside class="inspector" data-testid="stratification-inspector">
      <div v-if="selected" class="inspector-header">
        <span class="inspector-title">{{ selected.label }}</span>
        <span
          class="chip chip-stratum"
          :style="{ backgroundColor: stratumColor(selected.stratum) }"
        >Stratum {{ stratumLabel(selected.stratum) }}</span>
        <span v-if="selected.monotonicity === 'negation'" class="chip chip-bad">Negation</span>
        <button
          v-if="selected.line"
          class="go-to-line"
          type="button"
          data-testid="stratification-go-to-line"
          @click="emit('go-to-line', selected.line)"
        >
          <CornerDownLeft :size="11" />Go to L{{ selected.line }}
        </button>
      </div>

      <div class="inspector-body">
        <template v-if="selected">
          <section v-if="selected.code" class="section">
            <SectionLabel>Source</SectionLabel>
            <div class="source">
              <div class="source-lines">
                <span v-for="(_, index) in sourceLines" :key="index">{{ sourceFirstLine + index }}</span>
              </div>
              <pre class="source-code">{{ selected.code }}</pre>
            </div>
          </section>

          <section class="section">
            <div class="section-head">
              <SectionLabel>Depends on</SectionLabel>
              <span class="section-count">
                {{ dependencies.length }} {{ dependencies.length === 1 ? 'rule' : 'rules' }}
              </span>
            </div>
            <p v-if="!dependencies.length" class="muted">Nothing — it reads only stored data.</p>
            <div
              v-for="dependency in dependencies"
              :key="dependency.id"
              class="dependency"
              :class="{ negated: dependency.negated }"
            >
              <span class="dependency-head">
                <span class="dependency-name">{{ dependency.label }}</span>
                <span class="dependency-kind" :class="{ negated: dependency.negated }">
                  {{
                    dependency.negated
                      ? `negated · forces stratum ${stratumLabel(selected.stratum)}`
                      : dependency.closed
                        ? `closed · forces stratum ${stratumLabel(selected.stratum)}`
                        : 'positive'
                  }}
                </span>
                <span
                  v-if="nodes.find((node) => node.id === dependency.id)?.line"
                  class="dependency-line"
                >L{{ nodes.find((node) => node.id === dependency.id)?.line }}</span>
              </span>
              <span v-for="(reason, index) in dependency.reasons" :key="index" class="reason">
                <code>{{ formatTriple(reason.body) }}</code>
                <MoveRight :size="13" class="reason-arrow" />
                <code>{{ formatTriple(reason.head) }}</code>
              </span>
            </div>
          </section>

          <section class="section">
            <SectionLabel>Evaluation order</SectionLabel>
            <div class="order-row">
              <template v-for="(group, index) in evaluationOrder" :key="group.stratum">
                <MoveRight v-if="index > 0" :size="13" class="reason-arrow" />
                <span
                  v-for="label in group.labels"
                  :key="`${group.stratum}-${label}`"
                  class="order-chip"
                  :class="{ current: label === selected.label }"
                  :style="{ backgroundColor: stratumColor(group.stratum) }"
                >{{ label }}</span>
              </template>
            </div>
          </section>
        </template>
        <p v-else class="muted">Select a rule to see what it depends on.</p>

        <section v-if="issues.length" class="section">
          <SectionLabel><Info :size="13" />Stratification issues</SectionLabel>
          <ul class="issues">
            <li v-for="issue in issues" :key="issue">{{ issue }}</li>
          </ul>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.strat-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.header-strip {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.headline {
  color: var(--ink);
  font-size: var(--text-body);
}

.computed {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.help-dot {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: help;
}

.help-dot:hover {
  background: var(--surface-sunken);
  color: var(--ink-secondary);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface);
  font-size: var(--text-label);
  white-space: nowrap;
}

.chip-ok {
  background: var(--success-surface);
  border-color: var(--success-border);
  color: var(--success-ink);
}

.chip-bad {
  background: var(--danger-surface);
  border-color: var(--danger-border);
  color: var(--danger);
  font-weight: var(--weight-semibold);
}

.chip-stratum {
  border-color: var(--border-subtle);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
}

.canvas {
  display: flex;
  flex-shrink: 0;
  min-height: 0;
}

/*
 * The inspector scrolls and the canvas does not: the graph is a fixed picture
 * you pan inside, and the detail below it is a document of unknown length. So
 * the inspector is the one that takes the slack, which is the whole point of
 * measuring the canvas rather than letting it stretch.
 */
.inspector {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border-top: 1px solid var(--border-default);
}

.inspector-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.inspector-title {
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.go-to-line {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  height: var(--control-h-sm);
  margin-left: auto;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.inspector-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
}

.section-count {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.source {
  display: flex;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
}

.source-lines {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: var(--space-3) var(--space-2) var(--space-3) 0;
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-subtle);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: 1.65;
  text-align: right;
  min-width: var(--grid-1);
}

.source-code {
  overflow: auto;
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: 1.65;
}

.dependency {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
}

.dependency.negated {
  background: var(--danger-surface);
  border-color: var(--danger-border);
}

.dependency-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.dependency-name {
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.dependency-kind {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.dependency-kind.negated {
  color: var(--danger);
}

.dependency-line {
  margin-left: auto;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}

.reason {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.reason code {
  padding: var(--space-1) var(--space-3);
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.reason-arrow {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.order-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.order-chip {
  display: inline-flex;
  align-items: center;
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.order-chip.current {
  border-color: var(--border-default);
  font-weight: var(--weight-semibold);
}

.issues {
  margin: 0;
  padding-left: var(--space-6);
  color: var(--danger);
  font-size: var(--text-label);
}

.muted {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
}
</style>
