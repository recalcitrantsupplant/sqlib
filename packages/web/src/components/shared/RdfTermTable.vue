<script setup lang="ts" generic="TData extends Record<string, any>">
/**
 * RdfTermTable - A reusable table component for rendering RDF terms
 *
 * This component provides a consistent way to render RDF terms (IRIs, literals, blank nodes)
 * with support for prefix abbreviation via the prefix manager. It uses TanStack Table
 * under the hood for filtering, sorting, and pagination.
 *
 * Features:
 * - Prefixed names by default, switched per column from the header menu
 * - The type badge copies the full IRI, whichever form the cell is showing
 * - Type badges (IRI, Literal, BNode)
 * - Datatype and language tag display
 * - Copy to clipboard functionality
 * - Filtering and sorting via DataTable
 */
import { computed, h, ref } from 'vue';
import type { DataTableColumnDef } from '@/composables/useDataTable';
import type { SparqlBindingValue } from '@sparql-query-lib/types';
import DataTable from '@/components/ui/table/DataTable.vue';
import type { DataTableState } from '@/composables/useDataTable';
import InlinePrefixAdder from '@/components/shared/InlinePrefixAdder.vue';
import TermDisplayMenuItems from '@/components/shared/TermDisplayMenuItems.vue';
import { usePrefixManager } from '@/composables/usePrefixManager';
import { useTermDisplay, type TermDisplayMode } from '@/composables/useTermDisplay';
import { useCopyToClipboard } from '@/composables/useCopyToClipboard';

export interface RdfTermValue {
  type: 'uri' | 'literal' | 'bnode' | 'default-graph';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

export interface RdfTermTableColumn {
  /** Column key/accessor */
  key: string;
  /** Column header label */
  label: string;
  /** Enable filtering for this column */
  filterable?: boolean;
}

const props = withDefaults(defineProps<{
  /** Array of data rows */
  data: TData[];
  /** Column definitions */
  columns: RdfTermTableColumn[];
  /** Global filter placeholder text */
  filterPlaceholder?: string;
  /** Empty state message */
  emptyText?: string;
  /** Enable row numbers */
  showRowNumbers?: boolean;
  /** Enable filters */
  enableFilters?: boolean;
  /** Enable pagination */
  enablePagination?: boolean;
  /** Initial page size */
  initialPageSize?: number;
  /** Let a caller host the filter input, row count and paging — see DataTable. */
  hideFilterRow?: boolean;
  hideRowCount?: boolean;
  hidePaginationBar?: boolean;
}>(), {
  filterPlaceholder: 'Filter results…',
  emptyText: 'No results found.',
  showRowNumbers: false,
  enableFilters: true,
  enablePagination: false,
  initialPageSize: 25,
  hideFilterRow: false,
  hideRowCount: false,
  hidePaginationBar: false,
});

const emit = defineEmits<{ state: [DataTableState] }>();

/** The filter, bindable from outside for a caller that hosts the input. */
const globalFilter = defineModel<string | undefined>('globalFilter', { default: undefined });

const tableRef = ref<{
  setPageIndex: (index: number) => void;
  setPageSize: (size: number) => void;
} | null>(null);

defineExpose({
  setPageIndex: (index: number) => tableRef.value?.setPageIndex(index),
  setPageSize: (size: number) => tableRef.value?.setPageSize(size),
});

const { copyToClipboard } = useCopyToClipboard();
const { abbreviateIri } = usePrefixManager();

/*
 * Term display is a column property, not a table-wide mode: there is no
 * control in the toolbar, and a column is switched to full IRIs from its own
 * header menu. See `useTermDisplay`.
 */
const { modeFor, isPrefixed, setMode, applyToAll } = useTermDisplay();

const columnKeys = computed(() => props.columns.map((col) => col.key));

const onSelectMode = (columnKey: string, mode: TermDisplayMode) =>
  setMode(columnKey, mode);
const onSelectModeForAll = (mode: TermDisplayMode) =>
  applyToAll(columnKeys.value, mode);

/**
 * The inline "+ prefix" affordance for an IRI that abbreviation left alone.
 *
 * Only offered while the column is showing prefixed names: in full-IRI mode
 * nothing in that column is abbreviated, so a button on every row would say
 * nothing about which namespaces are actually unregistered.
 */
const renderPrefixAdder = (iri: string, columnKey: string) => {
  if (!isPrefixed(columnKey)) return null;
  return h(InlinePrefixAdder, { iri, key: `prefix-adder:${iri}` });
};

/**
 * Renders a single RDF term cell with type badge, prefix abbreviation, and copy button
 */
const renderCell = (
  binding: RdfTermValue | SparqlBindingValue | string | undefined,
  columnKey: string,
) => {
  const prefixed = isPrefixed(columnKey);

  // Handle undefined/null
  if (!binding) {
    return h('span', { class: 'text-muted-foreground' }, '—');
  }

  // Handle plain strings
  if (typeof binding === 'string') {
    // For plain strings, check if they are IRIs and can be abbreviated
    if (prefixed && (binding.startsWith('http://') || binding.startsWith('https://'))) {
      const result = abbreviateIri(binding);
      if (result.wasAbbreviated) {
        return h('span', { class: 'term-cell flex items-center' }, [
          h(
            'code',
            { class: 'text-xs font-mono break-words rounded bg-muted px-1.5 py-0.5' },
            result.abbreviated,
          ),
        ]);
      }
    }
    if (binding.startsWith('http://') || binding.startsWith('https://')) {
      return h('span', { class: 'flex items-center gap-2' }, [
        h('span', { class: 'text-sm break-words' }, binding),
        renderPrefixAdder(binding, columnKey),
      ]);
    }
    return h('span', { class: 'text-sm' }, binding);
  }

  // Handle RDF term objects
  const term = binding as RdfTermValue;

  // Handle default-graph type specifically
  if (term.type === 'default-graph') {
    return h(
      'span',
      { class: 'italic text-muted-foreground' },
      term.value,
    );
  }

  // Abbreviate the IRI unless this column was switched to full IRIs
  let displayValue = term.value;
  let fullIri: string | null = null;

  if (term.type === 'uri' && prefixed) {
    const result = abbreviateIri(term.value);
    if (result.wasAbbreviated) {
      displayValue = result.abbreviated;
      fullIri = result.fullIri;
    }
  }

  const typeLabel =
    term.type === 'uri'
      ? 'IRI'
      : term.type === 'bnode'
        ? 'BNode'
        : term.type === 'literal'
          ? 'Literal'
          : term.type;

  // Abbreviate datatype IRIs as well
  let displayDatatype = term.datatype;
  if (term.datatype && prefixed) {
    const dtResult = abbreviateIri(term.datatype);
    if (dtResult.wasAbbreviated) {
      displayDatatype = dtResult.abbreviated;
    }
  } else if (term.datatype?.startsWith('http://www.w3.org/2001/XMLSchema#')) {
    // Fallback to hardcoded xsd: when the column is showing full IRIs
    displayDatatype = 'xsd:' + term.datatype.substring('http://www.w3.org/2001/XMLSchema#'.length);
  }

  const isStringDatatype =
    term.datatype === 'http://www.w3.org/2001/XMLSchema#string' ||
    term.datatype === 'xsd:string';

  const supplementary: string[] = [];
  if (displayDatatype && !isStringDatatype) {
    supplementary.push(displayDatatype);
  }
  if (term['xml:lang']) {
    supplementary.push(`lang:${term['xml:lang']}`);
  }

  return h('div', { class: 'term-cell flex flex-col gap-1' }, [
    h('div', { class: `flex justify-between gap-2 ${supplementary.length > 0 ? 'items-center' : 'items-start'}` }, [
      h(
        'code',
        {
          class:
            'flex-1 break-words rounded bg-muted px-1.5 py-0.5 text-xs font-mono',
        },
        displayValue,
      ),
      term.type === 'uri' && !fullIri ? renderPrefixAdder(term.value, columnKey) : null,
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
                'inline-flex items-center justify-center rounded-md border px-1.5 py-0 text-[10px] font-semibold uppercase leading-tight tracking-wide border-border text-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors',
              onClick: (e: Event) => {
                e.stopPropagation();
                // Copy full IRI, not abbreviated form
                copyToClipboard(fullIri || term.value, `Copied ${typeLabel} to clipboard`);
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
  ]);
};

/**
 * Extract string value from an RDF term for sorting/filtering
 */
const extractValue = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'value' in value) return (value as { value?: string }).value ?? '';
  return String(value);
};

/**
 * Build TanStack Table column definitions from our simplified column props
 */
const tableColumns = computed<DataTableColumnDef<TData>[]>(() =>
  props.columns.map((col) => ({
    accessorKey: col.key,
    accessorFn: (row: TData) => extractValue(row[col.key]),
    enableColumnFilter: col.filterable ?? true,
    header: () => h('span', { class: 'font-semibold' }, col.label),
    cell: ({ row }) => renderCell(row.original[col.key], col.key),
  })),
);
</script>

<template>
  <DataTable
    ref="tableRef"
    v-model:global-filter="globalFilter"
    :columns="tableColumns"
    :data="data"
    :global-filter-placeholder="filterPlaceholder"
    :empty-state-text="emptyText"
    :enable-row-numbers="showRowNumbers"
    :enable-filters="enableFilters"
    :enable-pagination="enablePagination"
    :initial-page-size="initialPageSize"
    :column-menu-ids="columnKeys"
    :hide-filter-row="hideFilterRow"
    :hide-row-count="hideRowCount"
    :hide-pagination-bar="hidePaginationBar"
    @state="emit('state', $event)"
  >
    <template #filter-actions>
      <slot name="filter-actions"></slot>
    </template>
    <template #column-menu="{ columnId }">
      <TermDisplayMenuItems
        :mode="modeFor(columnId)"
        @select="onSelectMode(columnId, $event)"
        @select-all="onSelectModeForAll($event)"
      />
    </template>
  </DataTable>
</template>
