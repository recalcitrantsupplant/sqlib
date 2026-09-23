<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Save as test case</DialogTitle>
        <DialogDescription>
          You are holding a query, arguments and a result — which is a test case. This creates
          one; it never edits the query.
        </DialogDescription>
      </DialogHeader>

      <div class="body">
        <label class="field">
          <span class="field__label">Test name</span>
          <input v-model="name" type="text" class="field__input" placeholder="Test name" />
        </label>

        <label class="field field--row">
          <input v-model="recordExpectation" type="checkbox" :disabled="!hasResult" />
          <span>
            Record the current result as the expectation
            <InlineNote v-if="!hasResult" as="span">— run the query first</InlineNote>
          </span>
        </label>

        <InheritTagsToggle
          v-model="copySubjectTags"
          :tags="inheritedTags"
          source-label="query"
          :disabled="saving"
        />

        <InlineNote>
          The arguments are saved as a named argument set on the query, and the new test's first
          case points at it.
        </InlineNote>
        <InlineNote v-if="error" tone="danger">{{ error }}</InlineNote>
      </div>

      <DialogFooter>
        <button type="button" class="button" :disabled="saving" @click="isOpen = false">Cancel</button>
        <button type="button" class="button button--primary" :disabled="saving || !name.trim()" @click="save">
          {{ saving ? 'Saving…' : 'Create test' }}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import InheritTagsToggle from '../tags/InheritTagsToggle.vue';
import InlineNote from '../shared/InlineNote.vue';
import { useApiClient } from '../../composables/useApiClient';
import { useTagsStore } from '../../composables/useTagsStore';
import { useInheritedTags } from '../../composables/useInheritedTags';
import type { SparqlBinding } from '../../types/argument-sets';

/**
 * The library page's one write affordance.
 *
 * A test case names an *argument set version*, not an inline payload, so saving
 * what is on screen is two writes: an argument set on the query, then a test
 * whose first case points at that set's current version. Doing it in that order
 * is what makes the loop close — the next export turns this case back into one
 * of the page's own example chips.
 */
const props = defineProps<{
  open: boolean;
  libraryId: string | null;
  /** The query this cell is for; a test names a saved query. */
  queryId: string | null;
  queryName: string;
  /** SELECT / ASK / CONSTRUCT / DESCRIBE — decides which comparator a recorded result gets. */
  queryType: string | null;
  /** The execution payload the argument builder is holding. */
  payload: ExecutionPayload | null;
  /** The last result, when there is one to record. */
  result: unknown;
  /**
   * The backend the run went to. A query test must name a backend or give every
   * case a data graph, and this page has no data graph to give.
   */
  backendId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'created', value: { testId: string }): void;
}>();

/** What `<sqlib-args>` holds: limits and offsets keyed by name, not listed. */
interface ExecutionPayload {
  arguments?: Array<{ head: { vars: string[] }; arguments: { bindings: Array<SparqlBinding | null> } }>;
  limits?: Record<string, number>;
  offsets?: Record<string, number>;
}

const apiClient = useApiClient();

const name = ref('');
const recordExpectation = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

/**
 * Carry the query's tags onto the test, on by default.
 *
 * The notebook is where a test is most likely to be made by someone who is not
 * thinking about suites at all, which is the case for the default rather than
 * against it: a query tagged `w3c` produces a test that runs with `w3c`, and
 * the box is there for the time that is wrong.
 */
const copySubjectTags = ref(true);

const tagsStore = useTagsStore();
const { inheritedTags } = useInheritedTags(
  computed(() => (props.queryId ? ('query' as const) : null)),
  computed(() => props.queryId),
);

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

/**
 * The comparator a recorded result should be judged by.
 *
 * Not a free choice: bindings, a boolean and a graph are compared by different
 * rules, and which one applies is a fact about the query, not a preference.
 */
const expectationKind = computed(() => {
  switch ((props.queryType ?? '').toUpperCase()) {
    case 'ASK':
      return 'boolean';
    case 'CONSTRUCT':
    case 'DESCRIBE':
      return 'graph';
    default:
      return 'bindings';
  }
});

const hasResult = computed(() => props.result !== null && props.result !== undefined);

const recording = computed(() => recordExpectation.value && hasResult.value);

/** CONSTRUCT and DESCRIBE come back as serialised RDF already; the rest is JSON. */
function serialisedResult(): string {
  return typeof props.result === 'string' ? props.result : JSON.stringify(props.result);
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = `${props.queryName} — from the library page`;
    recordExpectation.value = hasResult.value;
    copySubjectTags.value = true;
    error.value = null;
    void tagsStore.ensureLoaded(props.libraryId);
  },
  // `immediate` because the dialog need not be mounted closed: the page keeps
  // it mounted and flips `open`, but a caller that mounts it already open would
  // otherwise get an unnamed test and a copy-tags box with no vocabulary loaded
  // to name the tags in.
  { immediate: true },
);

/** The payload, in the shape an argument set stores. */
function tupleBindings() {
  return (props.payload?.arguments ?? []).map((argument) => ({
    tupleSignature: argument.head.vars.join('|'),
    variables: [...argument.head.vars],
    rows: argument.arguments.bindings
      .filter((row): row is SparqlBinding => row !== null && Object.keys(row).length > 0)
      .map((values, position) => ({ position, values })),
  }));
}

function scalarBindings() {
  const of = (kind: 'limit' | 'offset', table: Record<string, number> | undefined) =>
    Object.entries(table ?? {}).map(([parameterName, numericValue]) => ({
      parameterKind: kind,
      parameterName,
      numericValue,
    }));
  return [...of('limit', props.payload?.limits), ...of('offset', props.payload?.offsets)];
}

async function save() {
  if (!props.queryId || !props.libraryId) {
    error.value = 'This query is not saved in a library, so there is nothing to attach a test to.';
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    const { data: argumentSet } = await apiClient.createArgumentSet(props.queryId, {
      name: `${name.value.trim()} — arguments`,
      tupleBindings: tupleBindings(),
      scalarBindings: scalarBindings(),
    });

    const { data: test } = await apiClient.createTest({
      name: name.value.trim(),
      subject: props.queryId,
      subjectKind: 'query',
      isPartOf: [props.libraryId],
      // Omitting `tags` is what asks the server for the query's; `[]` is the
      // unticked box saying none.
      ...(copySubjectTags.value ? {} : { tags: [] }),
    } as never);

    await apiClient.createTestVersion(test.id, {
      // Recording the result makes this an assertion; without one it is a
      // smoke case, which is still worth having — it pins that the query runs.
      expectationKind: recording.value ? expectationKind.value : 'smoke',
      backend: props.backendId,
      cases: [
        {
          name: null,
          expected: recording.value ? serialisedResult() : null,
          expectedFormat: recording.value
            ? expectationKind.value === 'graph'
              ? 'application/n-triples'
              : 'application/sparql-results+json'
            : null,
          ordered: null,
          argumentSetVersion: argumentSet.currentVersion?.id ?? argumentSet.currentVersionId ?? null,
          dataGraphVersion: null,
          tupleSeeds: null,
        },
      ],
    });

    emit('created', { testId: test.id });
    isOpen.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.body { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-2) 0; }
.field { display: flex; flex-direction: column; gap: var(--space-2); }
.field--row { flex-direction: row; align-items: center; gap: var(--space-3); font-size: var(--text-label); }
.field__label { font-size: var(--text-micro); font-weight: var(--weight-semibold); text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-muted); }
.field__input { height: 30px; padding: 0 var(--space-3); border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface); color: inherit; font: inherit; font-size: var(--text-label); }
.button { height: 28px; padding: 0 var(--space-4); border: 1px solid var(--border-default); border-radius: var(--radius); background: transparent; font-size: var(--text-label); cursor: pointer; }
.button--primary { border-color: transparent; background: var(--action); color: var(--action-ink); font-weight: var(--weight-semibold); }
.button:disabled { opacity: 0.55; cursor: default; }
</style>
