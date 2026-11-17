<template>
  <!--
    The verdict as the same pill the query editor uses for "valid SELECT", so
    the two checks on one screen read alike. The reason sits beside the pill as
    data: which clauses are bound, which arity is wrong.
  -->
  <p class="signature-verdict" :data-testid="`signature-verdict-${verdict.verdict}`">
    <StatusBadge :tone="TONE[verdict.verdict]" :dot="false" data-testid="signature-verdict-pill">
      <Check v-if="verdict.verdict === 'fits'" :size="11" />
      <CircleDashed v-else-if="verdict.verdict === 'partial'" :size="11" />
      <AlertCircle v-else :size="11" />
      {{ LABEL[verdict.verdict] }}
    </StatusBadge>
    <span v-if="verdict.reason" class="signature-verdict-reason">{{ verdict.reason }}</span>
  </p>
</template>

<script setup lang="ts">
/**
 * Whether the open argument set fits the callable's parameters.
 *
 * `compatibility` (`lib/argumentSignature.ts`) gives three verdicts:
 *
 * - `fits`: each clause is bound, and each binding has a clause.
 * - `partial`: some clauses are bound. A clause left out runs unconstrained,
 *   so the set still runs. Also used when a binding has no clause to go to.
 * - `mismatch`: no binding matches any clause, or there are no bindings.
 *
 * The verdicts look at variable names and arity only.
 */
import { AlertCircle, Check, CircleDashed } from '@lucide/vue';
import StatusBadge from './StatusBadge.vue';
import type { Compatibility, CompatibilityVerdict } from '@/lib/argumentSignature';

defineProps<{ verdict: Compatibility }>();

const TONE: Record<CompatibilityVerdict, 'success' | 'warning' | 'danger'> = {
  fits: 'success',
  partial: 'warning',
  mismatch: 'danger',
};

const LABEL: Record<CompatibilityVerdict, string> = {
  fits: 'Matches signature',
  partial: 'Partial match',
  mismatch: 'No match',
};
</script>

<style scoped>
.signature-verdict {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: 0;
}

.signature-verdict-reason {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}
</style>
