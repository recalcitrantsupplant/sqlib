<template>
  <div class="template-query-picker" @pointerdown.capture="load" @focusin="load">
    <!--
      Start the SPARQL template from a saved query: a CONSTRUCT query of the
      library, then one of its CONSTRUCT versions. A choice copies that
      version's text into the template, as an ordinary edit. The list loads on
      first use, because it reads the versions of every query in the library.
      The version picker always holds its place, so the row does not shift
      when a query is chosen.
    -->
    <SearchSelect
      class="query-trigger"
      :model-value="queryId"
      :options="queryOptions"
      :placeholder="loading ? 'Loading queries…' : 'Use query…'"
      :disabled="disabled"
      aria-label="Query"
      test-id="etl-template-query"
      @update:model-value="onQueryChange"
    />
    <Select
      :model-value="versionNumber === null ? undefined : String(versionNumber)"
      :disabled="versionDisabled"
      @update:model-value="(value) => onVersionChange(Number(value))"
    >
      <SelectTrigger
        class="version-trigger"
        aria-label="Version"
        data-testid="etl-template-query-version"
        :disabled="versionDisabled"
      >
        <SelectValue placeholder="Version" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="version in versions" :key="version.id" :value="String(version.version)">
          v{{ version.version }}{{ version.isCurrent ? ' (current)' : '' }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { toast } from 'vue-sonner';
import SearchSelect, { type SearchSelectOption } from '../shared/SearchSelect.vue';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useQueriesStore } from '@/composables/useQueriesStore';
import { useQueryAssignmentOptions, type QueryAssignmentOption } from '@/composables/useQueryAssignmentOptions';
import { isConstructType, templateRefusal } from '@/lib/etlTemplateQuery';

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

/**
 * Only CONSTRUCT versions can be a template. A query keeps its CONSTRUCT
 * versions, and a query with none is not offered.
 */
const constructOptions = computed<QueryAssignmentOption[]>(() =>
  options.value
    .map((option) => ({ ...option, versions: option.versions.filter((version) => isConstructType(version.queryType)) }))
    .filter((option) => option.versions.length > 0),
);

const queryOptions = computed<SearchSelectOption[]>(() =>
  constructOptions.value.map((option) => ({ value: option.id, label: option.name })),
);
const selectedOption = computed(() => constructOptions.value.find((option) => option.id === queryId.value) ?? null);
const versions = computed(() => selectedOption.value?.versions ?? []);
const versionDisabled = computed(() => props.disabled || applying.value || versions.value.length === 0);

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
  if (!option) {
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
  gap: var(--grid-gap);
  min-width: 0;
}

/* Every control in a header row stands at --control-h, as the icon buttons beside it do. */
.query-trigger {
  width: var(--grid-5);
}

.query-trigger :deep(.search-select__input) {
  height: var(--control-h);
  font-size: var(--text-body);
}

.version-trigger {
  width: var(--grid-3);
  height: var(--control-h);
  font-size: var(--text-body);
}
</style>
