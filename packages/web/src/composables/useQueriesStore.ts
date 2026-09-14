import { computed, reactive } from 'vue';
import {
  type Query,
  type QueryCreateInput,
  type QueryUpdateInput,
  type QueryVersionExpanded,
  type QueryVersionExpandedWithIriMap,
  type QueryVersionForQueryCreateInput,
  type QueryVersion,
  type QueryVersionPatchInput,
} from '@sparql-query-lib/contracts';
import type { QueryFormInput } from '../types/query.js';
import type { QueryVersionFormInput } from '../types/queryVersion.js';
import { useApiClient } from './useApiClient.js';

type QueryState = {
  items: Query[];
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
  versions: Record<string, QueryVersion[]>;
  versionLoading: Record<string, boolean>;
  versionError: Record<string, string | null>;
};

const state = reactive<QueryState>({
  items: [],
  loading: false,
  error: null,
  concurrency: {},
  versions: {},
  versionLoading: {},
  versionError: {},
});

const extractQueryIdFromVersion = (versionId: string): string => {
  const match = versionId.match(/^(.*):v\d+$/);
  return match ? match[1] : versionId;
};

function deriveIfMatchToken(
  etag: string | null,
  entity: { dateModified?: string | null; dateCreated?: string | null } | null,
): string | null {
  if (etag && typeof etag === 'string' && etag.trim().length > 0) {
    return etag;
  }
  if (!entity) {
    return null;
  }
  return entity.dateModified ?? entity.dateCreated ?? null;
}

function toNullable(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseParentIris(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toFormInput(query: Query): QueryFormInput {
  return {
    name: query.name,
    description: query.description ?? null,
    isPartOf: Array.isArray(query.isPartOf) ? query.isPartOf.join('\n') : '',
    defaultBackend: query.defaultBackend ?? null,
  };
}

function buildCreatePayload(input: QueryFormInput): QueryCreateInput {
  const parents = parseParentIris(input.isPartOf);
  return {
    name: input.name.trim(),
    description: toNullable(input.description),
    defaultBackend: toNullable(input.defaultBackend),
    isPartOf: parents,
  };
}

function buildUpdatePayload(input: QueryFormInput): QueryUpdateInput {
  const parents = parseParentIris(input.isPartOf);
  return {
    name: input.name.trim(),
    description: toNullable(input.description),
    defaultBackend: toNullable(input.defaultBackend),
    isPartOf: parents,
  };
}

export function useQueriesStore() {
  const {
    listQueries,
    getQuery,
    createQuery,
    updateQuery,
    deleteQuery,
    listQueryVersions,
    getQueryVersion,
    createQueryVersion,
    patchQueryVersion,
  } = useApiClient();

  const queries = computed(() => state.items);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadQueries = async () => {
    state.loading = true;
    state.error = null;
    try {
      state.items = await listQueries();
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load queries';
      state.items = [];
    } finally {
      state.loading = false;
    }
  };

  const fetchQuery = async (id: string) => {
    try {
      const result = await getQuery(id);
      state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
      return {
        query: result.data,
        ifMatch: state.concurrency[id],
        form: toFormInput(result.data),
      };
    } catch (error) {
      console.error('[useQueriesStore] fetchQuery error:', {
        queryId: id,
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : typeof error
      });
      throw error;
    }
  };

  const create = async (input: QueryCreateInput) => {
    const result = await createQuery(input);
    state.concurrency[result.data.id] = deriveIfMatchToken(result.etag, result.data);
    await loadQueries();
    return result.data;
  };

  const createFromForm = async (form: QueryFormInput) => {
    const payload = buildCreatePayload(form);
    if (!payload.isPartOf.length) {
      throw new Error('At least one parent IRI is required');
    }
    return create(payload);
  };

  const update = async (id: string, input: QueryUpdateInput, explicitIfMatch?: string | null) => {
    const ifMatch = explicitIfMatch ?? state.concurrency[id] ?? null;
    const result = await updateQuery(id, input, { ifMatch });
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    await loadQueries();
    return result.data;
  };

  const updateFromForm = async (id: string, form: QueryFormInput, explicitIfMatch?: string | null) => {
    const payload = buildUpdatePayload(form);
    if (!payload.isPartOf || !payload.isPartOf.length) {
      throw new Error('At least one parent IRI is required');
    }
    return update(id, payload, explicitIfMatch);
  };

  const remove = async (id: string) => {
    await deleteQuery(id);
    delete state.concurrency[id];
    await loadQueries();
  };

  const getQueryNameByVersionId = (versionId: string): string | null => {
    if (!versionId || typeof versionId !== 'string') {
      return null;
    }
    const queryId = extractQueryIdFromVersion(versionId);
    const query = state.items.find((entry) => entry.id === queryId);
    return query?.name ?? null;
  };

  const getQueryNamesByVersionIds = (versionIds: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {};
    for (const versionId of versionIds) {
      const label = getQueryNameByVersionId(versionId);
      if (label) {
        mapping[versionId] = label;
      }
    }
    return mapping;
  };

  const loadVersions = async (queryId: string) => {
    state.versionLoading[queryId] = true;
    state.versionError[queryId] = null;
    try {
      state.versions[queryId] = await listQueryVersions(queryId);
    } catch (err: unknown) {
      state.versionError[queryId] = err instanceof Error ? err.message : 'Failed to load query versions';
      state.versions[queryId] = [];
    } finally {
      state.versionLoading[queryId] = false;
    }
    return state.versions[queryId];
  };

  const fetchQueryVersion = async (queryId: string, version: number): Promise<QueryVersionExpanded> => {
    const result = await getQueryVersion(queryId, version);
    return result.data;
  };

  const createVersion = async (queryId: string, input: QueryVersionFormInput) => {
    const payload: QueryVersionForQueryCreateInput = {
      queryVersion: {
        queryString: input.queryString.trim(),
        comment: toNullable(input.comment),
        queryType: toNullable(input.queryType),
        defaultBackend: toNullable(input.defaultBackend),
      },
    };
    const result = await createQueryVersion(queryId, payload);
    await loadVersions(queryId);
    return result.data as QueryVersionExpandedWithIriMap;
  };

  /**
   * Annotate a saved version. A version is a snapshot (issue #192): the
   * query text is what a group composing this version was validated against, so
   * changing it means saving a new version, not editing this one.
   */
  const annotateVersion = async (queryId: string, version: number, comment: string | null) => {
    const result = await patchQueryVersion(queryId, version, { comment: toNullable(comment) });
    await loadVersions(queryId);
    return result.data;
  };

  return {
    queries,
    loading,
    error,
    concurrency: state.concurrency,
    versions: state.versions,
    versionLoading: state.versionLoading,
    versionError: state.versionError,
    loadQueries,
    fetchQuery,
    createQuery: create,
    createQueryFromForm: createFromForm,
    updateQuery: update,
    updateQueryFromForm: updateFromForm,
    deleteQuery: remove,
    loadQueryVersions: loadVersions,
    fetchQueryVersion,
    createQueryVersion: createVersion,
    annotateQueryVersion: annotateVersion,
    getQueryNameByVersionId,
    getQueryNamesByVersionIds,
    toFormInput,
    buildCreatePayload,
    buildUpdatePayload,
    parseParentIris,
    toNullable,
  };
}
