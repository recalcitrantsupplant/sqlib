<script lang="ts">
import type { SrlDependencyReason } from '@/composables/useApiClient';
import type { StratificationNode } from './StratificationGraph.vue';

/**
 * Stratification: the DAG and its inspector, in the right-hand panel.
 *
 * One graph, one place. This used to be two — a thin tab and a full-screen
 * modal reachable three ways — and two copies of the same picture is how two
 * pictures drift apart. Everything the modal held is here: the counts, the
 * canvas, and the per-rule inspector (source, what it depends on and why, and
 * the evaluation order). The verdict is now shown only when it is bad news.
 *
 * What did *not* come with it is the paragraph explaining what a dashed edge
 * means. Reading that is a once-ever act; a wall of explanation above a graph
 * you open twenty times a day is a tax. It lives behind the header `?` and in
 * the spec.
 *
 * A document that does not stratify has no strata, so the panel stops talking
 * about them: no bands, no stratum chips, no evaluation order. It shows the
 * cycle instead — which rules are on it, which dependency joins them and why,
 * and what would break it.
 */
export interface StratificationPanelNode extends StratificationNode {
  /** The rule as written, shown in the inspector's Source section. */
  code?: string;
  /** The author's `RULE <iri>` name, when there is one. */
  name?: string | null;
}

export interface StratificationPanelEdge {
  from: string;
  to: string;
  label?: 'positive' | 'negative' | 'closed';
  reasons?: SrlDependencyReason[];
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Codemirror } from 'vue-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { CircleSlash, CornerDownLeft, HelpCircle, Info, MoveRight } from '@lucide/vue';
import { rdfSyntaxHighlighting } from '@/lib/codemirrorHighlight';
import { languageExtensionsFor } from '@/lib/codeLanguage';
import StratificationGraph from './StratificationGraph.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import { stratumColor } from '@/composables/useStratumPalette';
import { stratumLabel } from '@/lib/srlStratumGutter';
import { formatCompactAge } from '@/lib/time';
import { cycleEdgeLabel, formatBodyPattern, formatTriple } from '@/lib/srlDependencyDisplay';
import type { SrlStratificationCycle } from '@/composables/useApiClient';

const EDGE_HELP = 'An edge points from the rule depended on to the rule that depends on it. Solid '
  + 'grey is a positive dependency. Dashed red is negated and dashed grey is closed — the rule '
  + 'reading it runs exactly once. Both force a later stratum. SRL spec § Stratification';

const props = withDefaults(defineProps<{
  nodes: StratificationPanelNode[];
  edges: StratificationPanelEdge[];
  issues?: string[];
  /** What stops the rules stratifying, as data; empty when they stratify. */
  cycles?: SrlStratificationCycle[];
  stratified?: boolean;
  ruleCount: number;
  strataCount: number;
  /** When the analysis last landed — "computed 1m ago". */
  computedAt?: string | null;
}>(), {
  issues: () => [],
  cycles: () => [],
  stratified: true,
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
    // Unstratified, the rules worth opening on are the ones on the cycle.
    selectedId.value = (nodes.find((node) => node.inCycle) ?? nodes[0])?.id ?? null;
  },
  { immediate: true, deep: true },
);

const unstratified = computed(() => !props.stratified);
const cycleRuleIds = computed(() => new Set(props.cycles.flatMap((cycle) => cycle.rules)));
const nodeById = computed(() => new Map(props.nodes.map((node) => [node.id, node])));

/** A rule's line, as the gutter numbers it — the short form, for sentences. */
const lineRef = (id: string) => {
  const node = nodeById.value.get(id);
  return node?.line ? `L${node.line}` : node?.label ?? id;
};

/**
 * A rule as a reader finds it in the document: by the name its author gave it,
 * or by where it is. Never by the analysis id — nothing on screen says `rule-2`.
 */
const ruleRef = (id: string) => {
  const node = nodeById.value.get(id);
  if (!node) return id;
  if (node.name) return node.line ? `${node.label} (L${node.line})` : node.label;
  return node.line ? `rule at L${node.line}` : node.label;
};

const listJoin = (items: string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** One sentence saying why these rules cannot be ordered. */
function cycleSentence(cycle: SrlStratificationCycle): string {
  const refs = cycle.rules.map(lineRef);
  if (cycle.kind === 'run-once') {
    const once = (cycle.runOnce ?? []).map(({ rule, reasons }) => `${lineRef(rule)} (${reasons.join(', ')})`);
    if (cycle.rules.length === 1) {
      const why = cycle.runOnce?.[0]?.reasons.join(', ') || 'run-once';
      return `${refs[0]} runs once (${why}) but reads its own output, so it would have to run after itself.`;
    }
    return `${listJoin(refs)} depend on each other, and ${listJoin(once)} runs once: a run-once rule must run `
      + 'after everything it reads is complete, which a cycle never allows.';
  }
  if (cycle.rules.length === 1) {
    return `${refs[0]} negates its own output, so it would have to be evaluated before itself.`;
  }
  if (cycle.rules.length === 2) {
    const [a, b] = cycle.rules;
    const negates = (from: string, to: string) =>
      cycle.edges.some((edge) => edge.from === from && edge.to === to && edge.label === 'negative');
    if (negates(a, b) && negates(b, a)) {
      return `${lineRef(a)} and ${lineRef(b)} negate each other's output, so neither can be evaluated before the other.`;
    }
    const [reader, source] = negates(a, b) ? [a, b] : [b, a];
    return `${lineRef(reader)} negates ${lineRef(source)}'s output and ${lineRef(source)} depends on `
      + `${lineRef(reader)}'s, so neither can be evaluated before the other.`;
  }
  return `${listJoin(refs)} depend on each other in a cycle that passes through a NOT, so none of them `
    + 'can be evaluated before the others.';
}

const EDGE_VERB = {
  negative: 'negates the output of',
  closed: 'runs once over the output of',
  positive: 'reads the output of',
} as const;

/** The cycles, ready to render: a sentence, then each dependency with its lines. */
const cycleViews = computed(() =>
  props.cycles.map((cycle, index) => ({
    key: `${index}-${cycle.rules.join(',')}`,
    sentence: cycleSentence(cycle),
    edges: [...cycle.edges]
      .sort((x, y) => (nodeById.value.get(x.from)?.line ?? 0) - (nodeById.value.get(y.from)?.line ?? 0))
      .map((edge) => ({
        key: `${edge.from}->${edge.to}`,
        reader: edge.from,
        readerLine: nodeById.value.get(edge.from)?.line ?? null,
        source: edge.to,
        sourceLine: nodeById.value.get(edge.to)?.line ?? null,
        label: edge.label,
        verb: edge.from === edge.to ? EDGE_VERB[edge.label].replace('the output of', 'its own output') : EDGE_VERB[edge.label],
        reasons: edge.reasons,
      })),
  })),
);

/** What would break the cycle, for the kinds of cycle present. */
const fixHints = computed(() => {
  const hints: string[] = [];
  if (props.cycles.some((cycle) => cycle.kind === 'negation')) {
    hints.push('Remove or rewrite one NOT on the cycle — breaking any one of these dependencies breaks the cycle.');
    hints.push('If a NOT is meant to test only the input data, write it as NOT DATA { … }. It then reads the '
      + 'ground graph, which no rule writes, and depends on no rule.');
    hints.push('Narrow a pattern so it stops matching the other rule\'s head — a constant, or a different '
      + 'predicate, where it now has a free variable.');
  }
  if (props.cycles.some((cycle) => cycle.kind === 'run-once')) {
    hints.push('Have the run-once rule read only what nothing on the cycle writes — or, if it need not run once, '
      + 'drop the blank node or SET that makes it run-once.');
  }
  return hints;
});

/** Edges for the graph, the cycle's ones labelled with the patterns that made them. */
const graphEdges = computed(() => {
  const cycleReasons = new Map<string, SrlDependencyReason[]>();
  for (const cycle of props.cycles) {
    for (const edge of cycle.edges) cycleReasons.set(`${edge.from}->${edge.to}`, edge.reasons);
  }
  return props.edges.map((edge) => {
    const reasons = cycleReasons.get(`${edge.from}->${edge.to}`);
    return reasons ? { ...edge, cycleLabel: cycleEdgeLabel(reasons) } : edge;
  });
});

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
  // No strata to count: the verdict chip beside the headline says why.
  if (unstratified.value) return rules;
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
      line: nodeById.value.get(edge.to)?.line ?? null,
      negated: edge.label === 'negative',
      closed: edge.label === 'closed',
      onCycle: cycleRuleIds.value.has(id) && cycleRuleIds.value.has(edge.to),
      reasons: edge.reasons ?? [],
    }));
});

/*
 * What a dependency does to the reader. Stratified, that is the stratum it
 * forces; unstratified there is no stratum to name, so it says whether the
 * dependency is part of what went wrong.
 */
const dependencyKind = (dependency: { negated: boolean; closed: boolean; onCycle: boolean }) => {
  const kind = dependency.negated ? 'negated' : dependency.closed ? 'closed' : 'positive';
  if (unstratified.value) return dependency.onCycle ? `${kind} · on the cycle` : kind;
  if (kind === 'positive') return kind;
  return `${kind} · forces stratum ${stratumLabel(selected.value?.stratum ?? null)}`;
};

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

/** The document line the extract starts on — its first number in the gutter. */
const sourceFirstLine = computed(() => selected.value?.line ?? 1);

/*
 * The extract, read-only, numbered as the document numbers it.
 *
 * `vue-codemirror` installs `basicSetup` — and so `lineNumbers` — before
 * anything passed here, and an installed extension cannot be withdrawn. But
 * `lineNumbers` is one gutter however many times it is added, and its config
 * facet takes the formatter given here, so asking again with a `formatNumber`
 * renumbers the existing column rather than growing a second one.
 */
const sourceExtensions = computed<Extension[]>(() => {
  const offset = sourceFirstLine.value - 1;
  return [
    ...languageExtensionsFor('application/srl'),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    rdfSyntaxHighlighting,
    lineNumbers({ formatNumber: (line) => String(line + offset) }),
    EditorView.lineWrapping,
    EditorView.theme({
      '&': { backgroundColor: 'transparent' },
      '.cm-gutters': { border: 'none', backgroundColor: 'transparent' },
      '.cm-content': { padding: '0' },
      '.cm-line': { padding: '0 var(--space-4) 0 var(--space-2)' },
    }),
  ];
});
</script>

<template>
  <div class="strat-pane" data-testid="rules-stratification">
    <div class="header-strip">
      <span class="headline">{{ headline }}</span>
      <!--
        Only the bad news. A document that stratifies is the normal case, and a
        green chip restating it on every visit is a banner for "nothing is
        wrong" — the headline already says how many strata came out. The chip
        appears when there is something to act on.
      -->
      <span v-if="issues.length" class="chip chip-bad" data-testid="stratification-verdict">
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
        :edges="graphEdges"
        :selected-id="selectedId"
        show-bands
        @select="(id) => (selectedId = id)"
        @content-height="(height) => (graphHeight = height)"
      />
    </div>

    <aside class="inspector" data-testid="stratification-inspector">
      <div v-if="selected" class="inspector-header">
        <span class="inspector-title">{{ selected.label }}</span>
        <template v-if="unstratified">
          <span v-if="selected.inCycle" class="chip chip-bad" data-testid="stratification-on-cycle">
            <CircleSlash :size="11" />On the cycle
          </span>
          <span v-else class="chip chip-muted">Not on the cycle</span>
        </template>
        <span
          v-else
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
        <!--
          The document's problem before the selected rule's details: it is the
          same whichever rule is selected, and it is the reason the tab was
          opened.
        -->
        <section
          v-if="unstratified && cycleViews.length"
          class="section"
          data-testid="stratification-cycles"
        >
          <SectionLabel><CircleSlash :size="13" />Why it does not stratify</SectionLabel>
          <div v-for="cycle in cycleViews" :key="cycle.key" class="cycle">
            <p class="cycle-sentence" data-testid="stratification-cycle-sentence">{{ cycle.sentence }}</p>
            <div
              v-for="edge in cycle.edges"
              :key="edge.key"
              class="dependency"
              :class="{ negated: edge.label === 'negative' }"
              data-testid="stratification-cycle-edge"
            >
              <span class="cycle-edge-head">
                <button
                  class="line-link"
                  type="button"
                  :disabled="!edge.readerLine"
                  @click="edge.readerLine && emit('go-to-line', edge.readerLine)"
                >{{ ruleRef(edge.reader) }}</button>
                <span class="dependency-kind" :class="{ negated: edge.label === 'negative' }">{{ edge.verb }}</span>
                <button
                  v-if="edge.source !== edge.reader"
                  class="line-link"
                  type="button"
                  :disabled="!edge.sourceLine"
                  @click="edge.sourceLine && emit('go-to-line', edge.sourceLine)"
                >{{ ruleRef(edge.source) }}</button>
              </span>
              <span v-for="(reason, index) in edge.reasons" :key="index" class="reason">
                <code>{{ formatBodyPattern(reason) }}</code>
                <MoveRight :size="13" class="reason-arrow" />
                <code>{{ formatTriple(reason.head) }}</code>
              </span>
            </div>
          </div>
          <div class="fix" data-testid="stratification-fix">
            <span class="fix-title">To break it</span>
            <ul class="fix-list">
              <li v-for="hint in fixHints" :key="hint">{{ hint }}</li>
            </ul>
          </div>
        </section>

        <template v-if="selected">
          <section v-if="selected.code" class="section">
            <SectionLabel>Source</SectionLabel>
            <!--
              The rule as SRL, highlighted the way the editor above highlights
              it. No gutter: the extract is one rule lifted out of a document,
              so a column of numbers either counts from 1 and names lines that
              are not the document's, or carries the document's and asks to be
              read as a place to navigate — which is the button in the header's
              job. The header says where it came from; this says what it says.
            -->
            <div class="source">
              <Codemirror
                :model-value="selected.code"
                :extensions="sourceExtensions"
                :style="{ width: '100%' }"
              />
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
                  {{ dependencyKind(dependency) }}
                </span>
                <button
                  v-if="dependency.line"
                  class="dependency-line"
                  type="button"
                  :title="`Go to L${dependency.line}`"
                  @click="emit('go-to-line', dependency.line)"
                >L{{ dependency.line }}</button>
              </span>
              <span v-for="(reason, index) in dependency.reasons" :key="index" class="reason">
                <code>{{ formatBodyPattern(reason) }}</code>
                <MoveRight :size="13" class="reason-arrow" />
                <code>{{ formatTriple(reason.head) }}</code>
              </span>
            </div>
          </section>

          <!-- There is no order to show when the rules do not stratify. -->
          <section v-if="!unstratified" class="section">
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

        <!-- Cycles are shown above, as data; this is for anything else. -->
        <section v-if="issues.length && !cycles.length" class="section">
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
  flex-direction: column;
  overflow: hidden;
  padding: var(--space-3) 0;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
}


/* The editor's own type, at the size the rest of this panel reads at. */
.source :deep(.cm-editor) {
  width: 100%;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: 1.65;
}

/*
 * No active-line band, in the text or the gutter. The extract has no cursor to
 * put one under, and the app theme's rules carry `!important`, so the editor's
 * own theme cannot turn them off — this has to be said here, where the scoped
 * attribute outweighs it.
 */
.source :deep(.cm-editor .cm-activeLine),
.source :deep(.cm-editor .cm-activeLineGutter) {
  background: transparent !important;
  color: var(--ink-muted) !important;
}

/*
 * A gutter only as wide as the number in it. The editor's defaults size it for
 * a document of thousands of lines and put a fold column beside it; this holds
 * a handful of lines and folds nothing, and every pixel it takes is taken from
 * the rule — which is the thing being read.
 */
.source :deep(.cm-editor .cm-gutters) {
  background: transparent !important;
  border-right: none !important;
}

/* `!important` answers CodeMirror's own base theme, which sets the gutter
   columns to `display: flex !important` to stop their margins collapsing. */
.source :deep(.cm-editor .cm-foldGutter) {
  display: none !important;
}

.source :deep(.cm-editor .cm-lineNumbers .cm-gutterElement) {
  min-width: 0;
  padding: 0 var(--space-2) 0 var(--space-3);
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
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  cursor: pointer;
}

.dependency-line:hover {
  color: var(--action);
  text-decoration: underline;
}

.chip-muted {
  color: var(--ink-muted);
}

.cycle {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cycle-sentence {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-body);
  line-height: 1.5;
}

.cycle-edge-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.line-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--action);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  cursor: pointer;
}

.line-link:hover:not(:disabled) {
  text-decoration: underline;
}

.line-link:disabled {
  color: var(--ink-secondary);
  cursor: default;
}

.fix {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.fix-title {
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.fix-list {
  margin: 0;
  padding-left: var(--space-6);
  list-style: disc;
  color: var(--ink-secondary);
  font-size: var(--text-label);
  line-height: 1.5;
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
