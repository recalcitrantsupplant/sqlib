import { describe, it, expect, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { Node } from '@vue-flow/core';
import { useQueryGroupExecution } from '../../src/composables/useQueryGroupExecution';
import type { GraphNodeState, QueryGroupGraphState } from '../../src/composables/useQueryGroupGraph';
import type { CanvasSelectionDetail } from '../../src/composables/queryGroupTypes';

const GROUP_ID = 'urn:sqlib:query-group:1';
const VERSION_ID = 'urn:sqlib:query-group-version:1';

function makeNode(overrides: Partial<GraphNodeState> = {}): GraphNodeState {
  return {
    id: 'urn:sqlib:node:1',
    kind: 'query',
    label: 'Node',
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

function makeGraphState(nodes: GraphNodeState[] = []): QueryGroupGraphState {
  return {
    version: {} as QueryGroupGraphState['version'],
    nodes,
    edges: [],
    ioEntities: {},
    tupleMembers: {},
    variables: {},
    queryVersionInterfaces: {},
    iriMap: {},
  };
}

const SPARQL_JSON = { head: { vars: ['x'] }, results: { bindings: [] } };

function harness(overrides: Record<string, unknown> = {}) {
  const currentGraphState = ref(makeGraphState());
  const selectedCanvasDetail = ref<CanvasSelectionDetail>(null);
  const graphNodes = ref<Node[]>([]);

  const graph = {
    currentGraphState,
    selectedCanvasDetail,
    nodes: graphNodes,
    selectNode: vi.fn(),
    updateNodeBackend: vi.fn(),
    updateGraphNodeState: vi.fn((nodeId: string, updater: (node: GraphNodeState) => GraphNodeState) => {
      currentGraphState.value = {
        ...currentGraphState.value,
        nodes: currentGraphState.value.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
      };
    }),
    setNodeQueryVersionResolution: vi.fn(),
    updateNodeIoFromQueryVersion: vi.fn(),
  };

  const io = {
    ingestQueryVersionDrafts: vi.fn(),
  };

  const backendsStore = { backends: ref<Array<{ id: string; name: string }>>([]) };
  const queriesStore = {
    queries: ref<Array<{ id: string; defaultBackend?: string | null }>>([]),
    fetchQueryVersion: vi.fn().mockResolvedValue({ id: 'urn:sqlib:query-version:1' }),
  };
  const librariesStore = { libraries: ref<Array<{ id: string; defaultBackend?: string | null }>>([]) };
  const queryGroupsStore = {
    validateVersion: vi.fn().mockResolvedValue({ valid: true, issues: [], warnings: [] }),
  };
  const apiClient = {
    executeTarget: vi.fn().mockResolvedValue({
      body: JSON.stringify(SPARQL_JSON),
      contentType: 'application/sparql-results+json',
    }),
  };
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };

  const deps = {
    graph,
    io,
    queryGroupId: ref(GROUP_ID),
    queryGroupLibraryId: ref('urn:sqlib:library:1'),
    selectedVersionId: ref<string | null>(VERSION_ID),
    selectedVersionNumber: ref<number | null>(1),
    activeResultsTab: ref('io'),
    backendsStore,
    queriesStore,
    librariesStore,
    queryGroupsStore,
    apiClient,
    toast,
    getSelectedArgumentSetId: () => null,
    getInlineArguments: () => null,
    getDataGraphInputs: () => null,
    ...overrides,
  };

  const execution = useQueryGroupExecution(deps as Parameters<typeof useQueryGroupExecution>[0]);
  return {
    execution,
    graph,
    io,
    currentGraphState,
    selectedCanvasDetail,
    graphNodes,
    backendsStore,
    queriesStore,
    librariesStore,
    queryGroupsStore,
    apiClient,
    toast,
    deps,
  };
}

describe('useQueryGroupExecution', () => {
  describe('backend selection', () => {
    it('requires a backend only when a query or dynamic node is present', () => {
      const { execution, currentGraphState } = harness();
      expect(execution.requiresBackend.value).toBe(false);

      currentGraphState.value = makeGraphState([makeNode({ kind: 'start', outputs: [] })]);
      expect(execution.requiresBackend.value).toBe(false);

      currentGraphState.value = makeGraphState([makeNode({ kind: 'query' })]);
      expect(execution.requiresBackend.value).toBe(true);
    });

    it('auto-selects the only backend referenced by the graph', async () => {
      const { execution, currentGraphState } = harness();
      currentGraphState.value = makeGraphState([makeNode({ backendId: 'urn:sqlib:backend:1' })]);
      await nextTick();

      expect(execution.availableBackends.value).toEqual(['urn:sqlib:backend:1']);
      expect(execution.selectedBackendId.value).toBe('urn:sqlib:backend:1');
    });

    it('switches away from a selection that no longer exists in the graph', async () => {
      const { execution, currentGraphState } = harness();
      currentGraphState.value = makeGraphState([makeNode({ backendId: 'urn:sqlib:backend:1' })]);
      await nextTick();
      expect(execution.selectedBackendId.value).toBe('urn:sqlib:backend:1');

      currentGraphState.value = makeGraphState([makeNode({ backendId: 'urn:sqlib:backend:2' })]);
      await nextTick();
      expect(execution.selectedBackendId.value).toBe('urn:sqlib:backend:2');
    });

    it('falls back to null once no node names a backend', async () => {
      const { execution, currentGraphState } = harness();
      currentGraphState.value = makeGraphState([makeNode({ backendId: 'urn:sqlib:backend:1' })]);
      await nextTick();

      currentGraphState.value = makeGraphState([makeNode({ backendId: null })]);
      await nextTick();
      expect(execution.selectedBackendId.value).toBeNull();
    });
  });

  describe('assigning a backend to the selected node', () => {
    it('adopts the node backend when already set, without calling updateNodeBackend', async () => {
      const { graph, selectedCanvasDetail } = harness();
      const node = makeNode({ backendId: 'urn:sqlib:backend:existing' });
      selectedCanvasDetail.value = { type: 'node', node };
      await nextTick();

      expect(graph.updateNodeBackend).not.toHaveBeenCalled();
    });

    it('falls back to the query default backend when the node has none', async () => {
      const { graph, selectedCanvasDetail, queriesStore } = harness();
      queriesStore.queries.value = [{ id: 'urn:sqlib:query:1', defaultBackend: 'urn:sqlib:backend:query-default' }];
      const node = makeNode({ queryId: 'urn:sqlib:query:1' });
      selectedCanvasDetail.value = { type: 'node', node };
      await nextTick();

      expect(graph.updateNodeBackend).toHaveBeenCalledWith(node.id, 'urn:sqlib:backend:query-default');
    });

    it('falls back to the library default backend when neither the node nor its query has one', async () => {
      const { graph, selectedCanvasDetail, librariesStore } = harness();
      librariesStore.libraries.value = [{ id: 'urn:sqlib:library:1', defaultBackend: 'urn:sqlib:backend:lib-default' }];
      const node = makeNode();
      selectedCanvasDetail.value = { type: 'node', node };
      await nextTick();

      expect(graph.updateNodeBackend).toHaveBeenCalledWith(node.id, 'urn:sqlib:backend:lib-default');
    });

    it('leaves a ruleset node alone, since it has no backend concept', async () => {
      const { graph, selectedCanvasDetail } = harness();
      const node = makeNode({ kind: 'ruleset' });
      selectedCanvasDetail.value = { type: 'node', node };
      await nextTick();

      expect(graph.updateNodeBackend).not.toHaveBeenCalled();
    });
  });

  describe('assignQueryToNode', () => {
    const payload = {
      queryId: 'urn:sqlib:query:1',
      queryVersionId: 'urn:sqlib:query-version:1',
      queryVersionNumber: 1,
      queryName: 'Cities',
    };

    it('wires the node to the query version and hydrates its I/O', async () => {
      const { execution, graph, io, queriesStore, currentGraphState } = harness();
      currentGraphState.value = makeGraphState([makeNode({ id: 'urn:sqlib:node:1' })]);

      const expandedVersion = { id: 'urn:sqlib:query-version:1' };
      queriesStore.fetchQueryVersion.mockResolvedValueOnce(expandedVersion);

      await execution.assignQueryToNode('urn:sqlib:node:1', payload);

      expect(graph.setNodeQueryVersionResolution).toHaveBeenCalledWith('urn:sqlib:node:1', { status: 'loading' });
      expect(queriesStore.fetchQueryVersion).toHaveBeenCalledWith('urn:sqlib:query:1', 1);
      expect(io.ingestQueryVersionDrafts).toHaveBeenCalledWith(expandedVersion);
      expect(graph.updateNodeIoFromQueryVersion).toHaveBeenCalledWith('urn:sqlib:node:1', expandedVersion);
      expect(currentGraphState.value.nodes[0]).toMatchObject({
        label: 'Cities',
        queryId: 'urn:sqlib:query-version:1',
        queryVersionId: 'urn:sqlib:query-version:1',
        queryEntityId: 'urn:sqlib:query:1',
      });
      expect(currentGraphState.value.iriMap['urn:sqlib:query-version:1']).toBe('Cities');
    });

    it('keeps the query assignment but reports an error when the version fails to load', async () => {
      const { execution, graph, queriesStore, currentGraphState, toast } = harness();
      currentGraphState.value = makeGraphState([makeNode({ id: 'urn:sqlib:node:1' })]);

      queriesStore.fetchQueryVersion.mockRejectedValueOnce(new Error('network down'));

      await execution.assignQueryToNode('urn:sqlib:node:1', payload);

      expect(graph.setNodeQueryVersionResolution).toHaveBeenCalledWith('urn:sqlib:node:1', {
        status: 'error',
        message: 'network down',
      });
      expect(toast.warning).toHaveBeenCalled();
      // The assignment itself still happened, so this still fires.
      expect(toast.success).toHaveBeenCalledWith('Query assigned to execution node');
      expect(currentGraphState.value.nodes[0].queryId).toBe('urn:sqlib:query-version:1');
    });
  });

  describe('validateQueryGroup', () => {
    it('refuses without a selected version, and does not call the store', async () => {
      const { execution, queryGroupsStore, toast } = harness({ selectedVersionNumber: ref(null) });

      const result = await execution.validateQueryGroup();

      expect(result).toBeNull();
      expect(queryGroupsStore.validateVersion).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it('stays quiet in silent mode even when there is nothing to validate', async () => {
      const { execution, toast } = harness({ selectedVersionNumber: ref(null) });

      await execution.validateQueryGroup({ silent: true });

      expect(toast.error).not.toHaveBeenCalled();
    });

    it('reports errors when validation finds blocking issues', async () => {
      const { execution, queryGroupsStore, toast } = harness();
      queryGroupsStore.validateVersion.mockResolvedValueOnce({
        valid: false,
        issues: [{ level: 'error', message: 'bad' }],
      });

      const result = await execution.validateQueryGroup();

      expect(result?.valid).toBe(false);
      expect(execution.validationIssues.value).toHaveLength(1);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('1 error'));
    });

    it('reports warnings only when there are no errors', async () => {
      const { execution, queryGroupsStore, toast } = harness();
      queryGroupsStore.validateVersion.mockResolvedValueOnce({
        valid: true,
        issues: [{ level: 'warning', message: 'careful' }],
      });

      await execution.validateQueryGroup();

      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('1 warning'));
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('reports success when there are no issues at all', async () => {
      const { execution, toast } = harness();

      await execution.validateQueryGroup();

      expect(toast.success).toHaveBeenCalledWith('Validation passed');
    });

    it('surfaces a request failure without throwing, and clears isValidating', async () => {
      const { execution, queryGroupsStore, toast } = harness();
      queryGroupsStore.validateVersion.mockRejectedValueOnce(new Error('boom'));

      const result = await execution.validateQueryGroup();

      expect(result).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Validation request failed');
      expect(execution.isValidating.value).toBe(false);
    });
  });

  describe('executeQueryGroup', () => {
    it('is a no-op while a run is already in flight', async () => {
      const { execution, apiClient } = harness();
      execution.isExecuting.value = true;

      await execution.executeQueryGroup();

      expect(apiClient.executeTarget).not.toHaveBeenCalled();
    });

    it('refuses without a query group', async () => {
      const { execution, apiClient, toast } = harness({ queryGroupId: ref('') });

      await execution.executeQueryGroup();

      expect(apiClient.executeTarget).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('No query group selected');
    });

    it('refuses without a selected version', async () => {
      const { execution, apiClient, toast } = harness({ selectedVersionNumber: ref(null) });

      await execution.executeQueryGroup();

      expect(apiClient.executeTarget).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Select a query group version before executing');
    });

    it('stops before executing when validation fails', async () => {
      const { execution, queryGroupsStore, apiClient, toast } = harness();
      queryGroupsStore.validateVersion.mockResolvedValueOnce({
        valid: false,
        issues: [{ level: 'error', message: 'bad' }],
      });

      await execution.executeQueryGroup();

      expect(apiClient.executeTarget).not.toHaveBeenCalled();
      expect(execution.executionError.value).toContain('Validation failed');
      expect(toast.error).toHaveBeenCalledWith(execution.executionError.value);
    });

    it('warns but still runs when validation passes with warnings', async () => {
      const { execution, queryGroupsStore, apiClient, toast } = harness();
      queryGroupsStore.validateVersion.mockResolvedValueOnce({
        valid: true,
        issues: [],
        warnings: ['heads up'],
      });

      await execution.executeQueryGroup();

      expect(toast.warning).toHaveBeenCalled();
      expect(apiClient.executeTarget).toHaveBeenCalled();
    });

    it('targets the selected version, and falls back to the group id without one', async () => {
      const { execution, apiClient } = harness({ selectedVersionId: ref(null) });

      await execution.executeQueryGroup();

      expect(apiClient.executeTarget).toHaveBeenCalledWith(
        expect.objectContaining({ targetId: GROUP_ID, nodeDetail: 'results' }),
        'application/sparql-results+json',
      );
    });

    it('prefers a saved argument set over inline arguments', async () => {
      const inline = { arguments: [{ head: { vars: [] }, arguments: { bindings: [] } }] };
      const getInlineArguments = vi.fn().mockReturnValue(inline);
      const { execution, apiClient } = harness({
        getSelectedArgumentSetId: () => 'urn:sqlib:argument-set-version:1',
        getInlineArguments,
      });

      await execution.executeQueryGroup();

      expect(getInlineArguments).not.toHaveBeenCalled();
      expect(apiClient.executeTarget).toHaveBeenCalledWith(
        expect.objectContaining({ argumentSetIds: ['urn:sqlib:argument-set-version:1'] }),
        expect.anything(),
      );
      const [sentPayload] = apiClient.executeTarget.mock.calls[0];
      expect(sentPayload).not.toHaveProperty('arguments');
    });

    it('sends inline arguments when there is no saved set', async () => {
      const inline = { arguments: [{ head: { vars: [] }, arguments: { bindings: [] } }] };
      const { execution, apiClient } = harness({ getInlineArguments: () => inline });

      await execution.executeQueryGroup();

      expect(apiClient.executeTarget).toHaveBeenCalledWith(
        expect.objectContaining({ arguments: inline.arguments }),
        expect.anything(),
      );
    });

    it('includes data graphs alongside arguments when there are any', async () => {
      const dataGraphs = [{ port: 'urn:sqlib:port:1', dataGraphVersionId: 'urn:sqlib:data-graph-version:1' }];
      const { execution, apiClient } = harness({ getDataGraphInputs: () => dataGraphs });

      await execution.executeQueryGroup();

      expect(apiClient.executeTarget).toHaveBeenCalledWith(
        expect.objectContaining({ dataGraphs }),
        expect.anything(),
      );
    });

    it('omits dataGraphs entirely when there are none', async () => {
      const { execution, apiClient } = harness();

      await execution.executeQueryGroup();

      const [sentPayload] = apiClient.executeTarget.mock.calls[0];
      expect(sentPayload).not.toHaveProperty('dataGraphs');
    });

    it('unwraps a nodeDetail envelope and moves the inspector to the results tab', async () => {
      const nodes = [{ nodeId: 'urn:sqlib:node:1', status: 'ok' as const, rowCount: 2 }];
      const { execution, apiClient, deps } = harness({
        apiClient: {
          executeTarget: vi.fn().mockResolvedValue({
            body: JSON.stringify({ result: SPARQL_JSON, nodes }),
            contentType: 'application/json',
          }),
        },
      });

      await execution.executeQueryGroup();

      expect(execution.nodeExecutions.value).toEqual(nodes);
      expect(execution.executionResultJson.value).toEqual(SPARQL_JSON);
      expect(execution.executionContentType.value).toBe('application/sparql-results+json');
      expect((deps.activeResultsTab as { value: string }).value).toBe('results');
      expect(execution.executionError.value).toBeNull();
    });

    it('unwraps an envelope whose result is already a string, using the requested format', async () => {
      const { execution } = harness({
        apiClient: {
          executeTarget: vi.fn().mockResolvedValue({
            body: JSON.stringify({ result: '<a> <b> <c> .', nodes: [] }),
            contentType: 'application/json',
          }),
        },
      });

      await execution.executeQueryGroup();

      expect(execution.executionResultRaw.value).toBe('<a> <b> <c> .');
      expect(execution.executionContentType.value).toBe('application/sparql-results+json');
      // Not SPARQL-results-shaped JSON, so it does not get parsed as one.
      expect(execution.executionResultJson.value).toBeNull();
    });

    it('passes a non-enveloped body through untouched, with an empty node list', async () => {
      const { execution } = harness({
        apiClient: {
          executeTarget: vi.fn().mockResolvedValue({
            body: JSON.stringify(SPARQL_JSON),
            contentType: 'application/sparql-results+json',
          }),
        },
      });

      await execution.executeQueryGroup();

      expect(execution.nodeExecutions.value).toEqual([]);
      expect(execution.executionResultJson.value).toEqual(SPARQL_JSON);
    });

    it('captures the failed node and any partial results on a mid-chain failure', async () => {
      const partialNodes = [{ nodeId: 'urn:sqlib:node:1', status: 'ok' as const }];
      const error = Object.assign(new Error('node urn:sqlib:node:2 failed'), {
        data: { failedNodeId: 'urn:sqlib:node:2', nodes: partialNodes },
      });
      const { execution, toast } = harness({
        apiClient: { executeTarget: vi.fn().mockRejectedValue(error) },
      });

      await execution.executeQueryGroup();

      expect(execution.executionError.value).toBe('node urn:sqlib:node:2 failed');
      expect(execution.failedNodeId.value).toBe('urn:sqlib:node:2');
      expect(execution.nodeExecutions.value).toEqual(partialNodes);
      expect(toast.error).toHaveBeenCalledWith('node urn:sqlib:node:2 failed');
      expect(execution.isExecuting.value).toBe(false);
    });

    it('handles a rejection carrying no structured data at all', async () => {
      const { execution } = harness({
        apiClient: { executeTarget: vi.fn().mockRejectedValue(new Error('offline')) },
      });

      await execution.executeQueryGroup();

      expect(execution.executionError.value).toBe('offline');
      expect(execution.failedNodeId.value).toBeNull();
      expect(execution.isExecuting.value).toBe(false);
    });
  });

  describe('runBenchmark', () => {
    it('opens the benchmark dialog', async () => {
      const { execution } = harness();
      await execution.runBenchmark();
      expect(execution.showBenchmarkDialog.value).toBe(true);
    });
  });
});
