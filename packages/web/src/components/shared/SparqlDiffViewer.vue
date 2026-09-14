<template>
  <div class="sparql-diff-viewer">
    <div ref="mergeViewContainer" class="merge-view-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { languageExtensionsFor } from '@/lib/codeLanguage'
import { rdfSyntaxHighlighting } from '@/lib/codemirrorHighlight'
import { MergeView } from '@codemirror/merge'

const props = withDefaults(
  defineProps<{
    leftQuery: string
    rightQuery: string
    leftLabel?: string
    rightLabel?: string
    height?: string
  }>(),
  {
    leftLabel: 'Original',
    rightLabel: 'Modified',
    height: '500px'
  }
)

const mergeViewContainer = ref<HTMLDivElement | null>(null)
let mergeView: MergeView | null = null

function initializeMergeView() {
  if (!mergeViewContainer.value) return

  // Clean up existing merge view if any
  if (mergeView) {
    mergeView.destroy()
    mergeView = null
  }

  mergeView = new MergeView({
    a: {
      doc: props.leftQuery,
      extensions: [
        basicSetup,
        ...languageExtensionsFor('application/sparql-query'),
        rdfSyntaxHighlighting,
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: props.height },
          ".cm-scroller": { overflow: "auto" }
        })
      ]
    },
    b: {
      doc: props.rightQuery,
      extensions: [
        basicSetup,
        ...languageExtensionsFor('application/sparql-query'),
        rdfSyntaxHighlighting,
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: props.height },
          ".cm-scroller": { overflow: "auto" }
        })
      ]
    },
    parent: mergeViewContainer.value,
    orientation: "a-b",
    revertControls: "a-to-b",
    highlightChanges: true,
    gutter: true,
    renderRevertControl() {
      const button = document.createElement("button")
      button.textContent = "⇄"
      button.title = "Revert this change"
      button.style.cssText = "cursor: pointer; padding: 2px 6px; font-size: var(--text-body);"
      return button
    }
  })
}

// Watch for changes to the queries and reinitialize
watch(() => [props.leftQuery, props.rightQuery, props.height], () => {
  initializeMergeView()
})

onMounted(() => {
  initializeMergeView()
})

onUnmounted(() => {
  if (mergeView) {
    mergeView.destroy()
    mergeView = null
  }
})
</script>

<style scoped>
.sparql-diff-viewer {
  width: 100%;
  height: 100%;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.merge-view-container {
  width: 100%;
  height: 100%;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

/* CodeMirror merge view styling */
:deep(.cm-mergeView) {
  display: flex !important;
  width: 100% !important;
  height: 100% !important;
}

/* This is the wrapper that contains both editors */
:deep(.cm-mergeViewEditors) {
  display: flex !important;
  width: 100% !important;
  height: 100% !important;
  flex: 1 !important;
}

:deep(.cm-mergeViewEditor) {
  flex: 1 1 50% !important;
  min-width: 0 !important;
  width: 50% !important;
}

:deep(.cm-merge-revert) {
  position: absolute !important;
}

:deep(.cm-merge-spacer) {
  flex: 0 0 auto !important;
  width: 2px !important;
  background: var(--surface-raised) !important;
}

/* Ensure the editor content doesn't have fixed widths */
:deep(.cm-editor) {
  width: 100% !important;
}

:deep(.cm-scroller) {
  width: 100% !important;
}

:deep(.cm-changedLine) {
  background: var(--warning-surface) !important;
}

:deep(.cm-deletedLine) {
  background: var(--danger-surface) !important;
}

:deep(.cm-insertedLine) {
  background: var(--success-surface) !important;
}

:deep(.cm-changedText) {
  background: var(--warning-surface) !important;
}

:deep(.cm-deletedText) {
  background: var(--danger-surface) !important;
  text-decoration: line-through;
}

:deep(.cm-insertedText) {
  background: var(--success-surface) !important;
}

:deep(.cm-merge-revert) {
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  padding: var(--space-1) var(--space-3);
  margin: var(--space-1);
  cursor: pointer;
  border-radius: var(--radius);
  font-size: var(--text-body);
}

:deep(.cm-merge-revert:hover) {
  background: var(--surface-raised);
}

:deep(.cm-gutters) {
  background-color: var(--surface-subtle);
  border-right: 1px solid var(--border-subtle);
}

:deep(.cm-activeLineGutter) {
  background-color: var(--surface-sunken);
}
</style>
