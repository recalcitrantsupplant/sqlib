<script setup lang="ts" generic="TData extends RowData, TValue">
import type { RowData } from "@tanstack/vue-table"
import { FlexRender } from "@tanstack/vue-table"
import { computed, ref, useSlots, watch, watchEffect } from "vue"
import {
  Filter,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  AlertTriangle,
  MoreVertical,
  ChevronFirst,
  ChevronLeft,
  ChevronRight,
  ChevronLast,
} from "@lucide/vue"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import TableEmpty from "./TableEmpty.vue"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "."
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  useDataTable,
  type DataTableColumnDef,
  type DataTableState,
} from "@/composables/useDataTable"

const props = withDefaults(defineProps<{
  columns: DataTableColumnDef<TData, TValue>[]
  data: TData[]
  enableFilters?: boolean
  globalFilterPlaceholder?: string
  emptyStateText?: string
  enableRowNumbers?: boolean
  enablePagination?: boolean
  initialPageSize?: number
  pageSizeOptions?: number[]
  /**
   * Columns whose header menu also carries the `column-menu` slot. Named
   * rather than inferred so the slot lands only on the columns it means
   * something for — the row-number gutter never gets a menu of its own.
   */
  columnMenuIds?: string[]
  /**
   * Hide the built-in filter row, for a caller that hosts the filter input
   * itself — the results panel puts it on one bar with the view toggle and the
   * response actions. Column menus are unaffected: `enableFilters` still says
   * whether a column can be filtered at all.
   */
  hideFilterRow?: boolean
  /** Hide the row-count line — the results footer states it as a pill. */
  hideRowCount?: boolean
}>(), {
  enableFilters: true,
  globalFilterPlaceholder: "Filter all columns…",
  emptyStateText: "No results found.",
  enableRowNumbers: false,
  enablePagination: false,
  initialPageSize: DEFAULT_PAGE_SIZE,
  pageSizeOptions: () => PAGE_SIZE_OPTIONS,
  columnMenuIds: () => [],
  hideFilterRow: false,
  hideRowCount: false,
})

const emit = defineEmits<{ state: [DataTableState] }>()

/**
 * The global filter, bindable from outside for a caller that hosts the input.
 * Unbound it behaves exactly as before — the internal input drives it.
 */
const externalFilter = defineModel<string | undefined>("globalFilter", { default: undefined })

const slots = useSlots()

const {
  table,
  globalFilter,
  pagination,
  columnCount,
  getColumnFacets,
  applyFacetFilter,
  isFilterActive,
} = useDataTable(props.columns, props.data, {
  enableRowNumbers: props.enableRowNumbers,
  enablePagination: props.enablePagination,
  initialPageSize: props.initialPageSize,
})

watch(externalFilter, (value) => {
  if (value !== undefined && value !== globalFilter.value) globalFilter.value = value
})
watch(globalFilter, (value) => {
  if (externalFilter.value !== value) externalFilter.value = value
})

const showFilters = computed(() => {
  if (!props.enableFilters) {
    return false
  }

  return table.getAllColumns().length > 0
})

/** Whether a column carries slot content beyond the filter block. */
const hasExtraMenu = (columnId: string) =>
  !!slots["column-menu"] && props.columnMenuIds.includes(columnId)

const canFilterColumn = (canFilter: boolean) => showFilters.value && canFilter

/** The header menu opens for a filterable column, or for one with extra items. */
const hasColumnMenu = (columnId: string, canFilter: boolean) =>
  canFilterColumn(canFilter) || hasExtraMenu(columnId)

const totalRowCount = computed(
  () => table.getPreFilteredRowModel().rows.length,
)
const filteredRowCount = computed(() =>
  props.enablePagination
    ? table.getFilteredRowModel().rows.length
    : table.getRowModel().rows.length,
)
const hasActiveFilter = computed(() => {
  const hasGlobalFilter = (globalFilter.value ?? "").trim().length > 0
  return hasGlobalFilter && filteredRowCount.value < totalRowCount.value
})
const showRowCount = computed(() => totalRowCount.value > 0)
const showPagination = computed(
  () => props.enablePagination && totalRowCount.value > 0,
)
const pageSize = computed({
  get: () => pagination.value.pageSize,
  set: (value: number) => table.setPageSize(value),
})
const pageIndex = computed(() => pagination.value.pageIndex)
const pageCount = computed(() => table.getPageCount())

watchEffect(() => {
  emit("state", {
    totalRows: totalRowCount.value,
    filteredRows: filteredRowCount.value,
    pageIndex: pagination.value.pageIndex,
    pageCount: pageCount.value,
    pageSize: pagination.value.pageSize,
    pageSizeOptions: props.pageSizeOptions,
  })
})

defineExpose({
  setPageIndex: (index: number) => table.setPageIndex(index),
  setPageSize: (size: number) => table.setPageSize(size),
  previousPage: () => table.previousPage(),
  nextPage: () => table.nextPage(),
})

const formatNumber = (num: number) => {
  return num.toLocaleString('en-US')
}

const openFacetColumns = ref<Set<string>>(new Set())
const computeFacetsForColumns = ref<Set<string>>(new Set())

const setFacetOpen = (columnId: string, isOpen: boolean) => {
  const next = new Set(openFacetColumns.value)
  if (isOpen) {
    next.add(columnId)
    // Auto-compute facets for datasets with 1000 or fewer rows
    if (totalRowCount.value <= 1000) {
      const nextCompute = new Set(computeFacetsForColumns.value)
      nextCompute.add(columnId)
      computeFacetsForColumns.value = nextCompute
    }
  } else {
    next.delete(columnId)
  }
  openFacetColumns.value = next
}

const isFacetOpen = (columnId: string) => openFacetColumns.value.has(columnId)

const shouldShowFacets = (columnId: string) => {
  return totalRowCount.value <= 1000 || computeFacetsForColumns.value.has(columnId)
}

const enableFacetsForColumn = (columnId: string) => {
  const next = new Set(computeFacetsForColumns.value)
  next.add(columnId)
  computeFacetsForColumns.value = next
}

</script>

<template>
  <div class="table-container-wrapper flex flex-col gap-2">
    <div v-if="showFilters && !hideFilterRow" class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <Input
          v-model="globalFilter"
          class="max-w-sm"
          :placeholder="globalFilterPlaceholder"
        />
        <slot name="filter-actions"></slot>
      </div>
    </div>
    <p
      v-if="showRowCount && !hideRowCount"
      class="text-xs text-muted-foreground"
      role="status"
    >
      <template v-if="hasActiveFilter">
        <span class="italic">Filtered to {{ formatNumber(filteredRowCount) }} of {{ formatNumber(totalRowCount) }} rows</span>
      </template>
      <template v-else>
        <span class="italic">{{ formatNumber(totalRowCount) }} {{ totalRowCount === 1 ? 'row' : 'rows' }}</span>
      </template>
    </p>
    <div class="table-shell">
      <div class="table-scroll">
        <Table>
          <TableHeader>
            <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
              <TableHead v-for="header in headerGroup.headers" :key="header.id" :class="header.column.columnDef.meta?.headerClassName">
                <div class="flex items-center justify-between gap-2">
                  <FlexRender
                    v-if="!header.isPlaceholder"
                    :render="header.column.columnDef.header"
                    :props="header.getContext()"
                    @click="header.column.getToggleSortingHandler()?.($event)"
                    :class="{
                      'cursor-pointer select-none': header.column.getCanSort(),
                    }"
                  />
                  <div class="flex items-center gap-1 ml-auto shrink-0">
                    <Button
                      v-if="header.column.getCanSort()"
                      variant="ghost"
                      size="sm"
                      class="h-6 w-6 p-0"
                      @click="header.column.getToggleSortingHandler()?.($event)"
                    >
                      <ArrowUp v-if="header.column.getIsSorted() === 'asc'" class="h-3 w-3" />
                      <ArrowDown v-else-if="header.column.getIsSorted() === 'desc'" class="h-3 w-3" />
                      <ArrowUpDown v-else class="h-3 w-3" />
                    </Button>
                    <DropdownMenu
                      v-if="hasColumnMenu(header.column.id, header.column.getCanFilter())"
                      @update:open="setFacetOpen(header.column.id, $event)"
                    >
                      <DropdownMenuTrigger as-child>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-6 w-6 p-0"
                          :data-testid="`column-menu-${header.column.id}`"
                        >
                          <span class="sr-only">Open column menu</span>
                          <MoreVertical v-if="hasExtraMenu(header.column.id)" class="h-3 w-3" />
                          <Filter v-else class="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" class="min-w-[260px] space-y-2">
                      <template v-if="hasExtraMenu(header.column.id)">
                        <slot name="column-menu" :column-id="header.column.id"></slot>
                        <Separator v-if="canFilterColumn(header.column.getCanFilter())" />
                      </template>
                      <div v-if="canFilterColumn(header.column.getCanFilter())" class="px-2 pt-2">
                        <Input
                          :placeholder="`Filter ${header.column.id}…`"
                          :model-value="String(header.column.getFilterValue() ?? '')"
                          @update:modelValue="header.column.setFilterValue($event || undefined)"
                          class="w-full"
                        />
                      </div>
                      <Separator v-if="canFilterColumn(header.column.getCanFilter())" />
                      <div
                        v-if="canFilterColumn(header.column.getCanFilter()) && isFacetOpen(header.column.id)"
                        class="px-2 pb-2"
                      >
                        <template v-if="shouldShowFacets(header.column.id)">
                          <div class="max-h-48 space-y-1 overflow-y-auto">
                            <DropdownMenuItem
                              v-for="([value, count]) in getColumnFacets(header.column.id)"
                              :key="value"
                              class="flex items-center justify-between rounded px-2 py-1 text-sm"
                              :class="isFilterActive(header.column.id, value) ? 'bg-accent/40 text-accent-foreground' : ''"
                              @click="applyFacetFilter(header.column.id, value)"
                            >
                              <span class="truncate">{{ value }}</span>
                              <Badge variant="secondary">{{ count }}</Badge>
                            </DropdownMenuItem>
                          </div>
                        </template>
                        <template v-else>
                          <Button
                            variant="outline"
                            size="sm"
                            class="w-full gap-2 text-xs"
                            @click="enableFacetsForColumn(header.column.id)"
                          >
                            <AlertTriangle class="h-3 w-3 text-yellow-600" />
                            <span>Calculate facets ({{ formatNumber(totalRowCount) }} rows)</span>
                          </Button>
                          <p class="mt-2 text-[10px] text-muted-foreground text-center">
                            Computing facets on large datasets may be slow
                          </p>
                        </template>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  </div>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="table.getRowModel().rows.length">
              <TableRow
                v-for="row in table.getRowModel().rows"
                :key="row.id"
                :data-state="row.getIsSelected() && 'selected'"
              >
                <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id" :class="cell.column.columnDef.meta?.cellClassName">
                  <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
                </TableCell>
              </TableRow>
            </template>
            <template v-else>
              <TableEmpty :colspan="columnCount" class="text-muted-foreground">
                {{ emptyStateText }}
              </TableEmpty>
            </template>
          </TableBody>
        </Table>
      </div>
      <!--
        Paging on its own row under the table: rows per page on the left, the
        page you are on and the four moves through the pages on the right.
        It used to hang off the row-count pill in the footer as a menu, which
        made stepping through pages a click into a menu per page.
      -->
      <div
        v-if="showPagination"
        class="pagination-bar flex flex-wrap items-center justify-between gap-2 px-3 py-1 text-xs text-muted-foreground"
        data-testid="results-pagination"
      >
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2">
            <span>Rows per page</span>
            <select
              v-model.number="pageSize"
              class="rounded border bg-background px-2 py-1 text-xs"
              data-testid="results-page-size"
            >
              <option
                v-for="size in pageSizeOptions"
                :key="size"
                :value="size"
              >
                {{ size }}
              </option>
            </select>
          </label>
        </div>
        <div class="flex items-center gap-1">
          <span class="px-1 tabular-nums" data-testid="results-page-position">
            Page {{ pageIndex + 1 }} of {{ Math.max(pageCount, 1) }}
          </span>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            title="First page"
            data-testid="results-page-first"
            :disabled="!table.getCanPreviousPage()"
            @click="table.setPageIndex(0)"
          >
            <span class="sr-only">First page</span>
            <ChevronFirst class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            title="Previous page"
            data-testid="results-page-prev"
            :disabled="!table.getCanPreviousPage()"
            @click="table.previousPage()"
          >
            <span class="sr-only">Previous page</span>
            <ChevronLeft class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            title="Next page"
            data-testid="results-page-next"
            :disabled="!table.getCanNextPage()"
            @click="table.nextPage()"
          >
            <span class="sr-only">Next page</span>
            <ChevronRight class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            title="Last page"
            data-testid="results-page-last"
            :disabled="!table.getCanNextPage()"
            @click="table.setPageIndex(pageCount - 1)"
          >
            <span class="sr-only">Last page</span>
            <ChevronLast class="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-container-wrapper {
  container-type: inline-size;
  flex: 1;
  min-height: 0;
}

.table-shell {
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-panel);
  overflow: hidden;
  background: hsl(var(--background));
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-scroll {
  overflow-x: scroll;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
  flex: 1;
  min-height: 0;
}

.pagination-bar {
  position: sticky;
  bottom: 0;
  background: hsl(var(--background));
  z-index: 2;
  border-top: 1px solid hsl(var(--border));
}

.table-shell :deep([data-slot="table-container"]) {
  overflow: visible;
}

:deep(.row-number-header),
:deep(.row-number-cell) {
  width: 50px;
  max-width: 50px;
  padding-left: var(--space-4);
  padding-right: var(--space-4);
  font-style: italic;
  color: var(--ink-muted);
  text-align: center !important;
}

:deep(.row-number-cell) {
  font-size: var(--text-body);
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark :deep(.row-number-header),
.dark :deep(.row-number-cell) {
  color: var(--ink-muted);
}
</style>
