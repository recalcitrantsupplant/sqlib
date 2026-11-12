<template>
  <div class="template-query-picker" @pointerdown.capture="load" @focusin="load">
    <!--
      Start the SPARQL template from a saved query: a query of the library, then
      one of its versions. A choice copies that version's text into the
      template, as an ordinary edit. The list loads on first use, because it
      reads the versions of every query in the library.
    -->
    <SearchSelect
      :model-value="queryId"
      :options="queryOptions"
      :placeholder="loading ? 'Loading queries…' : 'Use query…'"
      :disabled="disabled"
      variant="bare"
      aria-label="Query"
      test-id="etl-template-query"
      @update:model-value="onQueryChange"
    />
    <select
      v-if="selectedOption"
      :value="versionNumber ?? ''"
      :disabled="disabled || applying"
      class="version-select"
      aria-label="Version"
      data-testid="etl-template-query-version"
      @change="onVersionChange(Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="version in selectedOption.versions" :key="version.id" :value="version.version">
        v{{ version.version }}{{ version.isCurrent ? ' (current)' : '' }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { toast } from 'vue-sonner';
import SearchSelect, { type SearchSelectOption } from '../shared/SearchSelect.vue';
import { useQueriesStore } from '@/composables/useQueriesStore';
import { useQueryAssignmentOptions } from '@/composables/useQueryAssignmentOptions';
import { templateRefusal } from '@/lib/etlTemplateQuery';

const props = defineProps<{
  /** The library whose queries are offered. */
  libraryId: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  /** The chosen version's text, to become the template. */
  (e: 'use', text: string): void;
}>();

const queriesStore = useQueriesStore();
const { options, loading, ensureLoaded } = useQueryAssignmentOptions(toRef(props, 'libraryId'), queriesStore);

const queryId = ref<string | null>(null);
const versionNumber = ref<number | null>(null);
const applying = ref(false);

const queryOptions = computed<SearchSelectOption[]>(() =>
  options.value.map((option) => ({ value: option.id, label: option.name })),
);
const selectedOption = computed(() => options.value.find((option) => option.id === queryId.value) ?? null);

const load = () => {
  void ensureLoaded();
};

async function apply(id: string, version: number) {
  applying.value = true;
  try {
    const loaded = await queriesStore.fetchQueryVersion(id, version);
    const text = loaded.queryVersion.queryString ?? '';
    const refusal = templateRefusal(text, loaded.queryVersion.queryType ?? null);
    if (refusal) {
      toast.error(refusal);
      return;
    }
    emit('use', text);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not load that query version');
  } finally {
    applying.value = false;
  }
}

function onQueryChange(id: string) {
  queryId.value = id || null;
  const option = selectedOption.value;
  if (!option || option.versions.length === 0) {
    versionNumber.value = null;
    return;
  }
  const current = option.versions.find((version) => version.isCurrent) ?? option.versions[0];
  versionNumber.value = current.version;
  void apply(option.id, current.version);
}

function onVersionChange(version: number) {
  if (!queryId.value || Number.isNaN(version)) return;
  versionNumber.value = version;
  void apply(queryId.value, version);
}
</script>

<style scoped>
.template-query-picker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.template-query-picker :deep(.search-select) {
  max-width: 220px;
}

.version-select {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: var(--text-label);
}
</style>
