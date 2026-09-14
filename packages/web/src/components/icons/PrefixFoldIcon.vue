<template>
  <!--
    Fold to prefixed names: two brackets turned inward on a colon.

    Sized by how much of the 24-grid it fills rather than by the px it renders
    at. An earlier cut was 83% wide but only 47% tall, against the ~75% the
    wand beside it fills — so it read as the small icon in the row even though
    it was the widest. Scaling it up uniformly would only have clipped: the
    height was the thing missing, and the heads and colon grew into it.

    The head is drawn at bracket proportions rather than arrowhead ones — 3
    wide by 4.5 half-height — so it reads as the '<' and '>' you actually type
    around an IRI. Turned in, they squeeze; turned out (IriUnfoldIcon), the
    same two heads spell the delimiters of what they produce.
  -->
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M1.6 12H8.4M22.4 12H15.6" />
    <path d="M4.6 4.5 9.2 12l-4.6 7.5M19.4 4.5 14.8 12l4.6 7.5" />
    <circle cx="12" cy="6.6" r="2.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="17.4" r="2.3" fill="currentColor" stroke="none" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), {
  size: 18,
});
</script>
