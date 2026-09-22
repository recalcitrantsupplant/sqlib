<script setup lang="ts">
/**
 * The slim band of run facts under a results table.
 *
 * Everything here is a *fact about the response* — how many rows, when it ran,
 * what it was rendered from, how long it took — which is why none of it belongs
 * in the action bar above: that bar is for things you do to the response. The
 * facts are pills so they stay legible at any width.
 *
 * Paging is not here. It used to hang off the row-count pill as a menu, which
 * put a menu between the reader and the next page; it is a row of buttons
 * under the table now (`DataTable`), where the rows it moves through are.
 */
import { computed } from 'vue';
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
    /**
     * How the view stands to that media type.
     *
     * A table is *rendered from* a payload — the rows are a reading of it. A
     * raw view is not rendered from anything; it *is* the payload, so it says
     * "as". One word, and the sentence stops claiming a transformation that
     * did not happen.
     */
    mediaRelation?: 'rendered from' | 'as';
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
    mediaRelation: 'rendered from',
    durationMs: null,
    durationTitle: null,
  },
);

const rowCount = computed(() => props.table?.filteredRows ?? 0);
const isFiltered = computed(
  () => !!props.table && props.table.filteredRows < props.table.totalRows,
);
const formatNumber = (value: number) => value.toLocaleString('en-US');
const rowLabel = computed(
  () => `${formatNumber(rowCount.value)} ${rowCount.value === 1 ? props.rowNoun : `${props.rowNoun}s`}`,
);

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
    <span v-if="table" class="footer-pill" data-testid="results-rows-pill">
      {{ rowLabel }}
      <span v-if="isFiltered" class="footer-pill-note">filtered</span>
    </span>

    <!--
      What the rows are, then what they came from, then when. The media type
      used to trail the timestamp, which read as "executed in the last minute
      from application/n-triples" — as though the run had been performed on a
      media type. It belongs beside the count it describes.
    -->
    <template v-if="mediaType">
      <span class="footer-label">{{ mediaRelation }}</span>
      <span class="footer-pill">{{ mediaType }}</span>
    </template>

    <template v-if="executedRelative">
      <span class="footer-label">executed</span>
      <span class="footer-pill" :title="executedAt ?? undefined">{{ executedRelative }}</span>
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
  box-sizing: border-box;
  /*
   * The same band the editor and the Details tab end on: `--panel-bar-h` tall,
   * `var(--space-4)` all round, full width, flush to the panel's bottom edge.
   * It used to be inset from three sides by the padding on `.results-content`,
   * which made it the one band in the app that floats.
   */
  min-height: var(--panel-bar-h);
  padding: var(--space-4);
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
