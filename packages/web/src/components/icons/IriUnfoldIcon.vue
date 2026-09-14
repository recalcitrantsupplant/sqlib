<template>
  <!--
    Unfold to full IRIs: the same two bracket heads, turned outward, spelling
    the '< >' the conversion produces.

    The shafts stop at 8.6 and 15.4 rather than at 9.5 and 14.5, where the
    folded icon's heads stop. That 1.2 is an optical correction, not a
    measurement: folded, the nearest ink to the colon is a converging point,
    and a taper recedes; unfolded, it is a blunt round cap with the arms
    flaring back toward the colon behind it, and a blunt terminal advances. At
    matched geometry the expand icon reads as crowding the colon, so it is
    given clearance it does not geometrically need. Only the shaft moves —
    the heads stay where the folded icon puts them, so nothing shifts when a
    toolbar shows the two side by side.
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
    <path d="M3.2 12H8M20.8 12H16" />
    <path d="M7.2 4.5 2.6 12l4.6 7.5M16.8 4.5 21.4 12l-4.6 7.5" />
    <circle cx="12" cy="6.6" r="2.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="17.4" r="2.3" fill="currentColor" stroke="none" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), {
  size: 18,
});
</script>
