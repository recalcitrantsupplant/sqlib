<template>
  <div
    class="callable-row"
    :class="{ draft: callable.state === 'draft', expanded }"
    :data-callable-id="callable.id"
  >
    <button
      type="button"
      class="expander"
      :aria-expanded="expanded"
      :aria-label="expanded ? `Collapse ${callable.name}` : `Expand ${callable.name}`"
      @click="emit('toggle')"
    >
      <ChevronDown v-if="expanded" :size="13" />
      <ChevronRight v-else :size="13" />
    </button>

    <div class="name-cell">
      <div class="name-line">
        <Workflow v-if="callable.type === 'group'" :size="13" class="type-icon" />
        <FileCode2 v-else :size="13" class="type-icon" />
        <span class="name">{{ callable.name }}</span>
        <StatusBadge
          size="xs"
          :dot="false"
          :tone="callable.state === 'draft' ? 'warning' : 'action'"
          data-testid="callable-version-pill"
        >
          <PencilLine v-if="callable.state === 'draft'" :size="10" />
          {{ callable.state === 'draft' ? 'Draft' : `v${callable.version}` }}
        </StatusBadge>
      </div>
      <span class="description">{{ subtitle }}</span>
    </div>

    <CallableSignature :callable="callable" side="inputs" :stacked="stacked" />
    <CallableSignature :callable="callable" side="returns" :stacked="stacked" />

    <div class="actions">
      <button type="button" class="action" title="Try it" @click="emit('open', 'try')">
        <Play :size="11" />
      </button>
      <button type="button" class="action" title="Code" @click="emit('open', 'code')">
        <CodeXml :size="11" />
      </button>
      <button
        type="button"
        class="action"
        title="Open in work area"
        @click="emit('open-work-area')"
      >
        <ArrowUpRight :size="11" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Workflow,
  Play,
  CodeXml,
  ArrowUpRight,
  PencilLine,
} from '@lucide/vue';
import CallableSignature from './CallableSignature.vue';
import StatusBadge from '../shared/StatusBadge.vue';
import type { Callable } from '../../lib/callables';

const props = defineProps<{
  callable: Callable;
  stacked: boolean;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'open', tab: 'try' | 'code'): void;
  (e: 'open-work-area'): void;
}>();

/*
 * A group with no description still has something worth saying — how many
 * things it composes — and an empty second line would leave the row's two-line
 * height looking like a rendering fault.
 */
const subtitle = computed(() => {
  const parts: string[] = [];
  if (props.callable.description) parts.push(props.callable.description);
  if (props.callable.composes != null) parts.push(`composes ${props.callable.composes}`);
  return parts.join(' · ') || '—';
});
</script>

<style scoped>
/*
 * The grid is repeated verbatim on the header row in CallableTable, so
 * signatures line up down the whole list. If you change it here, change it
 * there.
 */
.callable-row {
  display: grid;
  grid-template-columns: 26px 230px minmax(0, 1.02fr) minmax(0, 0.98fr) 112px;
  align-items: stretch;
  background: var(--surface);
  border-bottom: 1px solid var(--border-subtle);
}

/*
 * Draft rows are tinted and bordered because draft-versus-live is the most
 * load-bearing distinction on this screen: the difference between "the
 * assistant wrote this" and "my app can call this".
 */
.callable-row.draft {
  background: var(--draft-surface);
  border-bottom-color: var(--warning-border);
}

.expander {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-5) 0 0;
  border: none;
  background: none;
  color: var(--ink-disabled);
  cursor: pointer;
}

.callable-row.expanded .expander {
  color: var(--action);
}

.name-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-4) var(--space-4) var(--space-4) 0;
}

.name-line {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

.type-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.name {
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.description {
  font-size: var(--text-label);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4);
}

.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
}

.action:hover {
  background: var(--surface-subtle);
  border-color: var(--border-hover);
}
</style>
