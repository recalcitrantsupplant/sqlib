<template>
  <footer class="strip" data-testid="splash-about">
    <StatusBadge
      v-if="backend"
      :tone="backend.tone"
      size="xs"
      dot
      :title="backend.title"
      data-testid="splash-backend"
    >
      {{ backend.label }}
    </StatusBadge>

    <StatusBadge
      v-if="tests"
      :tone="tests.tone"
      size="xs"
      dot
      :title="tests.title"
      data-testid="splash-tests"
    >
      {{ tests.label }}
    </StatusBadge>

    <span class="strip-end">
      <span class="build" data-testid="splash-version" :title="buildTitle">Version {{ label }}</span>
      <a class="about-link" :href="REPO_URL" target="_blank" rel="noreferrer">
        <Code :size="13" /> Source
      </a>
      <a class="about-link" :href="DOCS_URL" target="_blank" rel="noreferrer">
        <BookOpen :size="13" /> Documentation
      </a>
    </span>
  </footer>
</template>

<script lang="ts">
/** One fact on the strip: a word, the sentence behind it, and the paint. */
export interface StripFact {
  label: string;
  title: string;
  tone: 'success' | 'warning' | 'danger' | 'action' | 'neutral';
}
</script>

<script setup lang="ts">
/**
 * The line along the foot of the landing screen: which store this library
 * talks to, whether its tests were passing when they last ran, and which build
 * is running.
 *
 * It carries what would otherwise want a panel each, and a panel that is empty
 * half the time is worse than a line that is short. Each fact is omitted rather
 * than drawn as a dash when there is nothing to say — a library with no default
 * backend has no backend line, and a library whose tests have never been run in
 * this browser has no verdict line.
 *
 * About lives here for the reason it lived in the old footer: which build this
 * is, and where the source and the docs are, is read once, and a destination
 * nobody navigates to is a worse home for it than the screen they land on.
 */
import { computed } from 'vue';
import { BookOpen, Code } from '@lucide/vue';
import StatusBadge from '../shared/StatusBadge.vue';
import { useBuildInfo } from '../../composables/useBuildInfo';
import { DOCS_URL, REPO_URL } from '../../lib/docs';

defineProps<{
  backend: StripFact | null;
  tests: StripFact | null;
}>();

const { label, commit, builtOn } = useBuildInfo();

/* The build date and full commit belong in the tooltip, not on the line. */
const buildTitle = computed(() => {
  const parts = [commit.value ? `Commit ${commit.value}` : '', builtOn.value ? `built ${builtOn.value}` : ''];
  return parts.filter(Boolean).join(', ');
});
</script>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  flex-wrap: wrap;
  width: 100%;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.strip-end {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.build {
  font-variant-numeric: tabular-nums;
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-secondary);
  text-decoration: none;
}

.about-link:hover,
.about-link:focus-visible {
  color: var(--ink);
  text-decoration: underline;
}
</style>
