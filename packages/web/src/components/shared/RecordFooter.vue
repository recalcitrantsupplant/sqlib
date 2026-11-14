<template>
  <!--
    The foot of a record: when it was made, and the one action that unmakes
    it. Delete confirms in place. The strip is where the answer is wanted, and
    a dialog over the record covers the thing being deleted.
  -->
  <div class="record-footer" :data-testid="`${testIdPrefix}-footer`">
    <template v-if="confirming">
      <InlineNote as="span" tone="danger" class="confirm-note" :data-testid="`${testIdPrefix}-confirm-prompt`">
        {{ confirmPrompt }}
      </InlineNote>
      <button
        class="confirm-delete"
        :data-testid="`${testIdPrefix}-confirm-delete`"
        :disabled="deleting"
        @click="emit('delete')"
      >
        {{ deleting ? 'Deleting…' : 'Delete' }}
      </button>
      <button class="confirm-cancel" :data-testid="`${testIdPrefix}-cancel-delete`" @click="confirming = false">
        Cancel
      </button>
    </template>
    <template v-else>
      <InlineNote v-if="createdLabel" as="span" :data-testid="`${testIdPrefix}-created`">Created {{ createdLabel }}</InlineNote>
      <button
        v-if="canDelete"
        class="delete-button"
        :data-testid="`${testIdPrefix}-delete`"
        @click="confirming = true"
      >
        <Trash2 :size="12" />Delete {{ noun }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * The one Delete for a saved record, shared by the Details panel
 * (`EntityDetailsPanel`) and the records that have no such panel (backends).
 *
 * The footer is a band across the full width of its column, pinned below the
 * part that scrolls. The host places it as the last child of a flex column
 * whose body has `flex: 1; overflow: auto`. Inside the scrolling body it would
 * take the body's padding and scroll away with the content.
 *
 * Confirming is local state. Changing `resetKey` (the record's id) closes the
 * strip, because the delete being confirmed belonged to the record that was
 * open. A failed delete leaves the strip up, so the user can try again. The
 * host unmounts the footer when a delete succeeds.
 */
import { computed, ref, watch } from 'vue';
import { Trash2 } from '@lucide/vue';
import { formatShortDate } from '../../lib/time';
import InlineNote from './InlineNote.vue';

const props = withDefaults(defineProps<{
  /** The record's kind, lower case, for "Delete {noun}". */
  noun: string;
  /** The question in the confirm strip, with the effects of the delete. */
  confirmPrompt: string;
  /** When the record was created; absent leaves the note out. */
  createdAt?: string | null;
  /** False leaves the button out, for a record the user cannot delete. */
  canDelete?: boolean;
  /** True while the host's delete is in flight. */
  deleting?: boolean;
  /** Closes the confirm strip when it changes. */
  resetKey?: string | null;
  /** Prefix for the `data-testid` of each part. */
  testIdPrefix?: string;
}>(), {
  createdAt: null,
  canDelete: false,
  deleting: false,
  resetKey: null,
  testIdPrefix: 'details',
});

const emit = defineEmits<{
  (e: 'delete'): void;
}>();

const confirming = ref(false);

const createdLabel = computed(() => formatShortDate(props.createdAt));

watch(() => props.resetKey, () => {
  confirming.value = false;
});
</script>

<style scoped>
.record-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-4);
  box-sizing: border-box;
  /* The same band as the Results tab's footer: switching tabs must not move it. */
  min-height: var(--panel-bar-h);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
}

/* Destructive, and last in the row: red enough to read as the one action here
   that cannot be undone, quiet enough that the eye does not land on it first. */
.delete-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--control-h-sm);
  margin-left: auto;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--danger-active);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.delete-button:hover {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

/* The prompt shrinks so the buttons keep their width. */
.confirm-note {
  min-width: 0;
}

.confirm-delete {
  height: var(--control-h-sm);
  margin-left: auto;
  padding: 0 var(--space-4);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  background: var(--danger);
  color: var(--danger-fg);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}

.confirm-delete:hover:not(:disabled) {
  background: var(--danger-hover);
}

.confirm-delete:disabled {
  cursor: default;
  opacity: 0.7;
}

.confirm-cancel {
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.confirm-cancel:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}
</style>
