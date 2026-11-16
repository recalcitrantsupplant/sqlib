<template>
  <button
    type="button"
    class="list-pin-button"
    :class="{ pinned }"
    :title="pinned ? 'Unpin' : 'Pin to top'"
    :aria-label="pinned ? `Unpin ${name}` : `Pin ${name} to top`"
    :aria-pressed="pinned"
    data-testid="pin-button"
    @click.stop="emit('toggle')"
    @keydown.enter.stop
  >
    <PinOff v-if="pinned" :size="12" />
    <Pin v-else :size="12" />
  </button>
</template>

<script setup lang="ts">
/**
 * The pin control at the end of a list row.
 *
 * It shows when the row is hovered or holds focus; the row's own style does
 * that. `.stop` on the click keeps the row from opening.
 */
import { Pin, PinOff } from '@lucide/vue';

defineProps<{ pinned: boolean; name: string }>();
const emit = defineEmits<{ (e: 'toggle'): void }>();
</script>

<style scoped>
.list-pin-button {
  /* The row shows it on hover and focus: see `.saved-row` and `.backend-row`. */
  display: none;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  margin-right: calc(var(--space-2) * -1);
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.list-pin-button:hover {
  background: var(--surface-sunken);
  color: var(--ink);
}

.list-pin-button.pinned {
  color: var(--action-ink);
}
</style>
