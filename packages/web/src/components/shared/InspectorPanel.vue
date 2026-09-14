<template>
  <section class="inspector-panel" :class="{ collapsed }" :data-testid="testid">
    <div class="tabs-header">
      <button
        class="collapse-toggle"
        :title="collapsed ? 'Expand panel' : 'Collapse panel'"
        @click="collapsed = !collapsed"
      >
        <PanelRightClose v-if="!collapsed" :size="18" />
        <PanelRightOpen v-else :size="18" />
      </button>
      <div v-show="!collapsed" class="tabs-list">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          class="tab-button"
          :class="{ active: activeTab === tab.id }"
          :data-testid="tab.testid ?? `${tab.id}-tab`"
          :disabled="tab.disabled"
          :title="tab.disabled ? tab.disabledReason : undefined"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
          <Loader2 v-if="tab.busy" :size="14" class="tab-spinner" />
        </button>
      </div>
      <div v-show="!collapsed" class="header-actions">
        <slot name="actions" :active-tab="activeTab" />
      </div>
    </div>

    <template v-for="tab in visibleTabs" :key="tab.id">
      <div v-show="activeTab === tab.id && !collapsed" class="tab-content">
        <slot :name="tab.id" />
      </div>
    </template>
  </section>
</template>

<script lang="ts">
/**
 * The right-hand inspector: one panel, one tab strip, one collapse toggle.
 *
 * Queries, groups and ETL all put the same three things on the right — what
 * this is (Details), what you can pass it (Arguments), what came back
 * (Results) — and each had grown its own copy of the chrome around them. Three
 * copies meant three collapse behaviours and three sets of tab styling that
 * had already drifted, so the chrome lives here and the sections supply only
 * the contents of the tabs they declare.
 *
 * A tab whose content does not exist yet is `hidden` rather than absent from
 * the list: ETL's Results is hidden until a run produces something, and the
 * strip must not jump between two and three tabs as a side effect of some
 * other state.
 */
export interface InspectorTab {
  /** Also the slot name. */
  id: string;
  label: string;
  /** Drawn out of the strip entirely — ETL's Results before a run. */
  hidden?: boolean;
  /** In the strip but not selectable, with a reason on hover. */
  disabled?: boolean;
  disabledReason?: string;
  /** Spins next to the label — the Arguments tab while validation runs. */
  busy?: boolean;
  testid?: string;
}
</script>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { Loader2, PanelRightClose, PanelRightOpen } from '@lucide/vue';

const props = defineProps<{
  tabs: InspectorTab[];
  testid?: string;
}>();

const activeTab = defineModel<string>('activeTab', { required: true });
const collapsed = defineModel<boolean>('collapsed', { default: false });

const visibleTabs = computed(() => props.tabs.filter((tab) => !tab.hidden));

/*
 * The selected tab can vanish under you — Results hides again when a run is
 * cleared. Falling back to the first selectable tab keeps the panel showing
 * something rather than going blank with a strip that highlights nothing.
 */
watch(
  [visibleTabs, activeTab],
  ([tabs, current]) => {
    if (tabs.some((tab) => tab.id === current && !tab.disabled)) return;
    const fallback = tabs.find((tab) => !tab.disabled);
    if (fallback) activeTab.value = fallback.id;
  },
  { immediate: true },
);
</script>

<style scoped>
.inspector-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
  border-left: 1px solid var(--border-default);
}

.tabs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-6) 0;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.inspector-panel.collapsed .tabs-header {
  justify-content: center;
  padding: var(--space-4) var(--space-5) 0;
}

.collapse-toggle {
  flex-shrink: 0;
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  font-size: var(--text-title);
  cursor: pointer;
  transition: background-color 0.2s;
}

.collapse-toggle:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

.tabs-list {
  display: flex;
  gap: 4px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tab-button {
  position: relative;
  top: 1px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-4) var(--space-6);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ink-muted);
  font-size: var(--text-body-lg);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-button:hover:not(:disabled) {
  background: rgb(0 0 0 / 3%);
  color: var(--ink-secondary);
}

.tab-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tab-button.active {
  border-bottom-color: var(--action);
  background: var(--surface);
  color: var(--action);
}

.tab-spinner {
  animation: inspector-spin 1s linear infinite;
}

@keyframes inspector-spin {
  to {
    transform: rotate(360deg);
  }
}

.tab-content {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
</style>
