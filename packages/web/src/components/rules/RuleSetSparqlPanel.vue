<script setup lang="ts">
/**
 * Equivalent SPARQL: what the engine runs, one block at a time.
 *
 * A right-panel tab rather than an accordion under the editor, because it is
 * derived output you check *against* the document — it wants to sit beside it,
 * not under it.
 *
 * One banner stays as body copy: that each program is one pass and SRL
 * evaluates to fixpoint. It earns the space because it changes how you read
 * everything beneath it. The tuple-surface explanation does not — it is a
 * once-ever read, so it lives in the spec.
 */
import { computed, ref, watch } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { Copy, Download, ExternalLink, Info } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import SectionLabel from '../shared/SectionLabel.vue';
import { stratumColor, STRATUM_NONE } from '@/composables/useStratumPalette';
import { stratumLabel } from '@/lib/srlStratumGutter';
import {
  useApiClient,
  type RuleSetSrlCompileFlavour,
  type RuleSetSrlCompileResult,
  type SrlDocumentBlock,
} from '@/composables/useApiClient';

const SPEC_LINK = 'https://w3c.github.io/data-shapes/shacl12-rules/#relationship-to-sparql';

const props = withDefaults(defineProps<{
  /** The document itself — this tab compiles it. */
  document: string;
  documentValid: boolean;
  tuplesEnabled: boolean;
  /** Every rule and DATA block, in document order — for the stratum swatches. */
  blocks: SrlDocumentBlock[];
  /** Only compiled while the tab is on screen; nobody reads a closed tab. */
  active: boolean;
  editorExtensions?: Extension[];
}>(), {
  editorExtensions: () => [],
});

const emit = defineEmits<{
  (e: 'open-in-query', sparql: string): void;
}>();

const apiClient = useApiClient();

const compiled = ref<RuleSetSrlCompileResult | null>(null);
const compileError = ref<string | null>(null);
const compiling = ref(false);
const selectedProgram = ref<string | null>(null);

/**
 * INSERT or CONSTRUCT — the two readings of the same rule, both from the
 * compiler rather than from rewriting the INSERT text, which would go wrong on
 * exactly the blocks a reader most needs to be right.
 *
 * The flavour belongs to the *selected block*, not to the tab, which is why the
 * control sits under the block picker rather than beside it — and why a block
 * whose head is a tuple has no choice to offer at all.
 */
const flavours: Array<{ id: RuleSetSrlCompileFlavour; label: string; hint: string }> = [
  { id: 'insert', label: 'INSERT', hint: 'What the engine runs — writes the inferred triples.' },
  { id: 'construct', label: 'CONSTRUCT', hint: 'Same body, non-destructive — returns the inferred triples instead of writing them.' },
];
const flavour = ref<RuleSetSrlCompileFlavour>('insert');

const ruleBlocks = computed(() => props.blocks.filter((block) => block.kind === 'rule'));

/** Rules first, then DATA blocks — the order the picker shows them in. */
const programs = computed(() => {
  const result = compiled.value;
  if (!result) {
    return [] as Array<{
      key: string;
      label: string;
      sparql: string;
      caveats: string[];
      color: string;
      stratum: number | null;
      producesTuples: boolean;
    }>;
  }
  return [
    ...result.rules.map((rule, index) => ({
      key: `rule-${rule.index}`,
      label: rule.label ?? `rule-${index + 1}`,
      sparql: rule.sparql,
      caveats: rule.caveats ?? [],
      color: stratumColor(ruleBlocks.value[index]?.stratum ?? null),
      stratum: ruleBlocks.value[index]?.stratum ?? null,
      producesTuples: rule.producesTuples === true,
    })),
    ...result.dataBlocks.map((block) => ({
      key: `data-${block.index}`,
      label: block.label,
      sparql: block.sparql,
      caveats: [] as string[],
      color: STRATUM_NONE,
      stratum: null,
      producesTuples: false,
    })),
  ];
});

const activeProgram = computed(
  () => programs.value.find((program) => program.key === selectedProgram.value) ?? programs.value[0] ?? null,
);

/*
 * A tuple-headed block has no flavour to choose: its rows are captured into the
 * ephemeral store, never written to the graph, so the SELECT it compiles to is
 * already the non-destructive form. The control says `SELECT` and goes inert
 * rather than offering two buttons that produce the same text.
 */
const tupleHead = computed(() => activeProgram.value?.producesTuples === true);

// Wrap rather than scroll sideways: the panel is narrow and tall, and a
// compiled program's long IRIs would otherwise run off the right edge.
const readOnlyExtensions = computed(() => [
  ...props.editorExtensions,
  EditorState.readOnly.of(true),
  EditorView.lineWrapping,
]);

const footerLine = computed(() => {
  const program = activeProgram.value;
  if (!program) return '';
  const lines = program.sparql.split('\n').length;
  const stratum = program.stratum === null ? 'data block' : `stratum ${stratumLabel(program.stratum)}`;
  return `${lines} ${lines === 1 ? 'line' : 'lines'} · ${stratum}`;
});

let compileTimer: ReturnType<typeof setTimeout> | null = null;
let compileSeq = 0;

const compile = async () => {
  const current = ++compileSeq;
  const text = props.document.trim();
  if (!text || !props.documentValid) {
    compiled.value = null;
    compileError.value = props.documentValid ? null : 'The document does not parse yet.';
    return;
  }
  compiling.value = true;
  try {
    const result = await apiClient.compileRuleSetSrl(props.document, {
      tuples: props.tuplesEnabled,
      flavour: flavour.value,
    });
    if (current !== compileSeq) return;
    compiled.value = result;
    compileError.value = null;
  } catch (error) {
    if (current !== compileSeq) return;
    compiled.value = null;
    compileError.value = error instanceof Error ? error.message : 'Could not compile the document';
  } finally {
    if (current === compileSeq) compiling.value = false;
  }
};

watch(
  () => [props.active, props.document, props.tuplesEnabled, props.documentValid, flavour.value] as const,
  ([active]) => {
    if (!active) return;
    if (compileTimer) clearTimeout(compileTimer);
    compileTimer = setTimeout(compile, 400);
  },
  { immediate: true },
);

const copyProgram = async () => {
  const sparql = activeProgram.value?.sparql;
  if (!sparql) return;
  try {
    await navigator.clipboard.writeText(sparql);
    toast.success('SPARQL copied');
  } catch {
    toast.error('Could not copy — select the text and copy it manually');
  }
};

/**
 * The selected block only. Concatenating every block would not be one valid
 * SPARQL query — two CONSTRUCTs back to back parse as nothing — so an `.rq`
 * holding the whole rule set would misdescribe itself.
 */
const downloadProgram = () => {
  const program = activeProgram.value;
  if (!program) return;
  const blob = new Blob([program.sparql], { type: 'application/sparql-query' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${program.label.replace(/[^\w.-]+/g, '_') || 'rule'}.rq`;
  anchor.click();
  URL.revokeObjectURL(url);
};
</script>

<template>
  <div class="sparql-pane" data-testid="sparql-pane">
    <!--
      This one earns its space. Everything below is one pass of a fixpoint
      evaluation, and reading it as a standalone program is the mistake the
      banner exists to head off.
    -->
    <div class="banner-strip">
      <div class="banner">
        <Info :size="13" class="banner-icon" />
        <span>
          Not equivalent on its own. SRL evaluates every rule to fixpoint; each program below is one
          pass, run in stratum order.
          <a :href="SPEC_LINK" target="_blank" rel="noreferrer">SRL spec § Relationship to SPARQL</a>
        </span>
      </div>
    </div>

    <div v-if="programs.length" class="block-picker">
      <button
        v-for="program in programs"
        :key="program.key"
        class="block-chip"
        :class="{ active: program.key === activeProgram?.key }"
        type="button"
        data-testid="sparql-block-chip"
        @click="selectedProgram = program.key"
      >
        <span class="block-swatch" :style="{ backgroundColor: program.color }" />
        {{ program.label }}
      </button>
    </div>

    <!--
      Its own strip, under the picker: the flavour is a property of the selected
      block, not of the tab, and a segmented control divides its track evenly.
    -->
    <div class="render-as-row">
      <SectionLabel>Render as</SectionLabel>
      <div
        v-if="tupleHead"
        class="segmented inert"
        data-testid="sparql-flavour-inert"
      >
        <span class="segment active">SELECT</span>
      </div>
      <div v-else class="segmented" role="group" aria-label="SPARQL form">
        <button
          v-for="option in flavours"
          :key="option.id"
          class="segment"
          :class="{ active: flavour === option.id }"
          type="button"
          :title="option.hint"
          :aria-pressed="flavour === option.id"
          :data-testid="`sparql-flavour-${option.id}`"
          @click="flavour = option.id"
        >
          {{ option.label }}
        </button>
      </div>
      <button
        class="ghost-button export"
        type="button"
        data-testid="sparql-export"
        :disabled="!activeProgram"
        title="Download the selected block as a .rq file"
        @click="downloadProgram"
      >
        <Download :size="12" />Download
      </button>
    </div>

    <p v-if="compiling && !programs.length" class="muted pane-pad">Compiling…</p>
    <p v-else-if="compileError" class="muted pane-pad">{{ compileError }}</p>
    <p v-else-if="!programs.length" class="muted pane-pad">Nothing to compile yet.</p>

    <template v-else-if="activeProgram">
      <div class="sparql-editor">
        <Codemirror
          :model-value="activeProgram.sparql"
          :style="{ height: '100%' }"
          :extensions="readOnlyExtensions"
        />
      </div>
      <div class="sparql-footer">
        <span class="muted">{{ footerLine }}</span>
        <button class="ghost-button" type="button" @click="copyProgram">
          <Copy :size="12" />Copy
        </button>
        <button
          class="ghost-button"
          type="button"
          data-testid="sparql-open-in-query"
          title="Open this program as an unsaved query"
          @click="emit('open-in-query', activeProgram.sparql)"
        >
          <ExternalLink :size="12" />Open in Query
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sparql-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.banner-strip {
  flex-shrink: 0;
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.banner {
  display: flex;
  gap: 7px;
  padding: var(--space-4);
  background: var(--warning-surface);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-panel);
  color: var(--warning-ink);
  font-size: var(--text-label);
  line-height: 1.5;
}

.banner-icon {
  flex-shrink: 0;
  margin-top: var(--space-1);
  color: var(--warning-ink);
}

.banner a {
  color: var(--warning-ink);
  text-decoration: underline;
}

.block-picker {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 5px;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.block-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  cursor: pointer;
}

.block-chip.active {
  /* The named role, not raw ink — see tokens.css `--segment-selected`. */
  background: var(--segment-selected);
  border-color: var(--segment-selected);
  color: var(--segment-selected-ink);
  font-weight: var(--weight-semibold);
}

.block-swatch {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-sm);
}

.render-as-row {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

/* A segmented control divides its track evenly — equal-width segments, centred. */
.segmented {
  display: inline-flex;
  flex-shrink: 0;
  overflow: hidden;
  height: var(--control-h-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
}

.segment {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--grid-3);
  padding: 0 var(--space-4);
  border: none;
  border-left: 1px solid var(--border-default);
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.segment:first-child {
  border-left: none;
}

.segment.active {
  /* The named role, not raw ink — see tokens.css `--segment-selected`. */
  background: var(--segment-selected);
  color: var(--segment-selected-ink);
  font-weight: var(--weight-semibold);
}

.segmented.inert .segment {
  cursor: default;
}

.ghost-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  white-space: nowrap;
  cursor: pointer;
}

.ghost-button:disabled {
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.ghost-button.export {
  margin-left: auto;
}

.sparql-editor {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.sparql-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
  border-top: 1px solid var(--border-default);
}

.sparql-footer .ghost-button:first-of-type {
  margin-left: auto;
}

.muted {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.pane-pad {
  padding: 0 var(--space-5);
}
</style>
