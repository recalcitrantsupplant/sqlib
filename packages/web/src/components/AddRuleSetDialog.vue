<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEditMode ? 'Edit Rule Set' : 'Add Rule Set' }}</DialogTitle>
        <DialogDescription>
          {{ isEditMode ? 'Update rule set details.' : `Create a new rule set in ${libraryName}.` }}
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
              placeholder="My Rule Set"
              required
            />
          </div>

          <div class="field">
            <label for="description" class="field-label">Description</label>
            <textarea
              id="description"
              v-model="form.description"
              class="field-textarea"
              placeholder="Optional description for this rule set"
              rows="3"
            />
          </div>
        </div>

        <DialogFooter>
          <button type="button" @click="handleCancel" class="btn-cancel">
            Cancel
          </button>
          <button type="submit" class="btn-submit" :disabled="isSubmitting || (isEditMode && !hasChanges)">
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

interface RuleSetFormState {
  name: string;
  description: string | null;
}

export interface RuleSetSubmitData {
  name: string;
  description: string | null;
  libraryId?: string;
}

const props = defineProps<{
  open: boolean;
  libraryId?: string;
  libraryName?: string;
  mode?: 'create' | 'edit';
  initialData?: Partial<RuleSetFormState>;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'submit': [data: RuleSetSubmitData];
}>();

const isOpen = ref(props.open);
const isSubmitting = ref(false);
const error = ref<string | null>(null);

const form = ref<RuleSetFormState>({
  name: '',
  description: null,
});

const isEditMode = computed(() => props.mode === 'edit');

const submitButtonText = computed(() => {
  if (isSubmitting.value) {
    return isEditMode.value ? 'Updating...' : 'Creating...';
  }
  return isEditMode.value ? 'Update' : 'Create';
});

const hasChanges = computed(() => {
  if (!props.initialData) return true;
  return (
    form.value.name !== (props.initialData.name || '') ||
    form.value.description !== (props.initialData.description || null)
  );
});

watch(() => props.open, (newValue) => {
  isOpen.value = newValue;
  if (newValue) {
    resetForm();
  }
});

watch(isOpen, (newValue) => {
  if (!newValue) {
    emit('update:open', false);
  }
});

function resetForm() {
  if (props.initialData && isEditMode.value) {
    form.value = {
      name: props.initialData.name || '',
      description: props.initialData.description || null,
    };
  } else {
    form.value = {
      name: '',
      description: null,
    };
  }
  error.value = null;
  isSubmitting.value = false;
}

function handleCancel() {
  isOpen.value = false;
  resetForm();
}

async function handleSubmit() {
  try {
    isSubmitting.value = true;
    error.value = null;

    const submitData: RuleSetSubmitData = {
      name: form.value.name.trim(),
      description: form.value.description?.trim() || null,
    };

    if (!isEditMode.value && props.libraryId) {
      submitData.libraryId = props.libraryId;
    }

    emit('submit', submitData);
    isOpen.value = false;
    resetForm();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'An error occurred';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<style scoped>
.form-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: var(--space-7);
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
  font-size: var(--text-content);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  transition: border-color 0.2s;
}

.field-input:focus,
.field-textarea:focus {
  outline: none;
  border-color: var(--action);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.field-textarea {
  resize: vertical;
  font-family: inherit;
}

.btn-cancel,
.btn-submit {
  padding: var(--space-4) var(--space-6);
  font-size: var(--text-content);
  font-weight: 500;
  border-radius: var(--radius-panel);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  color: var(--ink-secondary);
  background: var(--surface);
  border: 1px solid var(--border-default);
}

.btn-cancel:hover {
  background: var(--surface-subtle);
}

.btn-submit {
  color: var(--action-fg);
  background: var(--action);
  border: none;
}

.btn-submit:hover:not(:disabled) {
  background: var(--action-hover);
}

.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-message {
  margin-top: var(--space-6);
  padding: var(--space-5);
  font-size: var(--text-content);
  color: var(--danger);
  background: var(--danger-surface);
  border-radius: var(--radius-panel);
}
</style>
