<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <!--
        The same button the query screen's results panel downloads from —
        `.btn-icon`, 28px square, a 16px glyph. It was drawn at 5px padding
        around an 11px chevron here, which read as a disabled affordance beside
        the Run button it sits next to.
      -->
      <button
        class="btn-icon export-button"
        type="button"
        data-testid="test-export-report"
        :disabled="disabled || busy"
        :title="disabled ? (disabledReason ?? 'Nothing to export yet') : 'Run and download the report'"
      >
        <Download :size="16" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="export-menu">
      <DropdownMenuLabel class="export-head">{{ heading }}</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="format in TEST_REPORT_FORMATS"
        :key="format.id"
        class="export-item"
        :data-testid="`test-export-${format.id}`"
        @select="emit('export', format)"
      >
        <span class="export-label">{{ format.label }}</span>
        <!-- The formats are close enough in name that the difference has to be said. -->
        <InlineNote as="span" size="xs">{{ format.hint }}</InlineNote>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
/**
 * Download a test run's report, in a format the caller picks.
 *
 * Picking a format *runs the tests* — export is a response format on the run
 * routes, not a view over stored results, because the library holds no run to
 * fetch later. So the heading says "Run and download", and the verdicts in the
 * file are the ones that run produced rather than whatever this tab last saw.
 *
 * The formats come from `lib/testReportFormats`, which mirrors the server's
 * registry: the by-tag menu offers the same list from the same place, so
 * neither surface can quietly end up missing a format the other has.
 */
import { ref } from 'vue';
import { Download } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { TEST_REPORT_FORMATS, type TestReportFormat } from '../../lib/testReportFormats';
import InlineNote from '../shared/InlineNote.vue';

withDefaults(defineProps<{
  /** What the run would cover — "this test", "12 tagged tests". */
  heading?: string;
  busy?: boolean;
  disabled?: boolean;
  /** Why it is disabled, for the tooltip. */
  disabledReason?: string | null;
}>(), {
  heading: 'Run and download',
  busy: false,
  disabled: false,
  disabledReason: null,
});

const emit = defineEmits<{ export: [format: TestReportFormat] }>();

const open = ref(false);
</script>

<style scoped>
/* `.btn-icon` carries the box; only the disabled state is ours. */
.export-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.export-button:disabled:hover {
  background: var(--surface-raised);
  color: var(--ink-secondary);
}

.export-menu {
  min-width: 240px;
}

.export-head {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.export-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}

.export-label {
  font-size: var(--text-body);
  color: var(--ink);
}
</style>
