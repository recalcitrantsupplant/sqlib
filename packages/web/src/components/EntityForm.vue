<template>
  <form @submit.prevent="emit('submit', form)" class="font-sans">
    <slot name="fields" :form="form">
      <template v-for="field in fields" :key="field.name">
        <div class="field">
          <label>{{ field.label }}</label>
          <input
            v-if="field.type === 'text' || !field.type"
            v-model="form[field.name]"
            :required="field.required"
            :placeholder="field.placeholder"
          />
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="form[field.name]"
            :required="field.required"
            :placeholder="field.placeholder"
          />
          <select
            v-else-if="field.type === 'select'"
            v-model="form[field.name]"
            :required="field.required"
          >
            <option
              v-for="option in field.options"
              :key="option.value ?? undefined"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <div v-else-if="field.type === 'radio-toggle'" class="radio-toggle">
            <label v-for="option in field.options" :key="option.value ?? undefined" class="radio-toggle-label">
              <input
                type="radio"
                :name="field.name"
                :value="option.value"
                :checked="form[field.name] === option.value"
                @change="form[field.name] = option.value"
              />
              <span>{{ option.label }}</span>
            </label>
          </div>
        </div>
      </template>
    </slot>
    <div class="actions">
      <button type="submit">{{ submitLabel }}</button>
      <button type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>

<script setup lang="ts" generic="T extends Record<string, any>">
import { computed, reactive, watch } from 'vue';

/*
 * No nested `group` variant. The template carried one — a `field.type ===
 * 'group'` branch iterating `field.fields` — that this type never allowed and
 * no caller ever passed, so it was unreachable markup duplicating the branch
 * below it minus `radio-toggle`. Removed rather than declared: see the note in
 * shared/FormField.vue on why this schema does not generalise. Issue #52.
 */
interface FieldDefinition {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'radio-toggle';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string | null; label: string }>;
}

const props = defineProps<{
  modelValue?: T;
  submitLabel?: string;
  fields?: FieldDefinition[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: T): void;
  (e: 'submit', value: T): void;
  (e: 'cancel'): void;
}>();

const form = reactive<T>({} as T);

// Watch for external changes to modelValue and update the internal form state.
watch(
  () => props.modelValue,
  (newModel) => {
    if (newModel) {
      // Clear old keys that are not in the new model
      Object.keys(form).forEach(key => {
        if (!(key in newModel)) {
          delete (form as Record<string, unknown>)[key];
        }
      });
      // Assign new and updated values
      Object.assign(form, newModel);
    }
  },
  { deep: true, immediate: true }
);

// Watch for internal form changes and emit them to the parent.
watch(
  () => ({ ...form }),
  (value) => emit('update:modelValue', value as T)
);

const submitLabel = computed(() => props.submitLabel ?? 'Save');
</script>

<style scoped>
.font-sans {
  font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

form {
  min-width: 400px;
}



.field {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-5);
}

.field label {
  font-weight: 500;
  margin-bottom: var(--space-2);
  color: var(--ink-secondary);
  font-size: var(--text-body-lg);
}

.field input,
.field textarea,
.field select {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  font-size: var(--text-content);
  transition: border-color 0.2s;
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: var(--action-active);
}

.field textarea {
  min-height: 80px;
  resize: vertical;
}

.field select {
  cursor: pointer;
}

.radio-toggle {
  display: flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  overflow: hidden;
}

.radio-toggle-label {
  flex: 1;
  text-align: center;
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  background-color: var(--surface-subtle);
  color: var(--ink-muted);
  transition: all 0.2s;
  border-right: 1px solid var(--border-strong);
  font-size: var(--text-body-lg);
}

.radio-toggle-label:last-child {
  border-right: none;
}

.radio-toggle-label input {
  display: none;
}

.radio-toggle-label input:checked + span {
  font-weight: 500;
}

.radio-toggle-label:has(input:checked) {
  background-color: var(--action-active);
  color: var(--action-fg);
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: var(--space-6);
}

.actions button {
  padding: var(--space-4) var(--space-5);
  border: none;
  border-radius: var(--radius);
  font-size: var(--text-content);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.actions button[type="submit"] {
  background: var(--action-active);
  color: var(--action-fg);
}

.actions button[type="submit"]:hover {
  background: var(--action-active);
}

.actions button[type="button"] {
  background: var(--surface-subtle);
  color: var(--ink-muted);
  border: 1px solid var(--border-default);
}

.actions button[type="button"]:hover {
  background: var(--surface-raised);
}
</style>
