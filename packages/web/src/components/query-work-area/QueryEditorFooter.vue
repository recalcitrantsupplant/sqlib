<template>
  <div class="editor-footer" data-testid="editor-footer">
    <!--
      What the validation banner used to say in a full-width strip above the
      code, said in a pill below it. The query form is in the label because
      "valid" alone does not tell you what you are about to get back.
    -->
    <StatusBadge
      v-if="showValidity"
      :status="badgeStatus"
      :dot="false"
      data-testid="validity-pill"
    >
      <Loader2 v-if="validationState === 'validating'" :size="11" class="spin" />
      <Check v-else-if="validationState === 'valid'" :size="11" />
      <AlertCircle v-else-if="validationState === 'error'" :size="11" />
      {{ statusLabel }}
    </StatusBadge>

    <span class="footer-note" data-testid="line-count">{{ lineCount }} lines</span>

    <span class="footer-spacer" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  Check,
  AlertCircle,
  Loader2,
} from '@lucide/vue';
import StatusBadge from '../shared/StatusBadge.vue';

const props = withDefaults(defineProps<{
  validationState: 'idle' | 'validating' | 'valid' | 'error';
  /** SELECT / ASK / CONSTRUCT, so the pill says what comes back. */
  queryTypeLabel: string | null;
  sparqlCode: string;
  /*
   * Off for callers with nothing to say in it. The ETL screen borrows this
   * strip and does not validate a body ahead of the run, so a permanent "not
   * checked" pill would be furniture, not information.
   */
  showValidity?: boolean;
}>(), {
  showValidity: true,
});

const lineCount = computed(() => (props.sparqlCode ? props.sparqlCode.split('\n').length : 0));

/*
 * The four validation states are `StatusBadge`'s own four, under other names —
 * which is why this footer's pill was the primitive written out by hand. The
 * map is stated rather than inferred so a fifth state has to choose one.
 */
const badgeStatus = computed(() => {
  switch (props.validationState) {
    case 'valid': return 'valid' as const;
    case 'error': return 'invalid' as const;
    case 'validating': return 'running' as const;
    default: return 'idle' as const;
  }
});

const statusLabel = computed(() => {
  if (props.validationState === 'validating') return 'checking…';
  if (props.validationState === 'error') return 'invalid';
  if (props.validationState === 'valid') {
    return props.queryTypeLabel ? `valid ${props.queryTypeLabel}` : 'valid';
  }
  return 'not checked';
});

</script>

<style scoped>
.editor-footer {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  box-sizing: border-box;
  flex-shrink: 0;
  flex-wrap: wrap;
  padding: var(--space-4);
  background: var(--surface-subtle);
  border-top: 1px solid var(--border-default);
}

/*
 * The pill itself is `StatusBadge`. What stays here is the spinner, which is
 * slot content: Vue puts this component's scope attribute on what it passes
 * into a child's slot, so the rule still reaches the icon.
 */
.spin {
  animation: footer-spin 1s linear infinite;
}

@keyframes footer-spin {
  to { transform: rotate(360deg); }
}

.footer-note {
  color: var(--ink-muted);
  font-size: var(--text-label);
  white-space: nowrap;
}

.footer-spacer {
  flex: 1;
  min-width: var(--space-4);
}







</style>
