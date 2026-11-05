<template>
  <div
    class="value-field"
    :class="{
      'value-field--blank': isBlank,
      'value-field--json': isJson,
      'value-field--invalid': isJson && jsonError,
    }"
  >
    <!--
      An rdf:JSON literal is a document, not a line: it gets a JSON editor
      that can lay the same text out compact or expanded, and pop out over the
      page when even expanded is too long for a row.
    -->
    <ExpandableEditor
      v-if="isJson"
      :id="regionId"
      :title="`?${variable} · rdf:JSON`"
      testid="argument-json-expand"
      :run-strip="false"
      @update:expanded="onPopOut"
    >
      <template #default="{ expanded }">
        <CodeEditor
          class="json-editor"
          :class="`json-editor--${layout}`"
          :model-value="draft"
          content-type="application/json"
          :show-line-numbers="false"
          :placeholder="placeholder"
          :read-only="disabled"
          :wrap="layout === 'compact'"
          :expanded="expanded"
          min-height="24px"
          :max-height="layout === 'expanded' ? '360px' : '96px'"
          test-id="argument-json"
          @update:model-value="setJsonText"
        />
      </template>
      <template #header-end>
        <JsonLayoutToggle v-model="layout" :invalid="Boolean(jsonError)" />
      </template>
    </ExpandableEditor>
    <input
      v-else
      type="text"
      class="value-input"
      data-testid="argument-value"
      :value="value.value"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="setLexical(($event.target as HTMLInputElement).value)"
    />

    <div class="value-side">
      <template v-if="isJson">
        <span
          v-if="jsonError"
          class="json-invalid"
          data-testid="argument-json-invalid"
          :title="jsonError"
        >
          <CircleAlert :size="12" /> Invalid JSON
        </span>
        <JsonLayoutToggle v-model="layout" :invalid="Boolean(jsonError)" />
        <button
          type="button"
          class="side-button"
          data-testid="argument-json-popout"
          :title="`Expand ?${variable} — Esc to come back`"
          :aria-label="`Expand ?${variable}`"
          @click="popOut"
        >
          <Expand :size="12" />
        </button>
      </template>

      <!--
        Term type moves inside the field it types, rather than sitting beside it
        as two more selects per cell. A cell is one control again, and the type
        is on the button that shows it (design §4).
      -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="type-button"
            :class="{ 'type-button--literal': value.type === 'literal' }"
            :disabled="disabled"
            :title="`Term type · ?${variable}`"
          >
            {{ typeLabel }}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="type-menu">
          <TermTypeMenuItems :value="value" :variable="variable" @update="emit('update', $event)" />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CircleAlert, Expand } from '@lucide/vue';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import CodeEditor from '../shared/CodeEditor.vue';
import ExpandableEditor from '../shared/ExpandableEditor.vue';
import JsonLayoutToggle from './JsonLayoutToggle.vue';
import TermTypeMenuItems from './TermTypeMenuItems.vue';
import { RDF_JSON, type SparqlValue } from '@/types/argument-sets';
import { isUndef, termPlaceholder, termTypeLabel } from '@/lib/argumentTerms';
import { compactJson, layoutJson, parseJson, type JsonLayout } from '@/lib/jsonText';
import { nextEditorExpandId, useEditorExpand } from '@/composables/useEditorExpand';

/**
 * One cell of a VALUES row: its lexical form and the term type that reads it.
 *
 * Blank is a real value here — it binds UNDEF — so the field renders empty
 * rather than refusing to be empty, and the export drops it (see `pruneUndef`).
 */
const props = defineProps<{
  value: SparqlValue;
  variable: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [value: SparqlValue];
}>();

const isBlank = computed(() => isUndef(props.value));
const typeLabel = computed(() => termTypeLabel(props.value));
const placeholder = computed(() => termPlaceholder(props.value));

function setLexical(next: string) {
  emit('update', { ...props.value, value: next });
}

/*
 * rdf:JSON. The layout is a view: what is stored, and sent, is always the
 * compact text whenever the draft parses, so switching to expanded never
 * changes the argument. The draft is kept apart from the stored value so the
 * editor does not reflow under the cursor on every keystroke.
 */
const isJson = computed(() => props.value.type === 'literal' && props.value.datatype === RDF_JSON);

const layout = ref<JsonLayout>('compact');
const draft = ref('');
let lastEmitted: string | null = null;

function laidOut(text: string): string {
  return text.trim() && parseJson(text).ok ? layoutJson(text, layout.value) : text;
}

watch(
  () => [props.value.value, isJson.value] as const,
  ([stored]) => {
    if (stored === lastEmitted) return;
    draft.value = laidOut(stored);
  },
  { immediate: true },
);

watch(layout, () => {
  draft.value = laidOut(draft.value);
});

const jsonError = computed(() => {
  if (!isJson.value || !draft.value.trim()) return null;
  const check = parseJson(draft.value);
  return check.ok ? null : check.message;
});

function setJsonText(text: string) {
  draft.value = text;
  const stored = text.trim() && parseJson(text).ok ? compactJson(text) : text;
  lastEmitted = stored;
  emit('update', { ...props.value, value: stored });
}

/*
 * Popped out, the text is read as a document, so it opens expanded; closing
 * gives back whichever layout the row had.
 */
const expand = useEditorExpand();
const regionId = nextEditorExpandId('argument-json');
let layoutBeforePopOut: JsonLayout | null = null;

function popOut() {
  expand.expand(regionId);
}

function onPopOut(expanded: boolean) {
  if (expanded) {
    layoutBeforePopOut = layout.value;
    layout.value = 'expanded';
  } else if (layoutBeforePopOut) {
    layout.value = layoutBeforePopOut;
    layoutBeforePopOut = null;
  }
}
</script>

<style scoped>
.value-field {
  display: flex;
  align-items: stretch;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
}

.value-field:focus-within {
  border-color: var(--action);
}

.value-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: var(--space-1) var(--space-3);
  border: none;
  background: transparent;
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.value-input:focus {
  outline: none;
}

.value-input:disabled {
  cursor: not-allowed;
}

/* Blank means UNDEF, and UNDEF should look deliberate rather than unfinished. */
.value-field--blank {
  border-style: dashed;
}

.type-button {
  flex-shrink: 0;
  min-width: 34px;
  padding: 0 var(--space-3);
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.type-button:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--ink);
}

.type-button--literal {
  color: var(--violet-500);
}

.type-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.type-menu {
  min-width: 190px;
}

.value-side {
  display: flex;
  flex-shrink: 0;
  align-items: stretch;
}

/*
 * JSON: the controls go on a strip above the text rather than beside it, so
 * the text keeps the field's whole width even in a narrow panel.
 */
.value-field--json {
  flex-direction: column;
}

.value-field--json .value-side {
  order: -1;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding-left: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
}

.value-field--json .value-side > :deep(.json-layout) {
  align-self: center;
}

.value-field--json .type-button {
  height: var(--control-h-sm);
}

.side-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
}

.side-button:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

.json-invalid {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: auto;
  color: var(--danger);
  font-size: var(--text-micro);
  white-space: nowrap;
}

.value-field--invalid,
.value-field--invalid:focus-within {
  border-color: var(--danger);
}

/* The field draws the border; the editor inside it is just the text. */
.json-editor {
  flex: 1;
  min-width: 0;
}

.json-editor :deep(.code-editor) {
  border: none;
  border-radius: 0;
}

.json-editor :deep(.cm-content) {
  padding: var(--space-1) 0;
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.json-editor :deep(.cm-editor .cm-line.cm-activeLine) {
  background: transparent;
}
</style>
