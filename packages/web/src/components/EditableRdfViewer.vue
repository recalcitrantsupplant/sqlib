<template>
  <div class="editable-rdf-viewer">
    <Codemirror
      :model-value="modelValue"
      :extensions="extensions"
      :tab-size="2"
      :indent-with-tab="false"
      :style="{
        height: '100%',
        minHeight: minHeightStyle,
      }"
      @update:model-value="handleUpdate"
    />
  </div>
</template>

<script setup lang="ts">
import { Codemirror } from 'vue-codemirror';
import { computed, ref, shallowRef, watch } from 'vue';
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
import { languageExtensionsFor } from '@/lib/codeLanguage';
import { useCommentKeymap } from '@/composables/useCommentKeymap';
import { useEditorKeymaps } from '@/composables/useEditorKeymaps';
import { rdfSyntaxHighlighting } from '@/lib/codemirrorHighlight';
import { usePrefixDiscovery } from '@/composables/usePrefixDiscovery';
import { useTheme } from '@/composables/useTheme';

interface Props {
  modelValue: string;
  contentType?: string;
  minHeight?: string | number;
  /**
   * Where this graph lives, as a prefix-source token (see
   * `lib/prefixSources.ts`). Its `@prefix` lines are registered with the
   * prefix manager, the same as a query's `PREFIX` lines are.
   */
  prefixSource?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  contentType: 'text/turtle',
  minHeight: '320px',
  prefixSource: undefined,
});

usePrefixDiscovery(() => props.modelValue, () => props.prefixSource);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const minHeightStyle = computed(() =>
  typeof props.minHeight === 'number' ? `${props.minHeight}px` : props.minHeight,
);

const handleUpdate = (value: string) => {
  emit('update:modelValue', value);
};

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
  keymap.of([...historyKeymap as any]),
  useCommentKeymap(),
  useEditorKeymaps(),
  EditorView.editable.of(true), // Enable editing
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

const languageExtensions = computed<Extension[]>(() => languageExtensionsFor(props.contentType));

const extensions = shallowRef<Extension[]>([]);

const applyExtensions = () => {
  const theme = isDarkMode.value ? darkTheme : lightTheme;
  extensions.value = [...baseExtensions, theme, ...languageExtensions.value];
};

watch([languageExtensions, isDarkMode], applyExtensions, { immediate: true });

</script>

<style scoped>
.editable-rdf-viewer {
  position: relative;
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-subtle);
  overflow: hidden;
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .editable-rdf-viewer {
  border-color: var(--border-hover);
  background: var(--gray-900);
}
</style>
