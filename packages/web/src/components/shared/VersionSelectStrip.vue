<template>
  <div class="version-strip">
    <div class="version-selector-group">
      <SectionLabel v-if="showLabel" as="label">{{ label }}</SectionLabel>
      <Select
        :model-value="selected ?? undefined"
        :disabled="disabled || options.length === 0"
        @update:model-value="$emit('update:selected', $event as string | null)"
      >
        <SelectTrigger class="version-trigger-compact" :disabled="disabled || options.length === 0">
          <SelectValue :placeholder="placeholder" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="version-select-item"
          >
            {{ option.label }}
            <template #aside>
              <span v-if="option.dateModified" class="version-timestamp">
                {{ formatRelativeTime(option.dateModified) }}
              </span>
            </template>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="versionId" class="version-id-display">
      <SectionLabel as="label">Version ID:</SectionLabel>
      <div class="id-display">
        <span class="id-text" :title="versionId">…{{ versionIdShort }}</span>
        <button
          class="btn-icon-copy"
          :title="copyTitle"
          @click="$emit('copy-version-id')"
        >
          <Copy :size="12" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Copy } from '@lucide/vue';
import Select from '../ui/select/Select.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import SectionLabel from './SectionLabel.vue';
import { formatRelativeTime } from '@/lib/time';

export type VersionStripOption = {
  value: string;
  label: string;
  dateModified?: string | null;
};

const props = defineProps<{
  options: VersionStripOption[];
  selected: string | null;
  versionId: string | null;
  placeholder?: string;
  disabled?: boolean;
  copyTitle?: string;
  label?: string;
  showLabel?: boolean;
}>();

defineEmits<{
  (e: 'update:selected', value: string | null): void;
  (e: 'copy-version-id'): void;
}>();

const versionIdShort = computed(() => {
  return props.versionId ? props.versionId.slice(-6) : '';
});

const label = computed(() => props.label ?? 'Version');
const showLabel = computed(() => props.showLabel ?? true);
</script>

<style scoped>
.version-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.version-selector-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-trigger-compact {
  height: 28px;
  font-size: var(--text-body);
}

.version-id-display {
  display: flex;
  align-items: center;
  gap: 8px;
}

.id-display {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  height: 28px;
}

.id-text {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: var(--text-label);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-select-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.version-timestamp {
  margin-left: 1em;
  font-size: var(--text-body);
  color: var(--ink-muted);
  white-space: nowrap;
}

.btn-icon-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
  color: var(--ink-muted);
  transition: background-color 0.2s, color 0.2s;
  flex-shrink: 0;
}

.btn-icon-copy:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--action-hover);
}

.btn-icon-copy:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
