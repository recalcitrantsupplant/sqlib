<script setup lang="ts">
/**
 * The term-display control in a column's header menu.
 *
 * The same pair of buttons the editors carry, doing the same thing to a
 * different subject: there, contract and expand rewrite the document; here they
 * change how this column is *read*, and nothing about the data. One pair of
 * icons for one idea — prefixed name ⇄ full IRI — is why they are not two
 * sentences of menu text that have to be read before they can be recognised.
 *
 * It stays per column (see `useTermDisplay`) because a column is where the
 * choice pays: `s` can show full IRIs while `p` and `o` stay narrow. "Apply to
 * all columns" is for when it does not.
 */
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import PrefixFoldIcon from '@/components/icons/PrefixFoldIcon.vue';
import IriUnfoldIcon from '@/components/icons/IriUnfoldIcon.vue';
import type { TermDisplayMode } from '@/composables/useTermDisplay';

defineProps<{
  /** The mode the column is rendering in right now. */
  mode: TermDisplayMode;
}>();

const emit = defineEmits<{
  select: [mode: TermDisplayMode];
  selectAll: [mode: TermDisplayMode];
}>();
</script>

<template>
  <div class="px-1 pb-1" data-testid="term-display-menu">
    <div class="term-display-buttons" role="group" aria-label="Term display">
      <button
        type="button"
        class="term-display-button"
        :class="{ on: mode === 'prefixed' }"
        data-testid="term-display-prefixed"
        :aria-pressed="mode === 'prefixed'"
        title="Show prefixed names in this column"
        @click="emit('select', 'prefixed')"
      >
        <PrefixFoldIcon :size="13" />
      </button>
      <button
        type="button"
        class="term-display-button"
        :class="{ on: mode === 'full' }"
        data-testid="term-display-full"
        :aria-pressed="mode === 'full'"
        title="Show full IRIs in this column"
        @click="emit('select', 'full')"
      >
        <IriUnfoldIcon :size="13" />
      </button>
    </div>
    <DropdownMenuItem
      class="flex items-center gap-2 rounded px-2 py-1 text-sm text-muted-foreground"
      data-testid="term-display-apply-all"
      @select="emit('selectAll', mode)"
    >
      <span>Apply to all columns</span>
    </DropdownMenuItem>
  </div>
</template>

<style scoped>
.term-display-buttons {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2) var(--space-2);
}

/*
 * The save bar's square icon button, restated — those styles are scoped to it,
 * so a class copied from it would silently do nothing here. `.on` is the one
 * addition: unlike the editor's pair, one of these two is always the state the
 * column is in, and a control with a current value has to show it.
 */
.term-display-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: var(--control-h);
  height: var(--control-h);
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
