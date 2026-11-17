<template>
  <!--
    The verdict as the same pill the query editor uses for "valid SELECT", so
    the two checks on one screen read alike. The reason sits beside the pill as
    data: which clauses are bound, which arity is wrong.
  -->
  <p class="signature-verdict" :data-testid="`signature-verdict-${verdict.verdict}`">
    <VerdictPill :verdict="verdict.verdict" data-testid="signature-verdict-pill">
      {{ LABEL[verdict.verdict] }}
    </VerdictPill>
    <span v-if="verdict.reason" class="signature-verdict-reason">{{ verdict.reason }}</span>
  </p>
</template>

<script setup lang="ts">
/**
 * Whether the open argument set fits the callable's parameters. The verdicts
 * are described on `VerdictPill`; they look at variable names and arity only.
 */
import VerdictPill from './VerdictPill.vue';
import type { Compatibility, CompatibilityVerdict } from '@/lib/argumentSignature';

defineProps<{ verdict: Compatibility }>();

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
