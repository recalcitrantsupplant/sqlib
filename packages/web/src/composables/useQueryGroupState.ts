import { ref, watch } from 'vue';
import type {
  UseQueryGroupStateDeps,
  UseQueryGroupStateResult,
  QueryGroupCreationRequest,
} from './queryGroupTypes';

const normalizeNullableString = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeVersionNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export function useQueryGroupState(deps: UseQueryGroupStateDeps): UseQueryGroupStateResult {
  const {
    graph,
    versions,
    io,
    queryGroupsStore,
    apiClient,
    toast,
    onCreationConsumed,
    resetExecutionState,
    onGroupDeleted,
    onGroupCloned,
    onGroupMoved,
  } = deps;

  const queryGroupState = ref<'new' | 'view' | 'edit'>('view');
  const queryGroupId = ref('');
  const queryGroupName = ref('');
  const queryGroupDescription = ref('');
  const queryGroupLibraryId = ref('');

  const versionComment = versions.versionComment;

  const isSaving = ref(false);
  const isLoading = ref(false);
  const isGraphLoading = ref(false);
  const graphLoadError = ref<string | null>(null);

  const suppressVersionWatch = ref(false);

  const resetGraphAndIo = () => {
    graph.applyGraphState(graph.initialGraphState);
    io.resetDrafts();
  };

  const beginCreate = (request: QueryGroupCreationRequest) => {
    queryGroupState.value = 'new';
    queryGroupName.value = '';
    queryGroupDescription.value = '';
    queryGroupId.value = '';
    queryGroupLibraryId.value = request.libraryId;
    versions.reset();
    versionComment.value = '';
    versions.currentVersionNumberForDisplay.value = null;
    versions.selectedVersionId.value = null;
    versions.selectedVersionNumber.value = null;
    resetGraphAndIo();
    resetExecutionState?.();
    onCreationConsumed?.();
  };

  const loadFromRoute = async (params: { queryGroupId: string; versionNumber?: number | null }) => {
    const { queryGroupId: groupIdParam, versionNumber } = params;
    if (!groupIdParam) {
      return;
    }

    queryGroupState.value = 'view';
    isLoading.value = true;
    isGraphLoading.value = true;
    graphLoadError.value = null;
    resetExecutionState?.();

    try {
      const [groupResult, versionsList] = await Promise.all([
        queryGroupsStore.fetchQueryGroup(groupIdParam),
        queryGroupsStore.loadQueryGroupVersions(groupIdParam),
      ]);

      const { queryGroup } = groupResult;
      queryGroupId.value = queryGroup.id;
      queryGroupName.value = queryGroup.name;
      queryGroupDescription.value = queryGroup.description ?? '';
      queryGroupLibraryId.value = queryGroup.isPartOf ?? '';

      versions.reset();
      // From the entity, not from whichever version happens to load: the route
      // convention below asks "is what is shown the current one", which needs
      // an answer that does not change as the user browses versions.
      versions.setCurrentVersion(queryGroup.currentVersion ?? null);
      await versions.loadVersionList(queryGroupId.value, versionsList);

      let targetVersionId: string | null = null;
      if (versionNumber != null) {
        targetVersionId = versions.findVersionIdByNumber(versionNumber);
        if (!targetVersionId) {
          toast.warning?.(`Version ${versionNumber} not found; showing latest available version.`);
        }
      }
      if (!targetVersionId) {
        targetVersionId = versions.versionOptions.value[0]?.value ?? null;
      }

      if (targetVersionId) {
        suppressVersionWatch.value = true;
        await versions.loadVersionById(queryGroupId.value, targetVersionId);
        versions.setSelectedVersion(targetVersionId);
        suppressVersionWatch.value = false;
      } else {
        resetGraphAndIo();
        versions.reset();
        versionComment.value = '';
      }
    } catch (error: unknown) {
      console.error('[useQueryGroupState] Failed to load query group details', error);
      graphLoadError.value = error instanceof Error ? error.message : 'Failed to load query group';
      toast.error('Failed to load query group');
      resetGraphAndIo();
      versions.reset();
      versionComment.value = '';
    } finally {
      isLoading.value = false;
      isGraphLoading.value = false;
    }
  };

  watch(
    versions.selectedVersionId,
    async (newVersionId, oldVersionId) => {
      if (suppressVersionWatch.value) {
        return;
      }
      if (!newVersionId || newVersionId === oldVersionId || !queryGroupId.value) {
        return;
      }
      if (!versions.versionMetadata.value[newVersionId]) {
        console.warn('[useQueryGroupState] Version metadata missing for', newVersionId);
        return;
      }

      isGraphLoading.value = true;
      try {
        suppressVersionWatch.value = true;
        await versions.loadVersionById(queryGroupId.value, newVersionId);
        suppressVersionWatch.value = false;
      } catch (error) {
        console.error('[useQueryGroupState] Failed to load selected version', error);
        toast.error('Failed to load selected version');
      } finally {
        suppressVersionWatch.value = false;
        isGraphLoading.value = false;
      }
    },
  );

  /**
   * Save the group's identity. There is no dialog behind this any more — the
   * Details tab's Name and Description fields save as you type — so it writes
   * and reports, and has nothing to close.
   */
  const submitMetadata = async (data: { name: string; description: string | null }) => {
    if (!queryGroupId.value) {
      toast.error('Cannot update: No query group ID');
      return;
    }

    const latestIfMatch = queryGroupsStore.concurrency[queryGroupId.value] ?? null;

    queryGroupName.value = data.name;
    queryGroupDescription.value = data.description || '';

    const updatePayload = {
      name: data.name,
      description: data.description,
    };

    try {
      await queryGroupsStore.updateQueryGroup(queryGroupId.value, updatePayload, latestIfMatch ?? undefined);
      toast.success('Query group details updated');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update query group';
      console.error('[useQueryGroupState] Failed to update query group', error);
      toast.error(message);
    }
  };

  /**
   * Write the canvas as the next version.
   *
   * Always the next one. A version used to be overwritable in place, through a
   * confirm dialog that warned the write was partial — it patched the graph and
   * left tuple and IO entities alone, because those are immutable once created.
   * Versions are snapshots now: compatibility between a group and the query
   * versions it composes can only be checked *for a given version*, and a
   * version that can change under a reference makes every such check provisional
   * (design §2.5).
   */
  const saveQueryGroup = async () => {
    if (isSaving.value) {
      return;
    }
    if (!queryGroupName.value.trim()) {
      toast.error('Query group name is required');
      return;
    }
    if (!queryGroupId.value) {
      toast.error('Select or create a query group before saving');
      return;
    }

    const groupId = queryGroupId.value;

    const normalizedComment = normalizeNullableString(versionComment.value);
    versionComment.value = normalizedComment ?? '';

    const persistNewVersion = async () => {
      let payload;
      try {
        payload = io.buildVersionCreatePayload({ versionComment: versionComment.value });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unable to serialize query group';
        toast.error(message);
        return;
      }

      isSaving.value = true;
      try {
        const result = await apiClient.createQueryGroupVersion(groupId, payload);
        const expanded = result.data;
        versions.concurrencyTokens.value[expanded.queryGroupVersion.id] = result.etag ?? null;

        const newVersionNumber = normalizeVersionNumber(expanded.queryGroupVersion.version) ?? 1;

        versions.setCurrentVersion(expanded.queryGroupVersion.id);
        await versions.reloadVersionsAndSelect(groupId, expanded.queryGroupVersion.id);
        queryGroupState.value = 'view';

        toast.success(`Query group version ${newVersionNumber} created`);
      } catch (error: unknown) {
        const err = error as { data?: { error?: unknown } };
        const message =
          (err.data && typeof err.data.error === 'string' && err.data.error) ||
          (error instanceof Error ? error.message : 'Failed to save query group');
        console.error('[useQueryGroupState] Failed to save query group version', error);
        toast.error(message);
      } finally {
        isSaving.value = false;
      }
    };

    await persistNewVersion();
  };

  const saveNewVersion = () => saveQueryGroup();

  /**
   * Delete the group and everything under it. The API cascades versions, nodes,
   * edges and tuples, so this is not recoverable from the UI - the caller is
   * expected to have confirmed first.
   */
  const deleteQueryGroup = async () => {
    if (!queryGroupId.value) {
      toast.error('No query group selected');
      return;
    }
    isSaving.value = true;
    try {
      const deletedId = queryGroupId.value;
      await queryGroupsStore.deleteQueryGroup(deletedId);
      toast.success('Query group deleted');
      resetGraphAndIo();
      resetExecutionState?.();
      queryGroupState.value = 'view';
      queryGroupId.value = '';
      queryGroupName.value = '';
      queryGroupDescription.value = '';
      queryGroupLibraryId.value = '';
      onGroupDeleted?.(deletedId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete query group';
      toast.error(message);
    } finally {
      isSaving.value = false;
    }
  };

  /**
   * Copy the group's metadata and its currently selected version's graph into a new
   * group. There is no clone endpoint, so this is create-then-write-a-version; the
   * graph is taken from what is on screen, which is also what the user is looking at.
   */
  const cloneQueryGroup = async (options: { name?: string; libraryId?: string } = {}) => {
    if (!queryGroupId.value) {
      toast.error('No query group selected');
      return;
    }
    const targetLibrary = options.libraryId ?? queryGroupLibraryId.value;
    if (!targetLibrary) {
      toast.error('Select a library for the copy');
      return;
    }

    isSaving.value = true;
    try {
      const created = await queryGroupsStore.createQueryGroupFromForm({
        name: options.name?.trim() || `${queryGroupName.value} (copy)`,
        description: queryGroupDescription.value || null,
        isPartOf: targetLibrary,
      });

      // Carry the graph across. Without this the copy is an empty group, which is
      // never what "clone" means to someone looking at a populated canvas.
      const payload = io.buildVersionCreatePayload({ versionComment: 'Cloned' });
      await apiClient.createQueryGroupVersion(created.id, payload);

      toast.success('Query group cloned');
      onGroupCloned?.(created.id, targetLibrary);
      return created.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clone query group';
      toast.error(message);
    } finally {
      isSaving.value = false;
    }
  };

  /** Membership is just `isPartOf`; there is no move endpoint. */
  const moveQueryGroup = async (options: { libraryId?: string } = {}) => {
    if (!queryGroupId.value) {
      toast.error('No query group selected');
      return;
    }
    const targetLibrary = options.libraryId;
    if (!targetLibrary) {
      toast.error('Select a destination library');
      return;
    }
    if (targetLibrary === queryGroupLibraryId.value) {
      toast.info?.('Query group is already in that library');
      return;
    }

    isSaving.value = true;
    try {
      await queryGroupsStore.updateQueryGroupFromForm(queryGroupId.value, {
        name: queryGroupName.value,
        description: queryGroupDescription.value || null,
        isPartOf: targetLibrary,
      });
      queryGroupLibraryId.value = targetLibrary;
      toast.success('Query group moved');
      onGroupMoved?.(queryGroupId.value, targetLibrary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move query group';
      toast.error(message);
    } finally {
      isSaving.value = false;
    }
  };

  return {
    queryGroupState,
    queryGroupId,
    queryGroupName,
    queryGroupDescription,
    queryGroupLibraryId,
    versionComment,
    isSaving,
    isLoading,
    isGraphLoading,
    graphLoadError,
    beginCreate,
    loadFromRoute,
    submitMetadata,
    saveQueryGroup,
    saveNewVersion,
    deleteQueryGroup,
    cloneQueryGroup,
    moveQueryGroup,
  };
}
