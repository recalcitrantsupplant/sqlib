<template>
  <div class="tuple-editor">
    <div v-if="!readOnly" class="tuple-header">
      <button class="btn-compact btn-primary" type="button" @click="emitAddTuple">
        <Plus :size="12" />
        {{ addTupleLabel }}
      </button>
    </div>

    <EmptyState
      v-if="tuples.length === 0"
      size="sm"
      boxed
      :class="{ 'is-readonly': readOnly }"
      :title="emptyStateLabel"
    >
      <template #icon><Plus :size="20" /></template>
    </EmptyState>

    <div
      v-for="(tuple, tupleIndex) in tuples"
      :key="tupleIndex"
      class="tuple-card"
    >
      <div class="tuple-card-header">
        <span class="tuple-label">
          {{ tupleLabel(tupleIndex, tuple.label) }}
        </span>
        <div class="tuple-actions" v-if="!readOnly">
          <button class="btn-compact" type="button" @click="emitAddVariable(tupleIndex)" title="Add Variable">
            <Plus :size="12" />
          </button>
          <button
            class="btn-compact btn-danger-compact"
            type="button"
            @click="emitRemoveTuple(tupleIndex)"
            title="Remove Tuple"
          >
            <Trash2 :size="12" />
          </button>
        </div>
      </div>

      <div class="variables-grid" :class="{ 'is-readonly': readOnly }">
        <div
          v-for="(variable, varIndex) in tuple.variables"
          :key="varIndex"
          class="variable-row"
        >
          <div class="variable-field">
            <label :for="idFor(tupleIndex, varIndex, 'name')">Variable</label>
            <input
              :id="idFor(tupleIndex, varIndex, 'name')"
              :value="variable.name"
              type="text"
              class="field-input-compact"
              placeholder="?variable"
              :disabled="readOnly"
              @input="updateVariable(tupleIndex, varIndex, 'name', ($event.target as HTMLInputElement).value)"
            />
          </div>

          <div class="variable-field">
            <label :for="idFor(tupleIndex, varIndex, 'nodeKind')">Node Kind</label>
            <Select
              :model-value="variable.nodeKind"
              :disabled="readOnly"
              @update:model-value="updateVariable(tupleIndex, varIndex, 'nodeKind', $event as string)"
            >
              <SelectTrigger :id="idFor(tupleIndex, varIndex, 'nodeKind')" class="select-compact">
                <SelectValue placeholder="Select kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="iri">IRI</SelectItem>
                <SelectItem value="literal">Literal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="variable.nodeKind === 'literal'" class="variable-field">
            <label :for="idFor(tupleIndex, varIndex, 'datatype')">Datatype</label>
            <Select
              :model-value="variable.datatype"
              :disabled="readOnly"
              @update:model-value="updateVariable(tupleIndex, varIndex, 'datatype', $event as string)"
            >
              <SelectTrigger :id="idFor(tupleIndex, varIndex, 'datatype')" class="select-compact">
                <SelectValue placeholder="Select datatype" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xsd:string">xsd:string</SelectItem>
                <SelectItem value="xsd:integer">xsd:integer</SelectItem>
                <SelectItem value="xsd:int">xsd:int</SelectItem>
                <SelectItem value="xsd:decimal">xsd:decimal</SelectItem>
                <SelectItem value="xsd:double">xsd:double</SelectItem>
                <SelectItem value="xsd:float">xsd:float</SelectItem>
                <SelectItem value="xsd:boolean">xsd:boolean</SelectItem>
                <SelectItem value="xsd:date">xsd:date</SelectItem>
                <SelectItem value="xsd:dateTime">xsd:dateTime</SelectItem>
                <SelectItem value="xsd:time">xsd:time</SelectItem>
                <SelectItem value="custom">Custom...</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <button
            v-if="!readOnly"
            class="btn-remove-var"
            type="button"
            @click="emitRemoveVariable(tupleIndex, varIndex)"
            title="Remove Variable"
          >
            <X :size="12" />
          </button>

          <div
            v-if="!readOnly && variable.nodeKind === 'literal' && variable.datatype === 'custom'"
            class="variable-field-full"
          >
            <label :for="idFor(tupleIndex, varIndex, 'customDatatype')">Custom Datatype IRI</label>
            <input
              :id="idFor(tupleIndex, varIndex, 'customDatatype')"
              :value="variable.customDatatype ?? ''"
              type="text"
              class="field-input-compact"
              placeholder="http://example.org/datatype"
              @input="updateVariable(tupleIndex, varIndex, 'customDatatype', ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Plus, Trash2, X } from '@lucide/vue';
import Select from '../ui/select/Select.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import EmptyState from './EmptyState.vue';
import type { TupleDefinition, TupleEditorUpdatePayload } from '../../types/tuple-editor';

const props = defineProps<{
  tuples: TupleDefinition[];
  readOnly?: boolean;
  addTupleLabel?: string;
  emptyStateLabel?: string;
}>();

const emit = defineEmits<{
  (e: 'add-tuple'): void;
  (e: 'remove-tuple', tupleIndex: number): void;
  (e: 'add-variable', tupleIndex: number): void;
  (e: 'remove-variable', tupleIndex: number, variableIndex: number): void;
  (e: 'update-variable', payload: TupleEditorUpdatePayload): void;
}>();

const readOnly = computed(() => props.readOnly ?? false);
const addTupleLabel = computed(() => props.addTupleLabel ?? 'Add Tuple');
const emptyStateLabel = computed(() => props.emptyStateLabel ?? 'No tuples configured');

const tupleLabel = (index: number, label?: string | null) => {
  if (label && label.trim().length > 0) {
    return label;
  }
  return `Tuple ${index + 1}`;
};

const idFor = (tupleIndex: number, variableIndex: number, field: string) =>
  `tuple-${tupleIndex}-var-${variableIndex}-${field}`;

const emitAddTuple = () => emit('add-tuple');
const emitRemoveTuple = (tupleIndex: number) => emit('remove-tuple', tupleIndex);
const emitAddVariable = (tupleIndex: number) => emit('add-variable', tupleIndex);
const emitRemoveVariable = (tupleIndex: number, variableIndex: number) =>
  emit('remove-variable', tupleIndex, variableIndex);

const updateVariable = (
  tupleIndex: number,
  variableIndex: number,
  field: TupleEditorUpdatePayload['field'],
  value: string,
) => {
  emit('update-variable', {
    tupleIndex,
    variableIndex,
    field,
    value,
  });
};
</script>

<style scoped>
.tuple-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/*
 * The well itself is `EmptyState boxed`; this is the one thing the primitive
 * does not say — a read-only editor offers no way to fill it, so the
 * invitation is dimmed rather than shown at full strength.
 */
.is-readonly {
  opacity: 0.75;
}

.tuple-card {
  background: var(--surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.tuple-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tuple-label {
  font-size: var(--text-content);
  font-weight: 600;
  color: var(--ink);
}

.tuple-actions {
  display: flex;
  gap: 8px;
}

.variables-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.variables-grid.is-readonly {
  opacity: 0.75;
}

.variable-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 12px;
  align-items: flex-end;
}

.variable-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.variable-field-full {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.variable-field label,
.variable-field-full label {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink-secondary);
}

.field-input-compact {
  height: 32px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface);
  font-size: var(--text-body-lg);
  color: var(--ink);
}

.select-compact {
  min-width: unset;
  height: 32px;
  border-radius: var(--radius-lg);
}

.btn-remove-var {
  height: 32px;
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  background: var(--surface-sunken);
  color: var(--ink-secondary);
  transition: background 0.2s ease;
}

.btn-remove-var:hover {
  background: var(--surface-raised);
}

.tuple-header {
  margin-bottom: var(--space-2);
}
</style>
