<template>
  <div class="empty-state" :class="[`empty-state--${size}`, { 'empty-state--boxed': boxed }]">
    <div v-if="$slots.icon" class="empty-state__icon">
      <slot name="icon" />
    </div>
    <p class="empty-state__title">{{ title }}</p>
    <p v-if="description" class="empty-state__description">{{ description }}</p>
    <div v-if="$slots.actions" class="empty-state__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The "nothing here yet" panel. Around twenty components had grown their own
 * variant of this with different padding, colour, and type size.
 */
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    /** `sm` for inline panels and dropdowns; `md` for a full pane. */
    size?: 'sm' | 'md';
    /**
     * Paint the well: a dashed outline on `--surface-subtle`. For an empty
     * state that sits *inside* a filled pane and has to read as a region of
     * its own — the fourth pass's residue, where every site had hand-rolled
     * one. See `docs/reference/ui-design-tokens.md`.
     *
     * The border is not decoration: `--surface-subtle` is also the toolbar and
     * table-header fill, so an unbordered well is the same colour as the
     * chrome above it.
     */
    boxed?: boolean;
  }>(),
  { size: 'md', boxed: false },
);
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: var(--space-4);
  color: var(--ink-muted);
}

.empty-state--sm {
  padding: var(--space-6);
}

.empty-state--md {
  padding: var(--space-8) var(--space-7);
  flex: 1;
}

/*
 * A container that is empty, drawn as one. `--radius-panel` because that is
 * what a grouped container takes; the sites this replaced reached for
 * `--radius-lg` and `--radius-xl`, which belong to dialogs and modals.
 */
.empty-state--boxed {
  background: var(--surface-subtle);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-panel);
}

.empty-state__icon {
  color: var(--ink-disabled);
  display: flex;
}

.empty-state__title {
  margin: 0;
  font-size: var(--text-body-lg);
  font-weight: var(--weight-medium);
  color: var(--ink-secondary);
}

.empty-state__description {
  margin: 0;
  font-size: var(--text-body);
  color: var(--ink-muted);
  max-width: 46ch;
  line-height: var(--leading-normal);
}

/*
 * Wrapping rather than overflowing. The row held one or two buttons everywhere
 * until the query-group canvas's empty state grew a template beside its primary
 * action; a fixed row then pushes the last one out of a boxed panel rather than
 * moving it to a second line. This cannot change a row that already fits, only
 * one that does not.
 */
.empty-state__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--grid-gap);
  margin-top: var(--space-2);
}
</style>
