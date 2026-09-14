<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 3 24 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <!-- Stylised ":" with hollow dots -->
    <circle cx="12" cy="7" r="2.5" stroke="currentColor" stroke-width="2" />
    <circle cx="12" cy="17" r="2.5" stroke="currentColor" stroke-width="2" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), {
  size: 18,
});
</script>
