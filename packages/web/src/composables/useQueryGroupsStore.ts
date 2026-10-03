import { reactive } from 'vue';
import {
  type QueryGroup,
  type QueryGroupCreateInput,
  type QueryGroupUpdateInput,
  type QueryGroupVersion,
  type QueryGroupVersionExpanded,
  type QueryGroupVersionExpandedWithIriMap,
  type QueryGroupVersionForGroupCreateInput,
} from '@sparql-query-lib/contracts';
import type { QueryGroupFormInput } from '../types/queryGroup.js';
import type { QueryGroupVersionFormInput } from '../types/queryGroupVersion.js';
import { useApiClient } from './useApiClient.js';
import { createVersionedEntityStore } from './createVersionedEntityStore';

type QueryGroupState = {
  versions: Record<string, QueryGroupVersion[]>;
  versionLoading: Record<string, boolean>;
  versionError: Record<string, string | null>;
  // IRI mapping for incremental graph building (tracks temporary URNs -> minted IRIs)
  iriMaps: Record<string, Record<string, string>>; // Key: `${groupId}:${version}`
};

type ValidationIssue = {
  level: 'error' | 'warning';
  message: string;
  entityType?: string;
  entityId?: string | null;
  code?: string | null;
};

type ValidationResponse = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues?: ValidationIssue[];
};

const useQueryGroupEntities = createVersionedEntityStore<QueryGroup, QueryGroupCreateInput, QueryGroupUpdateInput>({
  noun: 'query group',
  nounPlural: 'query groups',
  api: () => {
    const client = useApiClient();
    return {
      list: client.listQueryGroups,
      get: client.getQueryGroup,
      create: client.createQueryGroup,
      update: client.updateQueryGroup,
      remove: client.deleteQueryGroup,
    };
  },
});

const state = reactive<QueryGroupState>({
  versions: {},
  versionLoading: {},
  versionError: {},
  iriMaps: {},
});

function toNullable(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFormInput(group: QueryGroup): QueryGroupFormInput {
  return {
    name: group.name,
    description: group.description ?? null,
    isPartOf: group.isPartOf ?? '',
  };
}

function buildCreatePayload(input: QueryGroupFormInput): QueryGroupCreateInput {
  return {
    name: input.name.trim(),
    description: toNullable(input.description),
    // Note: comment is not a field on QueryGroup entity, it's on QueryGroupVersion
    isPartOf: input.isPartOf.trim(),
  };
}

function buildUpdatePayload(input: QueryGroupFormInput): QueryGroupUpdateInput {
  return {
    name: input.name.trim(),
    description: toNullable(input.description),
    // Note: comment is not a field on QueryGroup entity, it's on QueryGroupVersion
    isPartOf: input.isPartOf.trim(),
  };
}

export function useQueryGroupsStore() {
  const entities = useQueryGroupEntities();
  const {
    listQueryGroupVersions,
    getQueryGroupVersion,
    createQueryGroupVersion,
    patchQueryGroupVersion,
    // Incremental mutations
    validateQueryGroupVersion,
  } = useApiClient();

  const queryGroups = entities.items;
  const loading = entities.loading;
  const error = entities.error;
  const loadQueryGroups = entities.load;

  const fetchQueryGroup = async (id: string) => {
    const { data, ifMatch } = await entities.fetch(id);
    return { queryGroup: data, ifMatch, form: toFormInput(data) };
  };

  const create = entities.create;

  const createFromForm = async (form: QueryGroupFormInput) => {
    const payload = buildCreatePayload(form);
    if (!payload.isPartOf) {
      throw new Error('Library ID is required');
    }
    return create(payload);
  };

  const update = entities.update;

  const updateFromForm = async (id: string, form: QueryGroupFormInput, explicitIfMatch?: string | null) => {
    const payload = buildUpdatePayload(form);
    if (!payload.isPartOf) {
      throw new Error('Library ID is required');
    }
    return update(id, payload, explicitIfMatch);
  };

  const remove = entities.remove;

  const loadVersions = async (groupId: string) => {
    state.versionLoading[groupId] = true;
    state.versionError[groupId] = null;
    try {
      state.versions[groupId] = await listQueryGroupVersions(groupId);
    } catch (err: unknown) {
      state.versionError[groupId] = err instanceof Error ? err.message : 'Failed to load query group versions';
      state.versions[groupId] = [];
    } finally {
      state.versionLoading[groupId] = false;
    }
    return state.versions[groupId];
  };

  const fetchQueryGroupVersion = async (groupId: string, version: number): Promise<QueryGroupVersionExpanded> => {
    const result = await getQueryGroupVersion(groupId, version);
    return result.data;
  };

  const createVersion = async (groupId: string, input: QueryGroupVersionFormInput) => {
    const payload: QueryGroupVersionForGroupCreateInput = {
      queryGroupVersion: {
        comment: toNullable(input.comment),
        canvasData: toNullable(input.canvasData),
      },
    };
    const result = await createQueryGroupVersion(groupId, payload);

    // Store iriMap for this version
    const expanded = result.data as QueryGroupVersionExpandedWithIriMap;
    if (expanded.iriMap) {
      const versionId = expanded.queryGroupVersion.version;
      const key = `${groupId}:${versionId}`;
      state.iriMaps[key] = expanded.iriMap;
    }

    await loadVersions(groupId);
    return expanded;
  };

  /**
   * Annotate a saved version. A version is a snapshot (issue #192): the
   * graph, and the layout that ships with it, are what the version *is*.
   * Re-laying-out an old version means saving a new one.
   */
  const annotateVersion = async (groupId: string, version: number, comment: string | null) => {
    const result = await patchQueryGroupVersion(groupId, version, {
      queryGroupVersion: { comment: toNullable(comment) },
    });
    await loadVersions(groupId);
    return result.data;
  };

  // Helper to get/update IRI mapping for a version
  const getIriMap = (groupId: string, version: number | string): Record<string, string> => {
    const key = `${groupId}:${version}`;
    return state.iriMaps[key] || {};
  };

  const updateIriMap = (groupId: string, version: number | string, tempUrn: string, mintedIri: string) => {
    const key = `${groupId}:${version}`;
    if (!state.iriMaps[key]) {
      state.iriMaps[key] = {};
    }
    state.iriMaps[key][tempUrn] = mintedIri;
  };

  const resolveIri = (groupId: string, version: number | string, iriOrUrn: string): string => {
    const iriMap = getIriMap(groupId, version);
    return iriMap[iriOrUrn] || iriOrUrn;
  };

  const validateVersion = async (groupId: string, version: number | string): Promise<ValidationResponse> => {
    return await validateQueryGroupVersion(groupId, version);
  };

  return {
    queryGroups,
    loading,
    error,
    concurrency: entities.concurrency,
    versions: state.versions,
    versionLoading: state.versionLoading,
    versionError: state.versionError,
    iriMaps: state.iriMaps,
    loadQueryGroups,
    fetchQueryGroup,
    createQueryGroup: create,
    createQueryGroupFromForm: createFromForm,
    updateQueryGroup: update,
    updateQueryGroupFromForm: updateFromForm,
    deleteQueryGroup: remove,
    loadQueryGroupVersions: loadVersions,
    fetchQueryGroupVersion,
    createQueryGroupVersion: createVersion,
    annotateQueryGroupVersion: annotateVersion,
    // IRI mapping helpers
    getIriMap,
    updateIriMap,
    resolveIri,
    // Incremental graph building
    validateVersion,
    // Utility functions
    toFormInput,
    buildCreatePayload,
    buildUpdatePayload,
    toNullable,
  };
}
