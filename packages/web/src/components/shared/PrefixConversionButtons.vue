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
      class="icon-control"
      data-testid="prefix-fold-button"
      :disabled="disabled"
      title="Shorten full IRIs to prefixed names, declaring any prefix the result needs"
      @click="fold"
    >
      <PrefixFoldIcon :size="16" />
    </button>
    <button
      type="button"
      class="icon-control"
      data-testid="iri-unfold-button"
      :disabled="disabled"
      title="Expand every prefixed name to its full IRI"
      @click="unfold"
    >
      <IriUnfoldIcon :size="16" />
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
 * One chrome, not two. These used to come in a labelled variant as well, and
 * later restated the save bar's button in a scoped block that each host then
 * resized, which made the same pair of buttons a different size depending on
 * which toolbar you found them in. They are `.icon-control` from
 * `compact-buttons.css` — the same box as every other icon button in the row,
 * on every screen.
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
  gap: var(--space-3);
}
</style>
