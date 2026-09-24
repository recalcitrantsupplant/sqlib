<script setup lang="ts">
/**
 * The prefixed-name ⇄ full-IRI switch, in the results action bar.
 *
 * The same pair of icons the editors carry, doing the same thing to a
 * different subject: there, contract and expand rewrite the document; here
 * they change how every result table is *read*, and nothing about the data.
 *
 * One control for the whole browser (see `useTermDisplay`). It sat in each
 * column's header menu before, which meant a four-column table took four trips
 * into a menu to read one way, and the next table started over.
 */
import PrefixFoldIcon from '@/components/icons/PrefixFoldIcon.vue';
import IriUnfoldIcon from '@/components/icons/IriUnfoldIcon.vue';
import { useTermDisplay } from '@/composables/useTermDisplay';

const { mode, setMode } = useTermDisplay();
</script>

<template>
  <div class="term-display-toggle" role="group" aria-label="Term display" data-testid="term-display-toggle">
    <button
      type="button"
      class="term-display-button"
      :class="{ on: mode === 'prefixed' }"
      data-testid="term-display-prefixed"
      :aria-pressed="mode === 'prefixed'"
      title="Show prefixed names in every table"
      @click="setMode('prefixed')"
    >
      <PrefixFoldIcon :size="13" />
    </button>
    <button
      type="button"
      class="term-display-button"
      :class="{ on: mode === 'full' }"
      data-testid="term-display-full"
      :aria-pressed="mode === 'full'"
      title="Show full IRIs in every table"
      @click="setMode('full')"
    >
      <IriUnfoldIcon :size="13" />
    </button>
  </div>
</template>

<style scoped>
.term-display-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

/*
 * The action bar's own button, restated — `.btn-action` is scoped to
 * `.results-action-bar` in `results-chrome.css`, so a class copied from it
 * would silently do nothing inside this component. `.on` is the addition: one
 * of the two is always the state every table is in, and a control with a
 * current value has to show it.
 *
 * Restating a rule means restating its measurements too. This took the default
 * `--control-h` while everything it sits beside — the view toggle, the filter,
 * Download, Pop out — is `--control-h-sm`, so the one control in the row that
 * copied its neighbours stood 6px taller than all of them.
 */
.term-display-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  cursor: pointer;
}

.term-display-button:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}

.term-display-button.on {
  background: var(--segment-selected);
  border-color: var(--segment-selected);
  color: var(--segment-selected-ink);
}
</style>
