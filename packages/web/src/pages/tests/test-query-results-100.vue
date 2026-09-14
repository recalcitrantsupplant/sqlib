<script setup lang="ts">
import { computed } from 'vue';
import type { SparqlResults } from '@sparql-query-lib/types';
import QueryResultsViewer from '@/components/QueryResultsViewer.vue';
import mockResults from '@/assets/data/mock-100-results.json';

// The JSON import widens binding `type` to `string`; the fixture is trusted
// to actually hold the SPARQL JSON shape it is named for.
const structured = computed<SparqlResults>(() => mockResults as unknown as SparqlResults);
const rawContent = computed(() => JSON.stringify(mockResults, null, 2));
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
    <header class="space-y-2">
      <h1 class="text-2xl font-bold">100 Results Fixture</h1>
      <p class="text-sm text-muted-foreground">
        Static data set used to validate the SPARQL results viewer while the new UI is under construction.
      </p>
    </header>

    <QueryResultsViewer
      :results="structured"
      :raw-content="rawContent"
      content-type="application/sparql-results+json"
    />
  </div>
</template>
