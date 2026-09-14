<template>
  <Transition name="code-swap" appear>
    <slot />
  </Transition>
</template>

<script setup lang="ts">
/**
 * A cross-fade for the editor that swaps out from under you.
 *
 * The work areas keep one CodeMirror per section and re-create it whenever a
 * different document takes it over — that is what gives the new document an
 * empty undo history (see `useEditorDocumentKey`). Re-creating it is also what
 * you see: the old text is torn out and the new text painted in the same
 * frame, so moving between two queries reads as a flinch rather than as a
 * change of subject.
 *
 * So the two instances overlap for a moment instead of alternating. The
 * leaving one is taken out of the flow — absolutely positioned over the
 * incoming one, which is why the element around this has to be a positioned
 * box — and both are carried across on opacity. Nothing moves and nothing
 * reflows, so the whole thing is one composited fade; there is no layout for
 * the overlap to disturb.
 *
 * `appear` because the first document is a swap too, from the point of view
 * of someone moving between sections: picking a query group after a query
 * replaces the whole work area, and the editor inside the new one arrives by
 * the same fade as one that was swapped in place.
 *
 * Deliberately short. This is punctuation between two documents, not an
 * animation to watch: long enough that the eye follows the swap, short enough
 * that a keystroke landing straight after the switch still goes where it
 * looks like it went.
 */
</script>

<style scoped>
:slotted(.code-swap-enter-active),
:slotted(.code-swap-leave-active) {
  transition: opacity 150ms ease;
}

/*
 * Out of the flow, so the incoming editor takes the space immediately and the
 * two are drawn on top of each other rather than stacked. It is on its way out
 * and cannot be typed into, so it does not take the pointer with it.
 */
:slotted(.code-swap-leave-active) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

:slotted(.code-swap-enter-from),
:slotted(.code-swap-leave-to) {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  :slotted(.code-swap-enter-active),
  :slotted(.code-swap-leave-active) {
    transition: none;
  }
}
</style>
