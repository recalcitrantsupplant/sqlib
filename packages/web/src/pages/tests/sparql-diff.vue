<template>
  <div class="page">
    <header>
      <h1>SPARQL Query Diff</h1>
      <p>Compare two SPARQL queries side-by-side with syntax highlighting</p>
    </header>

    <section class="card">
      <div class="controls">
        <button @click="loadExampleQueries" class="btn-primary">Load Example</button>
        <button @click="clearQueries" class="btn-secondary">Clear</button>
        <button @click="swapQueries" class="btn-secondary">Swap Queries</button>
      </div>

      <div class="editor-container">
        <div ref="mergeViewContainer" class="merge-view"></div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { languageExtensionsFor } from '@/lib/codeLanguage'
import { MergeView } from '@codemirror/merge'

const mergeViewContainer = ref<HTMLDivElement | null>(null)
let mergeView: MergeView | null = null

const originalQuery = ref(`PREFIX schema: <http://schema.org/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT ?person ?name ?email
WHERE {
  ?person rdf:type schema:Person ;
          schema:name ?name ;
          schema:email ?email .
}
LIMIT 10`)

const modifiedQuery = ref(`PREFIX schema: <http://schema.org/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT ?person ?name ?email ?age
WHERE {
  ?person rdf:type schema:Person ;
          schema:name ?name ;
          schema:email ?email ;
          schema:age ?age .
  FILTER(?age > 18)
}
ORDER BY ?name
LIMIT 20`)

function loadExampleQueries() {
  const example1 = `PREFIX ex: <http://example.org/>
SELECT * WHERE {
  ?s ex:predicate ?o .
}`

  const example2 = `PREFIX ex: <http://example.org/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?s ?o ?type WHERE {
  ?s ex:predicate ?o ;
     rdf:type ?type .
  FILTER(?type != ex:Invalid)
}`

  if (mergeView) {
    mergeView.a.dispatch({
      changes: {
        from: 0,
        to: mergeView.a.state.doc.length,
        insert: example1
      }
    })
    mergeView.b.dispatch({
      changes: {
        from: 0,
        to: mergeView.b.state.doc.length,
        insert: example2
      }
    })
  }
}

function clearQueries() {
  if (mergeView) {
    mergeView.a.dispatch({
      changes: {
        from: 0,
        to: mergeView.a.state.doc.length,
        insert: ''
      }
    })
    mergeView.b.dispatch({
      changes: {
        from: 0,
        to: mergeView.b.state.doc.length,
        insert: ''
      }
    })
  }
}

function swapQueries() {
  if (mergeView) {
    const aContent = mergeView.a.state.doc.toString()
    const bContent = mergeView.b.state.doc.toString()
    
    mergeView.a.dispatch({
      changes: {
        from: 0,
        to: mergeView.a.state.doc.length,
        insert: bContent
      }
    })
    mergeView.b.dispatch({
      changes: {
        from: 0,
        to: mergeView.b.state.doc.length,
        insert: aContent
      }
    })
  }
}

onMounted(() => {
  if (mergeViewContainer.value) {
    mergeView = new MergeView({
      a: {
        doc: originalQuery.value,
        extensions: [
          basicSetup,
          ...languageExtensionsFor('application/sparql-query'),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "500px" },
            ".cm-scroller": { overflow: "auto" }
          })
        ]
      },
      b: {
        doc: modifiedQuery.value,
        extensions: [
          basicSetup,
          ...languageExtensionsFor('application/sparql-query'),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "500px" },
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
})

onUnmounted(() => {
  if (mergeView) {
    mergeView.destroy()
  }
})
</script>

<style scoped>
.page {
  max-width: 1400px;
  margin: 0 auto;
  padding: var(--space-8);
}

header {
  margin-bottom: var(--space-8);
}

h1 {
  font-size: var(--text-display-lg);
  font-weight: 700;
  margin-bottom: var(--space-4);
  color: var(--ink);
}

header p {
  color: var(--ink-muted);
  font-size: var(--text-title);
}

.card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: var(--space-7);
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
}

.controls {
  display: flex;
  gap: 0.75rem;
  margin-bottom: var(--space-6);
  flex-wrap: wrap;
}

.btn-primary,
.btn-secondary {
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-panel);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.btn-primary {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.btn-primary:hover {
  background: var(--action-hover);
  border-color: var(--action-hover);
}

.btn-secondary {
  background: var(--surface);
  color: var(--ink-secondary);
  border-color: var(--border-default);
}

.btn-secondary:hover {
  background: var(--surface-subtle);
  border-color: var(--border-hover);
}

.editor-container {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

.merge-view {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

/* CodeMirror merge view styling */
:deep(.cm-mergeView) {
  display: flex;
  width: 100%;
}

:deep(.cm-mergeViewEditor) {
  flex: 1;
  min-width: 0;
}

:deep(.cm-merge-spacer) {
  width: 1px;
  background: var(--surface-raised);
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
