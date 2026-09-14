<script setup lang="ts">
/**
 * The second column: the plan, or the runs. One screen in two modes.
 *
 * The zones are the design's whole argument (§7.2). Above the divider are the
 * **axes** — things that multiply — each with its count, its multiplier and its
 * own +. Below it are the **settings**, which never multiply and so carry
 * neither. The footer is the arithmetic, live, because knowing a plan is 4,320
 * requests before pressing Run is the most useful thing on the screen.
 *
 * Drawing them as one flat list is what the earlier version did, and it hid a
 * category error: only Cases had an Add button, because only Cases felt like a
 * list.
 */
import { computed } from 'vue';
import {
  Braces,
  ChevronRight,
  CircleAlert,
  FileCode2,
  History,
  Layers,
  Plus,
  Repeat,
  Server,
  ShieldCheck,
  Shuffle,
  Sigma,
  SlidersHorizontal,
  Table,
} from '@lucide/vue';
import { formatCount, formatDuration, type Expansion } from '../../lib/benchmarkPlan';
import type {
  AxisGroupView,
  AxisKey,
  RunListItem,
  SettingItemView,
  SettingKey,
} from '../../lib/benchmarkViews';
import InlineNote from '../shared/InlineNote.vue';

const props = defineProps<{
  tab: 'plan' | 'runs';
  groups: AxisGroupView[];
  settings: SettingItemView[];
  expansion: Expansion;
  /** Estimated wall clock in ms, or null before this benchmark has ever run. */
  estimateMs: number | null;
  selectedKind: AxisKey | 'setting' | null;
  selectedId: string | null;
  runs: RunListItem[];
  selectedRunId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:tab', tab: 'plan' | 'runs'): void;
  (e: 'select-item', payload: { kind: AxisKey; id: string }): void;
  (e: 'select-setting', key: SettingKey): void;
  (e: 'add', axis: AxisKey): void;
  (e: 'select-run', id: string): void;
}>();

const AXIS_ICON = {
  cases: FileCode2,
  backends: Server,
  argumentSets: Braces,
  // The run bar's vocabulary for the same two things (`lib/runBar.ts`): a table
  // for the tabular input, layers for RDF content.
  tupleSets: Table,
  dataGraphs: Layers,
  loadProfiles: Repeat,
} as const;

const SETTING_ICON = {
  statistic: Sigma,
  equivalence: ShieldCheck,
  failure: CircleAlert,
  order: Shuffle,
} as const;

const estimate = computed(() =>
  props.estimateMs == null ? null : `~${formatDuration(props.estimateMs)}`);

function isSelected(kind: AxisKey, id: string) {
  return props.selectedKind === kind && props.selectedId === id;
}
</script>

<template>
  <aside class="plan-sidebar" data-testid="benchmark-plan-sidebar">
    <div class="tab-row">
      <button
        class="tab"
        :class="{ 'tab-on': tab === 'plan' }"
        data-testid="benchmark-tab-plan"
        @click="emit('update:tab', 'plan')"
      >
        <SlidersHorizontal :size="13" />Plan
      </button>
      <button
        class="tab"
        :class="{ 'tab-on': tab === 'runs' }"
        data-testid="benchmark-tab-runs"
        @click="emit('update:tab', 'runs')"
      >
        <History :size="13" />Runs<span class="tab-count">{{ runs.length }}</span>
      </button>
    </div>

    <div v-if="tab === 'plan'" class="scroller">
      <div class="zone-label">
        <span class="zone-name">Axes</span>
        <span class="zone-note">these multiply</span>
        <span class="zone-rule" />
      </div>

      <div v-for="group in groups" :key="group.key" class="axis-group">
        <div class="axis-head">
          <component :is="AXIS_ICON[group.key]" :size="12" class="axis-icon" />
          <span class="axis-name">{{ group.name }}</span>
          <span class="axis-multiplier">{{ group.multiplier }}</span>
          <button
            v-if="group.canAdd"
            class="axis-add"
            :title="`Add ${group.addLabel}`"
            :data-testid="`benchmark-add-${group.key}`"
            @click="emit('add', group.key)"
          >
            <Plus :size="12" />
          </button>
        </div>

        <button
          v-for="item in group.items"
          :key="item.id"
          class="axis-item"
          :class="{ 'axis-item-on': isSelected(group.key, item.id) }"
          @click="emit('select-item', { kind: group.key, id: item.id })"
        >
          <span class="axis-dot" :style="{ background: item.dot ?? 'var(--border-strong)' }" />
          <span class="axis-item-name">{{ item.name }}</span>
          <span v-if="item.meta" class="axis-item-meta">{{ item.meta }}</span>
        </button>

        <!--
          An empty axis with a hint says why it is empty and what that costs;
          printing "nothing here" above that hint says the same thing twice.
        -->
        <p v-if="group.items.length === 0 && !group.hint" class="axis-empty">
          Nothing on this axis yet.
        </p>
        <p v-if="group.hint" class="axis-hint">{{ group.hint }}</p>
      </div>

      <div class="zone-label">
        <span class="zone-name">Settings</span>
        <span class="zone-note">these do not</span>
        <span class="zone-rule" />
      </div>

      <button
        v-for="setting in settings"
        :key="setting.key"
        class="setting-row"
        :class="{ 'setting-row-on': selectedKind === 'setting' && selectedId === setting.key }"
        :data-testid="`benchmark-setting-${setting.key}`"
        @click="emit('select-setting', setting.key)"
      >
        <component :is="SETTING_ICON[setting.key]" :size="12" class="setting-icon" />
        <span class="setting-name">{{ setting.name }}</span>
        <span class="setting-value">{{ setting.value }}</span>
        <ChevronRight :size="12" class="setting-chevron" />
      </button>
    </div>

    <div v-else class="scroller">
      <button
        v-for="run in runs"
        :key="run.id"
        class="run-row"
        :class="{ 'run-row-on': run.id === selectedRunId }"
        data-testid="benchmark-run-row"
        @click="emit('select-run', run.id)"
      >
        <span class="run-top">
          <span class="run-when">{{ run.when }}</span>
          <span class="run-duration">{{ run.duration }}</span>
        </span>
        <InlineNote as="span" size="xs" class="run-note">{{ run.note }}</InlineNote>
      </button>
      <p v-if="runs.length === 0" class="axis-empty">
        No runs yet. Save a version and run it.
      </p>
    </div>

    <!--
      The footer is the arithmetic on the Plan tab and nothing on the Runs tab:
      a request count under a list of past runs would read as a property of the
      selected run, which it is not.
    -->
    <div v-if="tab === 'plan'" class="expansion" data-testid="benchmark-expansion">
      <div class="expansion-top">
        <span class="expansion-count">{{ formatCount(expansion.requests) }}</span>
        <span class="expansion-unit">requests</span>
        <span class="expansion-estimate" :title="estimate ? 'Estimated from the last run of this benchmark' : 'No run yet to estimate from'">
          {{ estimate ?? 'no estimate yet' }}
        </span>
      </div>
      <span class="expansion-formula">{{ expansion.formula }}</span>
    </div>
    <div v-else class="expansion expansion-quiet">
      <span class="expansion-formula">
        Timings and status are kept for every run. Result bodies are not kept yet.
      </span>
    </div>
  </aside>
</template>

<style scoped>
.plan-sidebar {
  /*
   * Lines a hint or an empty note up with the labels in the axis items above
   * it — past the item's own padding, its dot and the gap after it. An
   * alignment offset, not a spacing step: rounding it to one would move the
   * text off the column it exists to sit under. Declared here rather than on
   * .axis-group because the Runs tab uses .axis-empty outside one.
   */
  --axis-hint-indent: 19px;

  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 268px;
  min-height: 0;
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-default);
}

.tab-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  box-sizing: border-box;
  height: 40px;
  flex-shrink: 0;
  padding: 0 var(--space-4) 0 var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border-default);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 40px;
  padding: 0 var(--space-4);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.tab-on {
  border-bottom-color: var(--action);
  color: var(--action);
  font-weight: var(--weight-semibold);
}

.tab-count {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-normal);
}

.tab-on .tab-count {
  color: var(--action);
  opacity: 0.7;
}

.scroller {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-3);
  overflow: auto;
}

.zone-label {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  padding: var(--space-2) var(--space-4) var(--space-3);
}

.zone-name {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.zone-note {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.zone-rule {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.axis-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex-shrink: 0;
  margin-bottom: var(--space-4);
}

.axis-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3) var(--space-1) var(--space-4);
}

.axis-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.axis-name {
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

.axis-multiplier {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}

.axis-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-left: auto;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  cursor: pointer;
}

.axis-add:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}

.axis-item {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  width: 100%;
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.axis-item:hover {
  background: var(--surface-raised);
}

.axis-item-on {
  background: var(--action-surface);
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.axis-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-left: var(--space-2);
  border-radius: var(--radius-sm);
}

.axis-item-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.axis-item-meta {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
}

.axis-hint,
.axis-empty {
  margin: var(--space-1) 0 0;
  padding: 0 var(--space-4) 0 var(--axis-hint-indent);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  line-height: var(--leading-normal);
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.setting-row:hover {
  background: var(--surface-raised);
}

.setting-row-on {
  background: var(--action-surface);
}

.setting-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.setting-name {
  color: var(--ink-secondary);
  white-space: nowrap;
}

.setting-value {
  overflow: hidden;
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-label);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.setting-chevron {
  flex-shrink: 0;
  color: var(--border-strong);
}

.run-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex-shrink: 0;
  width: 100%;
  margin-bottom: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius-panel);
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.run-row:hover {
  background: var(--surface-raised);
}

.run-row-on {
  background: var(--action-surface);
}

.run-top {
  display: flex;
  align-items: center;
  gap: 7px;
}

.run-when {
  color: var(--ink);
  font-size: var(--text-body);
  white-space: nowrap;
}

.run-row-on .run-when {
  font-weight: var(--weight-semibold);
}

.run-duration {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
}

.run-note {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.expansion {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex-shrink: 0;
  padding: var(--space-4) var(--space-5);
  background: var(--surface);
  border-top: 1px solid var(--border-default);
}

.expansion-top {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  font-family: var(--font-mono);
}

.expansion-count {
  color: var(--ink);
  font-size: var(--text-heading);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.02em;
}

.expansion-unit {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.expansion-estimate {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.expansion-formula {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  line-height: var(--leading-normal);
}

.expansion-quiet {
  background: var(--surface-subtle);
}
</style>
