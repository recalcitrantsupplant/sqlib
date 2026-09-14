<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <form class="form" @submit.prevent="handleSubmit">
        <label class="label" for="playground-name-input">
          {{ label }}
        </label>
        <input
          id="playground-name-input"
          ref="inputRef"
          v-model="localValue"
          type="text"
          class="input"
          :placeholder="placeholder"
          :disabled="loading"
          required
        />

        <DialogFooter>
          <button type="button" class="btn ghost" @click="closeDialog">
            Cancel
          </button>
          <button type="submit" class="btn primary" :disabled="loading || !localValue.trim()">
            {{ confirmLabel }}
          </button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

const props = withDefaults(defineProps<{
  open: boolean;
  defaultValue?: string;
  title?: string;
  description?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  loading?: boolean;
}>(), {
  defaultValue: '',
  title: 'Name your item',
  description: 'Give this item a short label so you can spot it quickly later.',
  label: 'Name',
  placeholder: 'Enter a name',
  confirmLabel: 'Save',
  loading: false,
});

const emit = defineEmits<{
  'update:open': [value: boolean];
  submit: [name: string];
}>();

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const localValue = ref(props.defaultValue ?? '');
const inputRef = ref<HTMLInputElement | null>(null);

watch(() => props.open, (open) => {
  if (open) {
    localValue.value = props.defaultValue ?? '';
    nextTick(() => inputRef.value?.focus());
  }
});

watch(() => props.defaultValue, (value) => {
  if (!props.open) return;
  localValue.value = value ?? '';
});

const closeDialog = () => {
  isOpen.value = false;
};

const handleSubmit = () => {
  const trimmed = localValue.value.trim();
  if (!trimmed) return;
  emit('submit', trimmed);
  closeDialog();
};
</script>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: var(--space-4);
}

.label {
  font-size: var(--text-body-lg);
  font-weight: 600;
  color: var(--ink);
}

.input {
  width: 100%;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  font-size: var(--text-content);
}

.input:focus {
  outline: 2px solid color-mix(in srgb, var(--action) 20%, transparent);
  border-color: var(--action);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  font-size: var(--text-content);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.btn.primary:hover:not(:disabled) {
  background: var(--action-hover);
}

.btn.ghost {
  background: transparent;
  color: var(--ink-secondary);
  border-color: var(--border-subtle);
}

.btn.ghost:hover:not(:disabled) {
  background: var(--surface-sunken);
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .input {
  background: var(--gray-900);
  border-color: var(--border-hover);
}

.dark .input:focus {
  outline-color: color-mix(in srgb, var(--action) 20%, transparent);
  border-color: var(--action);
}

.dark .btn.primary {
  background: var(--action);
  border-color: var(--action);
}

.dark .btn.primary:hover:not(:disabled) {
  background: var(--action-hover);
}

.dark .btn.ghost {
  border-color: var(--border-hover);
}

.dark .btn.ghost:hover:not(:disabled) {
  background: var(--gray-800);
}
</style>
