import { reactive } from 'vue';
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
import { createVersionedEntityStore } from './createVersionedEntityStore';

type QueryVersionState = {
  versions: Record<string, QueryVersion[]>;
  versionLoading: Record<string, boolean>;
  versionError: Record<string, string | null>;
};

const useQueryEntities = createVersionedEntityStore<Query, QueryCreateInput, QueryUpdateInput>({
  noun: 'query',
  nounPlural: 'queries',
  api: () => {
    const client = useApiClient();
    return {
      list: client.listQueries,
      get: client.getQuery,
      create: client.createQuery,
      update: client.updateQuery,
      remove: client.deleteQuery,
    };
  },
});

const state = reactive<QueryVersionState>({
  versions: {},
  versionLoading: {},
  versionError: {},
});

const extractQueryIdFromVersion = (versionId: string): string => {
  const match = versionId.match(/^(.*):v\d+$/);
  return match ? match[1] : versionId;
};

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
  const entities = useQueryEntities();
  const {
    listQueryVersions,
    getQueryVersion,
    createQueryVersion,
    patchQueryVersion,
  } = useApiClient();

  const queries = entities.items;
  const loading = entities.loading;
  const error = entities.error;
  const loadQueries = entities.load;

  const fetchQuery = async (id: string) => {
    const { data, ifMatch } = await entities.fetch(id);
    return { query: data, ifMatch, form: toFormInput(data) };
  };

  const create = entities.create;

  const createFromForm = async (form: QueryFormInput) => {
    const payload = buildCreatePayload(form);
    if (!payload.isPartOf.length) {
      throw new Error('At least one parent IRI is required');
    }
    return create(payload);
  };

  const update = entities.update;

  const updateFromForm = async (id: string, form: QueryFormInput, explicitIfMatch?: string | null) => {
    const payload = buildUpdatePayload(form);
    if (!payload.isPartOf || !payload.isPartOf.length) {
      throw new Error('At least one parent IRI is required');
    }
    return update(id, payload, explicitIfMatch);
  };

  const remove = entities.remove;

  const getQueryNameByVersionId = (versionId: string): string | null => {
    if (!versionId || typeof versionId !== 'string') {
      return null;
    }
    const queryId = extractQueryIdFromVersion(versionId);
    const query = entities.items.value.find((entry) => entry.id === queryId);
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
    concurrency: entities.concurrency,
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
