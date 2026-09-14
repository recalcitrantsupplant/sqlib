import { ref, computed, watch } from 'vue';
import { QueryTypeIri, toQueryTypeIri, type SparqlResults } from '@sparql-query-lib/types';
import type { ExecutionRequest, QueryVersionExpanded } from '@sparql-query-lib/contracts';
import type {
  UseQueryGroupExecutionDeps,
  UseQueryGroupExecutionResult,
  ValidationIssue,
  NodeExecutionDetail,
} from './queryGroupTypes';

/**
 * Recognise the `{ result, nodes, resultContentType }` envelope returned when
 * nodeDetail is requested. A plain SPARQL JSON result also parses, so the
 * discriminator is the `nodes` array rather than merely "is an object" —
 * `resultContentType` is not one, because a server older than it sends none.
 */
function parseNodeDetailEnvelope(
  body: string,
): { result: unknown; nodes: NodeExecutionDetail[]; resultContentType: string | null } | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { result?: unknown; nodes?: unknown; resultContentType?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.nodes) || !('result' in parsed)) return null;
    return {
      result: parsed.result,
      nodes: parsed.nodes as NodeExecutionDetail[],
      resultContentType: typeof parsed.resultContentType === 'string' ? parsed.resultContentType : null,
    };
  } catch {
    return null;
  }
}

export function useQueryGroupExecution(deps: UseQueryGroupExecutionDeps): UseQueryGroupExecutionResult {
  const {
    graph,
    io,
    queryGroupId,
    queryGroupLibraryId,
    selectedVersionId,
    selectedVersionNumber,
    activeResultsTab,
    backendsStore,
    queriesStore,
    librariesStore,
    queryGroupsStore,
    apiClient,
    toast,
    getSelectedArgumentSetId,
    getInlineArguments,
    getDataGraphInputs,
  } = deps;

  const selectedBackendId = ref<string | null>(null);
  const selectedResultFormat = ref<'application/sparql-results+json' | 'application/n-triples'>(
    'application/sparql-results+json',
  );
  const validationIssues = ref<ValidationIssue[]>([]);
  const executionError = ref<string | null>(null);
  const executionResultJson = ref<SparqlResults | null>(null);
  const executionResultRaw = ref<string | null>(null);
  const executionContentType = ref<string | null>(null);
  const isExecuting = ref(false);
  const isValidating = ref(false);
  const nodeExecutions = ref<NodeExecutionDetail[]>([]);
  const failedNodeId = ref<string | null>(null);
  const showBenchmarkDialog = ref(false);

  const availableBackendObjects = computed(() => {
    const items = backendsStore.backends.value ?? [];
    return items.map((backend) => ({
      id: backend.id,
      name: backend.name,
    }));
  });

  const selectedNodeDetail = graph.selectedCanvasDetail;

  /**
   * The kinds that name a query version and read a store to run it against.
   *
   * A patch node is one of them everywhere a backend is concerned: it reads its
   * store to work out what its update would change. Leaving it out is what would
   * make the inspector's backend picker, the run's backend list and the
   * auto-selection below all skip a node that cannot derive anything without one.
   */
  const READS_A_BACKEND = new Set(['query', 'dynamic', 'patch']);

  const selectedNodeQueryId = computed(() => {
    const detail = selectedNodeDetail.value;
    if (!detail || detail.type !== 'node') return null;
    if (!READS_A_BACKEND.has(detail.node.kind)) return null;
    return detail.node.queryId ?? null;
  });

  const queryDefaultBackend = computed(() => {
    const queryId = selectedNodeQueryId.value;
    if (!queryId) return null;
    const query = queriesStore.queries.value.find(q => q.id === queryId);
    return query?.defaultBackend ?? null;
  });

  const libraryDefaultBackend = computed(() => {
    const libraryId = queryGroupLibraryId.value;
    if (!libraryId) return null;
    const library = librariesStore.libraries.value.find(lib => lib.id === libraryId);
    return library?.defaultBackend ?? null;
  });

  const autoSelectedBackend = computed(() => {
    const detail = selectedNodeDetail.value;
    if (!detail || detail.type !== 'node') return null;
    if (!READS_A_BACKEND.has(detail.node.kind)) return null;

    if (detail.node.backendId) return detail.node.backendId;
    if (queryDefaultBackend.value) return queryDefaultBackend.value;
    if (libraryDefaultBackend.value) return libraryDefaultBackend.value;
    return null;
  });

  const requiresBackend = computed(() =>
    graph.currentGraphState.value.nodes.some(node => READS_A_BACKEND.has(node.kind)),
  );

  const availableBackends = computed(() => {
    const ids = new Set<string>();
    for (const node of graph.currentGraphState.value.nodes) {
      if (READS_A_BACKEND.has(node.kind) && node.backendId) {
        ids.add(node.backendId);
      }
    }
    return Array.from(ids);
  });

  watch(
    availableBackends,
    (backends) => {
      if (backends.length === 0) {
        selectedBackendId.value = null;
        return;
      }
      if (!selectedBackendId.value || !backends.includes(selectedBackendId.value)) {
        selectedBackendId.value = backends[0];
      }
    },
    { immediate: true },
  );

  watch(
    [selectedNodeDetail, autoSelectedBackend],
    ([detail, backend]) => {
      if (!detail || detail.type !== 'node') return;
      if (!READS_A_BACKEND.has(detail.node.kind)) return;
      if (!detail.node.backendId && backend) {
        graph.updateNodeBackend(detail.node.id, backend);
      }
    },
    { immediate: false },
  );

  /**
   * Point a node at a query version.
   *
   * Addressed by node id rather than by a pending-dialog ref: the inspector
   * assigns a query from a dropdown on the selected node, so the node is named
   * by the caller and there is no second place holding "the node the dialog is
   * about" to keep in step with the selection.
   */
  const assignQueryToNode = async (
    nodeId: string,
    payload: {
      queryId: string;
      queryVersionId: string;
      queryVersionNumber: number;
      queryName: string;
    },
  ) => {
    const versionId = payload.queryVersionId;
    const queryEntityId = payload.queryId;
    const queryName = payload.queryName;
    const targetNode = graph.currentGraphState.value.nodes.find(node => node.id === nodeId) ?? null;
    const fallbackBackend = targetNode?.backendId ?? selectedBackendId.value ?? null;

    /*
     * A patch node checks before it assigns, where every other node assigns and
     * then loads. It derives the effect of an *update*: pointed at a SELECT
     * there is no effect to derive, and the server refuses the graph outright
     * (`NODE_PATCH_QUERY_NOT_UPDATE`). Assigning first and reporting after would
     * leave the node holding a query it can never run, for the author to undo.
     */
    if (targetNode?.kind === 'patch') {
      let selectedVersion: QueryVersionExpanded;
      try {
        selectedVersion = await queriesStore.fetchQueryVersion(queryEntityId, payload.queryVersionNumber);
      } catch (error) {
        console.error('Failed to load query version metadata for node:', nodeId, error);
        toast.error(
          error instanceof Error ? error.message : 'Could not load this query version, so it was not assigned',
        );
        return;
      }

      if (toQueryTypeIri(selectedVersion.queryVersion?.queryType) !== QueryTypeIri.update) {
        toast.error('A patch node derives what an update would change, so it takes an update query');
        return;
      }

      graph.currentGraphState.value = {
        ...graph.currentGraphState.value,
        iriMap: {
          ...graph.currentGraphState.value.iriMap,
          [versionId]: queryName,
        },
      };
      graph.updateGraphNodeState(nodeId, (node) => ({
        ...node,
        label: queryName,
        queryId: versionId,
        queryVersionId: versionId,
        queryEntityId,
        backendId: node.backendId ?? fallbackBackend,
      }));
      io.ingestQueryVersionDrafts(selectedVersion);
      graph.updateNodeIoFromQueryVersion(nodeId, selectedVersion);

      toast.success('Update assigned to patch node');
      return;
    }

    graph.currentGraphState.value = {
      ...graph.currentGraphState.value,
      iriMap: {
        ...graph.currentGraphState.value.iriMap,
        [versionId]: queryName,
      },
    };

    graph.updateGraphNodeState(nodeId, (node) => ({
      ...node,
      label: queryName,
      queryId: versionId,
      queryVersionId: versionId,
      queryEntityId,
      backendId: node.backendId ?? fallbackBackend,
    }));

    graph.setNodeQueryVersionResolution(nodeId, { status: 'loading' });

    try {
      const selectedVersion = await queriesStore.fetchQueryVersion(queryEntityId, payload.queryVersionNumber);
      io.ingestQueryVersionDrafts(selectedVersion);
      graph.updateNodeIoFromQueryVersion(nodeId, selectedVersion);

      // `defaultBackend` was read off the *version* here, and a QueryVersion has
      // never had one — it is a property of the stable `Query`. The leaf schema
      // declared it anyway, so this typechecked and silently evaluated to null
      // on every path: picking a query version for a node has never adopted
      // that query's default backend. Found when the leaf shapes were projected
      // from the entity model (issue #65), which removed the field that was
      // hiding it.
      //
      // Not restored here on purpose. The stable query is in reach —
      // `queriesStore.queries.value.find(q => q.id === queryEntityId)?.defaultBackend`,
      // the same lookup this file already does above — but making nodes start
      // adopting a backend they never adopted is a product change, not a schema
      // one, and it does not belong in a refactor.
    } catch (error) {
      console.error('Failed to load query version metadata for node:', nodeId, error);
      // The node keeps its query reference: the assignment happened, only the
      // interface is missing. Saying so beats showing it as a query with no I/O.
      graph.setNodeQueryVersionResolution(nodeId, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load this query version.',
      });
      toast.warning?.('Query assigned, but its inputs and outputs could not be loaded');
    }

    toast.success('Query assigned to execution node');
  };

  const runBenchmark = async () => {
    showBenchmarkDialog.value = true;
    toast.info?.('Benchmark functionality coming soon');
  };

  /**
   * Validate without executing. Execution runs this as a pre-flight, but the canvas
   * badges are only useful if you can also ask for them directly - notably while
   * fixing a graph that is not yet runnable.
   */
  const validateQueryGroup = async (options: { silent?: boolean } = {}) => {
    if (!queryGroupId.value || !selectedVersionNumber.value) {
      if (!options.silent) toast.error('Select a query group version before validating');
      return null;
    }

    isValidating.value = true;
    try {
      const validation = await queryGroupsStore.validateVersion(queryGroupId.value, selectedVersionNumber.value);
      validationIssues.value = validation.issues ?? [];
      if (!options.silent) {
        const errors = validationIssues.value.filter((issue) => issue.level === 'error').length;
        const warnings = validationIssues.value.filter((issue) => issue.level === 'warning').length;
        if (errors > 0) toast.error(`Validation found ${errors} error(s)`);
        else if (warnings > 0) toast.warning?.(`Validation passed with ${warnings} warning(s)`);
        else toast.success('Validation passed');
      }
      return validation;
    } catch (error) {
      if (!options.silent) toast.error('Validation request failed');
      return null;
    } finally {
      isValidating.value = false;
    }
  };

  const executeQueryGroup = async () => {
    if (isExecuting.value) {
      return;
    }
    if (!queryGroupId.value) {
      toast.error('No query group selected');
      return;
    }
    if (!selectedVersionNumber.value) {
      toast.error('Select a query group version before executing');
      return;
    }

    isExecuting.value = true;
    executionError.value = null;
    executionResultRaw.value = null;
    executionResultJson.value = null;
    executionContentType.value = null;
    nodeExecutions.value = [];
    failedNodeId.value = null;

    try {
      const validation = await queryGroupsStore.validateVersion(queryGroupId.value, selectedVersionNumber.value);
      validationIssues.value = validation.issues ?? [];

      if (!validation.valid) {
        executionError.value = 'Validation failed. Resolve blocking errors before executing.';
        toast.error(executionError.value);
        return;
      }

      if ((validation.warnings ?? []).length > 0) {
        toast.warning?.('Validation completed with warnings. Review results before relying on them.');
      }

      const targetId = selectedVersionId.value || queryGroupId.value;
      // Query groups don't need backendId - each execution node has its own backend
      const payload: Record<string, unknown> = {
        targetId,
        // Ask for per-node detail so the canvas can show what each node did. The
        // server caps intermediate results, so this stays bounded.
        nodeDetail: 'results',
      };

      // A saved set and inline values are mutually exclusive on the API, and the
      // saved set wins when one is chosen.
      const selectedArgSetId = getSelectedArgumentSetId?.();
      if (selectedArgSetId) {
        payload.argumentSetIds = [selectedArgSetId];
      } else {
        const inline = getInlineArguments?.();
        if (inline) Object.assign(payload, inline);
      }

      // Data graphs are the group's other external input, filled per declared
      // start-node port. They stand beside the arguments rather than replacing
      // them, so this is not part of the choice above.
      const dataGraphs = getDataGraphInputs?.();
      if (dataGraphs && dataGraphs.length > 0) {
        payload.dataGraphs = dataGraphs;
      }

      const response = await apiClient.executeTarget(payload as ExecutionRequest, selectedResultFormat.value);

      executionContentType.value = response.contentType ?? null;
      let body = response.body ?? '';

      // With nodeDetail the response is always a JSON envelope - { result, nodes } -
      // whatever type the final result is. Unwrap before the viewer sees it.
      const envelope = parseNodeDetailEnvelope(body);
      if (envelope) {
        nodeExecutions.value = envelope.nodes;
        body = typeof envelope.result === 'string' ? envelope.result : JSON.stringify(envelope.result);
        /*
         * The response content type describes the envelope, not the result inside
         * it, so the envelope carries the result's own type beside it. Without
         * that a CONSTRUCT group's N-Triples came back as a bare string and this
         * fell through to `selectedResultFormat` — a ref this screen has no
         * control for, so always SPARQL JSON — and the viewer rendered RDF as
         * raw text rather than a triples table. Kept as the fallback for a
         * server that predates the field.
         */
        executionContentType.value = envelope.resultContentType
          ?? (typeof envelope.result === 'string'
            ? selectedResultFormat.value
            : 'application/sparql-results+json');
      } else {
        nodeExecutions.value = [];
      }

      executionResultRaw.value = body.length > 0 ? body : null;

      const contentType = (executionContentType.value ?? '').toLowerCase();
      if (executionResultRaw.value && contentType.includes('json')) {
        try {
          const parsed: unknown = JSON.parse(executionResultRaw.value);
          const parsedShape = parsed as { head?: { vars?: unknown }; results?: { bindings?: unknown } };
          const resemblesSparqlJson =
            !!parsed &&
            typeof parsed === 'object' &&
            'head' in parsed &&
            'results' in parsed &&
            Array.isArray(parsedShape.head?.vars) &&
            Array.isArray(parsedShape.results?.bindings);
          executionResultJson.value = resemblesSparqlJson ? (parsed as SparqlResults) : null;
        } catch (parseError) {
          console.warn('Failed to parse execution response as JSON:', parseError);
          executionResultJson.value = null;
        }
      } else {
        executionResultJson.value = null;
      }

      activeResultsTab.value = 'results';
      toast.success('Query group executed successfully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to execute query group';
      executionError.value = message;
      // A mid-chain failure names the node that broke and carries whatever ran
      // before it. Keep both so the canvas can point at the culprit.
      // useApiClient throws via createError, which puts the parsed response body
      // on `data`.
      const body = (error as { data?: unknown })?.data as
        | { failedNodeId?: unknown; nodes?: unknown }
        | undefined;
      if (typeof body?.failedNodeId === 'string') {
        failedNodeId.value = body.failedNodeId;
      }
      if (Array.isArray(body?.nodes)) {
        nodeExecutions.value = body.nodes as NodeExecutionDetail[];
      }
      toast.error(message);
      console.error('Failed to execute query group:', error);
    } finally {
      isExecuting.value = false;
    }
  };

  return {
    selectedBackendId,
    availableBackends,
    requiresBackend,
    availableBackendObjects,
    validationIssues,
    selectedResultFormat,
    executionError,
    executionResultJson,
    executionResultRaw,
    executionContentType,
    isExecuting,
    isValidating,
    nodeExecutions,
    failedNodeId,
    validateQueryGroup,
    showBenchmarkDialog,
    executeQueryGroup,
    runBenchmark,
    assignQueryToNode,
  };
}
