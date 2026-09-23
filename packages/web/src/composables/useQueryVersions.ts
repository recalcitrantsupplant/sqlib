import { computed, ref, watch, type Ref } from 'vue';
import { prefixSourceToken } from '@/lib/prefixSources';
import { usePrefixManager } from '@/composables/usePrefixManager';
import { routeVersionForSelection } from '@/lib/entityLifecycle';
import { DRAFT_SIDE, planVersionDiff, versionDiffLabel } from '@/lib/versionDiff';
import { isQueryTypeIri, type QueryTypeValue } from '@sparql-query-lib/types';

type VersionOption = { value: string; label: string; dateModified?: string | null; comment?: string | null };

type ToastLike = {
  success(message: string): void;
  error(message: string): void;
};

type ApiClientLike = {
  listQueryVersions: (
    queryId: string
  ) => Promise<Array<{ id: string; version: number; dateModified?: string | null }>>;
  getQueryVersion: (
    queryId: string,
    versionNumber: number
  ) => Promise<{
    data: {
      queryVersion: {
        id: string;
        version: number;
        queryString?: string | null;
        comment?: string | null;
        queryType?: string | null;
      };
    };
    etag?: string | null;
  }>;
};

export interface UseQueryVersionsDeps {
  apiClient: ApiClientLike;
  toast: ToastLike;
  queryId: Ref<string>;
  queryCode: Ref<string>;
  versionComment: Ref<string>;
  queryType: Ref<QueryTypeValue | null>;
  queryConcurrency: Ref<string | null>;
  emitVersionNumber?: (version: number | null) => void;
}

export function useQueryVersions(deps: UseQueryVersionsDeps) {
  const currentVersion = ref<string | null>(null); // Which version IRI is set as current
  const selectedVersion = ref<string | null>(null); // Which version IRI to VIEW
  const selectedVersionNumber = ref<number | null>(null); // Numeric version number for API calls
  const currentVersionNumberForDisplay = ref<number | null>(null);
  const versionOptions = ref<VersionOption[]>([]);
  const loadedVersionQueryString = ref<string | null>(null);

  const showDiff = ref(false);
  const diffLeftVersion = ref<string | null>(null);
  const diffRightVersion = ref<string | null>(null);
  const diffLeftQuery = ref<string | null>(null);
  const diffRightQuery = ref<string | null>(null);
  const suppressVersionWatch = ref(false);

  const versionNumberOf = (versionId: string | null): number | null => {
    const option = versionOptions.value.find((v) => v.value === versionId);
    const parsed = option ? parseInt(option.label, 10) : NaN;
    return Number.isNaN(parsed) ? null : parsed;
  };

  const sideLabel = (side: string | null, fallback: string) => {
    if (side === DRAFT_SIDE) return 'Draft';
    const version = versionNumberOf(side);
    return version === null ? fallback : versionDiffLabel(version, currentVersionNumberForDisplay.value);
  };

  const diffLeftLabel = computed(() => sideLabel(diffLeftVersion.value, 'Version A'));
  const diffRightLabel = computed(() => sideLabel(diffRightVersion.value, 'Version B'));

  /** Whether the editor holds edits the open version does not. */
  const hasDraftEdits = computed(
    () => deps.queryCode.value.trim() !== (loadedVersionQueryString.value ?? '').trim(),
  );

  /** What the Diff button compares — see `planVersionDiff`. */
  const diffPlan = computed(() => planVersionDiff({
    hasEdits: hasDraftEdits.value,
    open: selectedVersionNumber.value,
    current: currentVersionNumberForDisplay.value,
    versions: versionOptions.value
      .map((option) => parseInt(option.label, 10))
      .filter((version) => !Number.isNaN(version)),
  }));

  const applyCurrentVersionLocalState = (versionId: string | null) => {
    currentVersion.value = versionId;
    selectedVersion.value = versionId;

    if (!versionId) {
      selectedVersionNumber.value = null;
      currentVersionNumberForDisplay.value = null;
      return;
    }

    const matchedOption = versionOptions.value.find((option) => option.value === versionId);
    if (matchedOption) {
      const parsedVersion = parseInt(matchedOption.label, 10);
      if (!Number.isNaN(parsedVersion)) {
        selectedVersionNumber.value = parsedVersion;
        currentVersionNumberForDisplay.value = parsedVersion;
      }
    }
  };

  const mapVersionsToOptions = (
    versions: Array<{ id: string; version: number; dateModified?: string | null; comment?: string | null }>
  ) =>
    versions
      .map((v) => ({
        value: v.id,
        label: v.version.toString(),
        dateModified: v.dateModified,
        // Carried now that the Details list is the only place a version's
        // comment can be read — the editor's single comment field, which only
        // ever showed the selected version's, is gone.
        comment: v.comment ?? null,
      }))
      .sort((a, b) => parseInt(b.label, 10) - parseInt(a.label, 10));

  /**
   * Take a freshly saved version as the one being shown.
   *
   * This lives here rather than in the caller because the *other* place a
   * version becomes the shown one — the selection watcher below — also has to
   * tell the route about it, and when the two were written apart they drifted:
   * saving set the local refs and told nobody, so the editor showed vN+1
   * while the parent and the URL still said vN, and a reload went back to the
   * old version (design §7.1).
   *
   * The route convention is the watcher's: a version number while a *non-current*
   * version is being viewed, and null once the shown version is the current one
   * — which a save always makes it, so a stale `?version=` is cleared.
   */
  const adoptNewVersion = (version: { id: string; version: number; dateModified?: string | null }) => {
    currentVersion.value = version.id;
    selectedVersion.value = version.id;
    selectedVersionNumber.value = version.version;
    currentVersionNumberForDisplay.value = version.version;

    const label = version.version.toString();
    if (!versionOptions.value.some((option) => option.value === version.id)) {
      versionOptions.value = [
        ...versionOptions.value,
        { value: version.id, label, dateModified: version.dateModified ?? null },
      ].sort((a, b) => parseInt(b.label, 10) - parseInt(a.label, 10));
    }

    deps.emitVersionNumber?.(null);
  };

  const loadVersionOptions = async (queryId: string) => {
    const versions = await deps.apiClient.listQueryVersions(queryId);
    versionOptions.value = mapVersionsToOptions(versions);
    return versions;
  };

  const loadVersionContent = async (queryId: string, versionNumber: number, versionId?: string | null) => {
    const result = await deps.apiClient.getQueryVersion(queryId, versionNumber);
    const version = result.data.queryVersion;

    loadedVersionQueryString.value = version.queryString ?? null;
    if (version.queryString) {
      deps.queryCode.value = version.queryString;
      // Auto-discover prefixes from loaded query. Recorded against the query,
      // not the version: the Prefix Manager links a discovered mapping back to
      // its source, and only the query URN is routable (`?query=`).
      const { autoDiscoverFromSparql } = usePrefixManager();
      autoDiscoverFromSparql(version.queryString, prefixSourceToken('query', queryId));
    }
    if (version.comment !== undefined) {
      deps.versionComment.value = version.comment ?? '';
    }
    if (version.queryType && isQueryTypeIri(version.queryType)) {
      deps.queryType.value = version.queryType;
    }

    selectedVersionNumber.value = version.version;
    selectedVersion.value = versionId ?? version.id;

    if (result.etag) {
      deps.queryConcurrency.value = result.etag;
    }

    return version;
  };

  const loadVersionsForQuery = async (
    queryId: string,
    currentVersionId: string | null,
    options?: { versionOverride?: number | null; onInvalidOverride?: () => void }
  ) => {
    const versions = await loadVersionOptions(queryId);
    const currentVersionFromList = currentVersionId
      ? versions.find((v) => v.id === currentVersionId)
      : null;

    currentVersion.value = currentVersionId;
    currentVersionNumberForDisplay.value = currentVersionFromList ? currentVersionFromList.version : null;
    loadedVersionQueryString.value = null;
    suppressVersionWatch.value = true;
    applyCurrentVersionLocalState(currentVersionId);

    let targetVersion = currentVersionFromList ?? null;

    if (options?.versionOverride != null) {
      const overrideVersion = versions.find((v) => v.version === options.versionOverride);
      if (overrideVersion) {
        targetVersion = overrideVersion;
      } else {
        options.onInvalidOverride?.();
      }
    }

    if (targetVersion) {
      try {
        await loadVersionContent(queryId, targetVersion.version, targetVersion.id);
      } finally {
        suppressVersionWatch.value = false;
      }
    } else {
      selectedVersionNumber.value = null;
      selectedVersion.value = null;
      loadedVersionQueryString.value = null;
      suppressVersionWatch.value = false;
    }

    return { versions, targetVersion };
  };

  const toggleDiff = async () => {
    showDiff.value = !showDiff.value;
    if (!showDiff.value) return;

    const plan = diffPlan.value;
    if (!plan) {
      showDiff.value = false;
      return;
    }
    const sideId = (side: typeof plan.left) =>
      side.draft
        ? DRAFT_SIDE
        : versionOptions.value.find((v) => parseInt(v.label, 10) === side.version)?.value ?? null;
    diffLeftVersion.value = sideId(plan.left);
    diffRightVersion.value = sideId(plan.right);
    await loadDiffVersions();
  };

  /** A side's text: the draft is what is in the editor; a version is fetched. */
  const loadDiffSide = async (side: string | null, which: 'left' | 'right'): Promise<string | null> => {
    if (side === DRAFT_SIDE) return deps.queryCode.value;
    const versionNumber = versionNumberOf(side);
    if (versionNumber === null) return null;
    try {
      const result = await deps.apiClient.getQueryVersion(deps.queryId.value, versionNumber);
      return result.data.queryVersion.queryString || '';
    } catch (error) {
      console.error(`[useQueryVersions] Failed to load ${which} diff version:`, error);
      return '';
    }
  };

  const loadDiffVersions = async () => {
    if (!deps.queryId.value) return;
    const [left, right] = await Promise.all([
      loadDiffSide(diffLeftVersion.value, 'left'),
      loadDiffSide(diffRightVersion.value, 'right'),
    ]);
    if (left !== null) diffLeftQuery.value = left;
    if (right !== null) diffRightQuery.value = right;
  };

  const updateDiffLeftVersion = async (versionId: string) => {
    diffLeftVersion.value = versionId;
    await loadDiffVersions();
  };

  const updateDiffRightVersion = async (versionId: string) => {
    diffRightVersion.value = versionId;
    await loadDiffVersions();
  };

  const swapDiffVersions = async () => {
    const temp = diffLeftVersion.value;
    diffLeftVersion.value = diffRightVersion.value;
    diffRightVersion.value = temp;
    await loadDiffVersions();
  };

  watch(
    () => selectedVersion.value,
    async (newVersionId, oldVersionId) => {
      if (suppressVersionWatch.value) {
        return;
      }

      // If options not yet loaded, skip until list is populated
      if (!versionOptions.value.length) {
        return;
      }

      if (!newVersionId || newVersionId === oldVersionId || !deps.queryId.value) {
        return;
      }

      const versionOption = versionOptions.value.find((opt) => opt.value === newVersionId);
      if (!versionOption) {
        console.error('[useQueryVersions] Selected version not found in version options:', newVersionId);
        deps.toast.error('Selected version not found');
        return;
      }

      const versionNumber = parseInt(versionOption.label, 10);
      if (Number.isNaN(versionNumber)) {
        console.error('[useQueryVersions] Invalid version number:', versionOption.label);
        return;
      }

      try {
        await loadVersionContent(deps.queryId.value, versionNumber, newVersionId);

        // The convention lives in `entityLifecycle`, and both work areas call
        // it rather than restating the comparison — which is how the two ended
        // up disagreeing about what `?version=` means in the first place.
        deps.emitVersionNumber?.(
          routeVersionForSelection(versionNumber, currentVersionNumberForDisplay.value)
        );
      } catch (error) {
        console.error('[useQueryVersions] Failed to load selected version:', error);
        deps.toast.error('Failed to load selected version');
      }
    }
  );

  // Get the currently loaded version's query string (for dirty state comparison)
  const getLoadedVersionQueryString = () => {
    return loadedVersionQueryString.value || null;
  };

  return {
    currentVersion,
    selectedVersion,
    selectedVersionNumber,
    currentVersionNumberForDisplay,
    versionOptions,
    loadedVersionQueryString,
    showDiff,
    diffLeftVersion,
    diffRightVersion,
    diffLeftQuery,
    diffRightQuery,
    diffLeftLabel,
    diffRightLabel,
    hasDraftEdits,
    diffPlan,
    applyCurrentVersionLocalState,
    adoptNewVersion,
    loadVersionsForQuery,
    toggleDiff,
    updateDiffLeftVersion,
    updateDiffRightVersion,
    swapDiffVersions,
    loadDiffVersions,
    getLoadedVersionQueryString,
  };
}
