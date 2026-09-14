<template>
  <ul v-if="entries.length" class="reference-list" data-testid="tuple-set-references">
    <li v-for="entry in entries" :key="entry.key" class="reference" data-testid="tuple-set-reference">
      <Link2 :size="13" class="reference-icon" />

      <div class="reference-body">
        <span class="reference-name">{{ entry.name }}</span>
        <span class="reference-meta">
          <span
            class="reference-pin"
            :class="entry.floating ? 'reference-pin--floating' : 'reference-pin--pinned'"
            :title="entry.floating
              ? 'Follows the tuple set — saving this argument set pins whichever version is current then'
              : 'Pinned by a save. It will not move until you re-point it.'"
          >{{ entry.pinLabel }}</span>
          <template v-if="entry.rowLabel"> · {{ entry.rowLabel }}</template>
          <template v-if="entry.columns"> · {{ entry.columns }}</template>
        </span>
        <span v-if="entry.warning" class="reference-warning">{{ entry.warning }}</span>
      </div>

      <button
        v-if="entry.newerVersionId"
        type="button"
        class="reference-action"
        :disabled="disabled"
        :title="'Point this reference at the tuple set’s current version'"
        data-testid="tuple-set-reference-repin"
        @click="emit('repin', { reference: entry.reference, versionId: entry.newerVersionId })"
      >
        {{ entry.newerLabel }}
      </button>

      <button
        type="button"
        class="reference-remove"
        title="Unlink this tuple set from the clause"
        :disabled="disabled"
        data-testid="tuple-set-reference-remove"
        @click="emit('remove', entry.reference)"
      >
        <X :size="13" />
      </button>
    </li>
  </ul>
</template>

<script setup lang="ts">
/**
 * The tuple sets a clause is linked to, shown apart from the rows typed into it.
 *
 * Two sources fill one VALUES clause and they behave differently, so they are
 * drawn differently (issue #209 item 2): rows below are this argument set's own
 * and change only when edited, while a reference tracks — its rows are read out
 * of the tuple set at execution, and change when the tuple set does. Mixing
 * them into one grid would show a table nobody can edit half of.
 *
 * A reference is floating or pinned, and the chip says which. Floating means
 * "whatever this set holds when it runs", which is what a draft carries; a save
 * resolves it to the current version and the pin never moves again without an
 * author moving it — hence the nudge rather than an automatic bump when a newer
 * version exists (`docs/explanation/versioning-and-immutability.md`).
 */
import { computed, ref, watch } from 'vue';
import { Link2, X } from '@lucide/vue';
import { useTupleSetsStore } from '@/composables/useTupleSetsStore';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { bareVariable, tupleSetFit } from '@/lib/argumentSignature';
import { referenceKey, isFloating } from '@/lib/tupleSetReferences';
import { readTupleDocument } from '@/types/tuple-sets';
import type { TupleSetReference } from '@/types/argument-sets';

const props = defineProps<{
  references: TupleSetReference[];
  /** The clause's variables, for the "contributes nothing" warning. */
  variables: string[];
  libraryId?: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  remove: [reference: TupleSetReference];
  repin: [payload: { reference: TupleSetReference; versionId: string }];
}>();

const store = useTupleSetsStore();
const { activeLibraryId } = useActiveLibrary();

/**
 * Bumped once a resolve settles, to re-run `entries` over the store's caches.
 *
 * The lookups are plain reads of a reactive store, so they would track on their
 * own — but only for the sets already listed. A resolve that *adds* to the
 * cache has to say so, and this is that signal.
 */
const resolved = ref(0);

watch(
  () => props.references.map(referenceKey).join('|'),
  async () => {
    await store.resolveReferences(props.references, props.libraryId ?? activeLibraryId.value);
    resolved.value += 1;
  },
  { immediate: true },
);

const names = computed(() => props.variables.map(bareVariable));

interface Entry {
  key: string;
  reference: TupleSetReference;
  name: string;
  pinLabel: string;
  floating: boolean;
  rowLabel: string;
  columns: string;
  warning: string;
  /** Set when a pinned reference is behind its tuple set. */
  newerVersionId: string | null;
  newerLabel: string;
}

const entries = computed<Entry[]>(() => {
  void resolved.value;
  return props.references.map((reference) => describe(reference));
});

function describe(reference: TupleSetReference): Entry {
  const floating = isFloating(reference);
  const found = reference.versionId ? store.tupleSetVersionById(reference.versionId) : null;
  const set = found?.set ?? (reference.tupleSetId ? store.tupleSetById(reference.tupleSetId) : null);
  const currentVersionId = set?.currentVersion ?? null;
  const version = found?.version
    ?? (currentVersionId
      ? store.tupleSetVersionById(currentVersionId)?.version ?? null
      : null);

  const base: Entry = {
    key: referenceKey(reference),
    reference,
    name: set?.name ?? 'Tuple set',
    pinLabel: floating ? 'follows the set' : 'pinned',
    floating,
    rowLabel: '',
    columns: '',
    warning: '',
    newerVersionId: null,
    newerLabel: '',
  };

  // A pinned version that is nowhere in the library: deleted out from under the
  // set. Execution skips it rather than failing, so the panel says so plainly
  // instead of drawing a reference that looks healthy and contributes nothing.
  if (!floating && !found) {
    return { ...base, name: set?.name ?? 'Missing tuple set version', warning: 'This pinned version no longer exists — it contributes no rows.' };
  }
  if (floating && !set) {
    return { ...base, warning: 'This tuple set is not in the library any more — it contributes no rows.' };
  }
  if (!version) {
    return { ...base, warning: 'This tuple set has no saved version yet — it contributes no rows.' };
  }

  const columns = version.tupleColumns?.length
    ? version.tupleColumns
    : readTupleDocument(version.contentString).columns;
  const rowCount = version.rowCount ?? readTupleDocument(version.contentString).rows.length;
  const fit = tupleSetFit(names.value, columns);

  return {
    ...base,
    pinLabel: floating ? `follows the set — v${version.version} now` : `pinned to v${version.version}`,
    rowLabel: `${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`,
    columns: columns.map(name => `?${name}`).join(' '),
    warning: fit.verdict === 'mismatch'
      ? `Nothing lines up: ${fit.reason}. This reference contributes no rows.`
      : '',
    newerVersionId: !floating && currentVersionId && currentVersionId !== reference.versionId
      ? currentVersionId
      : null,
    newerLabel: newerLabel(currentVersionId),
  };
}

function newerLabel(currentVersionId: string | null): string {
  if (!currentVersionId) return '';
  const current = store.tupleSetVersionById(currentVersionId)?.version?.version;
  return current ? `v${current} available` : 'newer version available';
}
</script>

<style scoped>
.reference-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.reference {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}

.reference-icon {
  flex: none;
  color: var(--ink-muted);
}

.reference-body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.reference-name {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.reference-meta {
  overflow: hidden;
  font-size: var(--text-micro);
  color: var(--ink-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-pin--pinned {
  font-family: var(--font-mono);
  color: var(--ink-secondary);
}

.reference-pin--floating {
  font-style: italic;
}

.reference-warning {
  font-size: var(--text-micro);
  color: var(--danger-ink);
}

.reference-action {
  flex: none;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.reference-action:hover:not(:disabled) {
  background: var(--surface-raised);
}

.reference-remove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.reference-remove:hover:not(:disabled) {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.reference-action:disabled,
.reference-remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
