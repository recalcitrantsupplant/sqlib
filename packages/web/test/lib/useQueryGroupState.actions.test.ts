import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useQueryGroupState } from '../../src/composables/useQueryGroupState';

/**
 * Covers the delete / clone / move actions that were toast stubs. There is no type
 * checking on this package, so these also pin the store and API calls each one makes.
 */

const GROUP_ID = 'urn:sqlib:query-group:1';
const LIBRARY_A = 'urn:sqlib:library:a';
const LIBRARY_B = 'urn:sqlib:library:b';

function makeHarness() {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const queryGroupsStore = {
    deleteQueryGroup: vi.fn().mockResolvedValue(undefined),
    createQueryGroupFromForm: vi.fn().mockResolvedValue({ id: 'urn:sqlib:query-group:copy' }),
    updateQueryGroupFromForm: vi.fn().mockResolvedValue(undefined),
    updateQueryGroup: vi.fn().mockResolvedValue(undefined),
    fetchQueryGroup: vi.fn(),
    loadQueryGroupVersions: vi.fn(),
    concurrency: {},
  };
  const apiClient = { createQueryGroupVersion: vi.fn().mockResolvedValue({}) };
  const io = {
    resetDrafts: vi.fn(),
    buildVersionCreatePayload: vi.fn().mockReturnValue({ queryGroupVersion: {} }),
  };
  const graph = { applyGraphState: vi.fn(), initialGraphState: { nodes: [], edges: [], ioEntities: {}, iriMap: {} } };
  const versions = {
    versionComment: ref(''),
    reset: vi.fn(),
    selectedVersionId: ref<string | null>(null),
    selectedVersionNumber: ref<number | null>(null),
    currentVersionNumberForDisplay: ref<number | null>(null),
    versionMetadata: ref({}),
    versionOptions: ref([]),
    loadVersionList: vi.fn(),
    loadVersionById: vi.fn(),
    setSelectedVersion: vi.fn(),
    findVersionIdByNumber: vi.fn(),
  };

  const onGroupDeleted = vi.fn();
  const onGroupCloned = vi.fn();
  const onGroupMoved = vi.fn();

  const state = useQueryGroupState({
    graph, versions, io, queryGroupsStore, apiClient, toast,
    onGroupDeleted, onGroupCloned, onGroupMoved,
  } as any);

  state.queryGroupId.value = GROUP_ID;
  state.queryGroupName.value = 'Analysis';
  state.queryGroupDescription.value = 'desc';
  state.queryGroupLibraryId.value = LIBRARY_A;

  return { state, toast, queryGroupsStore, apiClient, io, onGroupDeleted, onGroupCloned, onGroupMoved };
}

describe('useQueryGroupState delete/clone/move', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => { h = makeHarness(); });

  it('deletes the group, clears local state and notifies the shell', async () => {
    await h.state.deleteQueryGroup();

    expect(h.queryGroupsStore.deleteQueryGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(h.onGroupDeleted).toHaveBeenCalledWith(GROUP_ID);
    // The pane must not keep pointing at something that no longer exists.
    expect(h.state.queryGroupId.value).toBe('');
    expect(h.state.queryGroupName.value).toBe('');
    expect(h.toast.success).toHaveBeenCalled();
  });

  it('reports a failed delete instead of clearing state', async () => {
    h.queryGroupsStore.deleteQueryGroup.mockRejectedValueOnce(new Error('in use'));

    await h.state.deleteQueryGroup();

    expect(h.toast.error).toHaveBeenCalledWith('in use');
    expect(h.state.queryGroupId.value).toBe(GROUP_ID);
    expect(h.onGroupDeleted).not.toHaveBeenCalled();
  });

  it('clones the metadata and carries the graph into the copy', async () => {
    await h.state.cloneQueryGroup({ name: 'Analysis copy', libraryId: LIBRARY_B });

    expect(h.queryGroupsStore.createQueryGroupFromForm).toHaveBeenCalledWith({
      name: 'Analysis copy', description: 'desc', isPartOf: LIBRARY_B,
    });
    // A copy that drops the graph is not a clone.
    expect(h.io.buildVersionCreatePayload).toHaveBeenCalled();
    expect(h.apiClient.createQueryGroupVersion).toHaveBeenCalledWith('urn:sqlib:query-group:copy', { queryGroupVersion: {} });
    expect(h.onGroupCloned).toHaveBeenCalledWith('urn:sqlib:query-group:copy', LIBRARY_B);
  });

  it('defaults a clone to the current library and a "(copy)" name', async () => {
    await h.state.cloneQueryGroup();

    expect(h.queryGroupsStore.createQueryGroupFromForm).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Analysis (copy)', isPartOf: LIBRARY_A }),
    );
  });

  it('moves the group by rewriting isPartOf', async () => {
    await h.state.moveQueryGroup({ libraryId: LIBRARY_B });

    expect(h.queryGroupsStore.updateQueryGroupFromForm).toHaveBeenCalledWith(GROUP_ID, {
      name: 'Analysis', description: 'desc', isPartOf: LIBRARY_B,
    });
    expect(h.state.queryGroupLibraryId.value).toBe(LIBRARY_B);
    expect(h.onGroupMoved).toHaveBeenCalledWith(GROUP_ID, LIBRARY_B);
  });

  it('does not issue a request when moving to the library it is already in', async () => {
    await h.state.moveQueryGroup({ libraryId: LIBRARY_A });

    expect(h.queryGroupsStore.updateQueryGroupFromForm).not.toHaveBeenCalled();
    expect(h.onGroupMoved).not.toHaveBeenCalled();
  });

  it('refuses to act when no group is loaded', async () => {
    h.state.queryGroupId.value = '';

    await h.state.deleteQueryGroup();
    await h.state.cloneQueryGroup({ libraryId: LIBRARY_B });
    await h.state.moveQueryGroup({ libraryId: LIBRARY_B });

    expect(h.queryGroupsStore.deleteQueryGroup).not.toHaveBeenCalled();
    expect(h.queryGroupsStore.createQueryGroupFromForm).not.toHaveBeenCalled();
    expect(h.queryGroupsStore.updateQueryGroupFromForm).not.toHaveBeenCalled();
  });
});
