<template>
  <div class="tuple-set-picker">
    <button
      type="button"
      class="btn-add"
      data-testid="tuple-set-picker-open"
      :disabled="disabled"
      @click="toggle"
    >
      <Table2 :size="13" /> From tuple set
    </button>

    <div v-if="open" class="picker-panel" data-testid="tuple-set-picker-panel">
      <header class="picker-header">
        <span class="picker-title">Tuple sets in this library</span>
        <button type="button" class="picker-close" title="Close" @click="open = false">
          <X :size="13" />
        </button>
      </header>

      <InlineNote v-if="loading">Loading…</InlineNote>
      <InlineNote v-else-if="error" tone="danger" data-testid="tuple-set-picker-error">{{ error }}</InlineNote>
      <InlineNote v-else-if="candidates.length === 0">
        No tuple sets here yet. Save a table under Tuples and it becomes available
        to every callable in this library.
      </InlineNote>

      <!--
        A filter, once the list is long enough that reading it is the slow part.
        Same fuzzy rule as every other chooser (`lib/fuzzy`): a subsequence
        matches, best-ranked first.
      -->
      <FilterBox
        v-if="candidates.length > FILTER_FROM"
        v-model="filter"
        placeholder="Filter tuple sets…"
        test-id="tuple-set-picker-filter"
      />

      <InlineNote v-if="candidates.length > 0 && visibleCandidates.length === 0">
        No tuple set here matches “{{ filter }}”.
      </InlineNote>

      <ul v-else class="picker-list">
        <li
          v-for="candidate in visibleCandidates"
          :key="candidate.set.id"
          class="picker-choice"
          :class="`picker-choice--${candidate.fit.verdict}`"
          :title="candidate.fit.reason || 'Matches this clause'"
          data-testid="tuple-set-picker-choice"
        >
          <span class="picker-name">{{ candidate.set.name }}</span>
          <span class="picker-columns">{{ candidate.columns.map((name) => `?${name}`).join(' ') }}</span>
          <span class="picker-meta">
            v{{ candidate.version.version }} ·
            {{ candidate.version.rowCount ?? 0 }}
            {{ (candidate.version.rowCount ?? 0) === 1 ? 'row' : 'rows' }}
            <template v-if="candidate.fit.reason"> · {{ candidate.fit.reason }}</template>
          </span>

          <!--
            The choice §7.2 asks for, stated rather than defaulted. Attach keeps
            the association — a v2 of the set reaches this clause — and copy is
            still the right answer for "take these rows and edit them", which a
            reference cannot do.
          -->
          <div class="picker-actions">
            <button
              type="button"
              class="picker-action picker-action--primary"
              :disabled="candidate.fit.verdict === 'mismatch' || attached(candidate)"
              :title="attached(candidate)
                ? 'Already linked to this clause'
                : 'Link this clause to the tuple set — it follows new versions until you save'"
              data-testid="tuple-set-picker-attach"
              @click="attach(candidate)"
            >
              <Link2 :size="12" /> {{ attached(candidate) ? 'Linked' : 'Attach' }}
            </button>
            <button
              type="button"
              class="picker-action"
              :disabled="candidate.fit.verdict === 'mismatch'"
              title="Copy the rows in as they are now — nothing tracks the set afterwards"
              data-testid="tuple-set-picker-copy"
              @click="choose(candidate)"
            >
              <Copy :size="12" /> Copy rows
            </button>
          </div>
        </li>
      </ul>

      <!--
        Append rather than replace is the default, because unioning rows for one
        signature is what the runtime already does with several sources
        (`mergeArgumentSets`), and because losing hand-typed rows to a misclick
        is the more expensive mistake of the two. Copy only: a reference adds a
        source and never overwrites the rows typed beside it.
      -->
      <footer v-if="candidates.length > 0" class="picker-footer">
        <label class="picker-mode">
          <input v-model="replace" type="checkbox" />
          Replace the rows already here when copying
        </label>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Fill one VALUES clause from a tuple set held elsewhere in the library.
 *
 * This is the "elsewhere in the library" listing the query arguments design
 * wanted and could not have: an argument set is stored per target, so rows
 * typed into one query were unreachable from the next. A tuple set is the unit
 * of reuse that unblocks it.
 *
 * One clause at a time, deliberately. A tuple set is one relation — a single
 * signature and its rows — so it answers one clause, and which clause is the
 * caller's to say.
 *
 * **Two ways to take a set, and the picker makes you pick one.** *Attach*
 * stores a reference (`ArgumentTupleBinding.tupleSetVersions`, design §7.2),
 * which floats on the draft and pins on save, so a v2 of the set reaches this
 * clause. *Copy rows* takes the rows as they stand now and forgets where they
 * came from, which is what you want when the next thing you do is edit them —
 * a reference has nothing to edit. Copying used to be the only option, and the
 * association was lost the moment the rows landed.
 */
import { computed, ref } from 'vue';
import { Table2, X, Link2, Copy } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import { useTupleSetsStore } from '@/composables/useTupleSetsStore';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { bareVariable, tupleSetFit, type Compatibility } from '@/lib/argumentSignature';
import { fuzzyFilter } from '@/lib/fuzzy';
import FilterBox from '@/components/shared/FilterBox.vue';
import { readTupleDocument } from '@/types/tuple-sets';
import type { ArgumentRow, SparqlBinding, SparqlValue, TupleSetReference } from '@/types/argument-sets';
import type { TupleSetVersion } from '@/composables/useApiClient';
import type { TupleSet } from '@sparql-query-lib/contracts';

const props = defineProps<{
  /** The clause being filled, in declaration order. */
  variables: string[];
  /**
   * The library to look in. Defaults to the active one, which is the library
   * scoping the rest of the app and so the one the open query belongs to;
   * passing it explicitly is for callers that know better.
   */
  libraryId?: string | null;
  /**
   * References the clause already holds, so a set cannot be attached twice —
   * two references to one version double every row it contributes.
   */
  attachedTo?: TupleSetReference[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  load: [payload: { rows: ArgumentRow[]; replace: boolean; setName: string }];
  attach: [payload: { reference: TupleSetReference; setName: string }];
}>();

interface Candidate {
  set: TupleSet;
  version: TupleSetVersion;
  columns: string[];
  fit: Compatibility;
}

const store = useTupleSetsStore();
const { activeLibraryId } = useActiveLibrary();

const open = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const replace = ref(false);
const candidates = ref<Candidate[]>([]);

/** Below this many rows the list is faster to read than to filter. */
const FILTER_FROM = 5;
const filter = ref('');

const visibleCandidates = computed(() =>
  fuzzyFilter(filter.value, candidates.value, (candidate) => candidate.set.name).map(({ item }) => item),
);

const names = computed(() => props.variables.map(bareVariable));

async function toggle() {
  open.value = !open.value;
  if (open.value) await refresh();
}

async function refresh() {
  const libraryId = props.libraryId ?? activeLibraryId.value;
  if (!libraryId) {
    candidates.value = [];
    error.value = 'Choose a library to see the tuple sets in it.';
    return;
  }

  loading.value = true;
  error.value = null;
  try {
    await store.loadTupleSets({ library: libraryId });
    const resolved = await store.loadCurrentVersions(store.tupleSets.value);
    candidates.value = resolved
      .map(({ set, version }) => {
        // `tupleColumns` is on the version precisely so a verdict never has to
        // parse content; falling back to the document keeps a version written
        // before that field existed from reading as "no columns".
        const columns = version.tupleColumns?.length
          ? version.tupleColumns
          : readTupleDocument(version.contentString).columns;
        return { set, version, columns, fit: tupleSetFit(names.value, columns) };
      })
      // Best match first, so the useful rows are not below the useless ones.
      .sort((a, b) => rank(a.fit) - rank(b.fit) || a.set.name.localeCompare(b.set.name));
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load tuple sets';
    candidates.value = [];
  } finally {
    loading.value = false;
  }
}

function rank(fit: Compatibility): number {
  return fit.verdict === 'fits' ? 0 : fit.verdict === 'partial' ? 1 : 2;
}

/**
 * Take a stored row down to the clause's variables.
 *
 * Columns the clause does not declare are dropped — they have nothing to bind
 * to. A variable the tuple set does not carry becomes a blank cell, which is
 * how this editor spells UNDEF, so a partial match leaves that variable
 * unconstrained rather than binding the empty literal.
 */
function toArgumentRow(binding: SparqlBinding): ArgumentRow {
  const values: SparqlBinding = {};
  for (const name of names.value) {
    const term = binding[name] as SparqlValue | undefined;
    values[name] = term ? { ...term } : { type: 'uri', value: '' };
  }
  return { values };
}

function choose(candidate: Candidate) {
  const { rows } = readTupleDocument(candidate.version.contentString);
  emit('load', {
    rows: rows.map(toArgumentRow),
    replace: replace.value,
    setName: candidate.set.name,
  });
  open.value = false;
}

/** Already linked, whether the held reference floats or names this version. */
function attached(candidate: Candidate): boolean {
  return (props.attachedTo ?? []).some(reference =>
    reference.tupleSetId === candidate.set.id || reference.versionId === candidate.version.id);
}

/**
 * Attach the *set*, not the version it currently points at.
 *
 * Floating is the draft's state by design (§7.2): the rows a run gets are
 * whatever the set holds at the time, and the version is written only when the
 * argument set is saved. Sending a version id here would pin it a save early.
 */
function attach(candidate: Candidate) {
  emit('attach', {
    reference: { tupleSetId: candidate.set.id },
    setName: candidate.set.name,
  });
  open.value = false;
}
</script>

<style scoped>
.tuple-set-picker {
  position: relative;
  display: inline-flex;
}

.btn-add {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.picker-panel {
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 0;
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

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.picker-title {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.picker-close {
  display: inline-flex;
  border: none;
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.picker-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.picker-choice {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  text-align: left;
  font-family: inherit;
}

.picker-choice:hover {
  border-color: var(--action-border);
}

.picker-choice--mismatch {
  opacity: 0.5;
}

.picker-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.picker-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.picker-action--primary {
  border-color: var(--action-border);
  color: var(--ink);
}

.picker-action:hover:not(:disabled) {
  background: var(--surface-subtle);
}

.picker-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.picker-name {
  color: var(--ink);
  font-size: var(--text-label);
}

.picker-columns {
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: calc(var(--text-label) * 0.92);
}

.picker-meta {
  color: var(--ink-muted);
  font-size: calc(var(--text-label) * 0.9);
}

.picker-footer {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-default);
}

.picker-mode {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-label);
}
</style>
