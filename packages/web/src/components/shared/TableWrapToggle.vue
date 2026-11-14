<script setup lang="ts">
/**
 * The word-wrap switch for result tables, in the results action bar beside
 * the term display pair. Drawn as an `.icon-control` so it matches them.
 * See `useTableWrap` for what it governs.
 */
import { TextWrap } from '@lucide/vue';
import { useTableWrap } from '@/composables/useTableWrap';

const { wrap, toggleWrap } = useTableWrap();
</script>

<template>
  <button
    type="button"
    class="icon-control"
    :class="{ 'icon-control--selected': wrap }"
    data-testid="table-wrap-toggle"
    :aria-pressed="wrap"
    title="Wrap long values"
    @click="toggleWrap"
  >
    <TextWrap :size="16" />
  </button>
</template>
