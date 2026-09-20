<template>
  <button
    type="button"
    class="expand-button"
    :class="{ 'expand-button--square': !withText }"
    :data-testid="testid || undefined"
    :title="label"
    :aria-label="label"
  >
    <Expand :size="13" />
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
.expand-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h-sm);
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

/* Icon only: a square box, like the other icon buttons it sits in a row with.
   The labelled variant keeps its side padding — it is a word, not a glyph. */
.expand-button--square {
  justify-content: center;
  width: var(--control-h-sm);
  padding: 0;
}

.expand-button-text {
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
</style>
