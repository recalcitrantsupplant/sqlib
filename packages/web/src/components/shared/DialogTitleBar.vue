<template>
  <DialogHeader class="dialog-title-bar" :class="{ 'dialog-title-bar--stacked': !!description }">
    <div class="dialog-title-bar__text">
      <div class="dialog-title-bar__title-row">
        <DialogTitle class="dialog-title-bar__title">{{ title }}</DialogTitle>
        <slot name="meta" />
      </div>
      <DialogDescription v-if="description" class="dialog-title-bar__description">
        {{ description }}
      </DialogDescription>
    </div>
    <div class="dialog-title-bar__actions">
      <slot name="actions" />
      <button
        type="button"
        class="dialog-title-bar__close"
        title="Close"
        aria-label="Close"
        @click="emit('close')"
      >
        <XIcon :size="15" />
      </button>
    </div>
  </DialogHeader>
</template>

<script setup lang="ts">
/**
 * The title bar of a full-bleed dialog: title, optional meta or description,
 * trailing actions, and the ✕.
 *
 * The archetype is a `DialogContent` at `p-0 gap-0` with `show-close-button`
 * off, a 12px header row above a body that owns its own padding and scrolling.
 * Three dialogs had written it out: `PrefixMappingsEditor`, `SettingsDialog`
 * and `PrefixSyncDialog`.
 *
 * It is deliberately *not* `PanelHeader`, which is the chrome inside a pane.
 * The title here has to be `DialogTitle`, because that is what `DialogContent`
 * points `aria-labelledby` at — a plain `<h3>` leaves the dialog unnamed to a
 * screen reader — and the same holds for `description` and `aria-describedby`.
 * The two also sit at different scales: 16px title on `--surface` at 12px all
 * round, against 13px on `--surface-subtle` at 6/12.
 */
import { DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { XIcon } from '@lucide/vue';

defineProps<{
  title: string;
  /**
   * A sentence under the title, rendered as the dialog's `DialogDescription`.
   *
   * Use it for a description the dialog does not repeat in its body; a short
   * status or count that belongs beside the title goes in the `meta` slot
   * instead, which keeps it on the title's baseline.
   */
  description?: string;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();
</script>

<style scoped>
.dialog-title-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  padding: var(--space-5);
  border-bottom: 1px solid var(--border-default);
  text-align: left;
}

/*
 * A description makes the text block two lines tall, and the ✕ then belongs
 * beside the title rather than centred against both.
 */
.dialog-title-bar--stacked {
  align-items: flex-start;
}

.dialog-title-bar__text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.dialog-title-bar__title-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  min-width: 0;
}

.dialog-title-bar__title {
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.dialog-title-bar__description {
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.dialog-title-bar__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

/*
 * The ✕. `DialogContent`'s built-in one is absolutely positioned at 16px, which
 * floats it over a 12px header row rather than sitting in it (dialogs doc §4) —
 * which is why every dialog using this bar turns it off and hands the close to
 * the row.
 */
.dialog-title-bar__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--control-h);
  height: var(--control-h);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  transition: background var(--duration), color var(--duration);
}

.dialog-title-bar__close:hover {
  background: var(--surface-subtle);
  color: var(--ink);
}

.dialog-title-bar__close:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: -1px;
}
</style>
