<template>
  <!--
    The results action bar: one row, wherever a response is being shown.
  -->
  <div class="results-action-bar" data-testid="results-action-bar">
    <slot />
    <div v-if="$slots.actions" class="action-bar-right">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The bar over a response: which view you are in, the filter over it, and what
 * you can do to the response.
 *
 * A component rather than a class anyone can type, because typing it is exactly
 * how this went wrong. The styles in `assets/css/results-chrome.css` are all
 * descendants of `.results-action-bar` — `.btn-action`, `.results-filter`,
 * `.action-bar-right` — so a second bar hand-drawn under any other class name
 * gets none of them: the pop-out view of the rule set results did that, and its
 * download button lost its height, padding and border and drew its icon above
 * its label, while its filter drifted to the right-hand end. Nothing about it
 * looked like a missing stylesheet; it looked like a design.
 *
 * So there is one way to spell the bar, it puts the left cluster in document
 * order and the actions in the right-hand group, and `designSystem.test.ts`
 * fails any file that reaches for the bar's classes without it.
 */
</script>
