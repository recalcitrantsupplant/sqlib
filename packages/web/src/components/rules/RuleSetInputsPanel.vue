<script lang="ts">
/**
 * Inputs: what this rule set is run against.
 *
 * The model change this tab exists for: **named tuples and a data graph are
 * arguments, not definition.** They have the same relationship to a rule set
 * that an argument set has to a query, and three things follow from saying so.
 *
 * 1. They never live in the SRL document. The editor column holds SRL only. A
 *    `DATA { … }` block *is* SRL and stays in the document — that is the rule
 *    set's own authoring sugar. The data *graph* is separate and external.
 * 2. They are their own entities, in the rail sections that already exist:
 *    named tuple sets under **Tuples**, graphs under **Data**.
 * 3. A rule set plus its inputs is a test — which is exactly what the Test
 *    entity already models. So promotion is explicit, and one button does it.
 *    Nothing is written to Tests implicitly: a scratch data graph that
 *    materialised a test case behind the author's back would fill Tests with
 *    noise nobody asked for, and we would then have to invent a way to hide it.
 *
 * Tuples above the graph, in one tab rather than two, because a run needs the
 * pair and both are small.
 */
export type InputSource = 'saved' | 'inline';
</script>

<script setup lang="ts">
import { computed } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { CircleCheck, Database, ExternalLink, HelpCircle, Save, Table } from '@lucide/vue';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { DATA_GRAPH_FORMATS, type DataGraphFormat, type DataGraphOption, type TupleSetOption } from '@/types/data-graphs';
import PrefixConversionButtons from '@/components/shared/PrefixConversionButtons.vue';
import SearchSelect from '@/components/shared/SearchSelect.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import { tupleBindNotice } from '@/lib/tupleSetLabels';

const HEADER_HELP = 'A rule set defines rules. Named tuples and a data graph are what you run it '
  + 'against — the same relationship an argument set has to a query. They save as their own '
  + 'entities in Tuples and Data; the pair plus this rule set is what a test is.';

const props = withDefaults(defineProps<{
  /**
   * Whether the rule set opted into the rule-tuples extension.
   *
   * Off means `TUPLE(…)` is a syntax error in the document, so there is nothing
   * a tuple input could feed: the block is not disabled but absent, since an
   * input that can never be read is not an input.
   */
  tuplesEnabled?: boolean;
  tupleSetOptions: TupleSetOption[];
  dataGraphOptions: DataGraphOption[];
  /** Rows the saved tuple set holds, rendered as `TUPLE(…)` — read-only. */
  savedTuplePreview: string;
  /** Triples the saved data graph holds — read-only, and lazily fetched. */
  savedDataPreview: string;
  savingTuples?: boolean;
  savingData?: boolean;
  savingTest?: boolean;
  /**
   * Whether this build offers tests at all. Off takes the button away rather
   * than disabling it: a door into a switched-off feature is absent, which is
   * the rule the rail section and the Tests tab already follow.
   */
  testsEnabled?: boolean;
  /**
   * Whether this build draws the **Tuples** and **Data** rail sections.
   *
   * These are inputs, not features (see `useInputSections`), so a closed
   * section takes nothing away from a run: both pickers stay, both saved
   * previews stay, and a rule set that pins a version keeps working — the
   * server serves these entities whatever the flag says. What goes is the pair
   * of controls that *lead* to the section: `Save to …`, which would author a
   * record in a section you cannot open, and `Open in …`, which would land on
   * the "feature is disabled" panel. Absent rather than disabled, the same
   * rule `Save as test` follows (`docs/reference/feature-flags.md`).
   *
   * Inline stays either way, which is what makes removing them safe: rows and
   * triples typed here run without ever being saved.
   */
  tupleSetSectionOpen?: boolean;
  dataGraphSectionOpen?: boolean;
  /** Blocked when there is nothing to promote, or no library to promote into. */
  testDisabledReason?: string | null;
  /** The data graph box's language and skin. */
  editorExtensions?: Extension[];
  /**
   * The seed-rows box's, which is a different language: those rows are SRL,
   * the graph beside them is Turtle. Falls back to `editorExtensions` so a
   * caller that has only one skin still gets a consistent pair of boxes.
   */
  tupleEditorExtensions?: Extension[];
  /**
   * The `TUPLE(…)` declarations this rule set's document holds, in order.
   *
   * Passed in rather than parsed here: the panel is given a rendering of the
   * rows, not the SRL document they came out of. Empty means the document
   * declares no shape to fill, and the note below is silent rather than
   * guessing at one.
   */
  tupleDeclarations?: string[][];
}>(), {
  tuplesEnabled: true,
  savingTuples: false,
  savingData: false,
  savingTest: false,
  testsEnabled: true,
  tupleSetSectionOpen: true,
  dataGraphSectionOpen: true,
  testDisabledReason: null,
  editorExtensions: () => [],
  tupleEditorExtensions: () => [],
  tupleDeclarations: () => [],
});

const emit = defineEmits<{
  (e: 'save-to-tuples'): void;
  (e: 'save-to-data'): void;
  (e: 'save-as-test'): void;
  (e: 'open-tuple-set', tupleSetId: string): void;
  (e: 'open-data-graph', graphId: string): void;
}>();

const tupleSource = defineModel<InputSource>('tupleSource', { default: 'inline' });
const tupleSetVersionId = defineModel<string | null>('tupleSetVersionId', { default: null });
const inlineTuples = defineModel<string>('inlineTuples', { default: '' });

const dataSource = defineModel<InputSource>('dataSource', { default: 'inline' });
const dataGraphVersionId = defineModel<string | null>('dataGraphVersionId', { default: null });
const dataGraphInline = defineModel<string>('dataGraphInline', { default: '' });
const dataGraphInlineFormat = defineModel<DataGraphFormat>('dataGraphInlineFormat', { default: 'text/turtle' });

/*
 * Both pickers name saved entities, so both are fuzzy-filtered rather than
 * native: a library with fifty data graphs made the old `<select>` a scroll.
 * The version is part of the label because the value is a version id — two
 * rows can carry the same name.
 */
const tupleSetSelectOptions = computed(() =>
  props.tupleSetOptions.map((option) => ({
    value: option.versionId,
    label: `${option.name} · v${option.version}`,
  })),
);
const dataGraphSelectOptions = computed(() =>
  props.dataGraphOptions.map((option) => ({
    value: option.versionId,
    label: `${option.name} · v${option.version}`,
  })),
);

const selectedTupleSet = computed(
  () => props.tupleSetOptions.find((option) => option.versionId === tupleSetVersionId.value) ?? null,
);
const selectedDataGraph = computed(
  () => props.dataGraphOptions.find((option) => option.versionId === dataGraphVersionId.value) ?? null,
);

/**
 * What binding this tuple set to this document's shape is worth saying.
 *
 * The only place a column name has any consequence at all — and the consequence
 * is a sentence, never a decision: matching is positional, and nothing reads
 * `columns`. Absent when there is no saved set chosen or no declaration to
 * judge against; the first declaration is the one judged, because a rule set
 * with several shapes is asking a question this picker cannot answer.
 */
const tupleBindNoticeLine = computed(() => {
  if (tupleSource.value !== 'saved') return null;
  const set = selectedTupleSet.value;
  const declaration = props.tupleDeclarations[0];
  if (!set || !declaration || declaration.length === 0) return null;
  return tupleBindNotice(set.columns, declaration);
});

const tupleBody = computed(() =>
  tupleSource.value === 'saved' ? props.savedTuplePreview : inlineTuples.value,
);
const dataBody = computed(() =>
  dataSource.value === 'saved' ? props.savedDataPreview : dataGraphInline.value,
);

const countLine = (text: string) => text.split('\n').filter((line) => line.trim().length > 0).length;

const tupleCount = computed(() => {
  if (tupleSource.value === 'saved') {
    const rows = selectedTupleSet.value ? countLine(props.savedTuplePreview) : 0;
    return `${rows} ${rows === 1 ? 'row' : 'rows'}`;
  }
  const rows = countLine(inlineTuples.value);
  return `${rows} ${rows === 1 ? 'row' : 'rows'}`;
});

const dataCount = computed(() => {
  if (dataSource.value === 'saved') return selectedDataGraph.value?.detail ?? 'nothing selected';
  const lines = countLine(dataGraphInline.value);
  return `${lines} ${lines === 1 ? 'line' : 'lines'}`;
});

/*
 * Read-only when saved, editable when inline — the same box either way, since
 * it holds the same text. A saved version is immutable by design, so showing it
 * in an editable box would be offering an edit that cannot land. The language
 * is passed in rather than fixed here, because the two boxes hold two of them.
 */
const bodyExtensions = (language: Extension[], readOnly: boolean) => [
  ...language,
  EditorView.lineWrapping,
  ...(readOnly ? [EditorState.readOnly.of(true)] : []),
];

const tupleLanguage = computed(() =>
  props.tupleEditorExtensions.length > 0 ? props.tupleEditorExtensions : props.editorExtensions,
);

const tupleExtensions = computed(() =>
  bodyExtensions(tupleLanguage.value, tupleSource.value === 'saved'),
);
const dataExtensions = computed(() =>
  bodyExtensions(props.editorExtensions, dataSource.value === 'saved'),
);

const canSaveTuples = computed(() => inlineTuples.value.trim().length > 0);
const canSaveData = computed(() => dataGraphInline.value.trim().length > 0);

/*
 * Typing only writes back on the Inline side. The Saved side is showing an
 * immutable version, so an edit there would be an edit that cannot land — the
 * editor is read-only for that reason, and this is the belt to its braces.
 */
const onTupleInput = (value: string) => {
  if (tupleSource.value === 'inline') inlineTuples.value = value;
};

const onDataInput = (value: string) => {
  if (dataSource.value === 'inline') dataGraphInline.value = value;
};
</script>

<template>
  <div class="inputs-pane" data-testid="rules-inputs">
    <!--
      The strip states the one thing the tab is for, and hands the rest to a
      `?`. `Save as test` sits here rather than beside either block because it
      promotes the *pair* with the rule set — no half of it is a test.
    -->
    <div class="not-part-strip">
      <span class="strip-note">Not part of the rule set</span>
      <button class="help-dot" type="button" tabindex="-1" :title="HEADER_HELP">
        <HelpCircle :size="12" />
      </button>
      <button
        v-if="testsEnabled"
        class="save-test"
        type="button"
        data-testid="save-as-test"
        :disabled="savingTest || Boolean(testDisabledReason)"
        :title="testDisabledReason ?? 'Keep this rule set with these inputs as a Test, with the expectation left for you to fill in'"
        @click="emit('save-as-test')"
      >
        <CircleCheck :size="12" />{{ savingTest ? 'Saving…' : 'Save as test' }}
      </button>
    </div>

    <div class="blocks">
      <!-- Named tuples — only where the extension makes them readable -->
      <section v-if="tuplesEnabled" class="input-block tuples" data-testid="inputs-tuples">
        <header class="block-header">
          <Table :size="13" class="block-icon" />
          <SectionLabel>Named tuples</SectionLabel>
          <span class="block-count">{{ tupleCount }}</span>
        </header>

        <div class="block-controls">
          <div class="mode-toggle" role="group" aria-label="Named tuples source">
            <button
              class="mode"
              type="button"
              :class="{ on: tupleSource === 'saved' }"
              :aria-pressed="tupleSource === 'saved'"
              data-testid="tuples-source-saved"
              title="Use a tuple set saved under Tuples"
              @click="tupleSource = 'saved'"
            >Saved</button>
            <button
              class="mode"
              type="button"
              :class="{ on: tupleSource === 'inline' }"
              :aria-pressed="tupleSource === 'inline'"
              data-testid="tuples-source-inline"
              title="Type rows here without saving them"
              @click="tupleSource = 'inline'"
            >Inline</button>
          </div>

          <template v-if="tupleSource === 'saved'">
            <SearchSelect
              class="entity-picker"
              test-id="tuples-picker"
              aria-label="Tuple set"
              placeholder="Choose a tuple set…"
              empty-label="Choose a tuple set…"
              :model-value="tupleSetVersionId"
              :options="tupleSetSelectOptions"
              @update:model-value="(value) => (tupleSetVersionId = value || null)"
            />
            <!-- A door into Tuples: gone where that section is not drawn. -->
            <button
              v-if="tupleSetSectionOpen"
              class="icon-button"
              type="button"
              data-testid="open-in-tuples"
              title="Open in Tuples"
              :disabled="!selectedTupleSet"
              @click="selectedTupleSet && emit('open-tuple-set', selectedTupleSet.tupleSetId)"
            >
              <ExternalLink :size="12" />
            </button>
          </template>

          <template v-else>
            <span class="scratch-marker">unsaved · scratch</span>
            <button
              v-if="tupleSetSectionOpen"
              class="save-button"
              type="button"
              data-testid="save-to-tuples"
              :disabled="!canSaveTuples || savingTuples"
              title="Save these rows to the library as a tuple set, so a run can name its version"
              @click="emit('save-to-tuples')"
            >
              <Save :size="12" />{{ savingTuples ? 'Saving…' : 'Save to Tuples' }}
            </button>
          </template>
        </div>

        <!--
          Column names are labels. Said here because this is where a person is
          looking at a table's headers and a declaration's variables at the same
          time, which is exactly where they would assume the two are matched by
          name.
        -->
        <InlineNote
          v-if="tupleBindNoticeLine"
          class="bind-note"
          :tone="tupleBindNoticeLine.level === 'info' ? 'muted' : 'danger'"
          size="xs"
          :data-testid="`tuple-bind-${tupleBindNoticeLine.level}`"
        >{{ tupleBindNoticeLine.message }}</InlineNote>

        <div class="block-body tuples-body">
          <Codemirror
            :model-value="tupleBody"
            placeholder="TUPLE(:reach, :a, :b)"
            :style="{ height: '100%' }"
            :extensions="tupleExtensions"
            @update:model-value="onTupleInput"
          />
        </div>
      </section>

      <!-- Data graph -->
      <section class="input-block data" data-testid="inputs-data">
        <header class="block-header">
          <Database :size="13" class="block-icon" />
          <SectionLabel>Data graph</SectionLabel>
          <span class="block-count">{{ dataCount }}</span>
        </header>

        <div class="block-controls">
          <div class="mode-toggle" role="group" aria-label="Data graph source">
            <button
              class="mode"
              type="button"
              :class="{ on: dataSource === 'saved' }"
              :aria-pressed="dataSource === 'saved'"
              data-testid="data-source-saved"
              title="Pick a saved data graph"
              @click="dataSource = 'saved'"
            >Saved</button>
            <button
              class="mode"
              type="button"
              :class="{ on: dataSource === 'inline' }"
              :aria-pressed="dataSource === 'inline'"
              data-testid="data-source-inline"
              title="Type triples here without saving them"
              @click="dataSource = 'inline'"
            >Inline</button>
          </div>

          <template v-if="dataSource === 'saved'">
            <SearchSelect
              class="entity-picker"
              test-id="data-picker"
              aria-label="Data graph"
              placeholder="Choose a data graph…"
              empty-label="Choose a data graph…"
              :model-value="dataGraphVersionId"
              :options="dataGraphSelectOptions"
              @update:model-value="(value) => (dataGraphVersionId = value || null)"
            />
            <!-- A door into Data: gone where that section is not drawn. -->
            <button
              v-if="dataGraphSectionOpen"
              class="icon-button"
              type="button"
              data-testid="open-in-data"
              title="Open in Data"
              :disabled="!selectedDataGraph"
              @click="selectedDataGraph && emit('open-data-graph', selectedDataGraph.graphId)"
            >
              <ExternalLink :size="12" />
            </button>
          </template>

          <template v-else>
            <span class="scratch-marker">unsaved · scratch</span>
            <select
              class="format-picker"
              data-testid="data-format"
              :value="dataGraphInlineFormat"
              @change="dataGraphInlineFormat = ($event.target as HTMLSelectElement).value as DataGraphFormat"
            >
              <option v-for="format in DATA_GRAPH_FORMATS" :key="format.value" :value="format.value">
                {{ format.label }}
              </option>
            </select>
            <!-- Shows itself only for a format it has a grammar for. -->
            <PrefixConversionButtons
              :code="dataBody"
              :content-type="dataGraphInlineFormat"
              @update:code="onDataInput"
            />
            <button
              v-if="dataGraphSectionOpen"
              class="save-button"
              type="button"
              data-testid="save-to-data"
              :disabled="!canSaveData || savingData"
              title="Save this content to the library as a data graph, so a run can name its version"
              @click="emit('save-to-data')"
            >
              <Save :size="12" />{{ savingData ? 'Saving…' : 'Save to Data' }}
            </button>
          </template>
        </div>

        <div class="block-body data-body">
          <Codemirror
            :model-value="dataBody"
            placeholder="ex:Alice foaf:knows ex:Bob ."
            :style="{ height: '100%' }"
            :extensions="dataExtensions"
            @update:model-value="onDataInput"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inputs-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.not-part-strip {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.strip-note {
  color: var(--ink-secondary);
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

.save-test {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h-sm);
  margin-left: auto;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  cursor: pointer;
}

.save-test:disabled {
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.blocks {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.input-block {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/*
 * Tuples are a handful of rows and a graph is a document, so the split is not
 * even: tuples take what they need and the graph takes the rest.
 */
.input-block.tuples {
  flex: 0 0 auto;
  max-height: 40%;
  border-bottom: 1px solid var(--border-default);
}

.input-block.data {
  flex: 1;
}

.block-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-4);
  height: var(--control-h);
  padding: 0 var(--space-5);
}

.block-icon {
  color: var(--ink-secondary);
}

.block-count {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.block-controls {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-5) var(--space-4);
}

/*
 * A mode switch, not a primary control: no border, no fill on the inactive
 * side, and a pale chip on the active one. It changes where the rows come
 * from; it is not the thing you came to the tab to press.
 */
.mode-toggle {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
}

.mode {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.mode.on {
  background: var(--surface-sunken);
  color: var(--ink);
  font-weight: var(--weight-semibold);
}

.format-picker {
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
}

/*
 * The chooser paints itself (see `SearchSelect`), so this only places it in the
 * row — a scoped rule here could not reach the input inside it anyway.
 */
.entity-picker {
  flex: 1;
  min-width: 0;
}

.format-picker {
  flex-shrink: 0;
  min-width: var(--grid-3);
}

.icon-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
}

.icon-button:disabled {
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.scratch-marker {
  overflow: hidden;
  flex: 1;
  min-width: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
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

.save-button:disabled {
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.block-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid var(--border-subtle);
}

.tuples-body {
  min-height: var(--grid-2);
}

/* Margin stays with the parent: where a note sits is a fact about this block. */
.bind-note {
  margin: 0;
  padding: var(--space-1) var(--space-2);
  border-top: 1px solid var(--border-subtle);
}
</style>
