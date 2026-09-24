<template>
  <div class="document-actions">
    <button
      class="editor-action"
      type="button"
      data-testid="format-query"
      title="Format the query"
      :disabled="!code.trim()"
      @click="emit('format')"
    >
      <WandSparkles :size="13" />
    </button>

    <PrefixConversionButtons
      :code="code"
      content-type="application/sparql-query"
      @update:code="(value) => emit('update:code', value)"
    />

    <!--
      Diff comes down here with them: it reframes the document rather than
      acting on the query, and it is a toggle, so it needs to sit where the
      thing it reframes is. Absent on a scratch query, which has no saved
      version to differ from.
    -->
    <button
      v-if="canDiff"
      class="editor-action"
      :class="{ 'editor-action--active': diffActive }"
      type="button"
      data-testid="diff-query"
      :disabled="!diffTitle"
      :title="diffTitle || NOTHING_TO_DIFF"
      @click="emit('diff')"
    >
      <GitCompare :size="13" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * What the query screen does *to the document*: rewrite it, or reframe it.
 *
 * One component because the row has two homes and only ever one at a time —
 * the editor's own header on the page, and the run row while the editor is
 * popped out, where the pop-out's header has already taken the title and
 * Expand has become Close.
 */
import { GitCompare, WandSparkles } from '@lucide/vue';
import PrefixConversionButtons from '../shared/PrefixConversionButtons.vue';
import { NOTHING_TO_DIFF } from '@/lib/versionDiff';

defineProps<{
  code: string;
  /** False on a scratch query: nothing saved to compare against. */
  canDiff: boolean;
  /** The pair being compared, or empty when there is no pair. */
  diffTitle: string;
  diffActive: boolean;
}>();

const emit = defineEmits<{
  (e: 'format'): void;
  (e: 'diff'): void;
  (e: 'update:code', value: string): void;
}>();
</script>
