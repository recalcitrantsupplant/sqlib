<template>
  <div v-if="tupleGroups.length > 0" class="tuple-variables-container">
    <div
      v-for="group in tupleGroups"
      :key="group.tupleId"
      class="tuple-group"
    >
      <div class="tuple-group-header">
        <span class="tuple-name">{{ group.tupleName }}</span>
        <span class="tuple-count">{{ group.variables.length }} variable{{ group.variables.length !== 1 ? 's' : '' }}</span>
      </div>
      <div class="variable-badges-wrapper">
        <Badge
          v-for="(variable, index) in group.variables"
          :key="`${group.tupleId}-${index}`"
          variant="secondary"
          class="variable-badge"
        >
          {{ variable }}
        </Badge>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Badge from '../ui/badge/Badge.vue';

export interface VariableInfo {
  variable: string;
  tupleId: string;
  tupleName: string;
}

const props = defineProps<{
  variables: VariableInfo[];
}>();

/**
 * Group variables by their tuple ID
 */
const tupleGroups = computed(() => {
  const groups = new Map<string, { tupleId: string; tupleName: string; variables: string[] }>();

  for (const varInfo of props.variables) {
    if (!groups.has(varInfo.tupleId)) {
      groups.set(varInfo.tupleId, {
        tupleId: varInfo.tupleId,
        tupleName: varInfo.tupleName,
        variables: [],
      });
    }
    groups.get(varInfo.tupleId)!.variables.push(varInfo.variable);
  }

  return Array.from(groups.values());
});
</script>

<style scoped>
.tuple-variables-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tuple-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-4);
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.tuple-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-default);
}

.tuple-name {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink-secondary);
}

.tuple-count {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.variable-badges-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.variable-badge {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: var(--text-body-lg);
  font-weight: 600;
}
</style>
