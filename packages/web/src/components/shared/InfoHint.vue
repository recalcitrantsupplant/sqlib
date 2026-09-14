<template>
  <span class="info-hint">
    <button
      type="button"
      class="info-hint__trigger"
      :aria-label="`About ${label}`"
      :aria-describedby="bubbleId"
      @click.prevent
    >
      <Info :size="12" />
    </button>
    <span :id="bubbleId" class="info-hint__bubble" role="tooltip">
      <slot />
    </span>
  </span>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import { Info } from '@lucide/vue';

/**
 * The `ⓘ` beside a field label.
 *
 * Explanations that used to sit permanently beside a value live in here
 * instead: the sentence is worth having, but it is worth having *on demand*.
 * A page of standing hints reads as a page of caveats, and the caveat competes
 * with the value it is explaining for the reader's attention.
 *
 * Hover and keyboard focus both open it — the trigger is a real button so it is
 * reachable without a mouse, and it does nothing on click so it never steals a
 * click meant for the field.
 */
defineProps<{
  /** Names what is being explained, for the accessible label. */
  label: string;
}>();

const bubbleId = `info-hint-${useId()}`;
</script>

<style scoped>
.info-hint {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.info-hint__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--border-strong);
  cursor: help;
}

.info-hint__trigger:hover,
.info-hint__trigger:focus-visible {
  color: var(--ink-muted);
}

/*
 * `display: none` while closed, not `visibility: hidden`.
 *
 * A hidden-but-laid-out bubble is still 320px wide and still sits wherever it
 * would open, which for an `ⓘ` on the right of a panel is well past the
 * panel's right edge. That counts towards the scrollable overflow of the
 * nearest scroll container, so a column with `overflow-y: auto` quietly gained
 * ~290px of horizontal scroll it had nothing to show in — and anything that
 * called `scrollIntoView` inside it (a combobox highlighting a row, say) would
 * scroll the column sideways and cut the labels off. `display` is discrete, so
 * the fade is kept with `allow-discrete` and `@starting-style`; where those are
 * not supported the bubble simply appears, which is what a tooltip did before
 * transitions existed.
 */
.info-hint__bubble {
  position: absolute;
  display: none;
  top: calc(100% + var(--space-2));
  left: calc(-1 * var(--space-4));
  z-index: var(--z-dropdown);
  width: max-content;
  max-width: 320px;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-panel);
  background: var(--tooltip-surface);
  color: var(--tooltip-ink);
  font-size: var(--text-label);
  font-weight: var(--weight-normal);
  line-height: var(--leading-normal);
  text-transform: none;
  letter-spacing: normal;
  box-shadow: var(--shadow-md);
  opacity: 0;
  transition: opacity var(--duration-fast), display var(--duration-fast) allow-discrete;
}

.info-hint__trigger:hover + .info-hint__bubble,
.info-hint__trigger:focus-visible + .info-hint__bubble,
.info-hint__bubble:hover {
  display: block;
  opacity: 1;
}

@starting-style {
  .info-hint__trigger:hover + .info-hint__bubble,
  .info-hint__trigger:focus-visible + .info-hint__bubble,
  .info-hint__bubble:hover {
    opacity: 0;
  }
}

.info-hint__bubble :deep(code) {
  font-family: var(--font-mono);
}
</style>
