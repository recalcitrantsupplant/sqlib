<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import type { DataTableColumnDef } from '@/composables/useDataTable';
import { Download, Expand } from '@lucide/vue';
import type {
  SparqlBinding,
  SparqlBindingValue,
  SparqlResults,
} from '@sparql-query-lib/types';
import type { QueryExecutionResultPayload } from '@/types/execution';
import { describeTerm } from '@sparql-query-lib/runtime';
import { usePrefixManager } from '@/composables/usePrefixManager';

import MediaTypeCodeViewer from '@/components/MediaTypeCodeViewer.vue';
import DataTable from '@/components/ui/table/DataTable.vue';
import type { DataTableState } from '@/composables/useDataTable';
import ResultsFooter from '@/components/shared/ResultsFooter.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import { Input } from '@/components/ui/input';
import RdfTermTable from '@/components/shared/RdfTermTable.vue';
import type { RdfTermTableColumn } from '@/components/shared/RdfTermTable.vue';
import InlinePrefixAdder from '@/components/shared/InlinePrefixAdder.vue';
import { usePrefixDiscovery } from '@/composables/usePrefixDiscovery';
import TermIriPopover from '@/components/shared/TermIriPopover.vue';
import TermDisplayMenuItems from '@/components/shared/TermDisplayMenuItems.vue';
import { useTermDisplay, type TermDisplayMode } from '@/composables/useTermDisplay';
import { useCopyToClipboard } from '@/composables/useCopyToClipboard';
import {
  parseNTriples,
  parseNQuads,
  isNTriplesContentType,
  isNQuadsContentType,
  type RdfRow,
} from '@/lib/ntriples-nquads-table-converter';
import {
  parseCsv,
  parseTsv,
  isCsvContentType,
  isTsvContentType,
  type TabularRow,
} from '@/lib/csv-tsv-table-converter';
import { formatRelativeTime } from '@/lib/time';

const props = withDefaults(
  defineProps<{
    results?: SparqlResults | null;
    bindings?: SparqlBinding[];
    variables?: string[];
    rawContent?: string | null;
    contentType?: string | null;
    loading?: boolean;
    error?: string | null;
    timing?: QueryExecutionResultPayload['timing'];
    executedAt?: string | null;
    /** Base name for the downloaded file; the extension follows the media type. */
    downloadBaseName?: string;
    /**
     * Overrides what the footer's duration says on hover, for a caller whose
     * timing does not fit the query breakdown — ETL's SQL/binding/SPARQL split.
     */
    timingDetail?: string | null;
    /**
     * Offer pop-out in the action bar. The panel that owns the overlay says
     * whether there is one; this component only asks for it.
     */
    canExpand?: boolean;
    /**
     * Where a prefix found in the response is recorded against — normally
     * `results:<backend id>`, since these declarations are the store's, not
     * yours. `null` still discovers, with no provenance; `undefined` turns
     * discovery off for a caller showing something that is not a real run.
     */
    prefixSource?: string | null;
  }>(),
  {
    results: null,
    bindings: undefined,
    variables: undefined,
    rawContent: null,
    contentType: null,
    loading: false,
    error: null,
    executedAt: null,
    downloadBaseName: 'query-results',
    timingDetail: null,
    canExpand: false,
    prefixSource: null,
  },
);

/*
 * A store answers a CONSTRUCT with its own prefix map — that is where the
 * endpoint's names for namespaces show up, and until now they were read past.
 * Learning them here is what makes the next table abbreviate rather than
 * spelling out the same namespace on every row.
 */
usePrefixDiscovery(() => props.rawContent, () => props.prefixSource, { delay: 0 });

const emit = defineEmits<{ expand: [] }>();

/*
 * The response's own chrome: one action bar while Results is open, and a
 * footer of run facts. Download and pop-out live here rather than in the
 * panel header because they belong to the response, not to Details or Code —
 * and the counts, the media type and the duration are facts about the same
 * response, so they read as pills under it rather than as toolbar furniture.
 */
const tableState = ref<DataTableState | null>(null);
const filterText = ref('');
const tableRef = ref<{
  setPageIndex: (index: number) => void;
  setPageSize: (size: number) => void;
} | null>(null);

const setPage = (index: number) => tableRef.value?.setPageIndex(index);
const setPageSize = (size: number) => tableRef.value?.setPageSize(size);

const { copyToClipboard } = useCopyToClipboard();
const { abbreviateIri } = usePrefixManager();

/*
 * Term display is a column property here too — same menu, same defaults as
 * RdfTermTable. See `useTermDisplay`.
 */
const { modeFor, isPrefixed, setMode, applyToAll } = useTermDisplay();

const onSelectMode = (columnKey: string, mode: TermDisplayMode) =>
  setMode(columnKey, mode);
const onSelectModeForAll = (mode: TermDisplayMode) =>
  applyToAll(resolvedVariables.value, mode);

const resolvedVariables = computed(
  () => props.variables ?? props.results?.head.vars ?? [],
);
const resolvedBindings = computed(
  () => props.bindings ?? props.results?.results.bindings ?? [],
);

const hasStructuredResults = computed(() => {
  if (!props.results) {
    return false;
  }
  const vars = resolvedVariables.value ?? [];
  if (vars.length > 0) {
    return true;
  }
  const bindings = resolvedBindings.value ?? [];
  return bindings.length > 0;
});
const hasRawContent = computed(() => !!(props.rawContent && props.rawContent.length > 0));

const normalizedContentType = computed(() => {
  if (!props.contentType) {
    return null;
  }
  const [type] = props.contentType.split(';');
  return type.trim().toLowerCase();
});

const executedAtIso = computed(() => props.executedAt ?? null);
const executedAtRelative = computed(() => {
  if (!executedAtIso.value) return '';
  return formatRelativeTime(executedAtIso.value);
});

/**
 * The serialisation the download hands over, named on the button itself, so
 * there is no second differently-scoped download to reason about.
 */
const SERIALISATION_NAMES: Array<[string, string]> = [
  ['sparql-results+json', 'SPARQL JSON'],
  ['sparql-results+xml', 'SPARQL XML'],
  ['n-triples', 'N-Triples'],
  ['n-quads', 'N-Quads'],
  ['turtle', 'Turtle'],
  ['rdf+xml', 'RDF/XML'],
  ['ld+json', 'JSON-LD'],
  ['csv', 'CSV'],
  ['tab-separated-values', 'TSV'],
  ['json', 'JSON'],
];

const serialisationLabel = computed(() => {
  const type = normalizedContentType.value;
  if (!type) return props.results ? 'SPARQL JSON' : null;
  return SERIALISATION_NAMES.find(([token]) => type.includes(token))?.[1] ?? type;
});

const timingHeader = computed(() => props.timing?.header ?? null);
const timingBreakdown = computed(() => props.timing?.breakdown ?? null);
const formatMs = (num: number) => {
  if (num < 1) return '<1 ms';
  return `${Math.round(num)} ms`;
};

const timingDisplayParts = computed(() => {
  if (!timingBreakdown.value) return [];
  const parts: Array<{ label: string; value: string }> = [];
  if (typeof timingBreakdown.value.networkMs === 'number') {
    parts.push({ label: 'Network est.', value: formatMs(timingBreakdown.value.networkMs) });
  }
  if (typeof timingBreakdown.value.appMs === 'number') {
    parts.push({ label: 'Query Library', value: formatMs(timingBreakdown.value.appMs) });
  }
  if (typeof timingBreakdown.value.backendMs === 'number') {
    parts.push({ label: 'Triplestore', value: formatMs(timingBreakdown.value.backendMs) });
  }
  if (typeof timingBreakdown.value.clientTotalMs === 'number') {
    parts.push({ label: 'Total', value: formatMs(timingBreakdown.value.clientTotalMs) });
  }
  return parts;
});
const timingTotalMs = computed(() => {
  const b = timingBreakdown.value;
  if (!b) return 0;
  return (
    (typeof b.clientTotalMs === 'number' && b.clientTotalMs > 0 ? b.clientTotalMs : null) ??
    (typeof b.serverTotalMs === 'number' && b.serverTotalMs > 0 ? b.serverTotalMs : null) ??
    0
  );
});

/** The duration, and the breakdown behind it, for the footer. */
const durationMs = computed(() => (timingTotalMs.value > 0 ? timingTotalMs.value : null));
const durationTitle = computed(() => {
  if (props.timingDetail) return props.timingDetail;
  if (timingDisplayParts.value.length > 0) {
    return timingDisplayParts.value.map((part) => `${part.label}: ${part.value}`).join(' · ');
  }
  return timingHeader.value;
});

// Parse N-Triples or N-Quads if present
const isNTriples = computed(() => isNTriplesContentType(props.contentType));
const isNQuads = computed(() => isNQuadsContentType(props.contentType));
const isCsv = computed(() => isCsvContentType(props.contentType));
const isTsv = computed(() => isTsvContentType(props.contentType));
const isTabular = computed(
  () => isNTriples.value || isNQuads.value || isCsv.value || isTsv.value,
);

const activeTab = ref<'table' | 'raw'>('table');

watch(
  [hasStructuredResults, hasRawContent, isTabular],
  ([sparqlTableAvailable, rawAvailable, tabularAvailable]) => {
    if (sparqlTableAvailable || tabularAvailable) {
      activeTab.value = 'table';
      return;
    }
    if (rawAvailable) {
      activeTab.value = 'raw';
    }
  },
  { immediate: true },
);

const tabularRows = computed<(RdfRow | TabularRow)[]>(() => {
  if (!isTabular.value || !props.rawContent) {
    return [];
  }

  let rows: (RdfRow | TabularRow)[] = [];

  if (isNTriples.value) {
    rows = parseNTriples(props.rawContent);
  } else if (isNQuads.value) {
    rows = parseNQuads(props.rawContent);
  } else if (isCsv.value) {
    rows = parseCsv(props.rawContent);
  } else if (isTsv.value) {
    rows = parseTsv(props.rawContent);
  }

  return rows;
});

const tabularColumns = computed<RdfTermTableColumn[]>(() => {
  if (!isTabular.value) {
    return [];
  }

  if (isNTriples.value || isNQuads.value) {
    const baseColumns: RdfTermTableColumn[] = [
      { key: 's', label: 's', filterable: true },
      { key: 'p', label: 'p', filterable: true },
      { key: 'o', label: 'o', filterable: true },
    ];

    if (isNQuads.value) {
      baseColumns.push({ key: 'g', label: 'g', filterable: true });
    }
    return baseColumns;
  } else if (isCsv.value || isTsv.value) {
    if (tabularRows.value.length === 0) {
      return [];
    }
    const firstRow = tabularRows.value[0] as TabularRow;
    const columnKeys = Object.keys(firstRow);
    return columnKeys.map((key) => ({ key, label: key, filterable: true }));
  }

  return [];
});

const hasStructuredOrTabularResults = computed(
  () => hasStructuredResults.value || isTabular.value,
);

/** Table and Raw are two views of one response, not two tabs of a panel. */
const viewOptions = computed(() => [
  {
    value: 'table',
    label: 'Table',
    disabled: !hasStructuredOrTabularResults.value,
    testId: 'results-view-table',
  },
  {
    value: 'raw',
    label: 'Raw',
    disabled: !hasRawContent.value,
    testId: 'results-view-raw',
  },
]);

/** What the rows are, for the filter placeholder and the footer's count pill. */
const rowNoun = computed(() => {
  if (isNTriples.value) return 'triple';
  if (isNQuads.value) return 'quad';
  return 'row';
});

const filterPlaceholder = computed(() => `Filter ${rowNoun.value}s…`);

/**
 * The inline "+ prefix" affordance for an IRI that abbreviation left alone.
 * See RdfTermTable for the same treatment of the tabular formats.
 */
const renderPrefixAdder = (iri: string, columnKey: string) => {
  if (!isPrefixed(columnKey)) return null;
  return h(InlinePrefixAdder, { iri, key: `prefix-adder:${iri}` });
};

/**
 * Renders a SPARQL JSON binding cell with type badge and prefix abbreviation
 * Only used for SPARQL JSON results, not for RDF tabular formats (those use RdfTermTable)
 */
const renderSparqlCell = (
  binding: SparqlBindingValue | undefined,
  columnKey: string,
) => {
  const prefixed = isPrefixed(columnKey);

  if (!binding) {
    return h('span', { class: 'text-muted-foreground' }, '—');
  }

  /*
   * No `default-graph` branch here, despite RdfTermTable having one. That term
   * type is not in the SPARQL Query Results JSON format — it is an N-Quads
   * table concept, produced by ntriples-nquads-table-converter for the graph
   * column and rendered by RdfTermTable, which is what the note above means by
   * "not for RDF tabular formats". The branch this replaces was copied across
   * and could never be reached.
   */

  /*
   * What to show is decided by `describeTerm` in @sparql-query-lib/runtime, so
   * an IRI reads the same way here as it does in an exported library page.
   * Abbreviation is passed in rather than done there: `abbreviateIri` is
   * reactive and memoised, and a cell has to touch it during its own render or
   * it will not re-render when a prefix is toggled (see the note in
   * usePrefixManager). Calling it here keeps that subscription.
   *
   * The datatype block below is deliberately *not* delegated: it carries an
   * app-only fallback that abbreviates `xsd:` even when the prefix manager is
   * off, and folding that into the shared abbreviator would change how a value
   * IRI in that namespace renders.
   */
  const described = describeTerm(binding, {
    abbreviate: (iri) => (prefixed ? abbreviateIri(iri) : { abbreviated: iri, wasAbbreviated: false }),
  });
  const displayValue = described.display;
  const fullIri = described.fullIri;
  const typeLabel = described.typeLabel;

  // Abbreviate datatype IRIs as well
  let displayDatatype = binding.datatype;
  if (binding.datatype && prefixed) {
    const dtResult = abbreviateIri(binding.datatype);
    if (dtResult.wasAbbreviated) {
      displayDatatype = dtResult.abbreviated;
    }
  } else if (binding.datatype?.startsWith('http://www.w3.org/2001/XMLSchema#')) {
    // Fallback to hardcoded xsd: when the column is showing full IRIs
    displayDatatype = 'xsd:' + binding.datatype.substring('http://www.w3.org/2001/XMLSchema#'.length);
  }

  const isStringDatatype =
    binding.datatype === 'http://www.w3.org/2001/XMLSchema#string' ||
    binding.datatype === 'xsd:string';

  const supplementary: string[] = [];
  if (displayDatatype && !isStringDatatype) {
    supplementary.push(displayDatatype);
  }
  if (described.language) {
    supplementary.push(`lang:${described.language}`);
  }

  return h('div', { class: 'term-cell group relative flex flex-col gap-1' }, [
    h('div', { class: `flex justify-between gap-2 ${supplementary.length > 0 ? 'items-center' : 'items-start'}` }, [
      h(
        'code',
        {
          class:
            'flex-1 break-words rounded bg-muted px-1.5 py-0.5 text-xs font-mono',
        },
        displayValue,
      ),
      binding.type === 'uri' && !fullIri ? renderPrefixAdder(binding.value, columnKey) : null,
      h(
        'div',
        {
          class: 'flex flex-col items-end gap-1',
        },
        [
          h(
            'button',
            {
              type: 'button',
              class:
                'node-type-badge inline-flex items-center justify-center rounded-md border px-1.5 py-0 text-[10px] font-semibold uppercase leading-tight tracking-wide border-border text-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors',
              onClick: (e: Event) => {
                e.stopPropagation();
                // Copy full IRI, not abbreviated form
                copyToClipboard(fullIri || binding.value, `Copied ${typeLabel} to clipboard`);
              },
              title: `Copy ${typeLabel} to clipboard`,
            },
            typeLabel,
          ),
          supplementary.length > 0
            ? h(
                'span',
                {
                  class:
                    'text-[10px] tracking-wide text-muted-foreground text-right leading-tight',
                },
                supplementary.join(' • '),
              )
            : null,
        ],
      ),
    ]),
    fullIri ? h(TermIriPopover, { fullIri, typeLabel }) : null,
  ]);
};

const downloadResults = () => {
  let content = '';
  let filename = props.downloadBaseName;
  let mimeType = 'text/plain';

  if (props.rawContent) {
    // Download raw content if available
    content = props.rawContent;
    
    // Determine file extension and mime type from content type
    const ct = normalizedContentType.value || '';
    if (ct.includes('json')) {
      filename += '.json';
      mimeType = 'application/json';
    } else if (ct.includes('turtle') || ct.includes('ttl')) {
      filename += '.ttl';
      mimeType = 'text/turtle';
    } else if (ct.includes('n-triples') || ct.includes('nt')) {
      filename += '.nt';
      mimeType = 'application/n-triples';
    } else if (ct.includes('n-quads') || ct.includes('nq')) {
      filename += '.nq';
      mimeType = 'application/n-quads';
    } else if (ct.includes('rdf+xml')) {
      filename += '.rdf';
      mimeType = 'application/rdf+xml';
    } else if (ct.includes('csv')) {
      filename += '.csv';
      mimeType = 'text/csv';
    } else if (ct.includes('tsv')) {
      filename += '.tsv';
      mimeType = 'text/tab-separated-values';
    } else if (ct.includes('sparql-results+json')) {
      filename += '.srj';
      mimeType = 'application/sparql-results+json';
    } else if (ct.includes('sparql-results+xml')) {
      filename += '.srx';
      mimeType = 'application/sparql-results+xml';
    } else {
      filename += '.txt';
    }
  } else if (props.results) {
    // Download structured SPARQL JSON results
    content = JSON.stringify(props.results, null, 2);
    filename += '.json';
    mimeType = 'application/sparql-results+json';
  } else {
    // No data to download
    console.warn('No results data available to download');
    return;
  }

  // Create and trigger download
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const hasDownloadableContent = computed(() => 
  !!(props.rawContent || props.results)
);

const sparqlColumns = computed<DataTableColumnDef<SparqlBinding>[]>(() =>
  (resolvedVariables.value || []).map((variable) => ({
    accessorKey: variable,
    accessorFn: (row) => row[variable]?.value ?? '',
    enableColumnFilter: true,
    header: () => h('span', { class: 'font-semibold' }, variable),
    cell: ({ row }) => renderSparqlCell(row.original[variable], variable),
  })),
);

// Expose methods for parent component
defineExpose({
  downloadResults,
  hasDownloadableContent,
});
</script>

<template>
  <div class="results-viewer">
    <!--
      The action bar. It exists only where the response does — the panel header
      above is tabs and nothing else — and carries, in one row: which view you
      are in, the filter over it, and the two things you can do to the response.
    -->
    <div class="results-action-bar">
      <SegmentedToggle
        v-model="activeTab"
        :options="viewOptions"
        group-label="Query results view"
      />
      <Input
        v-if="activeTab === 'table' && hasStructuredOrTabularResults"
        v-model="filterText"
        class="results-filter"
        :placeholder="filterPlaceholder"
        data-testid="results-filter"
      />
      <div class="action-bar-right">
        <button
          v-if="hasDownloadableContent"
          type="button"
          class="btn-action"
          data-testid="results-download"
          :title="serialisationLabel ? `Download the response as ${serialisationLabel}` : 'Download the response'"
          @click="downloadResults"
        >
          <Download :size="14" />
          <span v-if="serialisationLabel" class="btn-action-label">{{ serialisationLabel }}</span>
        </button>
        <button
          v-if="canExpand"
          type="button"
          class="btn-action btn-action--icon"
          data-testid="results-expand"
          title="Pop out"
          @click="emit('expand')"
        >
          <Expand :size="14" />
        </button>
      </div>
    </div>

    <div class="viewer-body">
      <div
        v-if="loading"
        class="viewer-message"
      >
        Running query…
      </div>
      <div
        v-else-if="error"
        class="viewer-message error"
        role="alert"
      >
        {{ error }}
      </div>
      <div v-else class="viewer-content-area">
        <div v-if="activeTab === 'table'" class="table-container">
          <!-- SPARQL JSON Results Table -->
          <DataTable
            v-if="hasStructuredResults"
            ref="tableRef"
            v-model:global-filter="filterText"
            :columns="sparqlColumns"
            :data="resolvedBindings"
            empty-state-text="No bindings returned for this query."
            :enable-row-numbers="true"
            :enable-pagination="true"
            :initial-page-size="25"
            :column-menu-ids="resolvedVariables"
            :hide-filter-row="true"
            :hide-row-count="true"
            :hide-pagination-bar="true"
            @state="tableState = $event"
          >
            <template #column-menu="{ columnId }">
              <TermDisplayMenuItems
                :mode="modeFor(columnId)"
                @select="onSelectMode(columnId, $event)"
                @select-all="onSelectModeForAll($event)"
              />
            </template>
          </DataTable>
          <!-- N-Triples / N-Quads / CSV / TSV Table (with prefix abbreviation) -->
          <RdfTermTable
            v-else-if="isTabular"
            ref="tableRef"
            v-model:global-filter="filterText"
            :columns="tabularColumns"
            :data="tabularRows"
            :empty-text="`No ${isNTriples ? 'triples' : isNQuads ? 'quads' : isCsv ? 'CSV rows' : 'TSV rows'} found in response.`"
            :enable-filters="true"
            :show-row-numbers="true"
            :enable-pagination="true"
            :initial-page-size="25"
            :hide-filter-row="true"
            :hide-row-count="true"
            :hide-pagination-bar="true"
            @state="tableState = $event"
          />
          <div v-else-if="hasRawContent" class="viewer-message">
            This response is not a SPARQL JSON result or RDF tabular format, so the table view is unavailable.
          </div>
          <div v-else class="viewer-message">
            Execute the query to populate the results table.
          </div>
        </div>
        <div v-else-if="activeTab === 'raw'" class="raw-container">
          <MediaTypeCodeViewer
            v-if="hasRawContent"
            :content="rawContent ?? ''"
            :content-type="contentType"
            min-height="360px"
          />
          <div v-else class="viewer-message">
            No response payload captured for this execution.
          </div>
        </div>
      </div>
    </div>

    <ResultsFooter
      :table="activeTab === 'table' ? tableState : null"
      :row-noun="rowNoun"
      :executed-at="executedAtIso"
      :media-type="normalizedContentType"
      :duration-ms="durationMs"
      :duration-title="durationTitle"
      @set-page="setPage"
      @set-page-size="setPageSize"
    />
  </div>
</template>

<style scoped>
.results-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.viewer-body {
  flex: 1;
  background: var(--surface);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.viewer-content-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-container {
  flex: 1;
  overflow: hidden;
  padding: var(--space-6);
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.raw-container {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  min-height: 0;
}

.viewer-message {
  padding: var(--space-8);
  text-align: center;
  font-size: var(--text-content);
  color: var(--ink-muted);
}

.viewer-message.error {
  color: var(--danger-ink);
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .viewer-body {
  background: var(--gray-900);
}

.dark .table-container,
.dark .raw-container {
  background: var(--gray-900);
}

.dark .viewer-message.error {
  color: var(--danger);
}

.dark .node-type-badge {
  border-color: var(--border-hover);
}

.dark .node-type-badge:hover {
  background-color: rgba(255, 255, 255, 0.1);
  /* --ink-inverse is near-black in dark mode, so hovering the badge used to
     erase its label against the lightened surface. */
  color: var(--ink);
}
</style>
