<script setup lang="ts">
import { computed } from 'vue';
import { formatRelativeTime } from '@/lib/time';

const props = defineProps<{
  /** ISO 8601 timestamp of when execution occurred */
  executedAt: string | null | undefined;
}>();

const executedAtRelative = computed(() => {
  if (!props.executedAt) return '';
  return formatRelativeTime(props.executedAt);
});
</script>

<template>
  <div v-if="executedAt && executedAtRelative" class="executed-time-container">
    <span class="executed-label">executed</span>
    <span class="executed-time-badge" :title="executedAt">
      {{ executedAtRelative }}
    </span>
  </div>
</template>

<style scoped>
.executed-time-container {
  display: flex;
  align-items: center;
  gap: 6px;
}

.executed-label {
  font-size: var(--text-label);
  font-weight: 400;
  font-style: italic;
  color: var(--ink-muted);
}

.executed-time-badge {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  white-space: nowrap;
}
</style>
