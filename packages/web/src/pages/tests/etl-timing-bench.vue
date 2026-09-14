<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
    <header class="space-y-2">
      <h1 class="text-2xl font-bold">ETL Timing Bench</h1>
      <p class="text-sm text-muted-foreground">
        Compare direct browser fetch timing with the ETL execute endpoint timing breakdown.
      </p>
    </header>

    <section class="space-y-4 rounded-lg border border-border bg-card p-4">
      <div class="space-y-1">
        <label class="text-sm font-medium" for="crossref-url">Crossref URL</label>
        <input
          id="crossref-url"
          v-model="crossrefUrl"
          type="text"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
        />
      </div>

      <div class="space-y-1">
        <label class="text-sm font-medium" for="sql-input">SQL (DuckDB)</label>
        <textarea
          id="sql-input"
          v-model="sql"
          rows="10"
          class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm"
        ></textarea>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1">
          <label class="text-sm font-medium" for="chunk-size">Chunk size</label>
          <input
            id="chunk-size"
            v-model.number="chunkSize"
            type="number"
            min="1"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
          />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="max-rows">Max rows (optional)</label>
          <input
            id="max-rows"
            v-model.number="maxRows"
            type="number"
            min="1"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
          />
        </div>
      </div>

      <div class="flex flex-wrap gap-3">
        <button
          class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60"
          :disabled="isBrowserRunning"
          @click="runBrowserFetch"
        >
          {{ isBrowserRunning ? 'Running browser fetch…' : 'Run browser fetch' }}
        </button>
        <button
          class="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm disabled:opacity-60"
          :disabled="isEtlRunning"
          @click="runEtlExecute"
        >
          {{ isEtlRunning ? 'Running ETL execute…' : 'Run ETL execute' }}
        </button>
      </div>
    </section>

    <section class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-lg border border-border bg-card p-4">
        <h2 class="mb-2 text-lg font-semibold">Browser Fetch</h2>
        <p class="text-sm text-muted-foreground">
          Direct fetch from the browser to Crossref. This does not involve DuckDB.
        </p>
        <div class="mt-3 text-sm">
          <div v-if="browserError" class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
            {{ browserError }}
          </div>
          <div v-else-if="browserTimingMs !== null" class="space-y-1">
            <div>Client total: {{ browserTimingMs }} ms</div>
            <div v-if="browserPayloadBytes !== null">Payload size: {{ browserPayloadBytes }} bytes</div>
          </div>
          <div v-else class="text-muted-foreground">No run yet.</div>
        </div>
      </div>

      <div class="rounded-lg border border-border bg-card p-4">
        <h2 class="mb-2 text-lg font-semibold">ETL Execute (Server)</h2>
        <p class="text-sm text-muted-foreground">
          Executes DuckDB on the server via <code>/playground/etl/execute</code>.
        </p>
        <div class="mt-3 text-sm">
          <div v-if="etlError" class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
            {{ etlError }}
          </div>
          <div v-else-if="etlTiming" class="space-y-1">
            <div>Client total: {{ etlClientMs }} ms</div>
            <div>SQL total: {{ etlTiming.sqlMs }} ms</div>
            <div>SQL init: {{ etlTiming.sqlInitMs }} ms</div>
            <div>SQL connect: {{ etlTiming.sqlConnectionMs }} ms</div>
            <div>SQL query: {{ etlTiming.sqlQueryMs }} ms</div>
            <div>SQL serialize: {{ etlTiming.sqlSerializeMs }} ms</div>
            <div>Binding: {{ etlTiming.bindingMs }} ms</div>
            <div>SPARQL: {{ etlTiming.sparqlMs }} ms</div>
            <div>Total: {{ etlTiming.totalMs }} ms</div>
          </div>
          <div v-else class="text-muted-foreground">No run yet.</div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRuntimeConfig } from '#imports';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';

const config = useRuntimeConfig();
const apiBaseUrl = config.public.apiBaseUrl.replace(/\/$/, '');

const defaultUrl = 'https://api.crossref.org/works?query.title=retrieval%20augmented%20generation%20RAG%20LLM&filter=from-pub-date:2022-01-01,until-pub-date:2025-12-31,type:journal-article&rows=100&facet=saved:*,type-name:*&select=DOI,title,author,saved,container-title,URL,type&mailto=you@example.com';
const crossrefUrl = ref(defaultUrl);

const sql = ref(`SELECT facet_name, facet_value, facet_count
FROM (
  SELECT
    'saved' AS facet_name,
    p.key AS facet_value,
    CAST(p.value AS BIGINT) AS facet_count
  FROM read_json_auto(
    '${defaultUrl}'
  ) r,
  json_each(to_json(r.message.facets.saved.values)) p

  UNION ALL

  SELECT
    'type-name' AS facet_name,
    t.key AS facet_value,
    CAST(t.value AS BIGINT) AS facet_count
  FROM read_json_auto(
    '${defaultUrl}'
  ) r,
  json_each(to_json(r.message.facets."type-name".values)) t
) x
WHERE facet_value IS NOT NULL`);

const sparqlTemplate = `CONSTRUCT {
  _:row <https://etl/facetName> ?facetName ;
        <https://etl/facetValue> ?facetValue ;
        <https://etl/facetCount> ?facetCount .
} WHERE {
  VALUES (?facetName ?facetValue ?facetCount) { (UNDEF UNDEF UNDEF) }
}`;

const columnMappings = [
  { columnName: 'facet_name', targetVariable: 'facetName', termType: 'literal', nullPolicy: 'skipRow' },
  { columnName: 'facet_value', targetVariable: 'facetValue', termType: 'literal', nullPolicy: 'skipRow' },
  {
    columnName: 'facet_count',
    targetVariable: 'facetCount',
    termType: 'literal',
    nullPolicy: 'skipRow',
    datatypeIri: 'http://www.w3.org/2001/XMLSchema#integer',
  },
];

const chunkSize = ref(1000);
const maxRows = ref<number | null>(null);

const isBrowserRunning = ref(false);
const browserTimingMs = ref<number | null>(null);
const browserPayloadBytes = ref<number | null>(null);
const browserError = ref<string | null>(null);

const isEtlRunning = ref(false);
const etlClientMs = ref<number | null>(null);
type EtlTiming = {
  sqlMs?: number;
  sqlInitMs?: number;
  sqlConnectionMs?: number;
  sqlQueryMs?: number;
  sqlSerializeMs?: number;
  bindingMs?: number;
  sparqlMs?: number;
  totalMs?: number;
};
const etlTiming = ref<EtlTiming | null>(null);
const etlError = ref<string | null>(null);

const runBrowserFetch = async () => {
  isBrowserRunning.value = true;
  browserError.value = null;
  browserTimingMs.value = null;
  browserPayloadBytes.value = null;

  try {
    const start = performance.now();
    const response = await fetch(crossrefUrl.value);
    if (!response.ok) {
      throw new Error(`Browser fetch failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    const totalMs = performance.now() - start;
    browserTimingMs.value = Math.round(totalMs);
    browserPayloadBytes.value = JSON.stringify(json).length;
  } catch (error: unknown) {
    browserError.value = error instanceof Error ? error.message : 'Browser fetch failed';
  } finally {
    isBrowserRunning.value = false;
  }
};

const runEtlExecute = async () => {
  isEtlRunning.value = true;
  etlError.value = null;
  etlTiming.value = null;
  etlClientMs.value = null;

  try {
    const start = performance.now();
    const response = await fetch(`${apiBaseUrl}/playground/etl/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: sql.value,
        sparqlTemplate,
        backendId: EPHEMERAL_BACKEND_ID,
        columns: columnMappings,
        chunkSize: chunkSize.value,
        maxRows: maxRows.value || undefined,
        outputFormat: 'text/turtle',
      }),
    });

    const data = await response.json().catch(() => ({}));
    const totalMs = performance.now() - start;
    etlClientMs.value = Math.round(totalMs);

    if (!response.ok) {
      throw new Error(data?.error || `ETL execute failed: ${response.status} ${response.statusText}`);
    }

    if (data?.timing) {
      etlTiming.value = data.timing;
    } else {
      throw new Error('ETL execute response missing timing data');
    }
  } catch (error: unknown) {
    etlError.value = error instanceof Error ? error.message : 'ETL execute failed';
  } finally {
    isEtlRunning.value = false;
  }
};
</script>
