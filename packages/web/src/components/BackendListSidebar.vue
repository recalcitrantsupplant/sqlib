<template>
  <aside class="backend-sidebar" :class="{ collapsed }" data-testid="backend-list-sidebar">
    <!--
      Folded, the same rail the artifact sidebars fold to: the hinge back out,
      + New, and the section's name on its side. Collapse-only, for the same
      reason — a fixed vocabulary has a comfortable width.
    -->
    <template v-if="collapsed">
      <button
        class="hinge rail-hinge"
        data-testid="sidebar-hinge"
        title="Expand the list"
        aria-label="Expand the list"
        :aria-expanded="false"
        @click="toggleCollapsed"
      >
        <PanelLeftOpen :size="14" />
      </button>
      <button
        class="rail-new"
        data-testid="rail-new-backend"
        title="New backend"
        aria-label="New backend"
        @click="emit('create')"
      >
        <Plus :size="14" />
      </button>
      <div class="rail-spine">
        <span class="rail-count">{{ backends.length }}</span>
        <span class="rail-label">Backends</span>
      </div>
    </template>

    <div v-if="!collapsed" class="sidebar-header">
      <button
        class="hinge"
        data-testid="sidebar-hinge"
        title="Collapse the list"
        aria-label="Collapse the list"
        :aria-expanded="true"
        @click="toggleCollapsed"
      >
        <PanelLeftClose :size="13" />
      </button>
      <Server :size="13" class="header-icon" />
      <span class="header-name">Backends</span>
      <span class="header-count" data-testid="backend-count">{{ backends.length }}</span>
      <button
        class="add-button"
        title="New backend"
        aria-label="New backend"
        data-testid="new-backend"
        @click="emit('create')"
      >
        <Plus :size="13" />
      </button>
    </div>

    <div v-if="!collapsed" class="filter-bar">
      <label class="filter-field">
        <Search :size="12" />
        <input
          v-model="filter"
          type="text"
          class="filter-input"
          placeholder="Filter backends"
          aria-label="Filter backends"
          data-testid="backend-filter"
        />
      </label>
    </div>

    <div v-if="!collapsed" class="backend-list">
      <!--
        The unsaved row sits at the top and stays there while it is being
        filled in: creation is a record in this list, not a dialog over it.
      -->
      <div v-if="draft" class="backend-row draft-row selected" data-testid="backend-draft-row">
        <span class="health-dot health-dot--draft" aria-hidden="true" />
        <span class="row-text">
          <span class="row-name row-name--draft">{{ draftName || 'Untitled backend' }}</span>
          <span class="row-host">unsaved</span>
        </span>
        <button
          class="discard-button"
          title="Discard this backend"
          aria-label="Discard this backend"
          data-testid="discard-backend-draft"
          @click.stop="emit('discard-draft')"
        >
          <X :size="12" />
        </button>
      </div>

      <InlineNote v-if="loading" class="list-message">Loading backends…</InlineNote>
      <InlineNote v-else-if="error" tone="danger" class="list-message">{{ error }}</InlineNote>
      <InlineNote v-else-if="backends.length === 0 && !draft" class="list-message">
        No backends yet. Add one with +.
      </InlineNote>
      <InlineNote v-else-if="visible.length === 0 && !draft" class="list-message">Nothing matches “{{ filter }}”.</InlineNote>

      <div
        v-for="backend in visible"
        :key="backend.id"
        class="backend-row"
        :class="{ selected: backend.id === selectedId }"
        data-testid="backend-row"
        :data-backend-id="backend.id"
        role="button"
        tabindex="0"
        @click="emit('select', backend.id)"
        @keydown.enter="emit('select', backend.id)"
      >
        <!--
          A browser backend keeps the dot's space and says nothing in it. The
          dot reports what a probe found, and the server cannot probe a record
          it does not have — grey-for-never-probed would be a claim about a
          probe that is never going to happen. Hidden rather than absent, so a
          list holding both kinds still lines up.
        -->
        <span
          class="health-dot"
          :class="isBrowserBackendId(backend.id) ? 'health-dot--none' : `health-dot--${healthFor(backend.id)}`"
          :title="isBrowserBackendId(backend.id) ? undefined : healthTitle(backend.id)"
          data-testid="backend-health-dot"
          aria-hidden="true"
        />
        <span class="row-text">
          <span class="row-name">
            {{ backend.name }}
            <!--
              Said in the list, not only on the record: a visitor scanning for
              where a query will run needs to see which rows are theirs alone
              without opening each one.
            -->
            <span
              v-if="isBrowserBackendId(backend.id)"
              class="row-badge"
              title="Registered in this browser only"
              data-testid="browser-backend-badge"
            >Browser</span>
          </span>
          <span class="row-host">{{ hostOf(backend) }}</span>
        </span>
        <span v-if="!isBrowserBackendId(backend.id)" class="row-latency">{{ latencyOf(backend.id) }}</span>
      </div>
    </div>

    <div v-if="!collapsed" class="sidebar-footer">
      <!--
        Nothing to probe is not the same as no backends: a list of nothing but
        browser backends has none the server could reach, so the button would
        ask it to probe a set it knows nothing about.
      -->
      <button
        class="probe-all-button"
        :disabled="probingAll || probableCount === 0"
        data-testid="probe-all"
        @click="emit('probe-all')"
      >
        <RefreshCw :size="12" :class="{ spinning: probingAll }" />
        {{ probingAll ? 'Probing…' : 'Probe all' }}
      </button>
      <span class="footer-note">Account level · attach to use</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Server, X } from '@lucide/vue';
import type { Backend } from '@sparql-query-lib/contracts';
import InlineNote from './shared/InlineNote.vue';
import { fuzzyMatches } from '../lib/fuzzy';
import { useBackendProbes } from '../composables/useBackendProbes';
import { isBrowserBackendId } from '../composables/useBrowserBackends';
import { useSidebarCollapse } from '../composables/useSidebarCollapse';

/**
 * The backends list — the same sidebar shape as queries, groups and rule sets,
 * carrying the two facts a connection has that an artifact does not: whether it
 * is answering, and how fast (backends UI doc §Layout).
 */
const props = defineProps<{
  backends: Backend[];
  selectedId: string | null;
  /** An unsaved backend being filled in, pinned above the saved rows. */
  draft: boolean;
  draftName?: string;
  loading?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'discard-draft'): void;
  (e: 'create'): void;
  (e: 'probe-all'): void;
}>();

const { probeFor, healthFor, probingAll } = useBackendProbes();

const { collapsed, toggle: toggleCollapsed } = useSidebarCollapse('backends');

const filter = ref('');

/*
 * Fuzzy on the name (`lib/fuzzy`), substring on the endpoint — a URL matches a
 * subsequence of almost anything. The alphabetical order stands: a filter here
 * removes rows, it does not re-rank them.
 */
const visible = computed(() => {
  const rows = [...props.backends].sort((a, b) => a.name.localeCompare(b.name));
  return rows.filter((backend) => fuzzyMatches(filter.value, backend.name, backend.endpoint));
});

/** Host, not the whole URL: the path is the same `/sparql` on every row. */
function hostOf(backend: Backend): string {
  const endpoint = backend.endpoint ?? '';
  if (!endpoint) return 'in-process';
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function latencyOf(id: string): string {
  const probe = probeFor(id);
  if (!probe) return '—';
  return probe.latencyMs === null ? '—' : `${probe.latencyMs} ms`;
}

/** How many of these the server could actually probe. */
const probableCount = computed(
  () => props.backends.filter((backend) => !isBrowserBackendId(backend.id)).length,
);

function healthTitle(id: string): string {
  const probe = probeFor(id);
  if (!probe) return 'Never probed';
  if (probe.health === 'unreachable') return `Unreachable — ${probe.error ?? 'no answer'}`;
  return probe.health === 'slow' ? `Slow — ${probe.latencyMs} ms` : `Healthy — ${probe.latencyMs} ms`;
}
</script>

<style scoped>
.backend-sidebar {
  width: 272px;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-default);
  transition: width 0.18s ease;
}

.backend-sidebar.collapsed {
  width: 44px;
  align-items: center;
  overflow: hidden;
}

.hinge {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.hinge:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

/* Full-bleed so its lower border joins the one the header draws. */
.rail-hinge {
  width: 100%;
  height: 40px;
  border-radius: 0;
  border-bottom: 1px solid var(--border-default);
  background: var(--surface);
}

.rail-new {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-top: var(--space-4);
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  cursor: pointer;
}

.rail-new:hover {
  color: var(--ink);
  border-color: var(--border-strong);
}

.rail-spine {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: var(--space-5);
  min-height: 0;
  overflow: hidden;
}

.rail-count {
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}

.rail-label {
  writing-mode: vertical-rl;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 40px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 var(--space-5);
  background: var(--surface);
  border-bottom: 1px solid var(--border-default);
}

.header-icon {
  color: var(--ink-muted);
}

.header-name {
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.header-count {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.add-button {
  margin-left: auto;
  display: inline-flex;
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

.add-button:hover {
  background: var(--surface-subtle);
}

.filter-bar {
  flex-shrink: 0;
  padding: var(--space-4) var(--space-4) var(--space-2);
}

.filter-field {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-disabled);
}

.filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
}

.filter-input:focus {
  outline: none;
}

.backend-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-2) var(--space-4) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* The inset is the list's fact about where a message sits, not the note's. */
.list-message {
  padding: var(--space-4);
}

.backend-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-panel);
  cursor: pointer;
}

.backend-row:hover {
  background: var(--surface-raised);
}

.backend-row.selected {
  background: var(--action-surface);
}

.health-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--state-idle);
}

.health-dot--healthy {
  background: var(--success);
}

.health-dot--slow {
  background: var(--warning);
}

.health-dot--unreachable {
  background: var(--danger);
}

.health-dot--never_probed {
  background: var(--border-strong);
}

/* Keeps the column, claims nothing — see the row's own comment. */
.health-dot--none {
  visibility: hidden;
}

.health-dot--draft {
  background: var(--warning);
}

.row-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.row-name {
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backend-row.selected .row-name {
  font-weight: var(--weight-semibold);
}

.row-name--draft {
  color: var(--ink-muted);
}

.row-badge {
  margin-left: var(--space-1);
  padding: 0 var(--space-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--text-micro);
  color: var(--ink-muted);
  vertical-align: middle;
}

.row-host {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-latency {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
  white-space: nowrap;
}

.discard-button {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.discard-button:hover {
  color: var(--danger);
}

.sidebar-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--surface);
  border-top: 1px solid var(--border-default);
}

.probe-all-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.probe-all-button:hover:not(:disabled) {
  background: var(--surface-subtle);
}

.probe-all-button:disabled {
  color: var(--ink-disabled);
  cursor: default;
}

.footer-note {
  font-size: var(--text-micro);
  color: var(--ink-muted);
  line-height: var(--leading-tight);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
