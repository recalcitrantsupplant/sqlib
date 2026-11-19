<template>
  <StatusBadge :tone="off ? 'neutral' : TONE[verdict]" :size="size" :dot="false" :data-testid="`verdict-pill-${verdict}`">
    <Check v-if="verdict === 'fits'" :size="11" />
    <CircleDashed v-else-if="verdict === 'partial'" :size="11" />
    <AlertCircle v-else :size="11" />
    <slot>{{ LABEL[verdict] }}</slot>
  </StatusBadge>
</template>

<script setup lang="ts">
/**
 * One signature verdict as a `StatusBadge`: an icon, a tone and a label.
 *
 * `compatibility` (`lib/argumentSignature.ts`) gives three verdicts:
 *
 * - `fits`: each clause is bound, and each binding has a clause.
 * - `partial`: some clauses are bound. A clause left out runs unconstrained,
 *   so the set still runs. Also used when a binding has no clause to go to.
 * - `mismatch`: no binding matches any clause, or there are no bindings.
 *
 * `off` paints the pill neutral, for a filter chip that is turned off.
 */
import { AlertCircle, Check, CircleDashed } from '@lucide/vue';
import StatusBadge from './StatusBadge.vue';
import type { CompatibilityVerdict } from '@/lib/argumentSignature';

withDefaults(defineProps<{
  verdict: CompatibilityVerdict;
  size?: 'sm' | 'xs';
  off?: boolean;
}>(), { size: 'sm', off: false });

const TONE: Record<CompatibilityVerdict, 'success' | 'warning' | 'danger'> = {
  fits: 'success',
  partial: 'warning',
  mismatch: 'danger',
};

const LABEL: Record<CompatibilityVerdict, string> = {
  fits: 'Matches',
  partial: 'Partial',
  mismatch: 'No match',
};
</script>
