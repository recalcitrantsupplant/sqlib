<script setup lang="ts">
/**
 * The slim band of run facts under a results table.
 *
 * Everything here is a *fact about the response* — how many rows, when it ran,
 * what it was rendered from, how long it took — which is why none of it belongs
 * in the action bar above: that bar is for things you do to the response. The
 * facts are pills so they stay legible at any width, and the row count carries
 * paging as a menu, because a one-page result should not spend a whole band on
 * First / Prev / Next / Last.
 */
import { computed } from 'vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DataTableState } from '@/composables/useDataTable';
import { formatRelativeTime } from '@/lib/time';

const props = withDefaults(
  defineProps<{
    /** Paging and counts, straight from the table's `state` event. */
    table?: DataTableState | null;
    /** What the rows are, for the count pill: "171 rows", "6 triples". */
    rowNoun?: string;
    /** ISO timestamp of the run, or null when nothing has run. */
    executedAt?: string | null;
    /** The media type the view was rendered from. */
    mediaType?: string | null;
    /** Total wall-clock, stated as text rather than drawn as a donut. */
    durationMs?: number | null;
    /** The breakdown behind that number, on hover. */
    durationTitle?: string | null;
  }>(),
  {
    table: null,
    rowNoun: 'row',
    executedAt: null,
    mediaType: null,
    durationMs: null,
    durationTitle: null,
  },
);

const emit = defineEmits<{
  'set-page': [index: number];
  'set-page-size': [size: number];
}>();

const rowCount = computed(() => props.table?.filteredRows ?? 0);
const isFiltered = computed(
  () => !!props.table && props.table.filteredRows < props.table.totalRows,
);
const formatNumber = (value: number) => value.toLocaleString('en-US');
const rowLabel = computed(
  () => `${formatNumber(rowCount.value)} ${rowCount.value === 1 ? props.rowNoun : `${props.rowNoun}s`}`,
);

const pageCount = computed(() => props.table?.pageCount ?? 0);
const pageIndex = computed(() => props.table?.pageIndex ?? 0);
const canPage = computed(() => pageCount.value > 1);

const executedRelative = computed(() =>
  props.executedAt ? formatRelativeTime(props.executedAt) : null,
);

const durationLabel = computed(() => {
  if (typeof props.durationMs !== 'number') return null;
  return props.durationMs < 1 ? '<1 ms' : `${Math.round(props.durationMs)} ms`;
});

const hasAnything = computed(
  () => !!props.table || !!executedRelative.value || !!props.mediaType || !!durationLabel.value,
);
</script>

<template>
  <div v-if="hasAnything" class="results-footer" data-testid="results-footer">
    <DropdownMenu v-if="table">
      <DropdownMenuTrigger as-child>
        <button type="button" class="footer-pill footer-pill--menu" data-testid="results-rows-pill">
          {{ rowLabel }}
          <span v-if="isFiltered" class="footer-pill-note">filtered</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-[220px]">
        <div class="px-2 py-1.5 text-xs text-muted-foreground">
          Rows per page
        </div>
        <DropdownMenuItem
          v-for="size in table.pageSizeOptions"
          :key="size"
          class="flex items-center justify-between rounded px-2 py-1 text-sm"
          :class="size === table.pageSize ? 'bg-accent/40 text-accent-foreground' : ''"
          :data-testid="`results-page-size-${size}`"
          @select="emit('set-page-size', size)"
        >
          <span>{{ size }}</span>
        </DropdownMenuItem>
        <template v-if="canPage">
          <DropdownMenuSeparator />
          <div class="px-2 py-1.5 text-xs text-muted-foreground">
            Page {{ pageIndex + 1 }} of {{ pageCount }}
          </div>
          <DropdownMenuItem
            :disabled="pageIndex === 0"
            data-testid="results-page-prev"
            @select="emit('set-page', pageIndex - 1)"
          >
            Previous page
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="pageIndex >= pageCount - 1"
            data-testid="results-page-next"
            @select="emit('set-page', pageIndex + 1)"
          >
            Next page
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="pageIndex === 0"
            @select="emit('set-page', 0)"
          >
            First page
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="pageIndex >= pageCount - 1"
            @select="emit('set-page', pageCount - 1)"
          >
            Last page
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <template v-if="executedRelative">
      <span class="footer-label">executed</span>
      <span class="footer-pill" :title="executedAt ?? undefined">{{ executedRelative }}</span>
    </template>

    <template v-if="mediaType">
      <span class="footer-label">from</span>
      <span class="footer-pill">{{ mediaType }}</span>
    </template>

    <span
      v-if="durationLabel"
      class="footer-duration"
      data-testid="results-duration"
      :title="durationTitle ?? undefined"
    >
      {{ durationLabel }}
    </span>
  </div>
</template>

<style scoped>
.results-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border-default);
  background: var(--surface-subtle);
}

.footer-label {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.footer-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  color: var(--action);
  padding: var(--space-1) var(--space-3);
  background: var(--action-surface);
  border: 1px solid var(--action-border);
  border-radius: var(--radius-full);
}

.footer-pill--menu {
  cursor: pointer;
}

.footer-pill--menu:hover {
  border-color: var(--action);
}

.footer-pill-note {
  font-weight: 400;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.footer-duration {
  margin-left: auto;
  font-size: var(--text-micro);
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .footer-pill {
  color: var(--action);
  background: rgb(59 130 246 / 14%);
  border-color: rgb(59 130 246 / 40%);
}
</style>
