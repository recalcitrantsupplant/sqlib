<template>
  <div class="template-query-picker" @pointerdown.capture="load" @focusin="load">
    <!--
      Link the SPARQL template to a saved query: a CONSTRUCT query of the
      library, then Latest or one of its CONSTRUCT versions. Latest stores the
      query, so each run uses its current version. A number stores that
      version (pinned). The list loads on first use, because it reads the
      versions of every query in the library. The version picker always holds
      its place, so the row does not shift when a query is chosen.
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
      :model-value="selection ?? undefined"
      :disabled="versionDisabled"
      @update:model-value="(value) => onVersionChange(String(value))"
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
        <SelectItem
          v-if="latestAvailable"
          :value="LATEST"
          data-testid="etl-template-query-latest"
          title="Each run uses the query's current version"
        >
          Latest
        </SelectItem>
        <SelectItem v-for="version in versions" :key="version.id" :value="String(version.version)">
          v{{ version.version }}{{ version.isCurrent ? ' (current)' : '' }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
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
  /**
   * The template's link as stored: a query IRI (Latest), a query version IRI
   * (pinned), or null for a template with its own text.
   */
  modelValue?: string | null;
}>();

const emit = defineEmits<{
  /** The chosen link, and the text it resolves to now. */
  (e: 'use', choice: { reference: string; text: string }): void;
}>();

/** The version select's value for a link that floats to the current version. */
const LATEST = 'latest';

const queriesStore = useQueriesStore();
const { options, loading, ensureLoaded } = useQueryAssignmentOptions(toRef(props, 'libraryId'), queriesStore);

const queryId = ref<string | null>(null);
/** `LATEST`, a version number as a string, or null before a query is chosen. */
const selection = ref<string | null>(null);
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
/** Latest is offered when the query's current version is a CONSTRUCT. */
const latestAvailable = computed(() => versions.value.some((version) => version.isCurrent));

const load = () => {
  void ensureLoaded();
};

/** Show the stored link in the two selects. */
function showLink(reference: string | null | undefined) {
  if (!reference) {
    queryId.value = null;
    selection.value = null;
    return;
  }
  const asQuery = constructOptions.value.find((option) => option.id === reference);
  if (asQuery) {
    queryId.value = asQuery.id;
    selection.value = LATEST;
    return;
  }
  for (const option of constructOptions.value) {
    const version = option.versions.find((entry) => entry.id === reference);
    if (version) {
      queryId.value = option.id;
      selection.value = String(version.version);
      return;
    }
  }
}

// A saved link names a query that only the loaded list can label, so a link
// loads the list without waiting for first use.
watch(
  () => props.modelValue,
  (reference) => {
    if (reference) void ensureLoaded();
    showLink(reference);
  },
  { immediate: true },
);
watch(constructOptions, () => showLink(props.modelValue));

async function apply(id: string, choice: string) {
  const option = constructOptions.value.find((entry) => entry.id === id);
  const target = choice === LATEST
    ? option?.versions.find((version) => version.isCurrent)
    : option?.versions.find((version) => String(version.version) === choice);
  if (!option || !target) return;
  applying.value = true;
  try {
    const loaded = await queriesStore.fetchQueryVersion(id, target.version);
    const text = loaded.queryVersion.queryString ?? '';
    const refusal = templateRefusal(text, loaded.queryVersion.queryType ?? null);
    if (refusal) {
      toast.error(refusal);
      showLink(props.modelValue);
      return;
    }
    emit('use', { reference: choice === LATEST ? option.id : target.id, text });
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
    selection.value = null;
    return;
  }
  // A new link follows the query. A query whose current version is not a
  // CONSTRUCT pins its newest CONSTRUCT version instead.
  selection.value = latestAvailable.value ? LATEST : String(option.versions[0].version);
  void apply(option.id, selection.value);
}

function onVersionChange(choice: string) {
  if (!queryId.value || !choice) return;
  selection.value = choice;
  void apply(queryId.value, choice);
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
