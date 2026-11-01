<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="group-diff" data-testid="group-version-diff">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          Nodes are matched by kind, name and query, because each version gives
          its nodes new ids.
        </DialogDescription>
      </DialogHeader>

      <p v-if="loading" class="diff-note">Loading both versions…</p>
      <p v-else-if="error" class="diff-note diff-error">{{ error }}</p>
      <p v-else-if="diff?.same" class="diff-note" data-testid="group-diff-same">
        The two versions draw the same group. Only node positions or notes can differ.
      </p>
      <div v-else-if="diff" class="diff-sections">
        <section v-for="section in sections" :key="section.title">
          <h3 class="diff-heading">{{ section.title }}</h3>
          <ul class="diff-list">
            <li v-for="item in section.added" :key="`+${item}`" class="diff-added">
              <span class="diff-mark" aria-label="added">+</span>{{ item }}
            </li>
            <li v-for="item in section.removed" :key="`-${item}`" class="diff-removed">
              <span class="diff-mark" aria-label="removed">−</span>{{ item }}
            </li>
            <li v-for="item in section.changed" :key="`~${item.name}`" class="diff-changed">
              <span class="diff-mark" aria-label="changed">~</span>{{ item.name }}:
              {{ item.changes.join('; ') }}
            </li>
          </ul>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import type { DiffChange, GroupVersionDiff } from '../../lib/groupVersionDiff';

const props = defineProps<{
  open: boolean;
  title: string;
  diff: GroupVersionDiff | null;
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>();

type Section = { title: string; added: string[]; removed: string[]; changed: DiffChange[] };

const sections = computed<Section[]>(() => {
  const diff = props.diff;
  if (!diff) return [];
  const all: Section[] = [
    { title: 'Inputs', added: diff.inputs.added, removed: diff.inputs.removed, changed: [] },
    { title: 'Nodes', ...diff.nodes },
    { title: 'Edges', ...diff.edges },
  ];
  return all.filter((section) => section.added.length + section.removed.length + section.changed.length > 0);
});
</script>

<style scoped>
.group-diff {
  max-width: min(640px, calc(100vw - 32px));
}

.diff-note {
  margin: 0;
  font-size: var(--text-body);
}

.diff-error {
  color: var(--danger-ink);
}

.diff-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: 60vh;
  overflow-y: auto;
}

.diff-heading {
  margin: 0 0 var(--space-2);
  font-size: var(--text-label);
  font-weight: 600;
}

.diff-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-body);
}

.diff-mark {
  display: inline-block;
  width: 1.25em;
  font-weight: 700;
}

.diff-added .diff-mark {
  color: var(--success-ink);
}

.diff-removed .diff-mark {
  color: var(--danger-ink);
}

.diff-changed .diff-mark {
  color: var(--warning-ink);
}
</style>
