<template>
  <div class="code-viewer">
    <EmptyState v-if="!hasContent" size="sm" title="No response content available" />
    <Codemirror
      v-else
      :model-value="contentValue"
      :extensions="extensions"
      :tab-size="2"
      :indent-with-tab="false"
      :style="{
        height: '100%',
        minHeight: minHeightStyle,
      }"
      @update:model-value="noop"
    />
  </div>
</template>

<script setup lang="ts">
import { Codemirror } from 'vue-codemirror';
import { computed, ref, shallowRef, watch } from 'vue';
import EmptyState from './shared/EmptyState.vue';
import { useTheme } from '@/composables/useTheme';
import type { Extension } from '@codemirror/state';
import { history, historyKeymap } from '@codemirror/commands';
import {
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  EditorView,
} from '@codemirror/view';
import {
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
  bracketMatching,
} from '@codemirror/language';
import { languageExtensionsFor, normalizeContentType } from '@/lib/codeLanguage';
import { rdfSyntaxHighlighting } from '@/lib/codemirrorHighlight';

const props = withDefaults(
  defineProps<{
    content?: string | null;
    contentType?: string | null;
    minHeight?: string | number;
  }>(),
  {
    content: '',
    contentType: null,
    minHeight: '320px',
  },
);

const minHeightStyle = computed(() =>
  typeof props.minHeight === 'number' ? `${props.minHeight}px` : props.minHeight,
);

const hasContent = computed(() => !!(props.content && props.content.length > 0));
const contentValue = computed(() => {
  const content = props.content ?? '';
  const type = normalizedContentType.value;

  if (
    content &&
    (type === 'application/sparql-results+json' ||
      type === 'application/json' ||
      type?.endsWith('+json'))
  ) {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      // Fallback to original content if JSON parsing fails
      console.warn('Failed to pretty-print JSON content:', e);
      return content;
    }
  }
  return content;
});

const baseExtensions: Extension[] = [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  highlightActiveLine(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  // Layered over the default: it wins for every tag it names, and the
  // default keeps covering the JSON/XML/SQL tags it does not.
  rdfSyntaxHighlighting,
  keymap.of([...historyKeymap]),
  EditorView.editable.of(false),
  EditorView.lineWrapping,
];

const lightTheme = EditorView.theme(
  {
    '&': { height: '100%' },
    '.cm-content': { fontSize: 'var(--text-code)' },
    '.cm-scroller': { overflow: 'auto' },
  },
  { dark: false },
);

const darkTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--code-surface)', color: 'var(--code-ink)' },
    '.cm-content': { fontSize: 'var(--text-code)' },
    '.cm-gutters': { backgroundColor: 'var(--code-surface)', color: 'var(--code-gutter-ink)' },
    '.cm-scroller': { overflow: 'auto' },
  },
  { dark: true },
);

/*
 * The editor theme follows the app's theme preference, not the OS: reading
 * matchMedia directly meant a preference pinned in Settings was ignored here,
 * so a light editor could sit in a dark app (and the reverse).
 */
const { isDark: isDarkMode } = useTheme();

const normalizedContentType = computed(() => normalizeContentType(props.contentType));

const languageExtensions = computed<Extension[]>(() => languageExtensionsFor(props.contentType));

const extensions = shallowRef<Extension[]>([]);

const applyExtensions = () => {
  const theme = isDarkMode.value ? darkTheme : lightTheme;
  extensions.value = [...baseExtensions, theme, ...languageExtensions.value];
};

watch([languageExtensions, isDarkMode], applyExtensions, { immediate: true });


const noop = () => {
  // Read-only viewer; ignore editor updates.
};
</script>

<style scoped>
.code-viewer {
  position: relative;
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  background: var(--surface-subtle);
  overflow: hidden;
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .code-viewer {
  border-color: var(--border-hover);
  background: var(--gray-900);
}
</style>
