<template>
  <!--
    A literal's datatype: none (xsd:string), a common datatype, or a custom
    IRI typed into the field that custom opens. The choices and the custom
    behaviour are the argument editor's (`useDatatypeChoice`).
  -->
  <div class="datatype-select">
    <select
      :value="choice.selection.value"
      :disabled="disabled"
      :data-testid="testId"
      aria-label="Datatype"
      @change="choice.choose(($event.target as HTMLSelectElement).value)"
    >
      <option value="">none (xsd:string)</option>
      <option v-for="dt in XSD_DATATYPES" :key="dt.value" :value="dt.value">{{ dt.label }}</option>
      <option :value="CUSTOM_DATATYPE">custom IRI…</option>
    </select>
    <input
      v-if="choice.isCustom.value"
      type="text"
      :value="choice.customDatatype.value"
      :disabled="disabled"
      :data-testid="testId ? `${testId}-iri` : undefined"
      aria-label="Datatype IRI"
      placeholder="http://example.org/datatype"
      @input="choice.setCustom(($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<script setup lang="ts">
import { XSD_DATATYPES } from '@/types/argument-sets';
import { CUSTOM_DATATYPE, useDatatypeChoice } from '@/composables/useDatatypeChoice';

const props = defineProps<{
  /** The datatype IRI, or undefined for none. */
  modelValue?: string;
  disabled?: boolean;
  testId?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>();

const choice = useDatatypeChoice(() => props.modelValue, (next) => emit('update:modelValue', next));
</script>

<style scoped>
.datatype-select {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
}

.datatype-select select,
.datatype-select input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: var(--text-label);
}

.datatype-select input {
  font-family: monospace;
}
</style>
