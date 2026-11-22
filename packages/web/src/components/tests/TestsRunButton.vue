<template>
  <span class="tests-run" :class="{ split: filtered }">
    <button
      type="button"
      class="tests-run-main"
      data-testid="tests-run-all"
      :disabled="busy || count === 0"
      :title="filtered ? `Run the ${count} tests in this list` : `Run all ${count} tests`"
      @click="emit('run')"
    >
      <Play :size="12" />{{ label }}
    </button>
    <DropdownMenu v-if="filtered">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="tests-run-more"
          data-testid="tests-run-menu"
          title="More ways to run"
          aria-label="More ways to run"
          :disabled="busy"
        >
          <ChevronDown :size="11" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem class="tests-run-item" data-testid="tests-run-filtered" :disabled="count === 0" @select="emit('run')">
          <Play :size="12" />
          <span>Run {{ count }} {{ count === 1 ? 'test' : 'tests' }}</span>
        </DropdownMenuItem>
        <DropdownMenuItem class="tests-run-item" data-testid="tests-run-everything" @select="emit('run-all')">
          <Play :size="12" />
          <span>Run all {{ totalCount }} tests</span>
        </DropdownMenuItem>
        <template v-if="canExport">
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="tests-run-label">Run {{ count }} and download as</DropdownMenuLabel>
          <DropdownMenuItem
            v-for="format in TEST_REPORT_FORMATS"
            :key="format.id"
            class="tests-run-item"
            :data-testid="`tests-export-${format.id}`"
            :title="format.hint"
            @select="emit('export', format)"
          >
            <Download :size="12" />
            <span>{{ format.label }}</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>
  </span>
</template>

<script setup lang="ts">
/**
 * Run for the Tests list. It runs the tests the list shows.
 *
 * With no filter it is the one Run all button. With a tag filter or a text
 * filter it reads "Run N" and gains a menu: run everything, or run the
 * tagged tests and download the report. The report formats need the tags,
 * because the server selects the tests of an export run by tag.
 */
import { ChevronDown, Download, Play } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { TEST_REPORT_FORMATS, type TestReportFormat } from '../../lib/testReportFormats';

defineProps<{
  /** What the main button says: "Run all", "Run 16", or the progress of a run. */
  label: string;
  /** How many tests the list shows. */
  count: number;
  /** How many tests the section holds. */
  totalCount: number;
  /** True when a tag or text filter narrows the list. */
  filtered: boolean;
  /** True when the filter is tags only, so the server can run and export it. */
  canExport: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  run: [];
  'run-all': [];
  export: [format: TestReportFormat];
}>();
</script>

<style scoped>
.tests-run {
  display: inline-flex;
}

.tests-run-main,
.tests-run-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.tests-run-main {
  padding: var(--space-1) var(--space-3);
}

.tests-run-more {
  padding: var(--space-1) var(--space-1);
}

.split .tests-run-main {
  border-right: none;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.split .tests-run-more {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.tests-run-main:hover:not(:disabled),
.tests-run-more:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--border-strong);
}

.tests-run-main:disabled,
.tests-run-more:disabled {
  opacity: 0.5;
  cursor: default;
}

.tests-run-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.tests-run-label {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-normal);
}
</style>
