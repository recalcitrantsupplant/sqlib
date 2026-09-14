import type { ColumnDef, FilterFn, RowData } from "@tanstack/vue-table"
import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createCoreRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_arrIncludes,
  filterFn_equals,
  filterFn_inDateRange,
  filterFn_inNumberRange,
  filterFn_includesString,
  filterFn_weakEquals,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from "@tanstack/vue-table"
import { computed, ref, type Ref } from "vue"

/**
 * What a caller hosting the table's chrome needs to draw it: the counts and the
 * paging position. `DataTable` emits it on every change, so the results panel
 * can state the row count in its footer and page from the menu there.
 */
export type DataTableState = {
  totalRows: number
  filteredRows: number
  pageIndex: number
  pageCount: number
  pageSize: number
  pageSizeOptions: number[]
}

/** Per-column presentation hooks read by `DataTable.vue` when rendering. */
export type DataTableColumnMeta = {
  headerClassName?: string
  cellClassName?: string
}

/**
 * The feature set every grid-style view in the app shares. TanStack Table v9
 * requires features and row models to be opted into explicitly; keeping them in
 * one module-level object means every table gets the same capabilities and the
 * row model factories memoize per table instance.
 */
const dataTableFeatures = tableFeatures({
  columnFacetingFeature,
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  columnMeta: {} as DataTableColumnMeta,
  // `filterFn: 'auto'`/`sortFn: 'auto'` pick a function *by name*, so the names
  // they can land on have to be registered or the column silently falls back to
  // no filtering / a plain comparison. These two registries are exactly the set
  // the auto-resolvers reach for.
  filterFns: {
    arrIncludes: filterFn_arrIncludes,
    equals: filterFn_equals,
    inDateRange: filterFn_inDateRange,
    inNumberRange: filterFn_inNumberRange,
    includesString: filterFn_includesString,
    weakEquals: filterFn_weakEquals,
  },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  coreRowModel: createCoreRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
})

export type DataTableFeatures = typeof dataTableFeatures

/** Column definition bound to the feature set `useDataTable` registers. */
export type DataTableColumnDef<
  TData extends RowData,
  TValue = unknown,
> = ColumnDef<DataTableFeatures, TData, TValue>

type DataTableOptions = {
  enableRowNumbers?: boolean
  enablePagination?: boolean
  initialPageSize?: number
}

/**
 * Shared TanStack table wiring used by the query results viewer and other grid-style views.
 */
export function useDataTable<TData extends RowData, TValue>(
  columns: DataTableColumnDef<TData, TValue>[],
  data: TData[],
  options: DataTableOptions = {},
) {
  const enableRowNumbers = options.enableRowNumbers ?? false
  const enablePagination = options.enablePagination ?? false
  const initialPageSize = options.initialPageSize ?? 25

  const sorting: Ref<SortingState> = ref([])
  const columnFilters: Ref<ColumnFiltersState> = ref([])
  const globalFilter = ref("")
  const pagination: Ref<PaginationState> = ref({
    pageIndex: 0,
    pageSize: initialPageSize,
  })

  /*
   * One filter function for both ways a column filter is set, distinguished by
   * the shape of the value rather than by which column it lands on:
   *
   *   - an array comes from clicking a facet value, which means "this exact
   *     value" — `uri` must not also match `uri-ref`;
   *   - a string comes from typing in the column filter box, which means the
   *     case-insensitive substring search that box has always done.
   *
   * Both used to funnel into TanStack's default `filterFn: 'auto'` (i.e.
   * `includesString`), so a facet click matched on substring too. The
   * `facetOrFilter` written to fix that was installed behind
   * `if (!column.columnDef.filterFn)`, which can never be true: the column
   * filtering feature contributes a default column def of `{ filterFn: 'auto' }`
   * to every column, so the guard always saw the truthy string `'auto'` and the
   * function never ran. It is registered on the column definitions instead, at
   * construction, where nothing can have defaulted it first.
   */
  const columnFilter: FilterFn<DataTableFeatures, TData> = (
    row,
    columnId,
    filterValue,
  ) => {
    const cellValue = String(row.getValue(columnId) ?? "")

    if (Array.isArray(filterValue)) {
      return filterValue.length === 0 || filterValue.includes(cellValue)
    }

    if (typeof filterValue === "string" && filterValue.length > 0) {
      return cellValue.toLowerCase().includes(filterValue.toLowerCase())
    }

    return true
  }

  /** Caller definitions win; anything that did not ask gets `columnFilter`. */
  const withColumnFilter = (
    column: DataTableColumnDef<TData, any>,
  ): DataTableColumnDef<TData, any> =>
    column.filterFn ? column : { ...column, filterFn: columnFilter }

  const finalColumns = computed<DataTableColumnDef<TData, any>[]>(() => {
    const filterable = columns.map(withColumnFilter)

    if (enableRowNumbers) {
      return [
        {
          id: "row-number",
          header: () => "#",
          cell: ({ row }) => row.index + 1,
          enableSorting: false,
          enableHiding: false,
          enableColumnFilter: false,
          size: 50,
          meta: {
            headerClassName: "row-number-header",
            cellClassName: "row-number-cell",
          },
        },
        ...filterable,
      ]
    }
    return filterable
  })

  const table = useTable<DataTableFeatures, TData>({
    features: dataTableFeatures,
    get data() {
      return data
    },
    get columns() {
      return finalColumns.value
    },
    state: {
      get sorting() {
        return sorting.value
      },
      get columnFilters() {
        return columnFilters.value
      },
      get globalFilter() {
        return globalFilter.value
      },
      get pagination() {
        return pagination.value
      },
    },
    onSortingChange: (updaterOrValue) => {
      sorting.value =
        typeof updaterOrValue === "function"
          ? updaterOrValue(sorting.value)
          : updaterOrValue
    },
    onColumnFiltersChange: (updaterOrValue) => {
      columnFilters.value =
        typeof updaterOrValue === "function"
          ? updaterOrValue(columnFilters.value)
          : updaterOrValue
    },
    onGlobalFilterChange: (updaterOrValue) => {
      globalFilter.value =
        typeof updaterOrValue === "function"
          ? updaterOrValue(globalFilter.value)
          : updaterOrValue
    },
    onPaginationChange: (updaterOrValue) => {
      pagination.value =
        typeof updaterOrValue === "function"
          ? updaterOrValue(pagination.value)
          : updaterOrValue
    },
    enableMultiSort: true,
    autoResetPageIndex: true,
    // Short-circuits the paginated row model so `getRowModel()` stops at the
    // pre-pagination stage for tables that do not ask for pagination.
    manualPagination: !enablePagination,
  })

  const getColumnFacets = (columnId: string): [string, number][] => {
    const column = table.getColumn(columnId)
    if (!column) {
      return []
    }

    const uniqueValues = column.getFacetedUniqueValues()
    return Array.from(uniqueValues.entries())
      .map(([value, count]) => [String(value ?? ""), count] as [string, number])
      .sort(([, a], [, b]) => b - a)
  }

  const applyFacetFilter = (columnId: string, value: string) => {
    const column = table.getColumn(columnId)
    if (!column) {
      return
    }

    // An array asks `columnFilter` for exact matching; see its comment.
    column.setFilterValue(isFilterActive(columnId, value) ? undefined : [value])
  }

  const isFilterActive = (columnId: string, value: string) => {
    const column = table.getColumn(columnId)
    if (!column) {
      return false
    }

    const currentFilter = column.getFilterValue()
    if (Array.isArray(currentFilter)) {
      return currentFilter.includes(value)
    }

    return currentFilter === value
  }

  const columnCount = computed(
    () => table.getHeaderGroups()[0]?.headers.length ?? 0,
  )

  return {
    table,
    sorting,
    columnFilters,
    globalFilter,
    pagination,
    columnCount,
    getColumnFacets,
    applyFacetFilter,
    isFilterActive,
  }
}
