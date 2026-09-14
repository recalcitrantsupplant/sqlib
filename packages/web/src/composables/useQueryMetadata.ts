import type { Ref } from 'vue';

type QueriesStoreLike = {
  // intentional any: loose DI boundary to the queries store; concrete entity/update
  // types live in the store and are deliberately not coupled here.
  fetchQuery: (id: string) => Promise<{ query: any; ifMatch?: string | null }>;
};

type QueryType = {
  id: string;
  name: string;
  isPartOf: string[];
  description?: string | null;
  defaultBackend?: string | null;
  currentVersion?: string | null;
  comment?: string | null;
  dateCreated?: string | null;
};

type VersionOption = { value: string; label: string; dateModified?: string | null };

export interface UseQueryMetadataDeps {
  queriesStore: QueriesStoreLike;
  queryConcurrency: Ref<string | null>;
  selectedVersionNumber: Ref<number | null>;
  currentVersionNumberForDisplay: Ref<number | null>;
  versionOptions: Ref<VersionOption[]>;
  applyCurrentVersionLocalState: (versionId: string | null) => void;
  hydrateFromQuery: (query: QueryType, options?: { ifMatch?: string | null }) => void;
}

/**
 * What is left of the Edit-details dialog: the two pieces that answer a 412.
 *
 * The dialog itself is gone — name, description, default backend and current
 * version are Details-tab controls that each save on their own — but a write
 * from any of them can still lose a race with another writer, and there is one
 * answer to that rather than one per field.
 */
export function useQueryMetadata(deps: UseQueryMetadataDeps) {
  const isConcurrencyError = (error: unknown): error is { statusCode?: number; data?: Record<string, unknown> } => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      (error as { statusCode?: number }).statusCode === 412
    );
  };

  const refreshQueryConcurrency = async (id: string) => {
    try {
      const previousVersionOptions = [...deps.versionOptions.value];
      const previousSelectedNumber = deps.selectedVersionNumber.value;
      const previousDisplayNumber = deps.currentVersionNumberForDisplay.value;

      const detail = await deps.queriesStore.fetchQuery(id);
      deps.hydrateFromQuery(detail.query, { ifMatch: detail.ifMatch ?? null });

      deps.versionOptions.value = previousVersionOptions;
      deps.selectedVersionNumber.value = previousSelectedNumber;
      deps.currentVersionNumberForDisplay.value = previousDisplayNumber;
      deps.applyCurrentVersionLocalState(detail.query.currentVersion ?? null);

      return detail.ifMatch ?? null;
    } catch (refreshError) {
      console.error('[useQueryMetadata] Failed to refresh query after concurrency conflict:', refreshError);
      return deps.queryConcurrency.value;
    }
  };

  return {
    isConcurrencyError,
    refreshQueryConcurrency,
  };
}
