<template>
  <div class="editor-footer" data-testid="rules-editor-footer">
    <!--
      The same strip the query editor grew, saying the things a rule set has
      instead of the things a query has: whether the document parses, what it
      contains, and how it stratifies.
    -->
    <StatusBadge :status="badgeStatus" :dot="false" data-testid="srl-validity-pill" :title="statusTitle">
      <Loader2 v-if="validationState === 'validating'" :size="11" class="spin" />
      <Check v-else-if="validationState === 'valid'" :size="11" />
      <AlertCircle v-else-if="validationState === 'error'" :size="11" />
      {{ statusLabel }}
    </StatusBadge>

    <span class="footer-note" data-testid="srl-counts">{{ contentSummary }}</span>

    <button
      v-if="strataCount > 0"
      class="strata-chip"
      data-testid="strata-chip"
      :class="{ unstratified: !stratified }"
      :title="stratified ? 'Show the Stratification tab' : 'This rule set does not stratify — show the Stratification tab'"
      @click="emit('focus-stratification')"
    >
      <Waypoints :size="12" />
      {{ strataCount }} {{ strataCount === 1 ? 'stratum' : 'strata' }}
      <span
        v-for="index in swatchCount"
        :key="index"
        class="strata-swatch"
        :style="{ backgroundColor: stratumColor(index - 1) }"
      />
      <span v-if="!stratified" class="strata-warn">unstratified</span>
    </button>

    <span class="footer-spacer" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  AlertCircle,
  Check,
  Loader2,
  Waypoints,
} from '@lucide/vue';
import { stratumColor } from '@/composables/useStratumPalette';
import StatusBadge from '../shared/StatusBadge.vue';

const props = withDefaults(defineProps<{
  validationState: 'idle' | 'validating' | 'valid' | 'error';
  /** The parser's message, shown on hover when the document does not parse. */
  parseError?: string | null;
  ruleCount: number;
  dataBlockCount: number;
  strataCount: number;
  stratified: boolean;
}>(), {
  parseError: null,
});

const emit = defineEmits<{
  /** Show the Stratification tab — there is no window to open any more. */
  (e: 'focus-stratification'): void;
}>();

/* The same four states as the query footer, mapped the same way. */
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
  if (props.validationState === 'error') return 'invalid SRL';
  if (props.validationState === 'valid') return 'valid SRL';
  return 'not checked';
});

const statusTitle = computed(() => props.parseError ?? undefined);

const contentSummary = computed(() => {
  const parts = [`${props.ruleCount} ${props.ruleCount === 1 ? 'rule' : 'rules'}`];
  if (props.dataBlockCount > 0) {
    parts.push(`${props.dataBlockCount} data ${props.dataBlockCount === 1 ? 'block' : 'blocks'}`);
  }
  return parts.join(' · ');
});

// Enough swatches to read as a legend, not enough to become a rainbow.
const swatchCount = computed(() => Math.min(props.strataCount, 4));

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

/* Slot content of the badge; see the query footer for why the rule reaches it. */
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

.strata-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  white-space: nowrap;
  cursor: pointer;
}

.strata-chip:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}

.strata-chip.unstratified {
  border-color: var(--danger-border);
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.strata-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-sm);
}

.strata-warn {
  font-weight: var(--weight-semibold);
}

.footer-spacer {
  flex: 1;
  min-width: var(--space-4);
}






</style>
