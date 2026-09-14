<template>
  <div class="run-export" role="group" aria-label="Run this scope">
    <button
      type="button"
      class="rerun-button"
      data-testid="test-run-rerun"
      :disabled="disabled || busy"
      :title="disabled ? (disabledReason ?? 'Nothing to re-run yet') : `Run ${scopeLabel} again`"
      @click="emit('rerun')"
    >
      <RefreshCw :size="13" :class="{ 'is-spinning': busy }" />{{ busy ? 'Running…' : 'Re-run' }}
    </button>

    <DropdownMenu v-model:open="open">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="export-button"
          data-testid="test-run-export"
          :disabled="disabled || busy"
          :title="disabled ? (disabledReason ?? 'Nothing to export yet') : 'Run and save the report'"
        >
          <Download :size="13" />Run &amp; export<ChevronUp :size="12" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" class="export-menu">
        <!--
          The heading says the run out loud, because picking a format here runs
          the suite: export is content negotiation on the run route, not a view
          over a stored result.
        -->
        <DropdownMenuLabel class="export-head">
          Re-run <span class="export-scope">{{ scopeLabel }}</span> and save as
        </DropdownMenuLabel>
        <DropdownMenuItem
          v-for="format in TEST_REPORT_FORMATS"
          :key="format.id"
          class="export-item"
          :data-testid="`test-run-export-${format.id}`"
          @select="emit('export', format)"
        >
          <span class="export-label">{{ format.label }}</span>
          <InlineNote as="span" size="xs">{{ format.hint }}</InlineNote>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<script setup lang="ts">
/**
 * Run this scope again, or run it and take the report away.
 *
 * A split control, and it lives with Run — in the Runs tab's footer — rather
 * than in the results header, because an export *is* a run: the route is the
 * same `POST /tests/run`, and the format is an `Accept` header on it. Putting
 * it beside the summary would suggest it saves what is on screen, which is the
 * one thing it does not do.
 *
 * Every format is a response format the server writes. The SPA owns no report
 * format — no EARL writer, no JUnit writer, no CSV writer — so the menu is a
 * list of `Accept` headers and a file save, exactly as the results panel's
 * downloads are.
 *
 * Each format costs a run of its own today. That is honest — the file always
 * matches a run that happened — and it is the open question the handover
 * raises: a multi-format select on the route would answer N formats from one
 * run. Until then this control does not pretend otherwise.
 */
import { ref } from 'vue';
import { ChevronUp, Download, RefreshCw } from '@lucide/vue';
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
  /** What Re-run would run — `tag: conformance`, `all tests`, a test's name. */
  scopeLabel: string;
  busy?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
}>(), { busy: false, disabled: false, disabledReason: null });

const emit = defineEmits<{ rerun: []; export: [format: TestReportFormat] }>();

const open = ref(false);
</script>

<style scoped>
.run-export {
  display: flex;
  gap: var(--space-2);
}

.rerun-button,
.export-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: var(--control-h);
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

/* Re-run is the primary: it is what the footer is for. */
.rerun-button {
  flex: 1;
  border: 1px solid var(--action);
  background: var(--action);
  color: var(--action-fg);
}

.rerun-button:hover:not(:disabled) {
  background: var(--action-hover);
}

.export-button {
  flex: 1;
  border: 1px solid var(--border-default);
  background: var(--surface);
  color: var(--ink-secondary);
}

.export-button:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--border-strong);
}

.rerun-button:disabled,
.export-button:disabled {
  opacity: 0.5;
  cursor: default;
}


.export-menu {
  min-width: var(--grid-8);
}

.export-head {
  font-size: var(--text-micro);
  font-weight: var(--weight-normal);
  color: var(--ink-muted);
}

.export-scope {
  color: var(--ink);
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
