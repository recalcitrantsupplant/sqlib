<template>
  <div class="page-shell">
    <header class="page-header">
      <div>
        <h1>CodeMirror RDF Playground</h1>
        <p>
          Toggle between RDF serializations to confirm the CodeMirror configuration that powers the
          query results viewer.
        </p>
      </div>
      <span class="active-type" aria-live="polite">
        <strong>Active:</strong>
        <code>{{ activeDemo.label }}</code>
      </span>
    </header>

    <section>
      <div class="toolbar" role="toolbar" aria-label="RDF media types">
        <button
          v-for="demo in demos"
          :key="demo.id"
          type="button"
          class="toolbar-button"
          :class="{ 'is-active': demo.id === activeDemo.id }"
          :title="demo.description"
          :aria-pressed="demo.id === activeDemo.id"
          @click="setDemo(demo)"
        >
          {{ demo.label }}
        </button>
      </div>

      <div class="editor-wrapper">
        <MediaTypeCodeViewer
          :content="activeDemo.sample"
          :content-type="activeDemo.id"
          min-height="420px"
        />
      </div>
    </section>

    <footer class="page-footer">
      <p>
        The component mirrors the production configuration, so visiting
        <code>/tests/codemirror-rdf</code> in the dev server is a quick way to check syntax support.
      </p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MediaTypeCodeViewer from '@/components/MediaTypeCodeViewer.vue';

type Demo = {
  id: string;
  label: string;
  description: string;
  sample: string;
};

const demos: Demo[] = [
  {
    id: 'text/turtle',
    label: 'text/turtle',
    description: 'Terse triples with prefixes',
    sample: `@prefix schema: <http://schema.org/> .
@prefix ex: <https://example.com/> .

ex:dataset a schema:Dataset ;
    schema:name "Sample dataset" ;
    schema:creator ex:Alice ;
    schema:distribution [
        schema:contentUrl <https://example.com/data.ttl> ;
        schema:encodingFormat "text/turtle"
    ] .`,
  },
  {
    id: 'application/trig',
    label: 'application/trig',
    description: 'TriG dataset with named graphs',
    sample: `@prefix ex: <https://example.com/> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

ex:default {
  ex:alice foaf:name "Alice" ;
           foaf:knows ex:bob .
}

ex:named {
  ex:bob foaf:name "Bob" ;
         foaf:knows ex:carol .
}`,
  },
  {
    id: 'application/n-triples',
    label: 'application/n-triples',
    description: 'Line-oriented triples (UTF-8)',
    sample: `<https://example.com/alice> <http://xmlns.com/foaf/0.1/name> "Alice" .
<https://example.com/alice> <http://xmlns.com/foaf/0.1/knows> <https://example.com/bob> .
<https://example.com/bob> <http://xmlns.com/foaf/0.1/name> "Bob" .`,
  },
  {
    id: 'application/n-quads',
    label: 'application/n-quads',
    description: 'Line-oriented quads with graph IRIs',
    sample: `<https://example.com/alice> <http://xmlns.com/foaf/0.1/name> "Alice" <https://example.com/graphs/people> .
<https://example.com/alice> <http://xmlns.com/foaf/0.1/knows> <https://example.com/bob> <https://example.com/graphs/people> .
<https://example.com/report> <http://purl.org/dc/terms/creator> <https://example.com/alice> <https://example.com/graphs/reports> .`,
  },
  {
    id: 'application/ld+json',
    label: 'application/ld+json',
    description: 'JSON-LD compacted form',
    sample: `{
  "@context": {
    "@vocab": "http://schema.org/",
    "knows": { "@id": "http://xmlns.com/foaf/0.1/knows", "@type": "@id" }
  },
  "@id": "https://example.com/alice",
  "@type": "Person",
  "name": "Alice",
  "knows": {
    "@id": "https://example.com/bob",
    "name": "Bob"
  }
}`,
  },
  {
    id: 'application/rdf+xml',
    label: 'application/rdf+xml',
    description: 'Classic RDF/XML serialization',
    sample: `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:foaf="http://xmlns.com/foaf/0.1/">
  <foaf:Person rdf:about="https://example.com/alice">
    <foaf:name>Alice</foaf:name>
    <foaf:knows rdf:resource="https://example.com/bob" />
  </foaf:Person>
</rdf:RDF>`,
  },
  {
    id: 'application/sparql-results+json',
    label: 'SPARQL JSON',
    description: 'SPARQL result for quick comparison',
    sample: `{
  "head": { "vars": ["name", "knows"] },
  "results": {
    "bindings": [
      {
        "name": { "type": "literal", "value": "Alice" },
        "knows": { "type": "uri", "value": "https://example.com/bob" }
      }
    ]
  }
}`,
  },
  {
    id: 'application/sparql-query',
    label: 'SPARQL Query',
    description: 'SPARQL query syntax highlighting',
    sample: `PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT ?name ?knows
WHERE {
  ?person a foaf:Person ;
          foaf:name ?name ;
          foaf:knows ?knows .
}`,
  },
  {
    id: 'application/xml',
    label: 'Generic XML',
    description: 'Fallback XML highlighting',
    sample: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example feed</title>
  <entry>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <title>Atom-powered robots run amok</title>
  </entry>
</feed>`,
  },
];

const activeDemo = ref<Demo>(demos[0]);

const setDemo = (demo: Demo) => {
  activeDemo.value = demo;
};
</script>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: var(--space-8) var(--space-7) var(--space-9);
  max-width: 1100px;
  margin: 0 auto;
  color: var(--ink);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem 1.5rem;
  flex-wrap: wrap;
}

.page-header h1 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-hero-fluid);
}

.page-header p {
  margin: 0;
  color: var(--ink-secondary);
  max-width: 640px;
}

.active-type {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--border-strong);
  background: var(--action-surface);
  font-size: var(--text-content);
}

.active-type code {
  background: rgba(129, 140, 248, 0.15);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-panel);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: var(--space-6);
}

.toolbar-button {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-6);
  background: var(--action-surface);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.toolbar-button:hover {
  background: var(--action-surface);
}

.toolbar-button.is-active {
  border-color: var(--violet-500);
  background: var(--action-surface);
  font-weight: 600;
  transform: translateY(-1px);
}

.editor-wrapper {
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.page-footer {
  color: var(--ink-secondary);
  line-height: 1.5;
}

.page-footer code {
  background: rgba(129, 140, 248, 0.15);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-panel);
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .page-shell {
  color: var(--ink-disabled);
}

.dark .page-header p,
.dark .page-footer {
  color: var(--ink-disabled);
}

.dark .active-type {
  border-color: var(--border-hover);
  background: rgba(99, 102, 241, 0.3);
}

.dark .active-type code,
.dark .page-footer code {
  background: rgba(129, 140, 248, 0.28);
}

.dark .toolbar-button {
  border-color: var(--border-hover);
  background: var(--gray-800);
  color: var(--ink-disabled);
}

.dark .toolbar-button:hover {
  background: var(--gray-800);
}

.dark .toolbar-button.is-active {
  border-color: var(--action-border);
  background: var(--violet-700);
}
</style>
