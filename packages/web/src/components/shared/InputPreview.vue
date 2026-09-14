<template>
  <CodePeek
    :label="label"
    :content="content"
    :content-type="contentType"
    :meta="meta"
    :empty="empty"
    :test-id="testId"
    :collapsed-lines="collapsedLines"
    class="input-preview"
  />
</template>

<script setup lang="ts">
/**
 * What an input actually contains, without leaving the page.
 *
 * A test's inputs are references — a data graph version, an argument set, a
 * pinned subject version — and a reference tells you a test *has* inputs while
 * hiding what they are. Since a test is read far more often than it is written,
 * and the question a reader has is nearly always "what is this running
 * against?", the answer belongs beside the reference rather than a navigation
 * away.
 *
 * This used to be a closed `<details>` over a `<pre>`, on the reasoning that
 * the input is the *premise* and the expectation is the claim, so opening every
 * premise would push the claim off the screen. The premise still must not take
 * the page — but a disclosure that shows *nothing* answers the reader's
 * question with a second click rather than with an answer. `CodePeek` keeps the
 * height bounded and shows the first few lines that say something, which is the
 * same constraint met with information in it.
 *
 * Read-only on purpose. Editing a data graph from inside a test would edit it
 * for every other test that names it — the reference is the point.
 */
import CodePeek from './CodePeek.vue';

withDefaults(
  defineProps<{
    label: string;
    /** The text to show. Nothing renders when it is empty. */
    content?: string | null;
    /** The media type, which decides the syntax highlighting. */
    contentType?: string | null;
    /** Format, size, version — whatever names *which* thing this is. */
    meta?: string;
    /** Shown in place of the peek when there is no content. */
    empty?: string;
    testId?: string;
    /** How many lines the collapsed peek shows before it fades out. */
    collapsedLines?: number;
  }>(),
  {
    content: '',
    contentType: 'text/turtle',
    meta: '',
    empty: '',
    testId: undefined,
    collapsedLines: 6,
  },
);
</script>

<style scoped>
.input-preview {
  min-width: 0;
}
</style>
