<template>
  <div class="policy-vars" data-testid="policy-variables">
    <template v-for="section in sections" :key="section.kind">
      <SectionLabel as="h4" class="vars-head">{{ section.label }}</SectionLabel>
      <ul class="vars">
        <li
          v-for="variable in section.rows"
          :key="variable.name"
          class="var-row"
          :class="`var-row--${variable.state}`"
          :data-testid="`policy-var-${variable.name}`"
          :data-state="variable.state"
        >
          <span class="state-icon" :title="STATE_TITLES[variable.state]">
            <Check v-if="variable.state === 'used'" :size="13" />
            <AlertTriangle v-else-if="variable.state === 'undeclared'" :size="13" />
            <Minus v-else :size="13" />
          </span>
          <code class="var-name">?{{ variable.name }}</code>
          <span class="var-text">
            <span class="var-role">{{ variable.role }}</span>
            <span class="var-meaning">{{ variable.meaning }}</span>
          </span>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, Check, Minus } from '@lucide/vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import { policyVariables, type PolicyVariableState } from '@/lib/policyVariables';

/**
 * The reserved variables under a policy's text: what each one does, and
 * whether this query uses it. An unused one is not a fault, so it gets a dash
 * and a sentence, not a warning; only a caller slot used without its VALUES
 * declaration warns, because sqlib will never fill it.
 */
const props = defineProps<{ queryText: string }>();

const STATE_TITLES: Record<PolicyVariableState, string> = {
  used: 'In the query',
  unused: 'Not in the query',
  undeclared: 'In the query, but not declared',
};

const sections = computed(() => {
  const all = policyVariables(props.queryText);
  return [
    { kind: 'output', label: 'Graphs it returns', rows: all.filter((v) => v.kind === 'output') },
    { kind: 'caller', label: 'Caller inputs sqlib fills', rows: all.filter((v) => v.kind === 'caller') },
  ];
});
</script>

<style scoped>
.policy-vars {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.vars-head {
  margin-top: var(--space-2);
}

.vars {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.var-row {
  display: grid;
  grid-template-columns: 16px 112px 1fr;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--text-label);
}

.state-icon {
  display: inline-flex;
  align-self: center;
  color: var(--ink-muted);
}

.var-row--used .state-icon {
  color: var(--success);
}

.var-row--undeclared .state-icon {
  color: var(--warning-ink);
}

.var-name {
  font-family: var(--font-mono);
  color: var(--action-ink);
}

.var-row--unused .var-name {
  color: var(--ink-muted);
}

.var-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.var-role {
  color: var(--ink);
}

.var-meaning {
  color: var(--ink-muted);
}
</style>
