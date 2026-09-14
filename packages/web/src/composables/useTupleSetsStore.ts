/**
 * The library's tuple sets, and the versions under each.
 *
 * Shaped like `useDataGraphsStore` because the entities are shaped alike:
 * a stable pointer carrying identity, immutable versions carrying content.
 * Versions are cached per set rather than globally for the same reason — a
 * record page shows one set's history, and the argument switcher wants the
 * current version of each candidate. Nothing needs every version at once.
 *
 * The one addition over the data-graph store is `libraryFilter`: unlike data
 * graphs, tuple sets are listed *from another screen* — the arguments panel
 * asking what else in this library could fill a clause — so the list has to be
 * scopeable to a library on the server rather than filtered after the fact.
 */
import { computed, reactive } from 'vue';
import type { TupleSet } from '@sparql-query-lib/contracts';
import { useApiClient, type TupleSetVersion } from './useApiClient.js';
import type { SuggestedColumnType, TupleSourceFormat } from '../types/tuple-sets';
import type { TupleSetReference } from '../types/argument-sets';

type TupleSetsState = {
  tupleSets: TupleSet[];
  versionsBySet: Record<string, TupleSetVersion[]>;
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
};

const state = reactive<TupleSetsState>({
  tupleSets: [],
  versionsBySet: {},
  loading: false,
  error: null,
  concurrency: {},
});

export function useTupleSetsStore() {
  const apiClient = useApiClient();

  const tupleSets = computed(() => state.tupleSets);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadTupleSets = async (filter?: { library?: string | null }) => {
    state.loading = true;
    state.error = null;
    try {
      state.tupleSets = await apiClient.listTupleSets(filter);
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load tuple sets';
      state.tupleSets = [];
    } finally {
      state.loading = false;
    }
  };

  const versionsFor = (tupleSetId: string) => computed(() => state.versionsBySet[tupleSetId] ?? []);

  const loadVersions = async (tupleSetId: string) => {
    const versions = await apiClient.listTupleSetVersions(tupleSetId);
    state.versionsBySet[tupleSetId] = versions;
    return versions;
  };

  const getTupleSet = async (tupleSetId: string) => {
    const { data, etag } = await apiClient.getTupleSet(tupleSetId);
    state.concurrency[tupleSetId] = etag ?? data.dateModified ?? null;
    return data;
  };

  const createTupleSet = async (input: Parameters<typeof apiClient.createTupleSet>[0]) => {
    const { data } = await apiClient.createTupleSet(input);
    state.tupleSets = [...state.tupleSets, data];
    return data;
  };

  const updateTupleSet = async (
    tupleSetId: string,
    input: Parameters<typeof apiClient.updateTupleSet>[1],
  ) => {
    const { data, etag } = await apiClient.updateTupleSet(tupleSetId, input, {
      ifMatch: state.concurrency[tupleSetId] ?? null,
    });
    state.concurrency[tupleSetId] = etag ?? data.dateModified ?? null;
    state.tupleSets = state.tupleSets.map(set => (set.id === tupleSetId ? data : set));
    return data;
  };

  /**
   * Take a freshly created version into the cache.
   *
   * Shared by every way a version can be made — content posted from here, rows
   * materialized by the server from an ETL job — because what the rest of the
   * app has to believe afterwards is the same in both cases.
   */
  const recordVersion = (tupleSetId: string, version: TupleSetVersion) => {
    const known = state.versionsBySet[tupleSetId] ?? [];
    // Replaced rather than appended when the id is already held. Every other
    // caller hands this a version that has just been created, but an unchanged
    // ETL re-run answers with the *current* version (#211's version churn), and
    // a cache that appended it would list one version twice.
    state.versionsBySet[tupleSetId] = known.some(entry => entry.id === version.id)
      ? known.map(entry => (entry.id === version.id ? version : entry))
      : [...known, version];
    // The server repoints the set at the new version; mirroring it here keeps a
    // listing's "v3" from lagging a save by one refresh.
    state.tupleSets = state.tupleSets.map(set =>
      set.id === tupleSetId ? { ...set, currentVersion: version.id } : set,
    );
    return version;
  };

  /**
   * Write (or clear) a version's note. The content of a version is a snapshot;
   * the comment is the only part of it a later edit may touch.
   */
  const annotateVersion = async (tupleSetId: string, version: number, comment: string | null) => {
    const { data } = await apiClient.annotateTupleSetVersion(tupleSetId, version, comment);
    state.versionsBySet[tupleSetId] = (state.versionsBySet[tupleSetId] ?? []).map(entry =>
      entry.id === data.id ? data : entry,
    );
    return data;
  };

  const createVersion = async (
    tupleSetId: string,
    input: {
      contentString: string;
      sourceFormat: TupleSourceFormat;
      comment?: string | null;
      columnTypes?: Record<string, SuggestedColumnType>;
    },
  ) => {
    const { data } = await apiClient.createTupleSetVersion(tupleSetId, input);
    return recordVersion(tupleSetId, data);
  };

  /**
   * Materialize a version by running an ETL job version's SQL (issue #211).
   *
   * The rows never pass through the browser: the caller names a job version and
   * the server runs it, so this cannot be expressed as `createVersion` with a
   * content string built here.
   *
   * The one call whose answer is not only its body. A run that produced what
   * the current version already holds cuts no version and answers 200 rather
   * than 201 (#211's version churn), and the body is that existing version — so
   * `reused` is the difference between "saved" and "already saved", which the
   * caller has to be able to say. The version is recorded either way: it is the
   * set's current version whichever branch the server took.
   */
  const createVersionFromEtl = async (
    tupleSetId: string,
    input: {
      etlJobVersionId: string;
      columnMappingVersionId?: string | null;
      comment?: string | null;
    },
  ) => {
    const { data, status } = await apiClient.createTupleSetVersionFromEtl(tupleSetId, input);
    return { version: recordVersion(tupleSetId, data), reused: status === 200 };
  };

  const deleteTupleSet = async (tupleSetId: string) => {
    await apiClient.deleteTupleSet(tupleSetId);
    state.tupleSets = state.tupleSets.filter(set => set.id !== tupleSetId);
    delete state.versionsBySet[tupleSetId];
    delete state.concurrency[tupleSetId];
  };

  /**
   * The current version of each set, loaded together.
   *
   * For the argument switcher, which judges every candidate in a library at
   * once: a verdict needs `tupleColumns`, which lives on the version, and the
   * listing only carries the pointer. Sets whose versions fail to load are
   * dropped rather than surfaced — a set with no readable current version is
   * one the switcher cannot judge, and an unjudgeable row is worse than an
   * absent one.
   */
  const loadCurrentVersions = async (sets: TupleSet[]) => {
    const resolved = await Promise.all(
      sets.map(async (set) => {
        if (!set.currentVersion) return null;
        const cached = state.versionsBySet[set.id];
        const known = cached?.find(version => version.id === set.currentVersion);
        if (known) return { set, version: known };
        try {
          const versions = await loadVersions(set.id);
          const version = versions.find(candidate => candidate.id === set.currentVersion)
            ?? versions.at(-1);
          return version ? { set, version } : null;
        } catch {
          return null;
        }
      }),
    );
    return resolved.filter((entry): entry is { set: TupleSet; version: TupleSetVersion } =>
      entry !== null);
  };

  /* ------------------------------------------------ references to a set */

  /** A set already listed, by id. Synchronous: the listing is the cache. */
  const tupleSetById = (tupleSetId: string): TupleSet | null =>
    state.tupleSets.find(set => set.id === tupleSetId) ?? null;

  /**
   * A version already loaded, by IRI, wherever it was loaded from.
   *
   * Versions are cached per set, and a pinned reference names only the version
   * — so this scans. The alternative would be a second index kept in step with
   * the first, for a list that is one library's tuple sets.
   */
  const tupleSetVersionById = (
    versionId: string,
  ): { set: TupleSet | null; version: TupleSetVersion } | null => {
    for (const [setId, versions] of Object.entries(state.versionsBySet)) {
      const version = versions.find(candidate => candidate.id === versionId);
      if (version) return { set: tupleSetById(setId), version };
    }
    return null;
  };

  /** Where a floating reference resolves to right now, or null. */
  const currentVersionIdOf = (tupleSetId: string): string | null =>
    tupleSetById(tupleSetId)?.currentVersion ?? null;

  /**
   * Load enough of the library for every one of these references to be
   * described — its set named, its version's rows readable.
   *
   * A reference attached in this browser names its set, so its versions are one
   * request. A reference read back off a saved argument set names only the
   * pinned *version*, and there is no route from a version IRI to its set:
   * `GET /tuple-sets/:id/versions` is the only listing there is. So the sets
   * are walked until every wanted version has been found, which is the same
   * N+1 `loadCurrentVersions` already pays on the picker, over the same small
   * per-library list, and against the same cache — a second call after the
   * first costs nothing.
   *
   * Best-effort by construction: a set whose versions fail to load leaves its
   * references undescribed rather than failing the panel around them.
   */
  const resolveReferences = async (
    references: TupleSetReference[],
    libraryId?: string | null,
  ): Promise<void> => {
    if (references.length === 0) return;
    if (state.tupleSets.length === 0 && libraryId) {
      await loadTupleSets({ library: libraryId });
    }

    const namedSets = new Set(
      references.map(reference => reference.tupleSetId).filter((id): id is string => !!id),
    );
    for (const setId of namedSets) {
      if (state.versionsBySet[setId]) continue;
      try {
        await loadVersions(setId);
      } catch {
        /* Described as missing rather than fatal — see the doc comment. */
      }
    }

    const wantedVersions = references
      .map(reference => reference.versionId)
      .filter((id): id is string => !!id)
      .filter(id => !tupleSetVersionById(id));
    if (wantedVersions.length === 0) return;

    const outstanding = new Set(wantedVersions);
    for (const set of state.tupleSets) {
      if (outstanding.size === 0) break;
      if (state.versionsBySet[set.id]) continue;
      try {
        for (const version of await loadVersions(set.id)) outstanding.delete(version.id);
      } catch {
        /* As above. */
      }
    }
  };

  return {
    tupleSets,
    loading,
    error,
    loadTupleSets,
    versionsFor,
    loadVersions,
    loadCurrentVersions,
    getTupleSet,
    createTupleSet,
    updateTupleSet,
    createVersion,
    annotateVersion,
    createVersionFromEtl,
    deleteTupleSet,
    tupleSetById,
    tupleSetVersionById,
    currentVersionIdOf,
    resolveReferences,
  };
}
