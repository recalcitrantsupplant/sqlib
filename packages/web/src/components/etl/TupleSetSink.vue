<template>
  <div class="tuple-set-sink">
    <button
      type="button"
      class="btn-sink"
      data-testid="etl-tuple-sink-open"
      :disabled="!!blockedReason || saving"
      :title="blockedReason ?? 'Run this pipeline and keep its rows as a tuple set version'"
      @click="toggle"
    >
      <Table2 :size="13" /> {{ saving ? 'Saving rows…' : 'Save rows to tuple set' }}
    </button>

    <div v-if="open" class="sink-panel" data-testid="etl-tuple-sink-panel">
      <header class="sink-header">
        <span class="sink-title">Save the mapped rows as</span>
        <button type="button" class="sink-close" title="Close" @click="open = false">
          <X :size="13" />
        </button>
      </header>

      <!--
        The rows this writes are the ones the mapping above describes, not the
        ones the peek showed: the server re-runs the pipeline's saved SQL and
        types it through the saved mapping, so what lands is what a run would
        produce, not what this browser happens to be holding.
      -->
      <InlineNote size="xs" class="sink-note">
        The saved SQL runs again on the server and the mapped columns are stored
        as one immutable version.
      </InlineNote>

      <InlineNote v-if="loading" size="xs" class="sink-note">Loading…</InlineNote>
      <InlineNote v-else-if="error" size="xs" tone="danger" class="sink-note" data-testid="etl-tuple-sink-error">
        {{ error }}
      </InlineNote>

      <ul v-if="!loading && candidates.length > 0" class="sink-list">
        <li v-for="set in candidates" :key="set.id" class="sink-choice">
          <span class="sink-name">{{ set.name }}</span>
          <span class="sink-meta">
            <template v-if="set.currentVersionNumber">v{{ set.currentVersionNumber }} · a new version</template>
            <template v-else>no versions yet</template>
          </span>
          <button
            type="button"
            class="sink-action"
            :disabled="saving"
            data-testid="etl-tuple-sink-existing"
            @click="saveTo(set)"
          >
            <Save :size="12" /> Save here
          </button>
        </li>
      </ul>

      <!--
        A new set is offered beside the existing ones rather than behind a
        second dialog: the first save a pipeline makes has nowhere to go yet,
        and that is the common case, not the edge one.
      -->
      <footer class="sink-footer">
        <label class="sink-field">
          <span class="sink-field-label">New tuple set</span>
          <input
            v-model="newName"
            type="text"
            class="sink-input"
            placeholder="Name"
            data-testid="etl-tuple-sink-name"
            @keyup.enter="saveToNew"
          />
        </label>
        <button
          type="button"
          class="sink-action sink-action--primary"
          :disabled="saving || newName.trim().length === 0"
          data-testid="etl-tuple-sink-create"
          @click="saveToNew"
        >
          <Plus :size="12" /> Create and save
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Write a pipeline's rows to a tuple set version — the ETL sink of issue #211.
 *
 * A DuckDB pipeline already produces exactly what a tuple set holds, a table of
 * typed rows, and until the API half landed the only thing it could do with
 * that table was render it into a SPARQL template and push the triples at a
 * backend. This is the other output: the rows themselves, kept in the library
 * under a name, versioned, and reusable as a `VALUES` clause by every callable
 * in that library.
 *
 * **The browser never carries the rows.** `POST /tuple-sets/:id/versions/from-etl`
 * takes a job *version* id; the server runs its SQL, types the columns through
 * the mapping that version names, and stores the snapshot with the job version,
 * the mapping version, the run time and a result hash recorded on it. So this
 * component sends two identifiers and shows the outcome — there is no content
 * for it to serialise, and no second typing rule that could disagree with the
 * SPARQL load path's.
 *
 * **Only a saved pipeline can be a source**, for the same reason only a saved
 * rule set can be a test subject: provenance names a version, and unsaved
 * editors have no version to name. The parent says why in `blockedReason`, so
 * a disabled button explains itself rather than looking broken.
 */
import { computed, ref } from 'vue';
import { Table2, X, Save, Plus } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { useTupleSetsStore } from '@/composables/useTupleSetsStore';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import type { TupleSet } from '@sparql-query-lib/contracts';
import InlineNote from '../shared/InlineNote.vue';

const props = defineProps<{
  /** The saved job version whose SQL the server re-runs. */
  etlJobVersionId: string | null;
  /** Its number, so the stored version can say where it came from. */
  versionNumber?: number | null;
  /** The pipeline's name, for the default set name and the comment. */
  jobName: string;
  /** Defaults to the active library, which is the one the pipeline is in. */
  libraryId?: string | null;
  /**
   * Why saving is not available — no saved version yet, or edits that are not
   * in one. Set means disabled, and the text is the button's title.
   */
  blockedReason?: string | null;
}>();

const store = useTupleSetsStore();
const { activeLibraryId } = useActiveLibrary();

const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const candidates = ref<TupleSet[]>([]);
const newName = ref('');

const targetLibraryId = computed(() => props.libraryId ?? activeLibraryId.value ?? null);

const byName = (sets: TupleSet[]) => [...sets].sort((a, b) => a.name.localeCompare(b.name));

async function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  newName.value = `${props.jobName.trim() || 'Pipeline'} rows`;
  await refresh();
}

async function refresh() {
  const libraryId = targetLibraryId.value;
  if (!libraryId) {
    candidates.value = [];
    error.value = 'Choose a library before saving a tuple set.';
    return;
  }

  loading.value = true;
  error.value = null;
  try {
    await store.loadTupleSets({ library: libraryId });
    candidates.value = byName(store.tupleSets.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load tuple sets';
    candidates.value = [];
  } finally {
    loading.value = false;
  }
}

/**
 * What the stored version says about itself.
 *
 * The structured provenance is on the snapshot already — job version, mapping
 * version, run time, hash — so the comment is the human sentence beside it,
 * naming the pipeline rather than repeating its IRI.
 */
function comment(): string {
  const name = props.jobName.trim() || 'a pipeline';
  return props.versionNumber
    ? `Rows from “${name}” v${props.versionNumber}`
    : `Rows from “${name}”`;
}

async function materialize(tupleSetId: string, setName: string) {
  const versionId = props.etlJobVersionId;
  if (!versionId) return;

  saving.value = true;
  error.value = null;
  try {
    const { version, reused } = await store.createVersionFromEtl(tupleSetId, {
      etlJobVersionId: versionId,
      comment: comment(),
    });
    const rows = version.rowCount ?? 0;
    const noun = rows === 1 ? 'row' : 'rows';
    const at = `“${setName}” v${version.version ?? ''}`.trim();
    // "Saved" would be a lie about a run that cut no version, and silence would
    // be a lie about a run that happened. The pipeline ran and the set already
    // holds what it produced (#211's version churn), which is a result rather
    // than a non-event — so it is said, as the outcome it is.
    toast.success(
      reused
        ? `${at} already holds these ${rows} ${noun} — no new version`
        : `Saved ${rows} ${noun} to ${at}`,
    );
    open.value = false;
  } catch (err) {
    // The server's message is the useful one — a mapping that types no columns,
    // a result over the per-version cap, SQL that will not run — so it is shown
    // in the panel as well as toasted, where it stays readable next to the
    // choice that produced it.
    const message = err instanceof Error ? err.message : 'Could not save the rows';
    error.value = message;
    toast.error(message);
  } finally {
    saving.value = false;
  }
}

function saveTo(set: TupleSet) {
  void materialize(set.id, set.name);
}

/**
 * Create the set, then fill it.
 *
 * Two calls, and between them the set joins the listing and the name field is
 * cleared: a run that fails after the set was made leaves a retry that goes
 * into that set, rather than a second Create making a namesake beside it.
 */
async function saveToNew() {
  const name = newName.value.trim();
  const libraryId = targetLibraryId.value;
  if (!name || !libraryId || saving.value) return;

  saving.value = true;
  error.value = null;
  let created: TupleSet;
  try {
    created = await store.createTupleSet({ name, isPartOf: [libraryId] });
    candidates.value = byName([...candidates.value, created]);
    newName.value = '';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create the tuple set';
    error.value = message;
    toast.error(message);
    return;
  } finally {
    saving.value = false;
  }

  await materialize(created.id, created.name);
}
</script>

<style scoped>
.tuple-set-sink {
  position: relative;
  display: inline-flex;
}

.btn-sink {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.btn-sink:hover:not(:disabled) {
  background: var(--surface-subtle);
  color: var(--ink);
}

.btn-sink:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sink-panel {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  z-index: 20;
  width: 34ch;
  max-height: 22rem;
  overflow-y: auto;
  padding: var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-raised, 0 6px 20px rgb(0 0 0 / 18%));
}

.sink-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.sink-title {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.sink-close {
  display: inline-flex;
  border: none;
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.sink-note {
  margin: 0 0 var(--space-3);
}

.sink-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sink-choice {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.sink-choice:hover {
  border-color: var(--action-border);
}

.sink-name {
  color: var(--ink);
  font-size: var(--text-label);
}

.sink-meta {
  grid-column: 1;
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.sink-action {
  display: inline-flex;
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.sink-action:hover:not(:disabled) {
  background: var(--surface-subtle);
}

.sink-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sink-action--primary {
  border-color: var(--action-border);
  color: var(--ink);
}

.sink-footer {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-default);
}

.sink-field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
}

.sink-field-label {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.sink-input {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
}
</style>
