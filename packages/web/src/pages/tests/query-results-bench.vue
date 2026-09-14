<script setup lang="ts">
/**
 * A results viewer with a dataset of any size, for the perf harness.
 *
 * `?rows=1000` picks the row count; the data is generated on load rather than
 * committed as a fixture, because the interesting sizes are megabytes of JSON
 * and the only thing that varies between them is a counter.
 *
 * The IRIs are deliberately mixed. Two thirds sit under namespaces the default
 * prefix set knows, so abbreviation has real work to do; the rest sit under one
 * it does not, which is the expensive path — a miss walks the whole sorted
 * namespace list before giving up. A fixture of purely abbreviable IRIs would
 * measure the memo cache instead of the lookup.
 */
import { computed } from 'vue';
import type { SparqlResults } from '@sparql-query-lib/types';
import QueryResultsViewer from '@/components/QueryResultsViewer.vue';

/*
 * Read straight off the URL rather than through `useRoute`.
 *
 * The app is `ssr: false` and this is a fixture, so `location` is always there;
 * the router is not worth the import. `nuxi typecheck` does not resolve Nuxt's
 * auto-imports (every existing `useRoute` call in the app is one of the errors
 * in .typecheck-baseline), so reaching for it here would have meant adding one
 * more to a number that is supposed to only go down.
 *
 * Read once, not reactively: nothing changes the query string without a reload.
 */
const rowCount = (() => {
  const raw = Number(new URLSearchParams(window.location.search).get('rows'));
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50_000) : 100;
})();

const KNOWN = [
  'http://xmlns.com/foaf/0.1/',
  'http://www.w3.org/2004/02/skos/core#',
  'http://purl.org/dc/terms/',
];
const UNKNOWN = 'http://example.org/bench/vocab#';

const structured = computed<SparqlResults>(() => {
  const bindings = [];
  for (let i = 0; i < rowCount; i++) {
    const namespace = i % 3 === 2 ? UNKNOWN : KNOWN[i % 3]!;
    bindings.push({
      s: { type: 'uri', value: `${namespace}subject${i}` },
      p: { type: 'uri', value: `${KNOWN[(i + 1) % 3]!}predicate${i % 17}` },
      o:
        i % 4 === 0
          ? { type: 'literal', value: `A literal value number ${i}` }
          : { type: 'uri', value: `${namespace}object${i}` },
    });
  }
  return { head: { vars: ['s', 'p', 'o'] }, results: { bindings } } as SparqlResults;
});

/*
 * Deliberately NOT the real JSON.
 *
 * The perf harness returns to the Raw tab between repeats, and that tab mounts
 * a CodeMirror over whatever this string holds. Serialising the dataset made
 * the reset cost scale with the row count and dominate the measurement — the
 * 100-row case measured SLOWER than the 1000-row one, which is CodeMirror
 * teardown, not the table. The tab only has to be enabled, so a placeholder is
 * all it needs to hold.
 */
const rawContent = computed(
  () => `{ "note": "${rowCount} generated bindings; see the Table tab." }`,
);
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
    <header class="space-y-2">
      <h1 class="text-2xl font-bold">Results bench</h1>
      <p class="text-sm text-muted-foreground" data-testid="bench-row-count">
        {{ rowCount }} generated bindings. Set ?rows= to change.
      </p>
    </header>

    <QueryResultsViewer
      :results="structured"
      :raw-content="rawContent"
      content-type="application/sparql-results+json"
    />
  </div>
</template>
