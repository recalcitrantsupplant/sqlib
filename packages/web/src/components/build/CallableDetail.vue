<template>
  <div class="detail">
    <span />
    <div class="detail-body">
      <div class="tabs">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          class="tab"
          :class="{ active: tab.id === activeTab }"
          @click="emit('update:activeTab', tab.id)"
        >
          {{ tab.label }}
        </button>

        <button
          v-if="callable.state === 'draft'"
          type="button"
          class="save-button"
          @click="emit('save')"
        >
          Save
        </button>
        <button v-else type="button" class="work-area-button" @click="emit('open-work-area')">
          <ArrowUpRight :size="11" />Open in work area
        </button>
      </div>

      <CallableTryIt
        v-if="activeTab === 'try'"
        :callable="callable"
        :backend-id="backendId"
        :backend-name="backendName"
      />
      <CallableCode v-else-if="activeTab === 'code'" :callable="callable" :endpoint="endpoint" />
      <CallableComposition v-else :callable="callable" :siblings="siblings" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUpRight } from '@lucide/vue';
import CallableTryIt from './CallableTryIt.vue';
import CallableCode from './CallableCode.vue';
import CallableComposition from './CallableComposition.vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import type { Callable } from '../../lib/callables';

export type DetailTab = 'try' | 'code' | 'composition';

const props = defineProps<{
  callable: Callable;
  siblings: Callable[];
  backendName: string | null;
  backendId?: string | null;
  libraryId: string | null;
  activeTab: DetailTab;
}>();

const emit = defineEmits<{
  (e: 'update:activeTab', tab: DetailTab): void;
  (e: 'save'): void;
  (e: 'open-work-area'): void;
}>();

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'try', label: 'Try it' },
  { id: 'code', label: 'Code' },
  { id: 'composition', label: 'Composition' },
];

const config = useRuntimeConfig();

/*
 * The design's header shows `POST api.sqlib.io/v1/lib/{library}/q/{id}`. That
 * per-callable path does not exist: execution goes through one /execute
 * endpoint with the target in the body. Showing the route that works beats
 * showing the route the mockup wished for.
 */
const endpoint = computed(
  () => `${String(config.public.apiBaseUrl).replace(/\/$/, '')}/execute`
);

const backendId = computed(() => props.backendId ?? null);
</script>

<style scoped>
/*
 * Two columns, the first matching the expander gutter above it, so the detail
 * hangs beneath its own row rather than under the whole table.
 */
.detail {
  display: grid;
  grid-template-columns: 26px 1fr;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-1) var(--space-5) var(--space-5) 0;
}

.tabs {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.tab {
  height: 30px;
  padding: 0 var(--space-4);
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
  cursor: pointer;
}

.tab:first-child {
  padding-left: 0;
}

.tab.active {
  border-bottom-color: var(--action);
  color: var(--action);
}

.save-button,
.work-area-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 26px;
  margin-left: auto;
  padding: 0 var(--space-4);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}

.save-button {
  border: 1px solid var(--action);
  background: var(--action);
  color: var(--action-fg);
}

.work-area-button {
  border: 1px solid var(--border-default);
  background: var(--surface);
  color: var(--ink-secondary);
}
</style>
