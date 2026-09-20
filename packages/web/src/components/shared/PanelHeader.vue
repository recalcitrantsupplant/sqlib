<template>
  <header class="panel-header" :class="[`panel-header--${size}`, { 'panel-header--sunken': sunken }]">
    <div class="panel-header__text">
      <div class="panel-header__title-row">
        <slot name="icon" />
        <!--
          Titleless is a real case: an editor popped out has its name in the
          pop-out's own header, and the row below it carries only the controls.
          An empty `<h3>` would be a heading naming nothing.
        -->
        <h3 v-if="title" class="panel-header__title" :title="title">{{ title }}</h3>
        <slot name="meta" />
      </div>
      <p v-if="subtitle" class="panel-header__subtitle" :title="subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="panel-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * Title bar for a panel: title, optional subtitle, and a trailing action slot.
 *
 * Replaces the several hand-rolled `.panel-header` / `.editor-header` /
 * `.card-header` blocks that had each picked their own padding and title size.
 */
withDefaults(
  defineProps<{
    /** Absent for a bar that is only controls — see the note in the template. */
    title?: string;
    subtitle?: string;
    /** Use the sunken chrome when the header sits above a well or code surface. */
    sunken?: boolean;
    /**
     * How much room the bar takes, orthogonal to `sunken` (which says what it
     * is painted on). `md` is dense chrome inside a pane; `lg` is the title bar
     * of a focus-mode overlay, where the header is the dialog's own heading and
     * carries dialog-scale type and padding.
     */
    size?: 'md' | 'lg';
  }>(),
  { sunken: false, size: 'md' },
);
</script>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-default);
  background: var(--surface);
  flex-shrink: 0;
}

.panel-header--md {
  gap: var(--space-5);
  padding: var(--space-3) var(--space-5);
}

.panel-header--lg {
  gap: var(--space-6);
  padding: var(--space-6) var(--space-7);
}

.panel-header--sunken {
  background: var(--surface-subtle);
}

.panel-header__text {
  min-width: 0;
}

.panel-header__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

.panel-header__title {
  margin: 0;
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-header--lg .panel-header__title {
  font-size: var(--text-heading);
}

.panel-header__subtitle {
  margin: var(--space-1) 0 0;
  font-size: var(--text-label);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-header__actions {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
  flex-shrink: 0;
}
</style>
