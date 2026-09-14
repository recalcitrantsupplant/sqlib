import { ref } from 'vue';
import type {
  UseQueryGroupVersionsDeps,
  UseQueryGroupVersionsResult,
  VersionMeta,
} from './queryGroupTypes';
import { createGraphStateFromExpanded } from './useQueryGroupGraph';
import type { QueryGroupVersion } from '@sparql-query-lib/contracts';
import type { QueryGroupGraphState } from './useQueryGroupGraph';

const collectQueryVersionIds = (graphState: QueryGroupGraphState) => {
  const ids = new Set<string>();
  for (const node of graphState.nodes) {
    if (node.kind !== 'query' && node.kind !== 'dynamic') {
      continue;
    }
    const versionId = node.queryVersionId ?? node.queryId;
    if (typeof versionId === 'string' && versionId.trim().length > 0) {
      ids.add(versionId);
    }
  }
  return Array.from(ids);
};

const parseQueryVersionId = (versionId: string): { queryId: string; versionNumber: number } | null => {
  if (!versionId || typeof versionId !== 'string') {
    return null;
  }
  const match = versionId.match(/^(.*):v(\d+)$/);
  if (!match) {
    return null;
  }
  const versionNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(versionNumber)) {
    return null;
  }
  return { queryId: match[1], versionNumber };
};

const normalizeVersionNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export function useQueryGroupVersions(deps: UseQueryGroupVersionsDeps): UseQueryGroupVersionsResult {
  const { graph, io, queryGroupsStore, queriesStore, apiClient, toast } = deps;

  const versionOptions = ref<Array<{ value: string; label: string; dateModified?: string | null }>>([]);
  const versionMetadata = ref<Record<string, VersionMeta>>({});
  const concurrencyTokens = ref<Record<string, string | null>>({});
  const selectedVersionId = ref<string | null>(null);
  const selectedVersionNumber = ref<number | null>(null);
  const currentVersionNumberForDisplay = ref<number | null>(null);
  /**
   * Which version the *entity* says is current, as opposed to which one is on
   * screen. The group had no notion of this at all — it tracked only what was
   * selected — which is why its `?version=` could not follow the convention
   * queries use: the check needs a current version to compare against.
   */
  const currentVersionId = ref<string | null>(null);
  const versionComment = ref<string>('');
  /** What the loaded version says this group accepts as LIMIT / OFFSET. */
  const pageParameters = ref<{ limitParameters: string[]; offsetParameters: string[] }>({
    limitParameters: [],
    offsetParameters: [],
  });

  const buildVersionOptionsList = (versions: QueryGroupVersion[]) => {
    const metadata: Record<string, VersionMeta> = {};
    const options: Array<{ value: string; label: string; dateModified?: string | null }> = [];

    for (const entry of versions) {
      const versionNumber = normalizeVersionNumber(entry.version);
      if (!versionNumber || !entry.id) {
        continue;
      }

      const optionValue = entry.id;
      const dateModified = entry.dateModified ?? entry.dateCreated ?? null;
      metadata[optionValue] = {
        id: optionValue,
        version: versionNumber,
        versionNumber,
        dateModified,
        comment: entry.comment ?? null,
      };

      options.push({
        value: optionValue,
        label: `v${versionNumber}`,
        dateModified,
      });
    }

    options.sort((a, b) => {
      const metaA = metadata[a.value]?.version ?? 0;
      const metaB = metadata[b.value]?.version ?? 0;
      return metaB - metaA;
    });

    versionMetadata.value = metadata;
    versionOptions.value = options;
  };

  const findVersionIdByNumber = (versionNumber: number | null): string | null => {
    if (!Number.isFinite(versionNumber ?? NaN)) {
      return null;
    }
    const target = Number(versionNumber);
    for (const [id, meta] of Object.entries(versionMetadata.value)) {
      if (meta.version === target) {
        return id;
      }
    }
    return null;
  };

  const ensureOptionForMeta = (meta: VersionMeta) => {
    const existing = versionOptions.value.find(option => option.value === meta.id);
    if (existing) {
      existing.label = `v${meta.versionNumber}`;
      existing.dateModified = meta.dateModified;
      return;
    }
    versionOptions.value.push({
      value: meta.id,
      label: `v${meta.versionNumber}`,
      dateModified: meta.dateModified,
    });
    versionOptions.value.sort((a, b) => {
      const metaA = versionMetadata.value[a.value]?.version ?? 0;
      const metaB = versionMetadata.value[b.value]?.version ?? 0;
      return metaB - metaA;
    });
  };

  const loadVersionList = async (groupId: string, versions?: QueryGroupVersion[]) => {
    const list = versions ?? await queryGroupsStore.loadQueryGroupVersions(groupId);
    versionMetadata.value = {};
    concurrencyTokens.value = {};
    buildVersionOptionsList(list);
  };

  const loadVersionById = async (groupId: string, versionId: string) => {
    const meta = versionMetadata.value[versionId];
    if (!meta) {
      throw new Error(`Version metadata not found for ${versionId}`);
    }

    const result = await apiClient.getQueryGroupVersion(groupId, meta.version);
    const expanded = result.data;
    concurrencyTokens.value[expanded.queryGroupVersion.id] = result.etag ?? null;

    const normalizedVersion =
      normalizeVersionNumber(expanded.queryGroupVersion.version) ?? meta.version;
    const updatedMeta: VersionMeta = {
      id: expanded.queryGroupVersion.id,
      version: normalizedVersion,
      versionNumber: normalizedVersion,
      dateModified: expanded.queryGroupVersion.dateModified ?? expanded.queryGroupVersion.dateCreated ?? null,
      comment: expanded.queryGroupVersion.comment ?? null,
    };
    versionMetadata.value[expanded.queryGroupVersion.id] = updatedMeta;
    ensureOptionForMeta(updatedMeta);

    selectedVersionId.value = expanded.queryGroupVersion.id;
    selectedVersionNumber.value = normalizedVersion;
    currentVersionNumberForDisplay.value = normalizedVersion;
    versionComment.value = expanded.queryGroupVersion.comment ?? '';
    /*
     * The LIMIT / OFFSET names this group accepts, computed server-side as the
     * union of what its member queries declare. Held here rather than derived
     * on the arguments panel so the fields it offers and the names `/execute`
     * accepts come from one place.
     */
    pageParameters.value = {
      limitParameters: expanded.limitParameters ?? [],
      offsetParameters: expanded.offsetParameters ?? [],
    };

    const graphState = createGraphStateFromExpanded(expanded);
    graph.applyGraphState(graphState);

    const versionIds = collectQueryVersionIds(graphState);
    if (versionIds.length) {
      if (queriesStore.queries.value.length === 0) {
        await queriesStore.loadQueries();
      }
      const mappedNames = queriesStore.getQueryNamesByVersionIds(versionIds);
      const expandedMappings: Record<string, string> = {};
      for (const entry of expanded.queryVersions ?? []) {
        if (!entry?.id || !entry.isPartOf) {
          continue;
        }
        const queryName = queriesStore.queries.value.find((query) => query.id === entry.isPartOf)?.name;
        if (queryName) {
          expandedMappings[entry.id] = queryName;
        }
      }
      graph.mergeIriMap({ ...mappedNames, ...expandedMappings });
    }

    const queryNodes = graph.currentGraphState.value.nodes.filter(
      (node) => node.kind === 'query' || node.kind === 'dynamic',
    );
    const previewRequests = queryNodes
      .map((node) => {
        const versionId = node.queryVersionId ?? node.queryId ?? null;
        if (!versionId) {
          return null;
        }
        const parsed = parseQueryVersionId(versionId);
        if (!parsed) {
          return null;
        }
        return { nodeId: node.id, versionId, ...parsed };
      })
      .filter((entry): entry is { nodeId: string; queryId: string; versionNumber: number; versionId: string } => !!entry);

    if (previewRequests.length) {
      const previews = await Promise.allSettled(
        previewRequests.map((request) =>
          queriesStore.fetchQueryVersion(request.queryId, request.versionNumber)
            .then((queryVersion) => ({ request, queryVersion })),
        ),
      );

      for (const result of previews) {
        if (result.status !== 'fulfilled') {
          console.warn('[useQueryGroupVersions] Failed to load query preview', result.reason);
          continue;
        }
        const { request, queryVersion } = result.value;
        graph.updateGraphNodeState(request.nodeId, (node) => ({
          ...node,
          queryEntityId: request.queryId,
          queryVersionId: request.versionId,
          queryString: queryVersion.queryVersion?.queryString ?? null,
        }));
      }
    }

    io.resetDrafts();
    io.populateFromExpanded(expanded);
  };

  const reloadVersionsAndSelect = async (groupId: string, versionId: string | null, versions?: QueryGroupVersion[]) => {
    await loadVersionList(groupId, versions);

    if (versionId && versionMetadata.value[versionId]) {
      await loadVersionById(groupId, versionId);
      return;
    }

    const fallbackId = versionOptions.value[0]?.value ?? null;
    if (fallbackId) {
      await loadVersionById(groupId, fallbackId);
      return;
    }

    reset();
    graph.applyGraphState(graph.initialGraphState);
    io.resetDrafts();
  };

  /** What the entity reports, from the group record rather than the version. */
  const setCurrentVersion = (versionId: string | null) => {
    currentVersionId.value = versionId;
  };

  const setSelectedVersion = (versionId: string | null) => {
    selectedVersionId.value = versionId;
    if (versionId && versionMetadata.value[versionId]) {
      selectedVersionNumber.value = versionMetadata.value[versionId].versionNumber;
    } else {
      selectedVersionNumber.value = null;
    }
  };

  const reset = () => {
    versionOptions.value = [];
    versionMetadata.value = {};
    concurrencyTokens.value = {};
    selectedVersionId.value = null;
    selectedVersionNumber.value = null;
    currentVersionNumberForDisplay.value = null;
    currentVersionId.value = null;
    versionComment.value = '';
  };

  return {
    pageParameters,
    versionOptions,
    versionMetadata,
    selectedVersionId,
    selectedVersionNumber,
    currentVersionNumberForDisplay,
    currentVersionId,
    versionComment,
    concurrencyTokens,
    loadVersionList,
    loadVersionById,
    reloadVersionsAndSelect,
    findVersionIdByNumber,
    setSelectedVersion,
    setCurrentVersion,
    reset,
  };
}
