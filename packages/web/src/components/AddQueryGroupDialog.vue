<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="dialog-wide">
      <DialogHeader>
        <DialogTitle>{{ isEditMode ? 'Edit Query Group' : 'Add Query Group' }}</DialogTitle>
        <DialogDescription>
          {{ isEditMode ? 'Update query group details.' : `Create a new query group in ${libraryName}.` }}
        </DialogDescription>
      </DialogHeader>

      <form @submit.prevent="handleSubmit">
        <div class="form-fields">
          <div class="field">
            <label for="name" class="field-label">Name <span class="required">*</span></label>
            <input
              id="name"
              v-model="form.name"
              type="text"
              class="field-input"
              placeholder="My Query Group"
              required
            />
          </div>

          <div class="field">
            <label for="description" class="field-label">Description</label>
            <textarea
              id="description"
              v-model="form.description"
              class="field-textarea"
              placeholder="Optional description for this query group"
              rows="3"
            />
          </div>
        </div>

        <DialogFooter>
          <button type="button" @click="handleCancel" class="btn-cancel">
            Cancel
          </button>
          <button
            type="submit"
            class="btn-submit"
            :disabled="isSubmitting || (isEditMode && !hasChanges)"
          >
            {{ submitButtonText }}
          </button>
        </DialogFooter>

        <div v-if="error" class="error-message">
          {{ error }}
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface QueryGroupFormState {
  name: string;
  description: string | null;
  libraryId?: string;
}

interface QueryGroupSubmitData {
  name: string;
  description: string | null;
  libraryId?: string;
}

const props = defineProps<{
  open: boolean;
  libraryId?: string;
  libraryName?: string;
  mode?: 'create' | 'edit';
  initialData?: Partial<QueryGroupFormState>;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'submit': [data: QueryGroupSubmitData];
}>();

const isOpen = ref(props.open);
const isSubmitting = ref(false);
const error = ref<string | null>(null);

const isEditMode = computed(() => props.mode === 'edit');

const form = ref<QueryGroupFormState>({
  name: '',
  description: null,
  libraryId: props.libraryId,
});

const initialFormState = ref<QueryGroupFormState>({
  name: '',
  description: null,
  libraryId: props.libraryId,
});

// Check if form has changes (for edit mode)
const hasChanges = computed(() => {
  if (!isEditMode.value) return true;

  return (
    form.value.name !== initialFormState.value.name ||
    form.value.description !== initialFormState.value.description
  );
});

const submitButtonText = computed(() => {
  if (isSubmitting.value) {
    return isEditMode.value ? 'Saving...' : 'Creating...';
  }
  return isEditMode.value ? 'Save' : 'Create Query Group';
});

// Sync with prop
watch(() => props.open, (value) => {
  isOpen.value = value;
  if (value) {
    resetForm();
  }
});

// Sync libraryId when it changes
watch(() => props.libraryId, (value) => {
  form.value.libraryId = value;
});

// Sync with parent
watch(isOpen, (value) => {
  emit('update:open', value);
});

function resetForm() {
  const initial: QueryGroupFormState = {
    name: props.initialData?.name || '',
    description: props.initialData?.description || null,
    libraryId: props.libraryId,
  };

  form.value = { ...initial };
  initialFormState.value = { ...initial };
  error.value = null;
  isSubmitting.value = false;
}

function handleCancel() {
  isOpen.value = false;
}

async function handleSubmit() {
  error.value = null;
  isSubmitting.value = true;

  try {
    emit('submit', {
      ...form.value,
      description: form.value.description?.trim() || null,
    });
    // Note: The parent component should close the dialog after successful submission
  } catch (err: any) {
    error.value = err?.message ?? `Failed to ${isEditMode.value ? 'update' : 'create'} query group`;
    isSubmitting.value = false;
  }
}
</script>

<style>
/* NOT scoped - needs to target the DialogContent component */
[data-slot="dialog-content"].dialog-wide {
  max-width: 56rem !important;
  width: 56rem !important;
}
</style>

<style scoped>
.form-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: var(--space-7) 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  font-size: var(--text-content);
  font-weight: 500;
  color: var(--ink);
}

.required {
  color: var(--danger);
}

.field-input,
.field-textarea {
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  font-size: var(--text-content);
  font-family: inherit;
  transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
}

.field-input:focus,
.field-textarea:focus {
  outline: none;
  border-color: var(--action);
  box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.25);
}

.field-textarea {
  resize: vertical;
  min-height: 60px;
}

.btn-cancel,
.btn-submit {
  padding: var(--space-4) var(--space-6);
  border: none;
  border-radius: var(--radius-panel);
  font-size: var(--text-content);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
}

.btn-cancel {
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  border: 1px solid var(--border-default);
}

.btn-cancel:hover {
  background: var(--surface-raised);
}

.btn-submit {
  background: var(--action);
  color: var(--action-fg);
}

.btn-submit:hover:not(:disabled) {
  background: var(--action-hover);
}

.btn-submit:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.error-message {
  margin-top: var(--space-6);
  padding: var(--space-5);
  background: var(--danger-surface);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-panel);
  color: var(--danger-ink);
  font-size: var(--text-content);
}
</style>
