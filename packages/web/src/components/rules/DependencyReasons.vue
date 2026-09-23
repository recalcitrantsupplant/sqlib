<script setup lang="ts">
/**
 * The pattern pairs behind one dependency: a body pattern, and the head it
 * matched.
 *
 * Usually one or two. A body written all in variables (`?a ?b ?c`) matches
 * every triple a head writes, though, and a head built from lists or RDF 1.2
 * terms writes many, so the rest fold away after the first few: the pairs that
 * are shown already say what kind of match it is.
 */
import { computed } from 'vue';
import { MoveRight } from '@lucide/vue';
import type { SrlDependencyReason } from '@/composables/useApiClient';
import { formatBodyPattern, formatTriple } from '@/lib/srlDependencyDisplay';

const SHOWN = 3;

const props = defineProps<{ reasons: SrlDependencyReason[] }>();

const shown = computed(() => props.reasons.slice(0, SHOWN));
const folded = computed(() => props.reasons.slice(SHOWN));
</script>

<template>
  <span v-for="(reason, index) in shown" :key="index" class="reason">
    <code>{{ formatBodyPattern(reason) }}</code>
    <MoveRight :size="13" class="reason-arrow" />
    <code>{{ formatTriple(reason.head) }}</code>
  </span>
  <details v-if="folded.length" class="more-reasons" data-testid="dependency-more-reasons">
    <summary>{{ folded.length }} more matching {{ folded.length === 1 ? 'pattern' : 'patterns' }}</summary>
    <span v-for="(reason, index) in folded" :key="index" class="reason">
      <code>{{ formatBodyPattern(reason) }}</code>
      <MoveRight :size="13" class="reason-arrow" />
      <code>{{ formatTriple(reason.head) }}</code>
    </span>
  </details>
</template>

<style scoped>
.reason {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.reason code {
  padding: var(--space-1) var(--space-3);
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.reason-arrow {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.more-reasons {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.more-reasons > summary {
  color: var(--ink-muted);
  font-size: var(--text-label);
  cursor: pointer;
}

.more-reasons[open] > summary {
  margin-bottom: var(--space-2);
}
</style>
