<template>
  <span v-if="state.kind === 'none'" class="dash">–</span>
  <button
    v-else
    type="button"
    class="badge-link"
    :title="state.title"
    data-testid="access-graphs-badge"
    @click="emit('open')"
  >
    <StatusBadge :tone="state.tone">{{ state.label }}</StatusBadge>
  </button>
</template>

<script setup lang="ts">
/**
 * How many of a backend's graphs one principal may read, as a badge.
 *
 * "3 of 12 · policy" under a graph policy, "all · no policy" without one,
 * "all" for an administrator. A dash means no grant reaches the backend, so
 * the policy never runs. Pressing it opens the backend's own view.
 */
import { computed } from 'vue';
import type { Backend } from '@sparql-query-lib/contracts';
import type { PrincipalRecord } from '@/composables/useApiClient';
import { graphsOf, useAccessData } from '@/composables/useAccessData';
import StatusBadge from '@/components/shared/StatusBadge.vue';

const props = withDefaults(defineProps<{
  backend: Backend;
  principal: PrincipalRecord;
  /** Add "· policy" to a policed count; the backend's own view leaves it out. */
  namePolicy?: boolean;
}>(), { namePolicy: true });

const emit = defineEmits<{ (e: 'open'): void }>();

const access = useAccessData();

type Tone = 'success' | 'warning' | 'danger' | 'action' | 'neutral';

const state = computed((): { kind: 'none' } | { kind: 'badge'; tone: Tone; label: string; title: string } => {
  if (props.backend.authBackend) return { kind: 'none' };
  if (access.isPending(props.principal.iri, props.backend.id)) {
    return { kind: 'badge', tone: 'neutral', label: 'after save', title: 'Graph counts read the saved grants. Save to see this change.' };
  }
  const readable = access.readableFor(props.backend.id, props.principal);
  if (readable.loading) return { kind: 'badge', tone: 'neutral', label: '…', title: 'Working out the graphs' };
  if (readable.error || !readable.result) {
    return { kind: 'badge', tone: 'danger', label: 'unknown', title: readable.error ?? 'Could not test this backend' };
  }
  const result = readable.result;
  if (result.admin) return { kind: 'badge', tone: 'warning', label: 'all', title: 'Administrators read every graph' };
  if (result.modes.length === 0) return { kind: 'none' };
  if (!result.policy) {
    return { kind: 'badge', tone: 'neutral', label: 'all · no policy', title: 'This backend has no graph policy' };
  }
  if (result.error) {
    return { kind: 'badge', tone: 'danger', label: 'policy failed', title: result.error };
  }
  const total = access.graphTotals.get(props.backend.id);
  const count = graphsOf(result).length;
  const label = `${count} of ${total ?? '?'}${props.namePolicy ? ' · policy' : ''}`;
  return { kind: 'badge', tone: 'action', label, title: 'Graphs the policy lets them read' };
});
</script>

<style scoped>
.dash {
  color: var(--ink-muted);
}

.badge-link {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
</style>
