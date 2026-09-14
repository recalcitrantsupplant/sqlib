<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="prefix-dialog p-0 gap-0" :show-close-button="false">
      <DialogTitleBar title="Prefix Manager" @close="isOpen = false">
        <template #meta>
          <span class="prefix-count">{{ countLabel }}</span>
        </template>
        <template #actions>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button type="button" class="icon-button bordered" title="More actions" aria-label="More actions">
                <MoreHorizontalIcon :size="14" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="showSync = true">Sync with endpoint…</DropdownMenuItem>
              <DropdownMenuItem @click="resetToDefaultsConfirm">Reset to defaults</DropdownMenuItem>
              <DropdownMenuItem @click="handleExportVann">Export as VANN</DropdownMenuItem>
              <DropdownMenuItem @click="handleExportRdfa">Export as RDFa</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </template>
      </DialogTitleBar>

      <div class="prefix-body">
        <DialogDescription class="prefix-blurb">
          Namespace prefixes abbreviate IRIs in result tables and are offered as completions in the
          editors.
        </DialogDescription>

        <div class="toolbar">
          <div class="filter-field">
            <Search :size="13" class="filter-icon" />
            <input
              v-model="searchQuery"
              type="text"
              class="filter-input"
              placeholder="Filter prefix or namespace"
              aria-label="Filter prefix or namespace"
            />
          </div>
          <button
            v-if="conflictCount > 0"
            type="button"
            class="conflicts-button"
            :class="{ active: conflictsOnly }"
            :aria-pressed="conflictsOnly"
            @click="conflictsOnly = !conflictsOnly"
          >
            <CheckIcon v-if="conflictsOnly" :size="13" />
            {{ conflictCount }} {{ conflictCount === 1 ? 'conflict' : 'conflicts' }}
          </button>
          <button type="button" class="btn-primary" @click="addNewPrefix">
            <PlusIcon :size="13" />
            Add prefix
          </button>
        </div>

        <div class="prefix-table">
          <div class="table-head">
            <span class="column-label">On</span>
            <span class="column-label">Prefix</span>
            <span class="column-label">Namespace</span>
            <span class="column-label">Source</span>
            <span />
          </div>

          <div class="table-body">
            <div v-for="row in pagedRows" :key="row.mapping.id" class="table-row" data-testid="prefix-row">
              <div class="cell switch-cell">
                <Switch
                  :model-value="row.mapping.enabled"
                  :disabled="editingId === row.mapping.id"
                  :title="row.mapping.enabled ? 'Enabled' : 'Disabled'"
                  :aria-label="`Enable ${row.mapping.prefix}`"
                  @update:model-value="togglePrefixEnabled(row.mapping.id)"
                />
              </div>

              <div class="cell stacked">
                <input
                  v-if="editingId === row.mapping.id"
                  v-model="editForm.prefix"
                  type="text"
                  class="row-input"
                  aria-label="Prefix"
                  @keyup.enter="saveEdit"
                  @keyup.esc="cancelEdit"
                />
                <span v-else class="prefix-name">{{ row.mapping.prefix }}:</span>
                <span v-if="row.shadowed" class="shadow-mark">
                  <TriangleAlert :size="11" />
                  not used
                </span>
              </div>

              <div class="cell stacked">
                <input
                  v-if="editingId === row.mapping.id"
                  v-model="editForm.namespace"
                  type="text"
                  class="row-input"
                  aria-label="Namespace"
                  @keyup.enter="saveEdit"
                  @keyup.esc="cancelEdit"
                />
                <span
                  v-else
                  class="namespace"
                  title="Click to copy"
                  @click.stop="copyNamespace(row.mapping.namespace)"
                >{{ row.mapping.namespace }}</span>
                <span v-if="row.note && editingId !== row.mapping.id" class="row-note">{{ row.note }}</span>
              </div>

              <div class="cell source-cell">
                <span class="source">{{ sourceLabel(row.mapping.source) }}</span>
                <NuxtLink
                  v-if="row.mapping.discoveredFrom && sourceLink(row.mapping.discoveredFrom)"
                  class="source-from source-link"
                  :title="row.mapping.discoveredFrom"
                  :to="sourceLink(row.mapping.discoveredFrom)!"
                  @click="isOpen = false"
                ><span class="source-link-text">{{ sourceFromLabel(row.mapping.discoveredFrom) }}</span><ExternalLink
                  :size="11"
                  class="source-link-glyph"
                  aria-hidden="true"
                /></NuxtLink>
                <span
                  v-else-if="row.mapping.discoveredFrom"
                  class="source-from"
                  :title="row.mapping.discoveredFrom"
                >{{ sourceFromLabel(row.mapping.discoveredFrom) }}</span>
              </div>

              <div class="cell actions">
                <template v-if="editingId === row.mapping.id">
                  <button type="button" class="row-button save" title="Save" @click="saveEdit">
                    <CheckIcon :size="13" />
                  </button>
                  <button type="button" class="row-button" title="Cancel" @click="cancelEdit">
                    <XIcon :size="13" />
                  </button>
                </template>
                <template v-else>
                  <button type="button" class="row-button" title="Edit" @click="startEdit(row.mapping)">
                    <PencilIcon :size="13" />
                  </button>
                  <button
                    type="button"
                    class="row-button danger"
                    title="Remove"
                    @click="removeMapping(row.mapping)"
                  >
                    <TrashIcon :size="13" />
                  </button>
                </template>
              </div>
            </div>

            <EmptyState v-if="rows.length === 0" :title="emptyMessage">
              <template #icon><Search :size="26" /></template>
            </EmptyState>
          </div>

          <div v-if="pageCount > 1" class="table-foot" data-testid="prefix-pagination">
            <span class="page-label">{{ pageRangeLabel }}</span>
            <div class="page-buttons">
              <button
                type="button"
                class="page-button"
                title="Previous page"
                aria-label="Previous page"
                :disabled="page === 1"
                @click="page--"
              >
                <ChevronLeftIcon :size="13" />
              </button>
              <span class="page-count">{{ page }} / {{ pageCount }}</span>
              <button
                type="button"
                class="page-button"
                title="Next page"
                aria-label="Next page"
                :disabled="page === pageCount"
                @click="page++"
              >
                <ChevronRightIcon :size="13" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="removed" class="undo-strip">
          <span class="undo-label">Removed {{ removed.mapping.prefix }}: {{ removed.mapping.namespace }}</span>
          <button type="button" class="undo-button" @click="undoRemove">Undo</button>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <PrefixSyncDialog v-model:open="showSync" />

  <!-- Reset keeps its confirm: unlike a single mapping, it is not recoverable. -->
  <AlertDialog v-model:open="showResetConfirm">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Reset to default prefixes?</AlertDialogTitle>
        <AlertDialogDescription>
          This will remove all user-added and auto-discovered prefixes and restore the default set.
          This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="showResetConfirm = false">Cancel</AlertDialogCancel>
        <AlertDialogAction @click="resetToDefaults">Reset</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
/**
 * The Prefix Manager, rebuilt against the design system.
 *
 * See `docs/reference/ui-design-tokens.md`. It was a hand-rolled
 * `.focus-overlay` at `z-index: 50` with its own escape listener and a
 * `prefers-color-scheme` dark block — so it sat under `--z-dialog`, trapped no
 * focus, and ignored the app's `.dark` class. It is now a real `Dialog`.
 *
 * The three prose-headed sections are one table body: a conflict is a property
 * of the row that loses, said on that row, with a count in the filter row that
 * narrows to them.
 */
import { ref, computed, watch } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import { usePrefixManager } from '@/composables/usePrefixManager';
import { useCopyToClipboard } from '@/composables/useCopyToClipboard';
import type { PrefixMapping } from '@/types/prefixes';
import { fuzzyMatches } from '@/lib/fuzzy';
import { parsePrefixSource, prefixSourceLabel, prefixSourceRoute } from '@/lib/prefixSources';
import { Dialog, DialogContent, DialogDescription } from './ui/dialog';
import DialogTitleBar from './shared/DialogTitleBar.vue';
import { Switch } from './ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import PrefixSyncDialog from './PrefixSyncDialog.vue';
import EmptyState from './shared/EmptyState.vue';
import { toast } from 'vue-sonner';
import {
  PlusIcon,
  MoreHorizontalIcon,
  CheckIcon,
  XIcon,
  PencilIcon,
  TrashIcon,
  Search,
  TriangleAlert,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLink,
} from '@lucide/vue';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const isOpen = ref(props.open);

watch(() => props.open, (value) => {
  isOpen.value = value;
});
watch(isOpen, (value) => {
  emit('update:open', value);
  if (!value) {
    // A reopened manager should not still be offering to undo a removal from
    // several minutes ago, nor holding a half-finished edit.
    removed.value = null;
    cancelEdit();
  }
});

const {
  prefixSettings,
  togglePrefixEnabled,
  updatePrefix,
  removePrefix,
  restorePrefix,
  getDuplicates,
  getEffectiveIds,
  resetToDefaults: managerResetToDefaults,
  exportPrefixesVann,
  exportPrefixesRdfa,
} = usePrefixManager();

const searchQuery = ref('');
const conflictsOnly = ref(false);
const editingId = ref<string | null>(null);
const editForm = ref({ prefix: '', namespace: '' });
const showResetConfirm = ref(false);
const showSync = ref(false);
const removed = ref<{ mapping: PrefixMapping; index: number } | null>(null);

const { copyToClipboard } = useCopyToClipboard();

interface PrefixRow {
  mapping: PrefixMapping;
  /** Loses its prefix to another mapping, so nothing is ever written with it. */
  shadowed: boolean;
  /** Why this row is in a conflict, in words, on the row. */
  note: string;
}

/**
 * Every mapping, with its conflict spelled out.
 *
 * Two shapes of conflict, both resolved by `usePrefixManager`:
 * one prefix pointing at two namespaces (one wins, the other is never used),
 * and two prefixes pointing at one namespace (both work on input, one is
 * written out).
 */
const allRows = computed<PrefixRow[]>(() => {
  const { duplicatePrefixes, duplicateNamespaces } = getDuplicates();
  const effective = getEffectiveIds();
  const mappings = prefixSettings.value.mappings;

  /*
   * Who wins a prefix, judged the way the resolver judges it: the longest —
   * most specific — namespace, the first one on a tie. This cannot come from
   * `effective`, because a mapping can win its prefix and still be dropped for
   * losing the namespace contest to a default; then nothing under that prefix
   * is effective and every row beneath it would have read "not used".
   */
  const prefixWinners = new Map<string, PrefixMapping>();
  for (const m of mappings) {
    if (!m.enabled) continue;
    const held = prefixWinners.get(m.prefix);
    if (!held || m.namespace.length > held.namespace.length) prefixWinners.set(m.prefix, m);
  }

  return [...mappings]
    .sort((a, b) => a.prefix.localeCompare(b.prefix) || a.namespace.localeCompare(b.namespace))
    .map((mapping) => {
      if (!mapping.enabled) return { mapping, shadowed: false, note: '' };

      const winner = prefixWinners.get(mapping.prefix);
      if (duplicatePrefixes.has(mapping.prefix) && winner && winner.id !== mapping.id) {
        return {
          mapping,
          shadowed: true,
          note: `Shadowed by ${winner.prefix}: ${winner.namespace}. Rename it or turn it off.`,
        };
      }

      if (duplicateNamespaces.has(mapping.namespace) && !effective.has(mapping.id)) {
        const preferred = mappings.find(
          (m) => m.namespace === mapping.namespace && effective.has(m.id),
        );
        return {
          mapping,
          shadowed: false,
          note: preferred
            ? `Alias — accepted on input, ${preferred.prefix}: is written out.`
            : 'Alias — accepted on input, another prefix is written out.',
        };
      }

      if (duplicatePrefixes.has(mapping.prefix)) {
        return {
          mapping,
          shadowed: false,
          note: `Two mappings use ${mapping.prefix}: — this one wins.`,
        };
      }

      return { mapping, shadowed: false, note: '' };
    });
});

const conflictCount = computed(() => allRows.value.filter((r) => r.note).length);

/* Fuzzy on the prefix, substring on the namespace: a namespace is a URL, and
 * every URL is a subsequence of "http" plus almost anything (`lib/fuzzy`). */
const rows = computed(() =>
  allRows.value.filter((row) => {
    if (conflictsOnly.value && !row.note) return false;
    return fuzzyMatches(searchQuery.value, row.mapping.prefix, row.mapping.namespace);
  }),
);

const PAGE_SIZE = 20;
const page = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)));
const pagedRows = computed(() =>
  rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
const pageRangeLabel = computed(() => {
  const total = rows.value.length;
  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(page.value * PAGE_SIZE, total);
  return `${start}–${end} of ${total}`;
});

// A new filter starts reading from the top; a shrunken result set must not
// leave the page pointing past its last row.
watch([searchQuery, conflictsOnly], () => {
  page.value = 1;
});
watch(pageCount, (count) => {
  if (page.value > count) page.value = count;
});

const countLabel = computed(() => {
  const all = prefixSettings.value.mappings;
  const enabled = all.filter((m) => m.enabled).length;
  return `${all.length} ${all.length === 1 ? 'mapping' : 'mappings'} · ${enabled} enabled`;
});

const emptyMessage = computed(() => {
  if (searchQuery.value.trim()) return `Nothing matches “${searchQuery.value.trim()}”.`;
  if (conflictsOnly.value) return 'No conflicts.';
  return 'No prefix mappings.';
});

// A filter that hides every conflict is a filter with nothing to show.
watch(conflictCount, (count) => {
  if (count === 0) conflictsOnly.value = false;
});

function copyNamespace(namespace: string) {
  copyToClipboard(namespace, 'Copied namespace to clipboard');
}

function sourceLabel(source: PrefixMapping['source']): string {
  switch (source) {
    case 'default': return 'Default';
    case 'auto-discovered': return 'Discovered';
    case 'user-added': return 'Added by you';
    case 'endpoint': return 'From endpoint';
    default: return source;
  }
}

/**
 * What the source column says a mapping was learned from.
 *
 * The kind of thing first: a prefix learned from an unsaved rule set came from
 * a rule set, and "scratch:rules:3f2c…" was never what anyone wanted to read
 * there. Whether it has been saved yet is a qualifier on that, and — because a
 * scratch item is addressable by id — not a reason to drop the link.
 */
function sourceFromLabel(from: string): string {
  const source = parsePrefixSource(from);
  // Anything else is an id this build has no kind for — an endpoint's, most
  // likely, whose own column already says so — shown as itself rather than
  // guessed at.
  return source ? prefixSourceLabel(source) : `from ${shortUrn(from)}`;
}

function shortUrn(urn: string, maxLength = 24): string {
  if (urn.length <= maxLength) return urn;
  return `…${urn.slice(urn.length - maxLength + 1)}`;
}

/** Where a discovered mapping's source opens, or null when it isn't addressable. */
function sourceLink(from: string): { path: string; query: Record<string, string> } | null {
  const source = parsePrefixSource(from);
  return source ? prefixSourceRoute(source) : null;
}

function addNewPrefix() {
  const newId = uuidv4();
  const newMapping: PrefixMapping = {
    id: newId,
    prefix: '',
    namespace: '',
    enabled: true,
    isDefault: false,
    source: 'user-added',
    createdAt: Date.now(),
  };
  prefixSettings.value.mappings.unshift(newMapping);
  searchQuery.value = '';
  conflictsOnly.value = false;
  // The empty prefix sorts before everything, so the new row is on page one.
  page.value = 1;
  editingId.value = newId;
  editForm.value = { prefix: '', namespace: '' };
}

function startEdit(mapping: PrefixMapping) {
  editingId.value = mapping.id;
  editForm.value = { prefix: mapping.prefix, namespace: mapping.namespace };
}

function saveEdit() {
  if (!editingId.value) return;
  if (!editForm.value.prefix.trim()) {
    toast.error('Prefix cannot be empty.');
    return;
  }
  if (!editForm.value.namespace.trim()) {
    toast.error('Namespace cannot be empty.');
    return;
  }
  try {
    updatePrefix(editingId.value, { ...editForm.value });
    toast.success(`Prefix ${editForm.value.prefix}: saved.`);
    editingId.value = null;
  } catch (e: any) {
    toast.error(`Save failed: ${e.message}`);
  }
}

function cancelEdit() {
  if (editingId.value) {
    const current = prefixSettings.value.mappings.find(m => m.id === editingId.value);
    if (current && current.prefix === '' && current.namespace === '') {
      removePrefix(editingId.value);
    }
  }
  editingId.value = null;
  editForm.value = { prefix: '', namespace: '' };
}

/*
 * No confirm dialog. A prefix mapping is cheap to recreate and the undo strip
 * below the table puts it back exactly where it was, default or not.
 */
function removeMapping(mapping: PrefixMapping) {
  if (editingId.value === mapping.id) cancelEdit();
  const index = prefixSettings.value.mappings.findIndex(m => m.id === mapping.id);
  removePrefix(mapping.id);
  removed.value = { mapping: { ...mapping }, index: index === -1 ? 0 : index };
}

function undoRemove() {
  if (!removed.value) return;
  restorePrefix(removed.value.mapping, removed.value.index);
  removed.value = null;
}

function resetToDefaultsConfirm() {
  showResetConfirm.value = true;
}

function resetToDefaults() {
  managerResetToDefaults();
  removed.value = null;
  toast.success('Prefixes reset to defaults.');
  showResetConfirm.value = false;
}

function downloadTurtle(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/turtle' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleExportVann() {
  downloadTurtle(exportPrefixesVann(), 'prefixes-vann.ttl');
  toast.success('Prefixes exported as VANN.');
}

function handleExportRdfa() {
  downloadTurtle(exportPrefixesRdfa(), 'prefixes-rdfa.ttl');
  toast.success('Prefixes exported as RDFa.');
}
</script>

<!--
  Unscoped on purpose. `DialogContent`'s template root is a portal rather than
  an element, so Vue has no root node to stamp this component's scope id onto —
  a `<style scoped>` rule for `.prefix-dialog` matches nothing and the dialog
  keeps shadcn's 512px default. The class is unique to this dialog.
-->
<style>
.prefix-dialog {
  /* Two rows: the header, then a body that owns the remaining height so the
     table scrolls inside the dialog rather than the dialog growing past 85vh.
     The height is fixed, not a maximum: filtering must not resize the dialog
     under the pointer as rows come and go. */
  grid-template-rows: auto minmax(0, 1fr);
  width: min(95vw, 1000px);
  max-width: min(95vw, 1000px);
  height: 85vh;
  max-height: 85vh;
  border-radius: var(--radius-xl);
  overflow: hidden;
}
</style>

<style scoped>
/* The count and the ⋯ menu the title bar carries in its slots; slotted content
   is compiled in this component's scope, so these rules stay here. */
.prefix-count {
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h);
  height: var(--control-h);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  transition: background var(--duration), color var(--duration);
}

.icon-button.bordered {
  border-color: var(--border-default);
  background: var(--surface);
  color: var(--ink-secondary);
}

.icon-button:hover {
  background: var(--surface-subtle);
  color: var(--ink);
}

.icon-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -1px;
}

.prefix-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  padding: var(--space-5);
}

.prefix-blurb {
  font-size: var(--text-body);
  line-height: 1.5;
  color: var(--ink-muted);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.filter-field {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
}

.filter-field:focus-within {
  border-color: var(--action);
}

.filter-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: var(--text-body);
  color: var(--ink);
}

.conflicts-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius);
  background: var(--warning-surface);
  color: var(--warning-ink);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: border-color var(--duration);
}

.conflicts-button:hover,
.conflicts-button.active {
  border-color: var(--warning);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  height: var(--control-h);
  min-width: var(--grid-3);
  padding: 0 var(--space-5);
  border: 1px solid var(--action);
  border-radius: var(--radius);
  background: var(--action);
  color: var(--action-fg);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration), border-color var(--duration);
}

.btn-primary:hover {
  background: var(--action-hover);
  border-color: var(--action-hover);
}

.conflicts-button:focus-visible,
.btn-primary:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 1px;
}

.prefix-table {
  display: flex;
  /* Fills whatever the fixed-height dialog leaves, so the table's frame and
     footer hold still while filtering changes how many rows are inside it. */
  flex: 1;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: 44px 132px 1fr 184px 60px;
  gap: var(--space-4);
}

.table-head {
  align-items: center;
  padding: var(--space-2) var(--space-4);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.column-label {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.table-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--surface);
}

.table-row {
  align-items: start;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.table-row:last-child {
  border-bottom: none;
}

.table-row:hover {
  background: var(--surface-subtle);
}

.cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
}

.switch-cell {
  flex-direction: row;
  align-items: center;
  height: var(--control-h-sm);
}

.actions {
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1);
  height: var(--control-h-sm);
}

.prefix-name,
.namespace {
  display: flex;
  align-items: center;
  height: var(--control-h-sm);
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.prefix-name {
  color: var(--ink);
}

.namespace {
  color: var(--ink-secondary);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.namespace:hover {
  text-decoration: underline;
}

.shadow-mark {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label);
  color: var(--warning-ink);
}

.row-note {
  font-size: var(--text-label);
  line-height: 1.4;
  color: var(--ink-muted);
}

/* The source label and its link sit side by side so a discovered row is no
   taller than one whose source has nowhere to link to. */
.source-cell {
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm);
}

.source {
  display: flex;
  align-items: center;
  flex: none;
  height: var(--control-h-sm);
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.source-from {
  min-width: 0;
  font-size: var(--text-label);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--action);
  text-decoration: none;
}

.source-link-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-link-glyph {
  flex: none;
}

.source-link:hover .source-link-text {
  text-decoration: underline;
}

.source-link:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 1px;
  border-radius: var(--radius);
}

.table-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: var(--surface-subtle);
  border-top: 1px solid var(--border-default);
}

.page-label {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.page-buttons {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.page-count {
  min-width: var(--grid-1, 40px);
  text-align: center;
  font-size: var(--text-label);
  color: var(--ink-secondary);
}

.page-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background var(--duration), color var(--duration);
}

.page-button:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--ink);
}

.page-button:disabled {
  color: var(--ink-disabled);
  cursor: default;
}

.page-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -1px;
}

.row-input {
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--action);
  border-radius: var(--radius);
  outline: none;
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  color: var(--ink);
}

.row-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  transition: background var(--duration), color var(--duration);
}

.row-button:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

.row-button.save {
  color: var(--success);
}

.row-button.danger:hover {
  background: var(--danger-surface);
  color: var(--danger);
}

.row-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -1px;
}

.undo-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface-subtle);
}

.undo-label {
  font-size: var(--text-body);
  color: var(--ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.undo-button {
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--action);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration);
}

.undo-button:hover {
  background: var(--action-surface);
}

.undo-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -1px;
}
</style>
