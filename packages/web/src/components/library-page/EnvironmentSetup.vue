<template>
  <EmptyState title="No environments" boxed data-testid="environment-setup">
    <template v-if="canControl" #actions>
      <div class="setup-row">
        <SegmentedToggle v-model="preset" :options="PRESETS" group-label="Environments" />
        <SegmentedToggle v-model="start" :options="STARTS" group-label="Start with" />
        <button type="button" class="btn-compact btn-primary" :disabled="busy" data-testid="environment-setup-create" @click="emit('setup', preset.split(','), start)">
          {{ label }}
        </button>
      </div>
    </template>
  </EmptyState>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';

defineProps<{ canControl: boolean; busy?: boolean }>();

const emit = defineEmits<{ (e: 'setup', names: string[], startFrom: string): void }>();

const PRESETS = [
  { value: 'dev,test,prod', label: 'dev → test → prod', testId: 'preset-three' },
  { value: 'dev,prod', label: 'dev → prod', testId: 'preset-two' },
  { value: 'prod', label: 'prod', testId: 'preset-one' },
];

const STARTS = [
  { value: 'latest', label: 'Current versions', title: 'Each environment starts with the current version of everything' },
  { value: 'empty', label: 'Empty' },
];

const preset = ref(PRESETS[0].value);
const start = ref('latest');

const label = computed(() => {
  const count = preset.value.split(',').length;
  return count === 1 ? 'Create environment' : `Create ${count} environments`;
});
</script>

<style scoped>
.setup-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
}
</style>
