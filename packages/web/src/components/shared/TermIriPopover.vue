<script setup lang="ts">
/**
 * The full IRI behind an abbreviated term, one hover away, with a copy button
 * that always yields the full IRI.
 *
 * This is what replaced the table-wide display toggle: people flipped that
 * toggle to read or copy *one* term, not to reformat every row. It is
 * positioned against the cell, which therefore has to carry `relative` and
 * Tailwind's `group` marker.
 *
 * Shown only while `showTooltips` is on — that setting is what says whether an
 * abbreviated term reveals its IRI on hover, and this is now how it does so
 * (see issue #52).
 */
import { Copy } from '@lucide/vue';
import { usePrefixManager } from '@/composables/usePrefixManager';
import { useCopyToClipboard } from '@/composables/useCopyToClipboard';

const props = withDefaults(
  defineProps<{
    /** The IRI the cell is abbreviating. */
    fullIri: string;
    /** What the copy button says it is copying. */
    typeLabel?: string;
  }>(),
  { typeLabel: 'IRI' },
);

const { prefixSettings } = usePrefixManager();
const { copyToClipboard } = useCopyToClipboard();

const copy = (event: Event) => {
  event.stopPropagation();
  copyToClipboard(props.fullIri, `Copied ${props.typeLabel} to clipboard`);
};
</script>

<template>
  <div
    v-if="prefixSettings.showTooltips"
    class="term-iri-popover absolute left-0 top-full z-20 mt-1 hidden w-max max-w-[36rem] items-center gap-2 rounded-md border border-border bg-popover px-2 py-1 shadow-md group-hover:flex group-focus-within:flex"
    data-testid="term-iri-popover"
  >
    <code class="break-all text-xs font-mono">{{ fullIri }}</code>
    <button
      type="button"
      class="inline-flex shrink-0 cursor-pointer items-center justify-center rounded border border-border p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      :title="`Copy ${typeLabel} to clipboard`"
      :aria-label="`Copy ${typeLabel} to clipboard`"
      @click="copy"
    >
      <Copy class="h-3 w-3" />
    </button>
  </div>
</template>
