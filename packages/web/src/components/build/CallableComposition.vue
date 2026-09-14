<template>
  <div class="composition">
    <div v-if="callable.type === 'group'" class="column">
      <span class="column-label">Composes</span>
      <InlineNote>
        {{ callable.composes }} {{ callable.composes === 1 ? 'node' : 'nodes' }} — open it in the
        work area to see the graph.
      </InlineNote>
    </div>

    <div class="column">
      <span class="column-label">Accepts this output</span>
      <!--
        Signature matching (§7): two callables compose when one's outputs cover
        the other's inputs. Cheap to compute in the client, absent from Swagger,
        and the thing that keeps a chat-built library coherent rather than forty
        unrelated queries.
      -->
      <div v-for="match in matches" :key="match.callable.id" class="match">
        <Workflow v-if="match.callable.type === 'group'" :size="12" class="match-icon" />
        <FileCode2 v-else :size="12" class="match-icon" />
        <span class="match-name">{{ match.callable.name }}</span>
        <span class="match-variables">{{ match.sharedVariables.join(', ') }}</span>
      </div>
      <InlineNote>{{ summary }}</InlineNote>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { FileCode2, Workflow } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import { callablesAcceptingOutput, type Callable } from '../../lib/callables';

const props = defineProps<{
  callable: Callable;
  siblings: Callable[];
}>();

const matches = computed(() => callablesAcceptingOutput(props.callable, props.siblings));

const summary = computed(() => {
  if (props.callable.resultKind !== 'BINDINGS') {
    return 'Chaining is matched on bindings variables, so a graph or boolean result has nothing to match on.';
  }
  const count = matches.value.length;
  if (count === 0) return 'No other callable takes these variables as input.';
  return `${count} ${count === 1 ? 'callable' : 'callables'} could chain from here`;
});
</script>

<style scoped>
.composition {
  display: flex;
  gap: var(--space-6);
}

.column {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.column-label {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

.match {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.match-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.match-name {
  min-width: 0;
  font-size: var(--text-body);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-variables {
  margin-left: auto;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink-muted);
}

</style>
