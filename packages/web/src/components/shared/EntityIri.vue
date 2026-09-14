<template>
  <div class="entity-iri">
    <span class="name">{{ name }}</span>
    <span class="iri">...{{ last6Id }}</span>
    <button class="copy-button" @click="copyIriToClipboard">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCopyToClipboard } from '../../composables/useCopyToClipboard';

const props = defineProps<{
  name: string;
  iri: string;
}>();

const { copyToClipboard } = useCopyToClipboard();

const last6Id = computed(() => {
  const parts = props.iri.split('/');
  const id = parts[parts.length - 1];
  return id.slice(-6);
});

const copyIriToClipboard = () => {
  copyToClipboard(props.iri, 'Copied IRI to clipboard');
};
</script>

<style scoped>
.entity-iri {
  display: flex;
  align-items: center;
  gap: 4px;
}

.name {
  font-weight: 500;
}

.iri {
  color: var(--ink-muted);
  font-family: monospace;
}

.copy-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius);
}

.copy-button:hover {
  background: var(--surface-sunken);
}
</style>
