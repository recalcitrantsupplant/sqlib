import { markRaw, ref, type Ref } from 'vue';
import { isUpdateQueryType, PATCH_MEDIA_TYPES, type SparqlResults } from '@sparql-query-lib/types';
import type { ExecutionRequest, SparqlRequest } from '@sparql-query-lib/contracts';
import type { QueryExecutionResultPayload, QueryInspectorTab } from '@/types/execution';

type ToastLike = {
  success(message: string): void;
  error(message: string): void;
};

type ApiClientLike = {
  executeTarget: (
    payload: ExecutionRequest,
    accept: string
  ) => Promise<{ body?: string; contentType?: string | null; timing?: QueryExecutionResultPayload['timing'] }>;
  executeSparqlDirect: (
    payload: SparqlRequest,
    accept?: string
  ) => Promise<{ body?: string; contentType?: string | null; timing?: QueryExecutionResultPayload['timing'] }>;
  previewUpdatePatch: (
    payload: { updateString: string; backendId: string }
  ) => Promise<{ body?: string; contentType?: string | null; timing?: QueryExecutionResultPayload['timing'] }>;
};

export interface UseQueryExecutionDeps {
  apiClient: ApiClientLike;
  toast: ToastLike;
  queryId: Ref<string>;
  selectedBackend: Ref<string>;
  selectedMediaType: Ref<string>;
  /**
   * What the editor holds, as an IRI. Only the update forms read it: asking an
   * update for `text/rdf-patch` is asking for the diff, which is derived rather
   * than run, and that is a different call.
   */
  queryType?: Ref<string | null>;
  selectedVersion: Ref<string | null>;
  currentVersion: Ref<string | null>;
  /** A run always takes you to Results; Details is a tab this never selects. */
  activeResultsTab?: Ref<QueryInspectorTab>;
  noneBackendId?: string;
  /** The saved argument-set version to run, or null when running a draft. */
  getSelectedArgumentSetId?: () => string | null;
  /**
   * The draft's values, for when there is no saved version to name.
   * `argumentSetIds` and inline arguments are mutually exclusive server-side,
   * so this is only consulted when the former is absent.
   */
  getInlineArguments?: () => {
    arguments?: unknown[];
    limits?: { name: string; value: number }[];
    offsets?: { name: string; value: number }[];
  } | null;
  /**
   * The values on screen, whatever the run target is — for the ad-hoc path.
   *
   * A draft has no version for the server to name, so a run of it cannot cite
   * an argument set by id; but "run what is in the editor" has to mean the
   * arguments too, or a query with a VALUES input silently runs unconstrained.
   * `POST /sparql` takes the same payload `/execute` does, so the values simply
   * travel with the query text.
   */
  getAdHocArguments?: () => {
    arguments?: unknown[];
    limits?: { name: string; value: number }[];
    offsets?: { name: string; value: number }[];
  } | null;
  isDirty?: Ref<boolean>;
  queryCode?: Ref<string>;
}

export function useQueryExecution(deps: UseQueryExecutionDeps) {
  const executionResult = ref<QueryExecutionResultPayload | null>(null);
  const isExecuting = ref(false);
  const noneBackendId = deps.noneBackendId ?? 'none';

  const resolveTargetId = () => {
    if (
      deps.selectedVersion.value &&
      deps.selectedVersion.value !== deps.currentVersion.value
    ) {
      return deps.selectedVersion.value;
    }
    return deps.queryId.value;
  };

  // Shared validation and setup logic
  const prepareExecution = () => {
    if (!deps.selectedBackend.value || deps.selectedBackend.value === noneBackendId) {
      deps.toast.error('Please select a backend to execute against.');
      console.error('[useQueryExecution] Execution failed: No backend selected');
      return false;
    }

    isExecuting.value = true;
    executionResult.value = null;
    deps.activeResultsTab && (deps.activeResultsTab.value = 'results');
    return true;
  };

  // Parse and structure the execution response
  const parseExecutionResponse = (response: {
    body?: string;
    contentType?: string | null;
    timing?: QueryExecutionResultPayload['timing'];
  }) => {
    let structured: SparqlResults | null = null;

    const contentType = response.contentType ?? 'unknown';
    const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();

    const isJsonContentType = normalizedContentType.includes('json');
    const isCsvTsvContentType =
      normalizedContentType === 'text/csv' ||
      normalizedContentType === 'text/tab-separated-values';
    const isNTriplesNQuadsContentType =
      normalizedContentType === 'application/n-triples' ||
      normalizedContentType === 'application/n-quads';

    if (response.body && response.body.trim().length > 0 && isJsonContentType) {
      try {
        const parsed = JSON.parse(response.body);
        const looksLikeSparql =
          parsed &&
          typeof parsed === 'object' &&
          'head' in parsed &&
          'results' in parsed;

        if (looksLikeSparql && parsed.head && parsed.results) {
          structured = markRaw(parsed as SparqlResults);
        }
      } catch (parseError) {
        console.error('[useQueryExecution] Failed to parse JSON response body:', parseError);
        deps.toast.error('Received JSON response but could not parse it.');
      }
    }

    executionResult.value = {
      structured,
      rawContent: response.body ?? null,
      contentType: response.contentType ?? null,
      timing: response.timing,
      executedAt: new Date().toISOString(),
    };
  };

  /**
   * Whether this run is asking an update for its diff rather than its effect.
   *
   * `text/rdf-patch` is the only output an update query has; picking it is the
   * one thing that turns Run into a preview instead of a write.
   */
  const wantsPatch = (): boolean =>
    deps.selectedMediaType.value === PATCH_MEDIA_TYPES.RDF_PATCH &&
    isUpdateQueryType(deps.queryType?.value ?? null);

  // Execute raw SPARQL (for unsaved queries)
  const executeRawSparql = async () => {
    if (!prepareExecution()) return;

    if (!deps.queryCode?.value || !deps.queryCode.value.trim()) {
      deps.toast.error('Query is empty');
      isExecuting.value = false;
      return;
    }

    try {
      if (wantsPatch()) {
        /*
         * An update's output is the patch it would make, and a draft has no
         * version to name — so the derivation is asked for directly. This runs
         * nothing: the store is left as it was, and applying the diff is a
         * separate, deliberate act.
         */
        const preview = await deps.apiClient.previewUpdatePatch({
          updateString: deps.queryCode.value,
          backendId: deps.selectedBackend.value,
        });
        parseExecutionResponse(preview);
        deps.toast.success('Derived the patch this update would make');
        return;
      }

      const adHocArguments = deps.getAdHocArguments?.() ?? deps.getInlineArguments?.();
      const response = await deps.apiClient.executeSparqlDirect(
        {
          query: deps.queryCode.value,
          backendId: deps.selectedBackend.value,
          ...(adHocArguments ?? {}),
        } as SparqlRequest,
        deps.selectedMediaType.value
      );

      parseExecutionResponse(response);
      deps.toast.success('Query executed successfully (unsaved)');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute query';
      console.error('[useQueryExecution] Raw SPARQL execution failed:', error);
      deps.toast.error(message);
      executionResult.value = null;
    } finally {
      isExecuting.value = false;
    }
  };

  // Execute saved query (with argument sets support)
  const executeSavedQuery = async () => {
    if (!deps.queryId.value) {
      deps.toast.error('Cannot execute: No query ID');
      console.error('[useQueryExecution] executeQuery failed: No query ID');
      return;
    }

    if (!prepareExecution()) return;

    try {
      const payload: Record<string, unknown> = {
        targetId: resolveTargetId(),
        backendId: deps.selectedBackend.value,
      };

      const selectedArgumentSetId = deps.getSelectedArgumentSetId?.();
      if (selectedArgumentSetId) {
        payload.argumentSetIds = [selectedArgumentSetId];
      } else {
        const inline = deps.getInlineArguments?.();
        if (inline) Object.assign(payload, inline);
      }

      const response = await deps.apiClient.executeTarget(payload as ExecutionRequest, deps.selectedMediaType.value);
      parseExecutionResponse(response);
      deps.toast.success('Query executed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute query';
      console.error('[useQueryExecution] Saved query execution failed:', error);
      deps.toast.error(message);
      executionResult.value = null;
    } finally {
      isExecuting.value = false;
    }
  };

  // Main execute function with auto-routing
  const executeQuery = async () => {
    // Auto-detect: if dirty or no current version, use raw SPARQL execution
    if (deps.isDirty?.value || !deps.currentVersion.value) {
      await executeRawSparql();
    } else {
      await executeSavedQuery();
    }
  };

  return {
    executionResult,
    isExecuting,
    executeQuery,
  };
}
