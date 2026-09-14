/**
 * The library's argument sets, and the versions under each.
 *
 * Shaped like `useTupleSetsStore` because the entities are shaped alike: a
 * stable pointer carrying identity, immutable versions carrying content. And
 * like that store it takes a library filter rather than filtering after the
 * fact, for the same reason — the list is asked for from more than one screen
 * (the rail, and the switcher's "elsewhere in the library"), so the scoping
 * belongs on the server.
 *
 * Argument sets reached the rail late (see `lib/sections.ts`), so until now the
 * only listing was `GET /queries/:id/argument-sets`, scoped to one callable.
 */
import { computed, reactive } from 'vue';
import { useApiClient } from './useApiClient.js';
import type { ArgumentSetDetail, ArgumentSetVersionDetail } from '../types/argument-sets';

type ArgumentSetsState = {
  argumentSets: ArgumentSetDetail[];
  versionsBySet: Record<string, ArgumentSetVersionDetail[]>;
  loading: boolean;
  error: string | null;
};

const state = reactive<ArgumentSetsState>({
  argumentSets: [],
  versionsBySet: {},
  loading: false,
  error: null,
});

export function useArgumentSetsStore() {
  const apiClient = useApiClient();

  const argumentSets = computed(() => state.argumentSets);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadArgumentSets = async (filter?: { library?: string | null }) => {
    if (!filter?.library) {
      // Library-scoped by construction: an argument set outside a library is
      // addressable by no screen, so an unscoped listing has nothing to show.
      state.argumentSets = [];
      return;
    }
    state.loading = true;
    state.error = null;
    try {
      state.argumentSets = (await apiClient.listLibraryArgumentSets(filter.library)) as ArgumentSetDetail[];
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load argument sets';
      state.argumentSets = [];
    } finally {
      state.loading = false;
    }
  };

  const versionsFor = (setId: string) => computed(() => state.versionsBySet[setId] ?? []);

  const loadVersions = async (setId: string) => {
    const versions = (await apiClient.listArgumentSetVersions(setId)) as ArgumentSetVersionDetail[];
    state.versionsBySet[setId] = versions;
    return versions;
  };

  const getArgumentSet = async (setId: string) => {
    const { data } = await apiClient.getArgumentSet(setId);
    return data as ArgumentSetDetail;
  };

  const createArgumentSet = async (input: Parameters<typeof apiClient.createStandaloneArgumentSet>[0]) => {
    const { data } = await apiClient.createStandaloneArgumentSet(input);
    state.argumentSets = [...state.argumentSets, data as ArgumentSetDetail];
    return data as ArgumentSetDetail;
  };

  const createVersion = async (
    setId: string,
    input: { tupleBindings?: unknown[]; scalarBindings?: unknown[]; graphBindings?: unknown[] },
  ) => {
    const { data } = await apiClient.createArgumentSetVersion(setId, input);
    const version = data as ArgumentSetVersionDetail;
    state.versionsBySet[setId] = [...(state.versionsBySet[setId] ?? []), version];
    // The server repoints the set at the new version; mirroring it keeps a
    // listing's "v3" from lagging a save by one refresh.
    state.argumentSets = state.argumentSets.map(set =>
      set.id === setId ? { ...set, currentVersionId: version.id, currentVersion: version } : set,
    );
    return version;
  };

  const deleteArgumentSet = async (setId: string) => {
    await apiClient.deleteArgumentSet(setId);
    state.argumentSets = state.argumentSets.filter(set => set.id !== setId);
    delete state.versionsBySet[setId];
  };

  return {
    argumentSets,
    loading,
    error,
    loadArgumentSets,
    versionsFor,
    loadVersions,
    getArgumentSet,
    createArgumentSet,
    createVersion,
    deleteArgumentSet,
  };
}
