<template>
  <!--
    Six buttons became two.
    New Version / Freeze / Copy JSON / Save / Delete collapsed into Discard +
    Save when there is unsaved work, nothing when there is not, and the
    ⋮ menu in the header for the rest (design §4).
  -->
  <footer v-if="dirty" class="footer">
    <InlineNote v-if="scratch" as="span" size="xs" class="footer-note">lives in this browser</InlineNote>
    <button type="button" class="btn-discard" data-testid="arguments-discard" :disabled="busy" @click="emit('discard')">
      Discard
    </button>
    <button type="button" class="btn-save" data-testid="arguments-save" :disabled="busy || !canSave" @click="emit('save')">
      {{ busy ? 'Saving…' : `Save v${nextVersion}` }}
    </button>
  </footer>
</template>

<script setup lang="ts">
import InlineNote from '../shared/InlineNote.vue';

defineProps<{
  /** There is unsaved work: a scratch set, or a draft on a saved one. */
  dirty: boolean;
  scratch: boolean;
  nextVersion: number;
  canSave: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'discard'): void;
  (e: 'save'): void;
}>();
</script>

<style scoped>
.footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: var(--space-4) var(--space-5);
  background: var(--surface-subtle);
  border-top: 1px solid var(--border-default);
}

.footer-note {
  margin-right: auto;
}

.btn-discard,
.btn-save {
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: 500;
  cursor: pointer;
}

.btn-discard {
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink-secondary);
}

.btn-discard:hover:not(:disabled) {
  background: var(--surface-raised);
}

.btn-save {
  border: 1px solid var(--action);
  background: var(--action);
  color: var(--action-fg);
}

.btn-save:hover:not(:disabled) {
  background: var(--action-hover);
  border-color: var(--action-hover);
}

.btn-discard:disabled,
.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
