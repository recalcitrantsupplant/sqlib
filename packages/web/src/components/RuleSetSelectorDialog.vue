<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="dialog-medium">
      <DialogHeader>
        <DialogTitle>Select Ruleset</DialogTitle>
        <DialogDescription>
          Choose a ruleset version for this execution node
        </DialogDescription>
      </DialogHeader>

      <div class="dialog-body">
        <VersionedEntitySelector
          :items="ruleSets"
          :loading="ruleSetsLoading"
          :error="ruleSetsError || undefined"
          title="RULESETS"
          empty-message="No rulesets available in this library"
          empty-filter-message="No rulesets match the filter"
          filter-placeholder="Filter rulesets..."
          loading-message="Loading rulesets..."
          selection-mode="single"
          radio-group-name="ruleset-selector"
          @update:selection="handleSelectionChange"
        />
      </div>

      <DialogFooter class="dialog-footer">
        <button
          type="button"
          @click="handleCancel"
          class="btn-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="handleSelect"
          class="btn-select"
          :disabled="!selectedRuleSet || !selectedRuleSet.selectedVersionId"
        >
          Select
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import VersionedEntitySelector, { type VersionedEntity, type EntityVersion } from './VersionedEntitySelector.vue';
import { useRuleSetsStore } from '../composables/useRuleSetsStore';
import { useApiClient } from '../composables/useApiClient';
import type { RuleSet, RuleSetVersion } from '@sparql-query-lib/contracts';

interface Props {
  open: boolean;
  libraryId: string;
  currentRuleSetVersionId?: string | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'select': [payload: { ruleSetId: string; ruleSetVersionId: string; ruleSetVersionNumber: number; ruleSetName: string }];
  'cancel': [];
}>();

const ruleSetsStore = useRuleSetsStore();
const apiClient = useApiClient();

const isOpen = ref(props.open);
const ruleSets = ref<VersionedEntity[]>([]);
const ruleSetsLoading = ref(false);
const ruleSetsError = ref<string | null>(null);
const selectedRuleSet = ref<VersionedEntity | null>(null);
const versionsCache = new Map<string, EntityVersion[]>();
const selectedVersionCache = new Map<string, string | null>();

watch(
  () => props.open,
  async (newValue) => {
    isOpen.value = newValue;
    if (newValue) {
      await loadRuleSets();
    }
  },
);

watch(isOpen, (newValue) => {
  if (!newValue) {
    emit('update:open', false);
  }
});

watch(
  () => ruleSetsStore.ruleSets.value,
  () => {
    if (!isOpen.value) return;
    void rebuildRuleSetsFromStore();
  },
  { deep: true },
);

watch(
  () => props.libraryId,
  () => {
    if (!isOpen.value) return;
    versionsCache.clear();
    selectedVersionCache.clear();
    void loadRuleSets();
  },
);

watch(
  selectedRuleSet,
  (entry) => {
    if (entry) {
      selectedVersionCache.set(entry.id, entry.selectedVersionId ?? null);
    }
  },
);

const getLibraryRuleSets = (): RuleSet[] => {
  const allRuleSets = ruleSetsStore.ruleSets.value as RuleSet[];
  return allRuleSets.filter((ruleSet) => {
    const memberships = Array.isArray(ruleSet.isPartOf) ? ruleSet.isPartOf : [ruleSet.isPartOf];
    return memberships.includes(props.libraryId);
  });
};

const getVersionItems = async (ruleSet: RuleSet): Promise<EntityVersion[]> => {
  const cached = versionsCache.get(ruleSet.id);
  if (cached) {
    return cached;
  }
  const versions = await apiClient.listRuleSetVersions(ruleSet.id) as RuleSetVersion[];
  const versionItems = versions
    .map<EntityVersion>((version) => ({
      id: version.id,
      version: version.version,
      isCurrent: version.id === ruleSet.currentVersion,
    }))
    .sort((a, b) => a.version - b.version);
  versionsCache.set(ruleSet.id, versionItems);
  return versionItems;
};

const buildVersionedEntity = async (ruleSet: RuleSet, previousSelection: string | null = null): Promise<VersionedEntity> => {
  try {
    const versionItems = await getVersionItems(ruleSet);
    const cachedSelectedVersion = selectedVersionCache.get(ruleSet.id);
    const assignedVersionId = props.currentRuleSetVersionId &&
      versionItems.some(v => v.id === props.currentRuleSetVersionId)
      ? props.currentRuleSetVersionId
      : null;

    const selectedVersionId =
      cachedSelectedVersion ??
      previousSelection ??
      assignedVersionId ??
      versionItems.find(v => v.isCurrent)?.id ??
      versionItems[0]?.id ??
      null;

    return {
      id: ruleSet.id,
      name: ruleSet.name,
      description: ruleSet.description ?? undefined,
      versions: versionItems,
      selectedVersionId,
      isChecked: Boolean(selectedVersionId && selectedVersionId === props.currentRuleSetVersionId),
    };
  } catch (error) {
    console.error(`[RuleSetSelectorDialog] Failed to load versions for ruleset ${ruleSet.id}:`, error);
    return {
      id: ruleSet.id,
      name: ruleSet.name,
      description: ruleSet.description ?? undefined,
      versions: [],
      selectedVersionId: null,
      isChecked: false,
    };
  }
};

const rebuildRuleSetsFromStore = async () => {
  const libraryRuleSets = getLibraryRuleSets();
  const previousSelectedId = selectedRuleSet.value?.id ?? null;

  if (libraryRuleSets.length === 0) {
    ruleSets.value = [];
    selectedRuleSet.value = null;
    return;
  }

  const previousSelections = new Map<string, string | null>();
  ruleSets.value.forEach(entry => previousSelections.set(entry.id, entry.selectedVersionId ?? null));

  const hydrated = await Promise.all(
    libraryRuleSets.map(ruleSet => buildVersionedEntity(ruleSet, previousSelections.get(ruleSet.id) ?? null)),
  );
  ruleSets.value = hydrated.sort((a, b) => a.name.localeCompare(b.name));

  if (previousSelectedId) {
    selectedRuleSet.value = ruleSets.value.find(entry => entry.id === previousSelectedId) ?? null;
  } else if (!selectedRuleSet.value) {
    const preChecked = ruleSets.value.find(entry => entry.isChecked);
    if (preChecked) {
      selectedRuleSet.value = preChecked;
    }
  }
};

async function loadRuleSets() {
  ruleSetsLoading.value = true;
  ruleSetsError.value = null;
  try {
    await ruleSetsStore.fetchRuleSets();
    await rebuildRuleSetsFromStore();
  } catch (error: any) {
    console.error('[RuleSetSelectorDialog] Failed to load rulesets:', error);
    ruleSetsError.value = error?.message ?? 'Failed to load rulesets';
    ruleSets.value = [];
  } finally {
    ruleSetsLoading.value = false;
  }
}

function handleSelectionChange(selected: VersionedEntity[]) {
  selectedRuleSet.value = selected.length > 0 ? selected[0] : null;
  if (selectedRuleSet.value) {
    selectedVersionCache.set(selectedRuleSet.value.id, selectedRuleSet.value.selectedVersionId ?? null);
  }
}

function handleSelect() {
  if (!selectedRuleSet.value || !selectedRuleSet.value.selectedVersionId) {
    return;
  }
  const versionInfo = selectedRuleSet.value.versions.find(
    version => version.id === selectedRuleSet.value?.selectedVersionId,
  );
  if (!versionInfo) {
    console.warn('[RuleSetSelectorDialog] Selected ruleset missing version metadata', selectedRuleSet.value);
    return;
  }

  emit('select', {
    ruleSetId: selectedRuleSet.value.id,
    ruleSetVersionId: selectedRuleSet.value.selectedVersionId,
    ruleSetVersionNumber: versionInfo.version,
    ruleSetName: selectedRuleSet.value.name,
  });

  isOpen.value = false;
}

function handleCancel() {
  emit('cancel');
  isOpen.value = false;
}
</script>

<style scoped>
.dialog-medium {
  max-width: 600px;
  max-height: 80vh;
}

.dialog-body {
  padding: var(--space-6) var(--space-7);
  overflow-y: auto;
  max-height: 60vh;
}

.dialog-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: var(--space-6) var(--space-7);
  border-top: 1px solid var(--border-default);
}

.btn-cancel,
.btn-select {
  padding: var(--space-4) var(--space-6);
  font-size: var(--text-body-lg);
  font-weight: 500;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel:hover {
  background: var(--surface-subtle);
  border-color: var(--border-hover);
}

.btn-select {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

.btn-select:hover:not(:disabled) {
  background: var(--action-hover);
  border-color: var(--action-active);
}

.btn-select:disabled {
  background: var(--gray-600);
  border-color: var(--border-hover);
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
