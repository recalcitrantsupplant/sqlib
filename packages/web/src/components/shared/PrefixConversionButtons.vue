<template>
  <!--
    Both directions, always live.

    Not a toggle: a document is rarely all one form or all the other — a full
    IRI pasted into a query that already declares six prefixes is the normal
    case — so there is no current state for a toggle to flip, and hiding one
    direction behind the other would hide half of a whole-document rewrite.

    Absent entirely for a language the app has no grammar for, rather than
    disabled: a greyed-out button invites a bug report, while a language that
    cannot be converted has nothing to explain to the person typing in it.
  -->
  <div v-if="supported" class="prefix-conversion-buttons">
    <button
      type="button"
      class="bar-button"
      data-testid="prefix-fold-button"
      :disabled="disabled"
      title="Shorten full IRIs to prefixed names, declaring any prefix the result needs"
      @click="fold"
    >
      <PrefixFoldIcon :size="13" />
    </button>
    <button
      type="button"
      class="bar-button"
      data-testid="iri-unfold-button"
      :disabled="disabled"
      title="Expand every prefixed name to its full IRI"
      @click="unfold"
    >
      <IriUnfoldIcon :size="13" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * The prefix conversions as a pair of toolbar buttons.
 *
 * Value-shaped rather than event-shaped — `code` in, `update:code` out — so
 * every editor that hosts it gets both conversions by dropping it in the
 * toolbar, with no handler of its own to write and no way for two hosts to
 * disagree about what the buttons do.
 *
 * One chrome, not two. These used to come in a labelled variant as well, which
 * made the same pair of buttons a different size and shape depending on which
 * toolbar you found them in. They are the square icon buttons the query
 * editor's save bar wears, everywhere.
 */
import { computed } from 'vue';
import PrefixFoldIcon from '@/components/icons/PrefixFoldIcon.vue';
import IriUnfoldIcon from '@/components/icons/IriUnfoldIcon.vue';
import { usePrefixConversion } from '@/composables/usePrefixConversion';

const props = defineProps<{
  code: string;
  /** What the document is — it decides which grammar the rewrite may use. */
  contentType: string | null | undefined;
}>();
const emit = defineEmits<{ (e: 'update:code', value: string): void }>();

const { toPrefixed, toIris, supported } = usePrefixConversion(() => props.contentType);

const disabled = computed(() => !props.code || props.code.trim().length === 0);

/*
 * A null result means the conversion changed nothing and has already said so.
 * Emitting anyway would push an identical string back through the editor and
 * mark the document dirty for a press that did nothing.
 */
function fold() {
  const next = toPrefixed(props.code);
  if (next !== null) emit('update:code', next);
}

function unfold() {
  const next = toIris(props.code);
  if (next !== null) emit('update:code', next);
}
</script>

<style scoped>
.prefix-conversion-buttons {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

/*
 * The save bar's own button, restated. Its styles are scoped to it, so a
 * component rendered inside it cannot inherit them by class name — these
 * values are copied from `.bar-button`/`.bar-icon` in SaveBar.vue and have to
 * be changed with them.
 */
.bar-button {
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

.bar-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--ink);
}

.bar-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
