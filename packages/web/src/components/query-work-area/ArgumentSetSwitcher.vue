<template>
  <div class="switcher">
    <!--
      Identity first, then what runs. Name and description left the panel body
      entirely: a set is identified here and renamed from the ⋮ menu, so the
      body below can be nothing but the query's signature and the values
      filling it (design §4).
    -->
    <div class="identity">
      <!--
        Renaming happens here, in the name's own place. It used to be a
        `window.prompt`, which a browser stops showing once someone ticks
        "prevent this page from creating more dialogs" — after which Rename…
        did nothing at all, with no way to tell. Same interaction as a backend's
        fields: click, type, Enter or blur commits, Esc abandons.
      -->
      <form
        v-if="renaming"
        class="rename"
        data-testid="argument-set-rename"
        @submit.prevent="commitRename"
      >
        <input
          ref="renameInput"
          v-model="renameDraft"
          class="rename-input"
          aria-label="Argument set name"
          placeholder="Untitled set"
          data-testid="argument-set-rename-input"
          @keydown.esc.prevent="renaming = false"
          @blur="commitRename"
        >
      </form>

      <DropdownMenu v-else>
        <DropdownMenuTrigger as-child>
          <button class="name-trigger" type="button" :disabled="disabled" data-testid="argument-set-switcher">
            <span class="name">{{ displayName }}</span>
            <ChevronsUpDown :size="13" class="name-chevron" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="set-menu" @open-auto-focus="focusFilter">
          <!--
            New first, then the filter, then the sets. At the foot of the list
            it moved down every time a set was added, and fell off the bottom
            of a long menu.
          -->
          <DropdownMenuItem class="set-row set-row--new" data-testid="argument-new-scratch" @select="emit('create-scratch')">
            <Plus :size="13" />
            <span class="set-row-name">New scratch set</span>
          </DropdownMenuItem>

          <template v-if="scratchSets.length || savedSets.length">
            <DropdownMenuSeparator />
            <!--
              The same box as the other lists (`FilterBox`, fuzzy on the name).
              A menu reads typed characters as typeahead, so they stop here;
              ArrowDown hands focus on to the first row.
            -->
            <div class="set-filter" @keydown="onFilterKeydown">
              <FilterBox
                ref="filterBox"
                v-model="filter"
                placeholder="Filter sets…"
                aria-label="Filter argument sets"
                test-id="argument-set-filter"
              />
            </div>
            <InlineNote v-if="!visibleScratch.length && !visibleSaved.length" size="xs" class="set-filter-empty">
              Nothing matches “{{ filter }}”.
            </InlineNote>
          </template>

          <template v-if="visibleScratch.length">
            <DropdownMenuSeparator />
            <DropdownMenuLabel class="menu-heading">
              Scratch
              <span class="menu-heading-count">{{ visibleScratch.length }}</span>
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="entry in visibleScratch"
              :key="entry.id"
              class="set-row"
              @select="emit('select-scratch', entry.id)"
            >
              <span class="set-row-name">{{ entry.name || 'Untitled set' }}</span>
              <span class="set-row-meta">{{ entry.meta }}</span>
            </DropdownMenuItem>
          </template>

          <template v-if="visibleSaved.length">
            <DropdownMenuSeparator />
            <DropdownMenuLabel class="menu-heading">
              Saved
              <span class="menu-heading-count">{{ visibleSaved.length }}</span>
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="entry in visibleSaved"
              :key="entry.id"
              class="set-row"
              @select="emit('select-set', entry.id)"
            >
              <span class="set-row-name">{{ entry.name }}</span>
              <span class="set-row-meta">{{ entry.meta }}</span>
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>

      <span v-if="stateLabel" class="state-badge" data-testid="argument-set-state" :class="stateBadgeClass">{{ stateLabel }}</span>
      <span v-if="editSummary" class="edit-summary">{{ editSummary }}</span>

      <!--
        Pop-out sits on the set, next to the ⋮ that acts on it, rather than in
        the inspector's tab strip: the strip is shared with Details and Code,
        which have nothing to pop out, and Results already carries its own in
        the results action bar.
      -->
      <button
        v-if="canExpand"
        class="btn-more"
        type="button"
        data-testid="arguments-expand"
        title="Pop out"
        @click="emit('expand')"
      >
        <Expand :size="14" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="btn-more" type="button" :disabled="disabled || !hasSelection" title="More" data-testid="argument-set-more">
            <MoreVertical :size="14" />
          </button>
        </DropdownMenuTrigger>
        <!--
          Rename… opens the field as the menu finishes closing, not when it is
          picked. While a menu is open it traps focus, so a field opened during
          the select is focused and immediately pulled back inside — arriving
          as a blur on the new field, which commits it before a character has
          been typed. `closeAutoFocus` is where the menu hands focus back, so
          it is where the field can take it instead.
        -->
        <DropdownMenuContent align="end" @close-auto-focus="openRenameOnClose">
          <DropdownMenuItem data-testid="argument-set-rename-open" @select="renameRequested = true">Rename…</DropdownMenuItem>
          <DropdownMenuItem :disabled="!canCopy" @select="emit('copy')">Copy JSON</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="!canDelete" class="menu-danger" @select="emit('delete')">
            Delete set
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!--
      One segmented control replaces the pin checkbox, the freeze button and the
      mutability warning: pick the draft or any saved version, and that is
      what executes. Same vocabulary as Run draft on the query itself (design §4).
    -->
    <div v-if="runOptions.length > 1" class="run-with">
      <span class="run-with-label">Run with</span>
      <div class="segments" role="group" aria-label="Run with" data-testid="argument-run-with">
        <button
          v-for="option in runOptions"
          :key="option.key"
          type="button"
          class="segment"
          data-testid="argument-run-option"
          :class="{ 'segment--selected': option.key === activeRunKey }"
          :disabled="disabled"
          @click="emit('run-with', option.target)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <InlineNote v-else-if="hasSelection && !hasVersions" size="xs" class="run-with-note">
      {{ isScratch ? 'no versions yet' : 'no saved version yet' }}
    </InlineNote>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { ChevronsUpDown, Expand, MoreVertical, Plus } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { RunTarget } from '@/composables/useArgumentSets';
import InlineNote from '../shared/InlineNote.vue';
import FilterBox from '../shared/FilterBox.vue';
import { fuzzyMatches } from '@/lib/fuzzy';

/** One row in the switcher list. `meta` is the right-hand grey text. */
export interface SwitcherEntry {
  id: string;
  name: string;
  meta: string;
}

const props = defineProps<{
  displayName: string;
  stateLabel: string;
  isScratch: boolean;
  hasDraft: boolean;
  hasSelection: boolean;
  editCount: number;
  /** ISO time of the last edit, for the age in the summary line. */
  draftSavedAt: string | null;
  scratchSets: SwitcherEntry[];
  savedSets: SwitcherEntry[];
  /** Saved versions, newest first. */
  versions: { id: string; version: number }[];
  runTarget: RunTarget;
  canDelete?: boolean;
  canCopy?: boolean;
  disabled?: boolean;
  /** Draws the pop-out button. Off where there is no focus mode to open. */
  canExpand?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select-set', setId: string): void;
  (e: 'select-scratch', scratchId: string): void;
  (e: 'create-scratch'): void;
  (e: 'run-with', target: RunTarget): void;
  (e: 'rename', name: string): void;
  (e: 'copy'): void;
  (e: 'delete'): void;
  (e: 'expand'): void;
}>();

const renaming = ref(false);
const renameRequested = ref(false);
const renameDraft = ref('');
const renameInput = useTemplateRef<HTMLInputElement>('renameInput');

async function startRename() {
  renameDraft.value = props.displayName === 'No argument set' ? '' : props.displayName;
  renaming.value = true;
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}

function openRenameOnClose(event: Event) {
  if (!renameRequested.value) return;
  renameRequested.value = false;
  // The field takes the focus the trigger would have been given back.
  event.preventDefault();
  void startRename();
}

function commitRename() {
  if (!renaming.value) return;
  const next = renameDraft.value.trim();
  renaming.value = false;
  if (!next || next === props.displayName) return;
  emit('rename', next);
}

/**
 * Fuzzy on the name, the rule every list of names filters by (`lib/fuzzy`).
 * The rows keep their own order — scratch, then saved — so the filter removes
 * rows rather than shuffling them.
 */
const filter = ref('');
const filterBox = useTemplateRef<InstanceType<typeof FilterBox>>('filterBox');
const visibleScratch = computed(() =>
  props.scratchSets.filter((entry) => fuzzyMatches(filter.value, entry.name || 'Untitled set', entry.meta)),
);
const visibleSaved = computed(() =>
  props.savedSets.filter((entry) => fuzzyMatches(filter.value, entry.name, entry.meta)),
);

/** Each opening starts from the whole list, with the caret in the filter. */
function focusFilter(event: Event) {
  filter.value = '';
  const input = (filterBox.value?.$el as HTMLElement | undefined) ?? null;
  if (!input) return;
  event.preventDefault();
  input.focus();
}

function onFilterKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    const menu = (event.currentTarget as HTMLElement).closest('[role="menu"]');
    const rows = menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])') ?? [];
    // The first row is New, above the box; the first set is the one after it.
    const below = [...rows].find((row) => row.compareDocumentPosition(event.currentTarget as Node) & Node.DOCUMENT_POSITION_PRECEDING);
    below?.focus();
    return;
  }
  if (event.key === 'Escape' || event.key === 'Tab') return;
  event.stopPropagation();
}

const hasVersions = computed(() => props.versions.length > 0);

const stateBadgeClass = computed(() => ({
  'state-badge--draft': props.stateLabel === 'Draft',
  'state-badge--scratch': props.stateLabel === 'Scratch',
}));

/**
 * The line beside the badge: how much unsaved work there is, and how long ago
 * the last of it was made. It does not say where those edits are being kept —
 * "saved locally" put the word `save` on browser storage while the button
 * beside it used the same word for a version on the server.
 */
const editSummary = computed(() => {
  if (!props.hasDraft) return '';
  const parts: string[] = [];
  if (props.editCount > 0) {
    parts.push(`${props.editCount} unsaved edit${props.editCount === 1 ? '' : 's'}`);
  }
  if (props.draftSavedAt) parts.push(relative(props.draftSavedAt));
  return parts.join(' · ');
});

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'just now';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** Draft first, then versions newest first — the order the design shows. */
const runOptions = computed(() => {
  const options: { key: string; label: string; target: RunTarget }[] = [];
  if (props.isScratch || props.hasDraft) {
    options.push({ key: 'draft', label: props.isScratch ? 'Scratch' : 'Draft', target: { kind: 'draft' } });
  }
  for (const version of props.versions) {
    options.push({
      key: version.id,
      label: `v${version.version}`,
      target: { kind: 'version', versionId: version.id },
    });
  }
  return options;
});

const activeRunKey = computed(() =>
  props.runTarget.kind === 'draft' ? 'draft' : props.runTarget.versionId,
);
</script>

<style scoped>
.switcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
}

.identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.name-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}

.name-trigger:hover:not(:disabled) {
  background: var(--surface-raised);
}

.name-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name-chevron {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.state-badge {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--ink-muted);
  background: var(--surface-raised);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-3);
}

.state-badge--draft,
.state-badge--scratch {
  color: var(--warning-ink);
  background: var(--warning-surface);
}

.edit-summary {
  font-size: var(--text-micro);
  color: var(--ink-muted);
  white-space: nowrap;
}

/* The editing state of the name, matching a backend's inline fields. */
.rename {
  display: flex;
  min-width: 0;
}

.rename-input {
  width: var(--grid-6);
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--action);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  box-shadow: 0 0 0 3px var(--action-surface);
}

.rename-input:focus {
  outline: none;
}

.btn-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h);
  height: var(--control-h);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.btn-more:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--ink);
}

.btn-more:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.run-with {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/*
 * "Run with" names the control beside it; the note says why there is no control
 * to name. They shared one rule while both were hand-written type — the note is
 * an <InlineNote> now, and what is left here is the label's own spec plus the
 * one line that is layout rather than type.
 */
.run-with-label {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
  white-space: nowrap;
}

.run-with-note {
  white-space: nowrap;
}

.segments {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}

.segment {
  padding: var(--space-1) var(--space-4);
  border: none;
  border-right: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
  font-weight: 500;
  cursor: pointer;
}

.segment:last-child {
  border-right: none;
}

.segment:hover:not(:disabled):not(.segment--selected) {
  background: var(--surface-subtle);
}

/*
 * Near-black on white rather than blue: blue is already the type chips, and two
 * blue selections in one row read as one control. The token inverts with the
 * theme on purpose.
 */
.segment--selected {
  background: var(--segment-selected);
  color: var(--segment-selected-ink);
}

.segment:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.menu-heading {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--text-micro);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-muted);
}

.menu-heading-count {
  font-weight: 400;
}

.set-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--text-body);
}

.set-row-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.set-row-meta {
  font-size: var(--text-micro);
  color: var(--ink-muted);
  white-space: nowrap;
}

.set-filter {
  padding: var(--space-1) var(--space-2);
}

.set-filter-empty {
  padding: var(--space-1) var(--space-3);
}

.set-row--new {
  color: var(--ink-secondary);
}

.menu-danger {
  color: var(--danger);
}
</style>
