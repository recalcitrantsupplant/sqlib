<template>
  <!--
    One row per VALUES parameter: what the query does when a run supplies no
    value for it. The mode belongs to the version, so a change here is saved
    with the next version, like an edit to the text.
  -->
  <section v-if="slots.length > 0" class="slot-policies" data-testid="slot-policies">
    <div class="slot-policies-label">If a parameter gets no value</div>
    <div
      v-for="slot in slots"
      :key="slot.vars.join(' ')"
      class="slot-policy-row"
      data-testid="slot-policy-row"
    >
      <span class="slot-vars">
        <span v-for="variable in slot.vars" :key="variable" class="slot-var">{{ variable }}</span>
      </span>
      <select
        class="slot-select"
        :aria-label="`If ${slot.vars.join(', ')} gets no value`"
        :value="slot.whenEmpty ?? ''"
        data-testid="slot-policy-select"
        @change="onChange(slot.vars, ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in WHEN_EMPTY_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>
    <p class="slot-policies-hint">
      "Fail the run" stops a run that would scan every value of the parameter.
      Saved with the next version.
    </p>
  </section>
</template>

<script setup lang="ts">
import { WHEN_EMPTY_OPTIONS, isWhenEmptyMode, type WhenEmptyMode } from '@/lib/slotPolicies';

defineProps<{
  slots: ReadonlyArray<{ vars: string[]; whenEmpty: WhenEmptyMode | null }>;
}>();

const emit = defineEmits<{
  (e: 'update', payload: { vars: string[]; whenEmpty: WhenEmptyMode | null }): void;
}>();

function onChange(vars: string[], value: string) {
  emit('update', { vars, whenEmpty: isWhenEmptyMode(value) ? value : null });
}
</script>

<style scoped>
.slot-policies {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.slot-policies-label {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.slot-policy-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.slot-vars {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.slot-var {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.slot-select {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-content);
}

.slot-select:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 1px;
  border-color: var(--action-border);
}

.slot-policies-hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
}
</style>
