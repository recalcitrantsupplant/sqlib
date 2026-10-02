<template>
  <button
    type="button"
    :class="withText ? 'expand-button' : 'icon-control'"
    :data-testid="testid || undefined"
    :title="label"
    :aria-label="label"
  >
    <Expand :size="16" />
    <span v-if="withText" class="expand-button-text">Expand</span>
  </button>
</template>

<script setup lang="ts">
/**
 * The one affordance for enlarging an editor, so it looks and reads the same
 * on every one of them. It sits in the header row above the editor it
 * enlarges, alongside that row's other controls — never over the code. A
 * button floating in the corner of a document covers the first line of it,
 * moves with nothing, and is the only control on the screen that is not in a
 * row with its neighbours.
 *
 * The comment is here rather than above the template so the button stays a
 * single root node — a leading comment makes the component a fragment, and a
 * fragment does not inherit the class its host positions it with.
 */
import { computed } from 'vue';
import { Expand } from '@lucide/vue';

const props = withDefaults(defineProps<{
  /** What is being enlarged, for the tooltip: "Expand the query editor". */
  subject?: string;
  withText?: boolean;
  testid?: string;
}>(), {
  subject: 'this editor',
  withText: false,
  testid: '',
});

const label = computed(() => `Expand ${props.subject} — Esc to come back`);
</script>

<style scoped>
/*
 * `--control-h` (28px), the design system's default for an interactive
 * control, so this button is the size of whatever it sits beside rather than
 * one step under it. It used to be `--control-h-sm`, which made it the odd one
 * out in every row it joined — and each host that noticed grew it back with a
 * `:deep` rule of its own.
 */
.expand-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-muted);
  font-size: var(--text-label);
  line-height: 1;
  cursor: pointer;
  transition: color 0.12s ease, background-color 0.12s ease;
}

.expand-button:hover,
.expand-button:focus-visible {
  background: var(--surface-raised);
  color: var(--ink);
}

/* Icon only, it is `.icon-control` from `compact-buttons.css` — the box every
   other icon button in its row is drawn in. Only the labelled variant, a word
   rather than a glyph, needs a rule of its own. */
.expand-button-text {
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
</style>
