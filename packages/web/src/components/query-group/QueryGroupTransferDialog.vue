<template>
  <Dialog v-model:open="isOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ isClone ? 'Clone query group' : 'Move query group' }}</DialogTitle>
        <DialogDescription>
          {{ isClone
            ? 'Creates a copy of this group, including the graph currently on the canvas.'
            : 'Choose the library this query group should belong to.' }}
        </DialogDescription>
      </DialogHeader>

      <form @submit.prevent="handleSubmit">
        <div class="form-fields">
          <div v-if="isClone" class="field">
            <label for="clone-name" class="field-label">Name <span class="required">*</span></label>
            <input
              id="clone-name"
              v-model="name"
              type="text"
              class="field-input"
              required
            />
          </div>

          <div class="field">
            <span class="field-label">Library <span class="required">*</span></span>
            <SearchSelect
              test-id="target-library"
              aria-label="Library"
              placeholder="Choose a library…"
              :model-value="libraryId"
              :options="librarySelectOptions"
              @update:model-value="(value) => (libraryId = value)"
            />
          </div>
        </div>

        <DialogFooter>
          <button type="button" class="btn-cancel" @click="handleCancel">Cancel</button>
          <button type="submit" class="btn-submit" :disabled="!canSubmit">
            {{ isClone ? 'Create copy' : 'Move' }}
          </button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Dialog from '../ui/dialog/Dialog.vue';
import DialogContent from '../ui/dialog/DialogContent.vue';
import DialogHeader from '../ui/dialog/DialogHeader.vue';
import DialogTitle from '../ui/dialog/DialogTitle.vue';
import DialogDescription from '../ui/dialog/DialogDescription.vue';
import DialogFooter from '../ui/dialog/DialogFooter.vue';
import SearchSelect from '../shared/SearchSelect.vue';

const props = defineProps<{
  open: boolean;
  mode: 'clone' | 'move';
  groupName: string;
  currentLibraryId: string;
  libraries: Array<{ id: string; name: string }>;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'submit', payload: { name?: string; libraryId: string }): void;
  (e: 'cancel'): void;
}>();

const isClone = computed(() => props.mode === 'clone');

const name = ref('');
const libraryId = ref('');

// Re-seed each time the dialog opens so a cancelled edit does not persist.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = `${props.groupName} (copy)`;
    libraryId.value = props.currentLibraryId || props.libraries[0]?.id || '';
  },
  { immediate: true },
);

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

/* Marked so the current library is recognisable in a list of names. */
const librarySelectOptions = computed(() =>
  props.libraries.map((library) => ({
    value: library.id,
    label: `${library.name}${library.id === props.currentLibraryId ? ' (current)' : ''}`,
  })),
);

const canSubmit = computed(() => {
  if (!libraryId.value) return false;
  // Moving to the library it is already in is a no-op, so do not offer it.
  if (!isClone.value && libraryId.value === props.currentLibraryId) return false;
  if (isClone.value && !name.value.trim()) return false;
  return true;
});

const handleSubmit = () => {
  if (!canSubmit.value) return;
  emit('submit', isClone.value ? { name: name.value.trim(), libraryId: libraryId.value } : { libraryId: libraryId.value });
  emit('update:open', false);
};

const handleCancel = () => {
  emit('cancel');
  emit('update:open', false);
};
</script>

<style scoped>
.form-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: var(--space-6) 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--ink);
}

.required {
  color: var(--danger-ink);
}

.field-input {
  width: 100%;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

.btn-cancel,
.btn-submit {
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-md);
  font-size: var(--text-body);
  cursor: pointer;
}

.btn-cancel {
  border: 1px solid var(--border-default);
  background: var(--surface);
  color: var(--ink);
}

.btn-submit {
  border: 1px solid var(--action);
  background: var(--action);
  color: var(--action-fg);
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
