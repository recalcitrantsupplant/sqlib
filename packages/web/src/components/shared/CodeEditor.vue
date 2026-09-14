<template>
  <!--
    The test id names the box, not the editor inside it: `vue-codemirror`'s
    own root carries no layout of its own, so an id on it resolves to an
    element with no bounding box — findable, and useless to anything that asks
    where it is on the page.

    The shell around that box exists so the height a caller asks for is a
    property of the field rather than of the scrolling area inside it.
  -->
  <div class="code-editor-shell" :style="shellStyle">
    <div class="code-editor" :data-testid="testId">
      <Codemirror
        :model-value="modelValue"
        :extensions="extensions"
        :tab-size="2"
        :indent-with-tab="false"
        :style="{ width: '100%' }"
        @update:model-value="(value: string) => emit('update:modelValue', value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * An editable code box, wherever a `<textarea>` was holding a document.
 *
 * The text people type into these fields is Turtle, SPARQL results JSON or a
 * TUPLE document — languages with brackets to match, prefixes to read and
 * terms whose colour tells you what kind of term they are. A textarea renders
 * all of that as one grey block, which is the difference between spotting a
 * missing `.` and hunting for it.
 *
 * Value-shaped like the textarea it replaces: `modelValue` in, string out. The
 * language comes from a media type rather than a flag, so callers say what the
 * text *is* and this decides what that means.
 */
import { computed } from 'vue';
import { Codemirror } from 'vue-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorView, placeholder as placeholderExtension } from '@codemirror/view';
import { rdfSyntaxHighlighting } from '@/lib/codemirrorHighlight';
import { languageExtensionsFor } from '@/lib/codeLanguage';
import { usePrefixDiscovery } from '@/composables/usePrefixDiscovery';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** The media type of what is being typed — it decides the highlighting. */
    contentType?: string | null;
    placeholder?: string;
    testId?: string;
    minHeight?: string;
    maxHeight?: string;
    /** Off for the short ones, where a gutter is wider than the content. */
    showLineNumbers?: boolean;
    /**
     * True while this box is the one popped out, so it fills the pop-out
     * rather than keeping the height it was given for its slot in a form. The
     * button that sets it lives in the header row the caller draws above this
     * box, not in here.
     */
    expanded?: boolean;
    /**
     * Where this text lives, as a prefix-source token (see
     * `lib/prefixSources.ts`). Given one, the declarations in the document are
     * registered with the prefix manager as they are typed, the same as in
     * every other editor in the app. Left off, nothing is discovered — for the
     * boxes holding something that is not RDF at all.
     */
    prefixSource?: string | null;
  }>(),
  {
    contentType: 'text/turtle',
    placeholder: '',
    testId: undefined,
    minHeight: '120px',
    maxHeight: 'none',
    showLineNumbers: true,
    expanded: false,
    prefixSource: undefined,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

/*
 * Prefixes are learned from what is typed here, wherever "here" is: a test's
 * expected graph declares them the same way a query does.
 */
usePrefixDiscovery(() => props.modelValue, () => props.prefixSource);

/*
 * Popped out, the box fills the pop-out: a height that was right for a slot in
 * a form is not a height that means anything over the whole screen.
 */
const shellStyle = computed(() =>
  props.expanded ? undefined : { minHeight: props.minHeight, maxHeight: props.maxHeight },
);

/*
 * Only what `vue-codemirror`'s own defaults do not already give.
 *
 * It installs CodeMirror's `basicSetup` before anything passed here — history,
 * the default keymaps, bracket matching, indent-on-input, the active line and
 * the line-number gutter. Adding a second `history()` on top of that is not
 * free: two history extensions mean an undo can take two presses, so the list
 * below is deliberately short. The gutter is the one default that is sometimes
 * wrong rather than merely present, and it is turned off by hiding it, since
 * an extension already installed cannot be withdrawn.
 */
const extensions = computed<Extension[]>(() => [
  ...languageExtensionsFor(props.contentType),
  rdfSyntaxHighlighting,
  EditorView.lineWrapping,
  ...(props.placeholder ? [placeholderExtension(props.placeholder)] : []),
  ...(props.showLineNumbers
    ? []
    : [EditorView.theme({ '.cm-gutters': { display: 'none' } })]),
]);
</script>

<style scoped>
.code-editor-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.code-editor {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.code-editor:focus-within {
  border-color: var(--action);
}

.code-editor :deep(.cm-placeholder) {
  color: var(--ink-muted);
}

.code-editor :deep(.cm-editor) {
  background: transparent;
}
</style>
