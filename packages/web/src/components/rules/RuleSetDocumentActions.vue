<template>
  <div class="document-actions">
    <button
      class="editor-action"
      type="button"
      data-testid="format-document"
      title="Format the rule set"
      :disabled="!code.trim() || formatting"
      @click="emit('format')"
    >
      <WandSparkles :size="13" />
    </button>

    <!--
      The prefix conversions, beside Format because they are the same kind of
      control: one press, whole document rewritten. They work on SRL against
      SRL's own grammar — see `prefixGrammarFor`.
    -->
    <PrefixConversionButtons
      :code="code"
      content-type="application/srl"
      @update:code="(value) => emit('update:code', value)"
    />

    <button
      class="editor-action"
      type="button"
      data-testid="import-body"
      title="Append a rule built from a CONSTRUCT or INSERT query"
      @click="emit('import')"
    >
      <FileInput :size="13" />
    </button>

    <button
      v-if="canDiff"
      class="editor-action"
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
 * What the rules screen does *to the document*: rewrite what is here, add to
 * it, compare it — in the order they are reached for.
 *
 * One component because the row has two homes and only ever one at a time —
 * the editor's own header on the page, and the run row while the editor is
 * popped out, where the pop-out's header has already taken the title and
 * Expand has become Close.
 */
import { FileInput, GitCompare, WandSparkles } from '@lucide/vue';
import PrefixConversionButtons from '../shared/PrefixConversionButtons.vue';
import { NOTHING_TO_DIFF } from '@/lib/versionDiff';

defineProps<{
  code: string;
  formatting: boolean;
  /** False on a scratch rule set: nothing saved to compare against. */
  canDiff: boolean;
  /** The pair being compared, or empty when there is no pair. */
  diffTitle: string;
}>();

const emit = defineEmits<{
  (e: 'format'): void;
  (e: 'import'): void;
  (e: 'diff'): void;
  (e: 'update:code', value: string): void;
}>();
</script>
