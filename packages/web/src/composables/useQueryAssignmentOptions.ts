import { ref, watch, type Ref } from 'vue';
import type { Query } from '@sparql-query-lib/contracts';

/**
 * The queries a canvas node can be pointed at, each with its versions.
 *
 * This is what the inspector's query dropdown reads. It exists as its own
 * composable because the list is a *library's* queries rather than a group's,
 * and it has to be loaded (queries, then each query's versions) before the
 * dropdown can offer anything — the modal it replaces did that load on open,
 * which is a thing a dropdown has no equivalent of.
 */
export interface QueryAssignmentVersion {
  id: string;
  version: number;
  isCurrent: boolean;
}

export interface QueryAssignmentOption {
  id: string;
  name: string;
  description?: string | null;
  versions: QueryAssignmentVersion[];
}

interface QueriesStoreLike {
  queries: Ref<Query[]>;
  loadQueries: () => Promise<void>;
  loadQueryVersions: (queryId: string) => Promise<Array<{ id: string; version: number }>>;
}

const belongsTo = (query: Query, libraryId: string): boolean =>
  Array.isArray(query.isPartOf) ? query.isPartOf.includes(libraryId) : query.isPartOf === libraryId;

export function useQueryAssignmentOptions(libraryId: Ref<string>, queriesStore: QueriesStoreLike) {
  const options = ref<QueryAssignmentOption[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** The library the current `options` describe, so a repeat ask is free. */
  let loadedFor: string | null = null;
  let inFlight: Promise<void> | null = null;

  const load = async (targetLibrary: string) => {
    loading.value = true;
    error.value = null;
    try {
      // The store's list is library-agnostic: it is fetched and then filtered
      // here, rather than asked for per library.
      await queriesStore.loadQueries();

      const libraryQueries = queriesStore.queries.value.filter((query) => belongsTo(query, targetLibrary));

      const loaded = await Promise.all(
        libraryQueries.map(async (query): Promise<QueryAssignmentOption> => {
          try {
            const versions = await queriesStore.loadQueryVersions(query.id);
            return {
              id: query.id,
              name: query.name,
              description: query.description ?? null,
              versions: versions
                .map((entry) => ({
                  id: entry.id,
                  version: entry.version,
                  isCurrent: entry.id === query.currentVersion,
                }))
                .sort((a, b) => b.version - a.version),
            };
          } catch (versionError) {
            console.error(`Failed to load versions for query ${query.id}:`, versionError);
            return { id: query.id, name: query.name, description: query.description ?? null, versions: [] };
          }
        }),
      );

      /*
       * A query with no saved version has nothing a node could name, so it is
       * left out — but on the strength of its version list rather than of its
       * `currentVersion` pointer. A query whose pointer is unset (or points at
       * a version the list no longer has) still has versions to assign, and
       * filtering on the pointer dropped those queries from the chooser with
       * no way to tell that from "this library has no queries".
       */
      options.value = loaded
        .filter((option) => option.versions.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
      loadedFor = targetLibrary;
    } catch (loadError) {
      console.error('Failed to load queries for assignment:', loadError);
      error.value = loadError instanceof Error ? loadError.message : 'Failed to load queries';
      options.value = [];
      loadedFor = null;
    } finally {
      loading.value = false;
    }
  };

  /** Load once per library, and share a load already under way. */
  const ensureLoaded = async (): Promise<void> => {
    const targetLibrary = libraryId.value;
    if (!targetLibrary) {
      options.value = [];
      loadedFor = null;
      return;
    }
    if (loadedFor === targetLibrary) return;
    if (inFlight) return inFlight;
    inFlight = load(targetLibrary).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  watch(libraryId, () => {
    loadedFor = null;
    options.value = [];
  });

  return { options, loading, error, ensureLoaded };
}
