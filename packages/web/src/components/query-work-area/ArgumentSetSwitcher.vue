<template>
  <div class="switcher">
    <!--
      Identity first, then what runs. Name and description left the panel body
      entirely: a set is identified here and renamed from the ⋮ menu, so the
      body below can be nothing but the query's signature and the values
      filling it (design §4).
    -->
    <div class="identity">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="name-trigger" type="button" :disabled="disabled" data-testid="argument-set-switcher">
            <span class="name">{{ displayName }}</span>
            <ChevronsUpDown :size="13" class="name-chevron" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="set-menu">
          <template v-if="scratchSets.length">
            <DropdownMenuLabel class="menu-heading">
              Scratch
              <span class="menu-heading-count">{{ scratchSets.length }}</span>
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="entry in scratchSets"
              :key="entry.id"
              class="set-row"
              @select="emit('select-scratch', entry.id)"
            >
              <span class="set-row-name">{{ entry.name || 'Untitled set' }}</span>
              <span class="set-row-meta">{{ entry.meta }}</span>
            </DropdownMenuItem>
          </template>

          <template v-if="savedSets.length">
            <DropdownMenuSeparator v-if="scratchSets.length" />
            <DropdownMenuLabel class="menu-heading">
              Saved
              <span class="menu-heading-count">{{ savedSets.length }}</span>
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="entry in savedSets"
              :key="entry.id"
              class="set-row"
              @select="emit('select-set', entry.id)"
            >
              <span class="set-row-name">{{ entry.name }}</span>
              <span class="set-row-meta">{{ entry.meta }}</span>
            </DropdownMenuItem>
          </template>

          <DropdownMenuSeparator v-if="scratchSets.length || savedSets.length" />
          <DropdownMenuItem class="set-row set-row--new" data-testid="argument-new-scratch" @select="emit('create-scratch')">
            <Plus :size="13" />
            <span class="set-row-name">New scratch set</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span v-if="stateLabel" class="state-badge" data-testid="argument-set-state" :class="stateBadgeClass">{{ stateLabel }}</span>
      <span v-if="editSummary" class="edit-summary">{{ editSummary }}</span>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="btn-more" type="button" :disabled="disabled || !hasSelection" title="More">
            <MoreVertical :size="14" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @select="emit('rename')">Rename…</DropdownMenuItem>
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
import { computed } from 'vue';
import { ChevronsUpDown, MoreVertical, Plus } from '@lucide/vue';
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
}>();

const emit = defineEmits<{
  (e: 'select-set', setId: string): void;
  (e: 'select-scratch', scratchId: string): void;
  (e: 'create-scratch'): void;
  (e: 'run-with', target: RunTarget): void;
  (e: 'rename'): void;
  (e: 'copy'): void;
  (e: 'delete'): void;
}>();

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

.btn-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
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

.set-row--new {
  color: var(--ink-secondary);
}

.menu-danger {
  color: var(--danger);
}
</style>
