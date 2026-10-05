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
 *
 * The buttons are `.icon-control`, the box the editors' pair is drawn in, so
 * the two icons are the same size in the results bar as above the editor.
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
      class="icon-control"
      :class="{ 'icon-control--selected': mode === 'prefixed' }"
      data-testid="term-display-prefixed"
      :aria-pressed="mode === 'prefixed'"
      title="Show prefixed names in every table"
      @click="setMode('prefixed')"
    >
      <PrefixFoldIcon :size="16" />
    </button>
    <button
      type="button"
      class="icon-control"
      :class="{ 'icon-control--selected': mode === 'full' }"
      data-testid="term-display-full"
      :aria-pressed="mode === 'full'"
      title="Show full IRIs in every table"
      @click="setMode('full')"
    >
      <IriUnfoldIcon :size="16" />
    </button>
  </div>
</template>

<style scoped>
.term-display-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}
</style>
