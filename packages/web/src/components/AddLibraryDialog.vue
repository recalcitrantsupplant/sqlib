<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ editMode ? 'Edit Library' : 'Add Library' }}</DialogTitle>
        <DialogDescription>
          {{ editMode ? 'Update the library configuration.' : 'Create a new library to organise your queries and query groups.' }}
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
              placeholder="My Library"
              required
            />
          </div>

          <div class="field">
            <label for="description" class="field-label">Description</label>
            <textarea
              id="description"
              v-model="form.description"
              class="field-textarea"
              placeholder="Optional description for this library"
              rows="3"
            />
          </div>

          <div class="field">
            <span class="field-label">Default Backend</span>
            <SearchSelect
              test-id="defaultBackend"
              aria-label="Default Backend"
              placeholder="None"
              empty-label="None"
              :model-value="form.defaultBackend"
              :options="backendSelectOptions"
              @update:model-value="(value) => (form.defaultBackend = value || null)"
            />
            <p class="field-hint">Ephemeral backends cannot be set as library defaults</p>
          </div>
        </div>

        <DialogFooter>
          <button type="button" @click="handleCancel" class="btn-cancel">
            Cancel
          </button>
          <button type="submit" class="btn-submit" :disabled="isSubmitting">
            {{ isSubmitting ? (editMode ? 'Updating...' : 'Creating...') : (editMode ? 'Update Library' : 'Create Library') }}
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
import type { Backend } from '@sparql-query-lib/contracts';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import SearchSelect from './shared/SearchSelect.vue';

interface LibraryFormData {
  name: string;
  description: string | null;
  defaultBackend: string | null;
}

const props = defineProps<{
  open: boolean;
  backends?: Backend[];
  libraryId?: string | null;
  initialData?: {
    name: string;
    description: string | null;
    defaultBackend: string | null;
  } | null;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'submit': [data: LibraryFormData & { libraryId?: string }];
}>();

const isOpen = ref(props.open);
const isSubmitting = ref(false);
const error = ref<string | null>(null);
const editMode = ref(false);

const form = ref<LibraryFormData>({
  name: '',
  description: null,
  defaultBackend: null,
});

// Filter out ephemeral backend from library default options
const libraryBackendOptions = computed(() => {
  return (props.backends ?? []).filter(b => b.id !== EPHEMERAL_BACKEND_ID);
});

/* Fuzzy-filtered: hand-named stores, and a deployment can carry many. */
const backendSelectOptions = computed(() =>
  libraryBackendOptions.value.map((backend) => ({ value: backend.id, label: backend.name })),
);

// Sync with prop
watch(() => props.open, (value) => {
  isOpen.value = value;
  if (value) {
    // Reset submitting state when dialog opens
    isSubmitting.value = false;
    error.value = null;

    editMode.value = !!props.libraryId;
    if (editMode.value && props.initialData) {
      form.value = { ...props.initialData };
    } else {
      resetForm();
    }
  } else {
    // Reset state when dialog closes
    isSubmitting.value = false;
    error.value = null;
  }
});

// Sync with parent
watch(isOpen, (value) => {
  emit('update:open', value);
});

function resetForm() {
  form.value = {
    name: '',
    description: null,
    defaultBackend: null,
  };
  error.value = null;
  isSubmitting.value = false;
}

function handleCancel() {
  isOpen.value = false;
}

async function handleSubmit() {
  // Prevent double submission
  if (isSubmitting.value) {
    console.warn('[AddLibraryDialog] Already submitting, ignoring duplicate submit call');
    return;
  }

  error.value = null;
  isSubmitting.value = true;

  try {
    const submitData: LibraryFormData & { libraryId?: string } = {
      ...form.value,
      description: form.value.description?.trim() || null,
    };

    if (editMode.value && props.libraryId) {
      submitData.libraryId = props.libraryId;
    }

    emit('submit', submitData);
    // Note: The parent component should close the dialog after successful submission
  } catch (err: unknown) {
    console.error('[AddLibraryDialog] Submit error:', err);
    error.value = err instanceof Error ? err.message : `Failed to ${editMode.value ? 'update' : 'create'} library`;
    isSubmitting.value = false;
  }
}
</script>

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

.field-hint {
  font-size: var(--text-body);
  color: var(--ink-muted);
  margin-top: var(--space-2);
  font-style: italic;
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
