import { computed, reactive } from 'vue';
import {
  type QueryGroup,
  type QueryGroupCreateInput,
  type QueryGroupUpdateInput,
  type QueryGroupVersion,
  type QueryGroupVersionExpanded,
  type QueryGroupVersionExpandedWithIriMap,
  type QueryGroupVersionForGroupCreateInput,
  type QueryGroupVersionPatchInput,
} from '@sparql-query-lib/contracts';
import type { QueryGroupFormInput } from '../types/queryGroup.js';
import type { QueryGroupVersionFormInput } from '../types/queryGroupVersion.js';
import { useApiClient } from './useApiClient.js';

// Derive the incremental-mutation input shapes from the API client's method
// signatures so they stay in sync with the (module-local) contract types there.
type ApiClient = ReturnType<typeof useApiClient>;

type QueryGroupState = {
  items: QueryGroup[];
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
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

const state = reactive<QueryGroupState>({
  items: [],
  loading: false,
  error: null,
  concurrency: {},
  versions: {},
  versionLoading: {},
  versionError: {},
  iriMaps: {},
});

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
  const {
    listQueryGroups,
    getQueryGroup,
    createQueryGroup,
    updateQueryGroup,
    deleteQueryGroup,
    listQueryGroupVersions,
    getQueryGroupVersion,
    createQueryGroupVersion,
    patchQueryGroupVersion,
    // Incremental mutations
    validateQueryGroupVersion,
  } = useApiClient();

  const queryGroups = computed(() => state.items);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadQueryGroups = async () => {
    state.loading = true;
    state.error = null;
    try {
      state.items = await listQueryGroups();
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load query groups';
      state.items = [];
    } finally {
      state.loading = false;
    }
  };

  const fetchQueryGroup = async (id: string) => {
    const result = await getQueryGroup(id);
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    return {
      queryGroup: result.data,
      ifMatch: state.concurrency[id],
      form: toFormInput(result.data),
    };
  };

  const create = async (input: QueryGroupCreateInput) => {
    const result = await createQueryGroup(input);
    state.concurrency[result.data.id] = deriveIfMatchToken(result.etag, result.data);
    await loadQueryGroups();
    return result.data;
  };

  const createFromForm = async (form: QueryGroupFormInput) => {
    const payload = buildCreatePayload(form);
    if (!payload.isPartOf) {
      throw new Error('Library ID is required');
    }
    return create(payload);
  };

  const update = async (id: string, input: QueryGroupUpdateInput, explicitIfMatch?: string | null) => {
    const ifMatch = explicitIfMatch ?? state.concurrency[id] ?? null;
    const result = await updateQueryGroup(id, input, { ifMatch });
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    await loadQueryGroups();
    return result.data;
  };

  const updateFromForm = async (id: string, form: QueryGroupFormInput, explicitIfMatch?: string | null) => {
    const payload = buildUpdatePayload(form);
    if (!payload.isPartOf) {
      throw new Error('Library ID is required');
    }
    return update(id, payload, explicitIfMatch);
  };

  const remove = async (id: string) => {
    await deleteQueryGroup(id);
    delete state.concurrency[id];
    await loadQueryGroups();
  };

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
    concurrency: state.concurrency,
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
