<template>
  <button
    type="button"
    class="icon-control"
    :class="[{ 'copy-button--done': copied }, size === 'sm' ? 'icon-control--sm' : '']"
    :data-testid="testid || undefined"
    :title="copied ? 'Copied' : label"
    :aria-label="label"
    :disabled="!text"
    @click="copy"
  >
    <Check v-if="copied" :size="16" />
    <Copy v-else :size="16" />
  </button>
</template>

<script setup lang="ts">
/**
 * Copy a whole document to the clipboard: the query, the rules, a response.
 *
 * It sits in the control row over the document, beside the other controls
 * that act on the whole text, and never over the code (see `ExpandButton`).
 * A selection is Ctrl+C's job; this button copies everything, including any
 * part a view hides, such as the prologue that `CodePeek` strips.
 *
 * Success is shown on the button, where the pointer is: the glyph turns to a
 * check for a moment. A refused write gets an error toast from
 * `useCopyToClipboard`, and the button stays as it was.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { Check, Copy } from '@lucide/vue';
import { useCopyToClipboard } from '@/composables/useCopyToClipboard';

const props = withDefaults(defineProps<{
  /** The text to copy. Empty disables the button. */
  text: string | null | undefined;
  /** What is copied, for the tooltip: "query" gives "Copy query". */
  subject?: string;
  size?: 'md' | 'sm';
  testid?: string;
}>(), {
  subject: 'text',
  size: 'md',
  testid: '',
});

const COPIED_MS = 1500;

const { writeClipboard } = useCopyToClipboard();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const label = computed(() => `Copy ${props.subject}`);

async function copy() {
  if (!props.text) return;
  if (!(await writeClipboard(props.text))) return;
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), COPIED_MS);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<style scoped>
.copy-button--done,
.copy-button--done:hover:not(:disabled) {
  border-color: var(--success);
  color: var(--success);
}
</style>
