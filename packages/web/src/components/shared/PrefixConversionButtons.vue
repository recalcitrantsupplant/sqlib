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
  <div v-if="supported" class="prefix-conversion-buttons" :class="`is-${variant}`">
    <button
      type="button"
      :class="buttonClass"
      data-testid="prefix-fold-button"
      :disabled="disabled"
      title="Shorten full IRIs to prefixed names, declaring any prefix the result needs"
      @click="fold"
    >
      <PrefixFoldIcon :size="iconSize" />
      <span v-if="variant === 'labelled'">Prefix</span>
    </button>
    <button
      type="button"
      :class="buttonClass"
      data-testid="iri-unfold-button"
      :disabled="disabled"
      title="Expand every prefixed name to its full IRI (the PREFIX declarations stay)"
      @click="unfold"
    >
      <IriUnfoldIcon :size="iconSize" />
      <span v-if="variant === 'labelled'">Expand</span>
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
 */
import { computed } from 'vue';
import PrefixFoldIcon from '@/components/icons/PrefixFoldIcon.vue';
import IriUnfoldIcon from '@/components/icons/IriUnfoldIcon.vue';
import { usePrefixConversion } from '@/composables/usePrefixConversion';

const props = withDefaults(defineProps<{
  code: string;
  /** What the document is — it decides which grammar the rewrite may use. */
  contentType: string | null | undefined;
  /**
   * Which chrome to wear. `icon` matches the save bar's square icon buttons,
   * where these sit beside Format; `labelled` is for the roomier toolbars that
   * spell their controls out.
   *
   * Styled here rather than by borrowing the host's classes: the save bar's
   * styles are scoped, so a class name copied from it would silently do
   * nothing inside this component.
   */
  variant?: 'labelled' | 'icon';
}>(), { variant: 'labelled' });
const emit = defineEmits<{ (e: 'update:code', value: string): void }>();

const { toPrefixed, toIris, supported } = usePrefixConversion(() => props.contentType);

const disabled = computed(() => !props.code || props.code.trim().length === 0);
const iconSize = computed(() => (props.variant === 'icon' ? 13 : 12));
const buttonClass = computed(() => (props.variant === 'icon' ? 'bar-button' : 'btn-compact'));

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
  gap: var(--space-2);
}

.prefix-conversion-buttons.is-icon {
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
