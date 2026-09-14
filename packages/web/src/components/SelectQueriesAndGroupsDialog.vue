<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="dialog-large dialog-flex">
      <DialogHeader>
        <DialogTitle>Add Queries and Query Groups</DialogTitle>
        <DialogDescription>Select items from {{ libraryName }} to add to this benchmark plan.</DialogDescription>
      </DialogHeader>

      <div class="dialog-body split">
        <div class="column">
          <VersionedEntitySelector
            :items="queries"
            :loading="queriesLoading"
            :error="queriesError || undefined"
            title="QUERIES"
            empty-message="No queries available in this library"
            empty-filter-message="No queries match the filter"
            filter-placeholder="Filter queries..."
            loading-message="Loading queries..."
            fill-height
            @update:selection="handleQuerySelection"
          />
        </div>

        <div class="column">
          <VersionedEntitySelector
            :items="queryGroups"
            :loading="queryGroupsLoading"
            :error="queryGroupsError || undefined"
            title="QUERY GROUPS"
            empty-message="No query groups available in this library"
            empty-filter-message="No query groups match the filter"
            filter-placeholder="Filter query groups..."
            loading-message="Loading query groups..."
            fill-height
            @update:selection="handleGroupSelection"
          />
        </div>
      </div>

      <DialogFooter class="dialog-footer">
        <button type="button" class="btn-cancel" @click="handleCancel">Cancel</button>
        <button type="button" class="btn-submit" :disabled="!hasSelections" @click="handleSubmit">Add Selected</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import VersionedEntitySelector, { type VersionedEntity } from './VersionedEntitySelector.vue';
import { useQueriesStore } from '../composables/useQueriesStore';
import { useQueryGroupsStore } from '../composables/useQueryGroupsStore';
import type { Query, QueryGroup, QueryVersion, QueryGroupVersion } from '@sparql-query-lib/contracts';

type InitialTarget = {
  entityId: string;
  versionId: string | null;
  type: 'query' | 'queryGroup';
};

const props = defineProps<{
  open: boolean;
  libraryId: string;
  libraryName: string;
  initialTargets?: InitialTarget[];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  submit: [payload: Array<{ type: 'query' | 'queryGroup'; entityId: string; versionId: string | null; name: string; versionNumber: number | null }>];
}>();

const queriesStore = useQueriesStore();
const queryGroupsStore = useQueryGroupsStore();

const isOpen = ref(props.open);
const queries = ref<VersionedEntity[]>([]);
const queryGroups = ref<VersionedEntity[]>([]);
const queriesLoading = ref(false);
const queryGroupsLoading = ref(false);
const queriesError = ref<string | null>(null);
const queryGroupsError = ref<string | null>(null);

watch(() => props.open, async (value) => {
  isOpen.value = value;
  if (value) {
    await loadData();
  }
});

watch(isOpen, (value) => {
  if (!value) {
    emit('update:open', false);
  }
});

const hasSelections = computed(() => {
  return queries.value.some((q) => q.isChecked) || queryGroups.value.some((g) => g.isChecked);
});

async function loadData() {
  queriesLoading.value = true;
  queryGroupsLoading.value = true;
  queriesError.value = null;
  queryGroupsError.value = null;

  try {
    await Promise.all([queriesStore.loadQueries(), queryGroupsStore.loadQueryGroups()]);
    const queryItems = await buildQueryItems();
    const groupItems = await buildGroupItems();
    queries.value = queryItems;
    queryGroups.value = groupItems;
  } catch (err: any) {
    const message = err?.message ?? 'Failed to load data';
    queriesError.value = message;
    queryGroupsError.value = message;
  } finally {
    queriesLoading.value = false;
    queryGroupsLoading.value = false;
  }
}

async function buildQueryItems(): Promise<VersionedEntity[]> {
  const libraryQueries = queriesStore.queries.value.filter((q: Query) => {
    const partOf = Array.isArray(q.isPartOf) ? q.isPartOf : [q.isPartOf];
    return partOf.includes(props.libraryId) && !!q.currentVersion;
  });

  return Promise.all(
    libraryQueries.map(async (query: Query) => {
      let versions: QueryVersion[] = [];
      try {
        versions = await queriesStore.loadQueryVersions(query.id);
      } catch (err) {
        console.error('Failed to load query versions', err);
      }
      const { selectedVersionId, isChecked } = resolveInitialVersion('query', query.id, versions, query.currentVersion ?? null);
      return {
        id: query.id,
        name: query.name,
        description: query.description ?? undefined,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          isCurrent: v.id === query.currentVersion,
        })),
        selectedVersionId,
        isChecked,
      };
    }),
  );
}

async function buildGroupItems(): Promise<VersionedEntity[]> {
  const libraryGroups = queryGroupsStore.queryGroups.value.filter((g: QueryGroup) => {
    const partOf = Array.isArray(g.isPartOf) ? g.isPartOf : [g.isPartOf];
    return partOf.includes(props.libraryId) && !!g.currentVersion;
  });

  return Promise.all(
    libraryGroups.map(async (group: QueryGroup) => {
      let versions: QueryGroupVersion[] = [];
      try {
        versions = await queryGroupsStore.loadQueryGroupVersions(group.id);
      } catch (err) {
        console.error('Failed to load query group versions', err);
      }
      const { selectedVersionId, isChecked } = resolveInitialVersion('queryGroup', group.id, versions, group.currentVersion ?? null);
      return {
        id: group.id,
        name: group.name,
        description: group.description ?? undefined,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          isCurrent: v.id === group.currentVersion,
        })),
        selectedVersionId,
        isChecked,
      };
    }),
  );
}

function resolveInitialVersion(
  type: 'query' | 'queryGroup',
  entityId: string,
  versions: Array<{ id: string; version: number }>,
  currentVersionId: string | null,
): { selectedVersionId: string | null; isChecked: boolean } {
  const match = props.initialTargets?.find((t) => t.entityId === entityId && t.type === type);
  if (match?.versionId) {
    return { selectedVersionId: match.versionId, isChecked: true };
  }
  const fallback = currentVersionId ?? versions[0]?.id ?? null;
  return { selectedVersionId: fallback, isChecked: false };
}

function handleQuerySelection(selected: VersionedEntity[]) {
  queries.value = queries.value.map((item) => ({
    ...item,
    isChecked: selected.some((s) => s.id === item.id),
  }));
}

function handleGroupSelection(selected: VersionedEntity[]) {
  queryGroups.value = queryGroups.value.map((item) => ({
    ...item,
    isChecked: selected.some((s) => s.id === item.id),
  }));
}

function handleCancel() {
  isOpen.value = false;
}

function handleSubmit() {
  const buildPayload = (item: VersionedEntity, type: 'query' | 'queryGroup') => {
    const version = item.versions.find((v) => v.id === item.selectedVersionId) ?? null;
    return {
      type,
      entityId: item.id,
      versionId: item.selectedVersionId,
      name: item.name,
      versionNumber: version?.version ?? null,
    };
  };

  const payload = [
    ...queries.value.filter((q) => q.isChecked && q.selectedVersionId).map((q) => buildPayload(q, 'query')),
    ...queryGroups.value.filter((g) => g.isChecked && g.selectedVersionId).map((g) => buildPayload(g, 'queryGroup')),
  ];

  emit('submit', payload);
  isOpen.value = false;
}
</script>

<style scoped>
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: var(--space-4) var(--space-2) 0 var(--space-2);
  flex: 1;
  min-height: 0;
}

.dialog-body.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.column {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.column :deep(.entity-selector) {
  flex: 1;
  min-height: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: var(--space-4);
  margin-top: auto;
}

.btn-cancel,
.btn-submit {
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-panel);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  cursor: pointer;
  font-weight: 600;
}

.btn-submit {
  background: var(--action-hover);
  border-color: var(--action-hover);
  color: var(--action-fg);
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
