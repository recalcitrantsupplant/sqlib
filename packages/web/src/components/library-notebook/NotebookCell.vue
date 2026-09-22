<template>
  <section :id="`q-${slug}`" class="cell" :data-testid="`notebook-cell-${slug}`">
    <header class="cell__head">
      <h2 class="cell__name">{{ slug }}</h2>
      <Badge variant="secondary" class="cell__kind">{{ query.queryType }}</Badge>
      <span
        v-for="tag in resolvedTags"
        :key="tag.id"
        class="tag-chip"
        :style="{ background: tag.color, color: tag.ink }"
      >{{ tag.name }}</span>

      <!--
        To edit, you leave. The notebook never mutates a query; it points at the
        screens that do (design doc §2.6).
      -->
      <div class="cell__links">
        <NuxtLink v-if="query.sourceQuery" :to="editorLink" class="cell__link">
          <Pencil :size="12" /> Open in editor
        </NuxtLink>
        <NuxtLink v-if="query.sourceQuery" :to="testsLink" class="cell__link">
          <CircleCheck :size="12" /> Tests
        </NuxtLink>
      </div>
    </header>

    <div class="cell__body">
      <p v-if="query.description" class="cell__desc">{{ query.description }}</p>

      <p class="signature">
        <span class="signature__label">Signature</span>
        <span v-for="(part, index) in signature" :key="index" class="signature__part">{{ part }}</span>
      </p>

      <div v-if="(query.examples ?? []).length > 0" class="examples">
        <span class="examples__label">Examples</span>
        <button
          v-for="(example, index) in query.examples"
          :key="index"
          type="button"
          class="example"
          :data-testid="`notebook-example-${index}`"
          :aria-pressed="activeExample === index"
          @click="loadExample(index)"
        >
          {{ example.name }}
          <Badge
            v-if="example.dataDependent"
            variant="outline"
            class="example__seeded"
            data-testid="notebook-example-seeded"
            title="From a test with its own seed data: the arguments are real, the recorded result does not hold against another backend."
          >seeded</Badge>
        </button>
      </div>

      <!--
        The same element the exported page uses, so the builder a person learns
        in one is the builder they use in the other. It is light DOM by design,
        which is what lets the app dress it in its own tokens — see the
        `:deep(.sqlib-args__*)` block below, and the note in args-element.ts.
      -->
      <section class="args">
        <PanelHeader title="Arguments" sunken />
        <div class="args__body">
          <sqlib-args ref="argsEl" @change="onArgsChange" />
        </div>
      </section>

      <!--
        One query pane, and a toggle for which document it holds.

        The template and the substituted query were side by side, on the
        reasoning that the pair is what the page teaches. Two half-width panes
        wrap SPARQL that a full-width one fits, and the second is a copy of the
        first with one line changed — so the comparison cost every reader half
        the width of every query, to show a difference most of them were not
        looking for. Swapping in place puts the whole width behind whichever
        document is being read, and the toggle is one click for the reader who
        does want to see what the arguments did.

        The toggle is absent when there is nothing to substitute: a query with
        no slots, no examples and no arguments typed in has one document, and
        offering a second view of it is a control that does nothing.

        The pane is a `CodePeek` for the reason that component exists: a
        library page is a column of these cells, and a pane sized to its query
        makes the page's shape a function of which queries happen to be long.
        Eight lines, prologue hidden — the prefixes are the same in every query
        in the library — and the whole document one click away.
      -->
      <div class="query">
        <div v-if="canSubstitute" class="query__views">
          <SegmentedToggle
            :model-value="queryView"
            :options="QUERY_VIEWS"
            group-label="Show the query as"
            @update:model-value="queryView = $event as QueryView"
          />
        </div>

        <!--
          The substitution error sits above the pane rather than inside it, and
          shows in either view: it is the reason Run is disabled, which is a
          fact about the cell rather than about the document being read.
        -->
        <p v-if="previewError" class="pane__error" data-testid="notebook-preview-error">
          {{ previewError }}
        </p>

        <CodePeek
          v-if="queryView === 'template'"
          label="Template"
          :content="templateText"
          content-type="application/sparql-query"
          :collapsed-lines="8"
          test-id="notebook-template"
        />
        <CodePeek
          v-else-if="!previewError"
          label="Substituted"
          :content="previewText ?? ''"
          content-type="application/sparql-query"
          :collapsed-lines="8"
          empty="Nothing substituted yet."
          test-id="notebook-substituted"
        />
      </div>

      <div class="runbar">
        <Button size="sm" data-testid="notebook-run" :disabled="!canRun || running" @click="run">
          <Play :size="12" />
          {{ running ? 'Running…' : 'Run' }}
        </Button>
        <Button size="sm" variant="outline" data-testid="notebook-reset" @click="reset">
          Reset to example
        </Button>
        <span class="runbar__status">{{ status }}</span>
        <Button
          v-if="canWrite && lastResult"
          size="sm"
          variant="outline"
          class="runbar__save"
          data-testid="notebook-save-as-test"
          @click="$emit('save-as-test', { slug, payload: lastPayload, result: lastResult })"
        >
          <ClipboardCheck :size="12" /> Save as test…
        </Button>
      </div>

      <p v-if="runError" class="run-error" data-testid="notebook-run-error">{{ runError }}</p>

      <div v-if="rows.length > 0" class="result" data-testid="notebook-result">
        <DataTable
          :columns="columns"
          :data="rows"
          :enable-filters="false"
          empty-state-text="No rows."
        />
      </div>
      <CodePeek
        v-else-if="scalarResult"
        label="Result"
        :content="scalarResult"
        :content-type="scalarContentType"
        :collapsed-lines="8"
      />

      <template v-if="expectedExamples.length > 0">
        <SectionLabel class="recorded-label">
          Recorded results from the library's tests — reference only, not assertions
        </SectionLabel>
        <CodePeek
          v-for="(example, index) in expectedExamples"
          :key="index"
          :label="example.name"
          :content="example.expected"
          :content-type="example.expectedFormat ?? 'application/json'"
          :collapsed-lines="6"
        />
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { CircleCheck, ClipboardCheck, Pencil, Play } from '@lucide/vue';
import {
  describeTerm,
  prefixTableAbbreviator,
  type ExportedQuery,
} from '@sparql-query-lib/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DataTable from '@/components/ui/table/DataTable.vue';
import { useTermDisplay } from '@/composables/useTermDisplay';
import CodePeek from '@/components/shared/CodePeek.vue';
import PanelHeader from '@/components/shared/PanelHeader.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import type { DataTableColumnDef } from '@/composables/useDataTable';
import type { DecoratedTag } from '@/lib/tagPalette';

const props = defineProps<{
  slug: string;
  query: ExportedQuery;
  canWrite: boolean;
  /** Resolved library tags, so a chip reads `geo` rather than its IRI's hash. */
  tagsById: Map<string, DecoratedTag>;
  /** Substitutes a payload, or explains why it does not fit. */
  preview: (slug: string, payload: unknown) => { text: string | null; error: string | null };
  /** Runs the payload through the API, so the server substitutes canonically. */
  execute: (slug: string, payload: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
}>();

defineEmits<{
  (e: 'save-as-test', value: { slug: string; payload: unknown; result: unknown }): void;
}>();

interface ArgsElement extends HTMLElement {
  signature: { inputs: string[][]; limits?: string[]; offsets?: string[] };
  payload: unknown;
  valid: boolean;
}

const argsEl = ref<ArgsElement | null>(null);
const activeExample = ref<number | null>(null);
const previewText = ref<string | null>(null);
const previewError = ref<string | null>(null);
const argsValid = ref(true);
const running = ref(false);
const runError = ref<string | null>(null);
const status = ref('');
const lastResult = ref<unknown>(null);
const lastPayload = ref<unknown>(null);

/** A tag the library no longer has is dropped rather than shown as an IRI. */
const resolvedTags = computed(() =>
  (props.query.tags ?? []).map((id) => props.tagsById.get(id)).filter((tag): tag is DecoratedTag => !!tag),
);

const signature = computed(() => {
  const parts = props.query.inferredInputs.map(
    (vars, index) => `slot ${index + 1}: ${vars.map((v) => `?${v}`).join(', ')}`,
  );
  if (parts.length === 0) parts.push('no arguments');
  if (props.query.limitParameters.length > 0) parts.push(`limit ${props.query.limitParameters.join(', ')}`);
  if (props.query.offsetParameters.length > 0) parts.push(`offset ${props.query.offsetParameters.join(', ')}`);
  return parts;
});

/**
 * The template as the author wrote it.
 *
 * `template.text` carries a marker IRI in each slot — that is how the compiler
 * found the span — and showing it raw reads as noise. The all-UNDEF spelling is
 * valid SPARQL and the one anyone who has parameterised a query recognises.
 */
const templateText = computed(() => {
  let out = '';
  let cursor = 0;
  for (const slot of props.query.template.slots) {
    const vars = slot.vars.map((name) => `?${name}`);
    out +=
      props.query.template.text.slice(cursor, slot.start) +
      (vars.length === 1
        ? `VALUES ${vars[0]} { UNDEF }`
        : `VALUES( ${vars.join(' ')} ){ ( ${vars.map(() => 'UNDEF').join(' ')} ) }`);
    cursor = slot.end;
  }
  return out + props.query.template.text.slice(cursor);
});

const expectedExamples = computed(() => (props.query.examples ?? []).filter((e) => e.expected));

type QueryView = 'template' | 'substituted';

const QUERY_VIEWS = [
  { value: 'template', label: 'Template', testId: 'notebook-view-template' },
  { value: 'substituted', label: 'Substituted', testId: 'notebook-view-substituted' },
] as const;

/** Which document the pane holds. The template, until a reader asks otherwise. */
const queryView = ref<QueryView>('template');

/** Whether any part of the query is filled in from arguments. */
const hasSlots = computed(
  () =>
    props.query.template.slots.length > 0 ||
    props.query.limitParameters.length > 0 ||
    props.query.offsetParameters.length > 0,
);

/**
 * Whether the reader has typed a value into the builder.
 *
 * The skeleton payload is a wildcard row per slot — bindings with no terms in
 * them — so "there is a payload" is not the question; "is there a value in it"
 * is. Limits and offsets count: they substitute into the query too.
 */
const hasInlineArguments = computed(() => {
  const payload = lastPayload.value as
    | {
        arguments?: Array<{ arguments?: { bindings?: Array<Record<string, unknown>> } }>;
        limits?: Record<string, unknown>;
        offsets?: Record<string, unknown>;
      }
    | null;
  if (!payload) return false;
  if (Object.keys(payload.limits ?? {}).length > 0) return true;
  if (Object.keys(payload.offsets ?? {}).length > 0) return true;
  return (payload.arguments ?? []).some((set) =>
    (set.arguments?.bindings ?? []).some((binding) => Object.keys(binding).length > 0),
  );
});

/**
 * Whether a substituted view is worth offering.
 *
 * A query with no slots, no examples and nothing typed in substitutes to
 * itself, and a toggle between a document and a copy of it is a control that
 * does nothing.
 */
const canSubstitute = computed(
  () => hasSlots.value || (props.query.examples ?? []).length > 0 || hasInlineArguments.value,
);

/* A cell that loses its arguments loses the view of them with it. */
watch(canSubstitute, (can) => {
  if (!can) queryView.value = 'template';
});

const canRun = computed(() => argsValid.value && !previewError.value);

/** A wildcard row per slot: the runtime drops the slot, so a fresh cell runs. */
function skeletonPayload(): unknown {
  return {
    arguments: props.query.inferredInputs.map((vars) => ({
      head: { vars: [...vars] },
      arguments: { bindings: [{}] },
    })),
  };
}

function examplePayload(index: number): unknown {
  const example = props.query.examples?.[index];
  if (!example) return skeletonPayload();
  const payload: Record<string, unknown> = { arguments: example.arguments };
  const toMap = (list: Array<{ name: string; value: number }>) =>
    Object.fromEntries(list.map((entry) => [entry.name, entry.value]));
  if (example.limits?.length) payload.limits = toMap(example.limits);
  if (example.offsets?.length) payload.offsets = toMap(example.offsets);
  return payload;
}

function setPayload(payload: unknown) {
  if (argsEl.value) argsEl.value.payload = payload;
  refresh(payload);
}

function loadExample(index: number) {
  activeExample.value = index;
  setPayload(examplePayload(index));
}

function reset() {
  const hasExamples = (props.query.examples ?? []).length > 0;
  activeExample.value = hasExamples ? 0 : null;
  setPayload(hasExamples ? examplePayload(0) : skeletonPayload());
}

function refresh(payload: unknown) {
  lastPayload.value = payload;
  const result = props.preview(props.slug, payload);
  previewText.value = result.text;
  previewError.value = result.error;
}

/**
 * The builder's own change event — and only it.
 *
 * `<sqlib-args>` renders its form into its light DOM, so every native `change`
 * from an input inside it bubbles up to this same listener. Those carry no
 * `detail`, and taking them meant substituting `undefined` and painting the
 * mismatch error every time a field lost focus — including on the way to the
 * Reset button, whose click then landed on a page the error had already
 * reflowed.
 */
function onArgsChange(event: Event) {
  const detail = (event as CustomEvent<{ payload: unknown; valid: boolean }>).detail;
  if (!detail || detail.payload === undefined) return;
  argsValid.value = detail.valid ?? true;
  refresh(detail.payload);
}

async function run() {
  running.value = true;
  runError.value = null;
  status.value = '';
  lastResult.value = null;
  const started = performance.now();

  const result = await props.execute(props.slug, lastPayload.value);
  const ms = Math.round(performance.now() - started);
  running.value = false;

  if (!result.ok) {
    runError.value = result.error ?? 'Execution failed.';
    status.value = 'failed';
    return;
  }
  lastResult.value = result.data;
  status.value = `ran in ${ms} ms${rows.value.length ? ` · ${rows.value.length} rows` : ''}`;
}

const abbreviate = computed(() => prefixTableAbbreviator(props.query.template.prefixes ?? []));

const resultVars = computed<string[]>(() => {
  const payload = lastResult.value as { head?: { vars?: string[] } } | null;
  return payload?.head?.vars ?? [];
});

/**
 * One cell's term, held in both spellings so the column can be switched
 * between them without re-describing every row. `full` is set only where the
 * display is actually hiding an IRI.
 */
type NotebookTerm = {
  display: string;
  full: string | null;
  suffix: string;
  suffixFull: string;
};

const rows = computed<Array<Record<string, NotebookTerm>>>(() => {
  const payload = lastResult.value as
    | { results?: { bindings?: Array<Record<string, unknown>> } }
    | null;
  const bindings = payload?.results?.bindings ?? [];
  // Described once, here, with the same rules the exported page uses.
  return bindings.map((binding) =>
    Object.fromEntries(
      resultVars.value.map((name) => {
        const term = binding[name] as { datatype?: string } | undefined;
        const described = describeTerm(binding[name] as never, { abbreviate: abbreviate.value });
        const suffix = described.language
          ? `@${described.language}`
          : described.datatype
            ? `^^${described.datatype}`
            : '';
        const suffixFull = described.language
          ? `@${described.language}`
          : described.datatype && term?.datatype
            ? `^^${term.datatype}`
            : suffix;
        return [name, { display: described.display, full: described.fullIri, suffix, suffixFull }];
      }),
    ),
  );
});

/*
 * Term display follows the same browser-wide switch the result tables do. The
 * prefixes are the query's own, not the prefix manager's, so what it switches
 * between here is this query's prologue and the IRIs behind it.
 */
const { isPrefixed } = useTermDisplay();

/** What one cell reads as, in the spelling every table is set to. */
const termText = (term: NotebookTerm): string =>
  isPrefixed.value || !term.full
    ? `${term.display}${term.suffix}`
    : `${term.full}${term.suffixFull}`;

/** ASK and CONSTRUCT have no rows to tabulate. */
const scalarResult = computed(() => {
  const payload = lastResult.value as { boolean?: boolean; data?: string } | null;
  if (!payload) return null;
  if (typeof payload.boolean === 'boolean') return String(payload.boolean);
  if (typeof lastResult.value === 'string') return lastResult.value as string;
  if (typeof payload.data === 'string') return payload.data;
  return null;
});

const scalarContentType = computed(() =>
  props.query.queryType === 'ASK' ? 'text/plain' : 'text/turtle',
);

const columns = computed<DataTableColumnDef<Record<string, NotebookTerm>, unknown>[]>(() =>
  resultVars.value.map((name) => ({
    accessorKey: name,
    accessorFn: (row: Record<string, NotebookTerm>) => termText(row[name]),
    header: name,
    cell: ({ row }) => {
      const term = row.original[name];
      return h('span', { class: 'term-cell inline-flex items-center' }, [
        h('code', { class: 'text-xs' }, termText(term)),
      ]);
    },
  })),
);

const editorLink = computed(() => ({
  path: '/',
  query: { section: 'queries', item: props.query.sourceQuery },
}));
const testsLink = computed(() => ({
  path: '/',
  query: { section: 'tests', subject: props.query.sourceQuery },
}));

onMounted(() => {
  if (argsEl.value) {
    argsEl.value.signature = {
      inputs: props.query.inferredInputs,
      limits: props.query.limitParameters,
      offsets: props.query.offsetParameters,
    };
  }
  reset();
});

watch(() => props.slug, () => reset());
</script>

<style scoped>
.cell {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  margin-bottom: var(--space-6);
}

.cell__head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-default);
  flex-wrap: wrap;
}

.cell__name {
  margin: 0;
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}


.tag-chip {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
}

.cell__links { margin-left: auto; display: flex; gap: var(--space-4); }

.cell__link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.cell__link:hover { color: var(--ink-secondary); }

.cell__body { padding: var(--space-5); }

.cell__desc {
  margin: 0 0 var(--space-4);
  max-width: 72ch;
  color: var(--ink-secondary);
}

.signature {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin: 0 0 var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--surface-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.signature__label {
  font-family: var(--font-sans, inherit);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
}

.signature__part { color: var(--ink-secondary); }
.signature__part + .signature__part::before { content: '· '; color: var(--ink-muted); }

.examples {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.examples__label {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.example {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm, 24px);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: inherit;
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.example:hover { background: var(--surface-subtle); }

.example[aria-pressed='true'] {
  border-color: var(--action-border, var(--action));
  background: var(--action-surface);
  color: var(--action);
  font-weight: var(--weight-semibold);
}

.example__seeded { font-size: var(--text-micro); }

.args {
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: var(--space-4);
}

.args__body { padding: var(--space-4) var(--space-5); }

.query {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.query__views {
  display: flex;
}

.pane__error {
  /* Standalone now that the panes are gone: it needs the edge the pane used
     to give it. */
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--danger-ink);
  border-radius: var(--radius-sm);
  background: var(--danger-surface);
  color: var(--danger-ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.runbar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.runbar__status { font-size: var(--text-label); color: var(--ink-muted); }
.runbar__save { margin-left: auto; }

.run-error {
  margin: var(--space-4) 0 0;
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--danger-ink);
  border-radius: var(--radius-sm);
  background: var(--danger-surface);
  color: var(--danger-ink);
  font-size: var(--text-label);
}

.result { margin-top: var(--space-5); }
.recorded-label { margin: var(--space-5) 0 var(--space-3); }

/*
 * `<sqlib-args>` in the app's clothes.
 *
 * The element is light DOM precisely so each host can theme it: the exported
 * page injects the runtime's own ARGS_ELEMENT_STYLES, and the app dresses the
 * same class names in its tokens instead. Without this the element renders as
 * raw unstyled HTML — which is exactly what shipped, because every test
 * asserted on DOM text and none of them could see it.
 */
:deep(.sqlib-args__modes) {
  display: inline-flex;
  gap: 0;
  padding: var(--space-1);
  margin-bottom: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface-subtle);
}

:deep(.sqlib-args__mode) {
  height: var(--control-h-sm, 24px);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

:deep(.sqlib-args__mode[aria-pressed='true']) {
  background: var(--surface);
  color: var(--ink);
  font-weight: var(--weight-semibold);
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

:deep(.sqlib-args__slot) { margin-bottom: var(--space-4); }

:deep(.sqlib-args__slot-label) {
  margin-bottom: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

:deep(.sqlib-args__table) {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-label);
}

:deep(.sqlib-args__table th) {
  padding: 0 var(--space-3) var(--space-2);
  text-align: left;
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
}

:deep(.sqlib-args__table td) { padding: var(--space-1) var(--space-3); vertical-align: top; }

:deep(.sqlib-args__cell) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

:deep(.sqlib-args__cell select),
:deep(.sqlib-args__cell input),
:deep(.sqlib-args__limit input) {
  height: var(--control-h-sm, 24px);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: inherit;
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

:deep(.sqlib-args__cell input) { flex: 3 1 14rem; min-width: 8rem; }

/* Datatype and language qualify the value; they should not rival it for width. */
:deep(.sqlib-args__cell input[placeholder='datatype IRI']),
:deep(.sqlib-args__cell input[placeholder='lang']) { flex: 1 1 7rem; min-width: 4rem; }
:deep(.sqlib-args__cell input:focus),
:deep(.sqlib-args__limit input:focus) { border-color: var(--action); outline: none; }
:deep(.sqlib-args__cell input.sqlib-args__invalid) { border-color: var(--danger-ink); }

:deep(.sqlib-args__error) {
  flex-basis: 100%;
  color: var(--danger-ink);
  font-size: var(--text-micro);
}

:deep(.sqlib-args__row-actions) { white-space: nowrap; }

:deep(.sqlib-args__button) {
  height: var(--control-h-sm, 24px);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

:deep(.sqlib-args__button:hover) { background: var(--surface-subtle); color: var(--ink); }

:deep(.sqlib-args__limits) {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

:deep(.sqlib-args__limit) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink-muted);
}

:deep(.sqlib-args__limit input) { width: 6rem; }

:deep(.sqlib-args__json) {
  width: 100%;
  min-height: 9rem;
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: inherit;
  font-family: var(--font-mono);
  font-size: var(--text-label);
  resize: vertical;
}

:deep(.sqlib-args__note) {
  margin: var(--space-2) 0 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

:deep(.sqlib-args__note--warn) { color: var(--warning-ink, var(--ink-secondary)); }
:deep(.sqlib-args__empty) { font-size: var(--text-label); color: var(--ink-muted); }
</style>
