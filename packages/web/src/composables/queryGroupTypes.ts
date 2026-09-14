import type { Ref, ComputedRef } from 'vue';
import type { Node, Edge } from '@vue-flow/core';
import type {
  QueryGroupVersion,
  QueryGroupVersionExpanded,
  QueryGroupVersionExpandedWithIriMap,
  QueryGroupVersionForGroupCreateInput,
} from '@sparql-query-lib/contracts';
import type { SparqlResults } from '@sparql-query-lib/types';
import type { useApiClient } from './useApiClient';
import type { useQueryGroupsStore } from './useQueryGroupsStore';
import type { useBackendsStore } from './useBackendsStore';
import type { useQueriesStore } from './useQueriesStore';
import type { useLibrariesStore } from './useLibrariesStore';
import type {
  GraphEdgeState,
  GraphNodeState,
  QueryGroupGraphState,
  graphStateToFlatPayload,
  FlatGraphPayload,
} from './useQueryGroupGraph';
import type { IoEntityRecord, QueryVersionResolution } from './queryGroupIoModel';
import type { QueryVersionExpanded } from '@sparql-query-lib/contracts';
import type { Diagnostic } from './queryGroupCompatibility';
import type { CanvasTemplate } from './canvasTemplates';
import type { TupleDefinition, TupleEditorUpdatePayload } from '../types/tuple-editor';
import type { VersionOption } from '../components/shared/VersionToolbar.vue';

export type ApiClient = ReturnType<typeof useApiClient>;
export type QueryGroupsStore = ReturnType<typeof useQueryGroupsStore>;
export type BackendsStore = ReturnType<typeof useBackendsStore>;
export type QueriesStore = ReturnType<typeof useQueriesStore>;
export type LibrariesStore = ReturnType<typeof useLibrariesStore>;

export type MapRef<K, V> = Ref<Map<K, V>>;

export type ToastLike = {
  success(message: string): void;
  error(message: string): void;
  info?(message: string): void;
  warning?(message: string): void;
};

export interface QueryGroupCreationRequest {
  id: number;
  libraryId: string;
  libraryName: string;
}

export type NodeExecutionDetail = {
  nodeId: string;
  status: 'pending' | 'running' | 'ok' | 'failed';
  durationMs?: number;
  rowCount?: number;
  tripleCount?: number;
  result?: unknown;
  error?: string;
};

export type ValidationIssue = {
  level: 'error' | 'warning';
  message: string;
  entityType?: string;
  entityId?: string | null;
  code?: string | null;
};

export type QuerySelectionPayload = {
  queryId: string;
  queryVersionId: string;
  queryVersionNumber: number;
  queryName: string;
};

export type CanvasSelection =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | { type: 'io'; id: string; parentNodeId?: string | null }
  | null;

export type CanvasSelectionDetail =
  | { type: 'node'; node: GraphNodeState }
  | { type: 'edge'; edge: GraphEdgeState }
  | { type: 'io'; entity: IoEntityRecord; parentNodeId: string | null }
  | null;

export interface VersionMeta {
  id: string;
  version: number;
  versionNumber: number;
  dateModified: string | null;
  /** The version's note, shown and edited on the Details version row. */
  comment: string | null;
}

export type NormalizedStartTuplePayload = {
  inputs: Array<{ id: string; variableName: string; allowedTypes?: string[] }>;
  tupleMembers: Array<{ id:string; position: number; variable: string }>;
  inputTuples: Array<{ id: string; name: string | null; memberEntries: string[] }>;
};

export type TupleMemberDraft = NonNullable<QueryGroupVersionForGroupCreateInput['tupleMembers']>[number];
export type InputTupleDraft = NonNullable<QueryGroupVersionForGroupCreateInput['inputTuples']>[number];
export type OutputTupleDraft = NonNullable<QueryGroupVersionForGroupCreateInput['outputTuples']>[number];
export type InputVariableDraft = NonNullable<QueryGroupVersionForGroupCreateInput['inputs']>[number];
export type OutputVariableDraft = NonNullable<QueryGroupVersionForGroupCreateInput['outputs']>[number];
export type TriplesQuadsDraft = NonNullable<QueryGroupVersionForGroupCreateInput['rdfOutputs']>[number];
export type BooleanDraft = NonNullable<QueryGroupVersionForGroupCreateInput['booleanOutputs']>[number];
export type QueryIdInputDraft = NonNullable<QueryGroupVersionForGroupCreateInput['queryIdInputs']>[number];

export interface UseQueryGroupGraphStateDeps {
  initialGraphState: QueryGroupGraphState;
  onSelectionChange?: (selection: CanvasSelection) => void;
}

export interface UseQueryGroupGraphStateResult {
  currentGraphState: Ref<QueryGroupGraphState>;
  nodes: Ref<Node[]>;
  edges: Ref<Edge[]>;
  selectedCanvasDetail: ComputedRef<CanvasSelectionDetail>;
  selectNode: (nodeId: string) => void;
  selectEdge: (edgeId: string) => void;
  selectIoEntity: (entityId: string, parentNodeId?: string | null) => void;
  clearSelection: () => void;
  applyGraphState: (graphState: QueryGroupGraphState) => void;
  updateGraphNodeState: (nodeId: string, updater: (node: GraphNodeState) => GraphNodeState) => void;
  updateGraphEdges: (updater: (edges: GraphEdgeState[]) => GraphEdgeState[]) => void;
  toFlatPayload: () => FlatGraphPayload;
  serializeCanvasSnapshot: () => string | null;
  updateNodeLabel: (nodeId: string, label: string) => void;
  updateNodeBackend: (nodeId: string, backendId: string | null) => void;
  updateNodeMediaType: (nodeId: string, mediaType: string | null) => void;
  updateNodeIoFromQueryVersion: (nodeId: string, queryVersion: QueryVersionExpanded) => void;
  setNodeQueryVersionResolution: (nodeId: string, resolution: QueryVersionResolution) => void;
  connectNodes: (params: {
    edgeId: string;
    sourceId: string;
    targetId: string;
    flowType: GraphEdgeState['flowType'];
  }) => { applied: boolean; diagnostics: Diagnostic[] };
  addStep: (params: {
    sourceId: string;
    nodeId: string;
    edgeId: string;
    label: string;
  }) => { applied: boolean; diagnostics: Diagnostic[]; flowType: GraphEdgeState['flowType'] | null };
  applyTemplate: (params: {
    template: CanvasTemplate;
    nodeIds: readonly string[];
    edgeIds: readonly string[];
  }) => { applied: boolean; diagnostics: Diagnostic[]; steps: GraphNodeState[] };
  updateEdgeFlowType: (
    edgeId: string,
    flowType: GraphEdgeState['flowType'],
  ) => { applied: boolean; diagnostics: Diagnostic[] };
  updateEdgeWhenEmpty: (edgeId: string, whenEmpty: string | null) => void;
  updateEdgeVariableMappings: (edgeId: string, variableMappings: string | null) => void;
  updateEdgeSourceOutput: (edgeId: string, sourceOutputId: string | null) => void;
  updateEdgeTargetInput: (edgeId: string, targetInputId: string | null) => void;
  deleteNode: (nodeId: string) => boolean;
  duplicateNode: (nodeId: string, newNodeId: string) => boolean;
  deleteEdge: (edgeId: string) => boolean;
  deleteSelected: () => boolean;
  initialGraphState: QueryGroupGraphState;
  mergeIriMap: (entries?: Record<string, string>) => void;
}

export interface UsePanelResizeDeps {
  initialWidthPercent?: number;
  document?: Document;
  containerRef?: Ref<HTMLElement | null>;
  /**
   * Where this split is remembered. One key per screen, so Query and Rules do
   * not share a width; absent means the split resets on every mount.
   */
  storageKey?: string;
  /**
   * True where the trailing panel has a collapsed rail to snap into. Dragging
   * the handle past the trailing floor closes it on those screens, and does
   * nothing on the ones with no rail to show.
   */
  collapsible?: boolean;
  /** Hard floor for the centre column, in px. The panel stops, not the editor. */
  minLeadingPx?: number;
  /** Floor for the trailing panel, in px. Dragged well below it, the panel snaps shut. */
  minTrailingPx?: number;
  /** Ceiling for the trailing panel, as a share of the pane. */
  maxTrailingRatio?: number;
  /** Trailing width a double-click on the handle returns to, in px. */
  resetTrailingPx?: number;
  /** Width of the resizer itself, which belongs to neither panel. */
  handlePx?: number;
}

export interface UsePanelResizeResult {
  panelWidthPercent: Ref<number>;
  startResize: (event: MouseEvent) => void;
  stopResize: () => void;
  isResizing: Ref<boolean>;
  /** Whether the trailing panel is snapped shut to its rail. */
  collapsed: Ref<boolean>;
  toggleCollapsed: () => void;
  /** Back to the default trailing width, opening the panel if it was shut. */
  resetWidth: () => void;
}

export interface UseQueryGroupIOResult {
  ioDraftStore: {
    tupleMembers: MapRef<string, TupleMemberDraft>;
    inputTuples: MapRef<string, InputTupleDraft>;
    outputTuples: MapRef<string, OutputTupleDraft>;
    inputs: MapRef<string, InputVariableDraft>;
    outputs: MapRef<string, OutputVariableDraft>;
    rdfOutputs: MapRef<string, TriplesQuadsDraft>;
    booleanOutputs: MapRef<string, BooleanDraft>;
    queryIdInputs: MapRef<string, QueryIdInputDraft>;
  };
  inputTuples: Ref<TupleDefinition[]>;
  populateFromExpanded: (expanded: QueryGroupVersionExpanded) => void;
  resetDrafts: () => void;
  normalizeStartTuples: () => NormalizedStartTuplePayload;
  resetStartTuples: () => void;
  ingestQueryVersionDrafts: (queryVersion: QueryVersionExpanded) => void;
  buildVersionCreatePayload: (options: { versionComment: string | null }) => QueryGroupVersionForGroupCreateInput;
  tupleEditor: {
    addTuple: () => void;
    removeTuple: (tupleIndex: number) => void;
    addVariable: (tupleIndex: number) => void;
    removeVariable: (tupleIndex: number, variableIndex: number) => void;
    updateVariable: (payload: TupleEditorUpdatePayload) => void;
    saveStartInputs: () => void;
  };
  registerRdfIoEntity: (draft: TriplesQuadsDraft) => void;
  registerQueryIdInput: (draft: QueryIdInputDraft) => void;
  unregisterIoEntity: (entityId: string) => void;
  unregisterQueryIdInput: (entityId: string) => void;
}

export interface UseQueryGroupIODeps {
  graph: UseQueryGroupGraphStateResult;
  toast: ToastLike;
  logger?: Pick<Console, 'debug' | 'error'>;
}

export interface UseQueryGroupExecutionResult {
  selectedBackendId: Ref<string | null>;
  availableBackends: ComputedRef<string[]>;
  /** True when the graph holds a node that has to run somewhere. */
  requiresBackend: ComputedRef<boolean>;
  availableBackendObjects: ComputedRef<Array<{ id: string; name: string }>>;
  validationIssues: Ref<ValidationIssue[]>;
  selectedResultFormat: Ref<'application/sparql-results+json' | 'application/n-triples'>;
  executionError: Ref<string | null>;
  executionResultJson: Ref<SparqlResults | null>;
  executionResultRaw: Ref<string | null>;
  executionContentType: Ref<string | null>;
  isExecuting: Ref<boolean>;
  isValidating: Ref<boolean>;
  nodeExecutions: Ref<NodeExecutionDetail[]>;
  failedNodeId: Ref<string | null>;
  showBenchmarkDialog: Ref<boolean>;
  executeQueryGroup: () => Promise<void>;
  validateQueryGroup: (options?: { silent?: boolean }) => Promise<{ valid: boolean; issues?: ValidationIssue[] } | null>;
  runBenchmark: () => Promise<void>;
  assignQueryToNode: (nodeId: string, payload: QuerySelectionPayload) => Promise<void>;
}

export interface UseQueryGroupExecutionDeps {
  graph: UseQueryGroupGraphStateResult;
  io: UseQueryGroupIOResult;
  queryGroupId: Ref<string>;
  queryGroupLibraryId: Ref<string>;
  selectedVersionId: Ref<string | null>;
  selectedVersionNumber: Ref<number | null>;
  /** The inspector's selected tab; execution moves it to Results. */
  activeResultsTab: Ref<string>;
  backendsStore: BackendsStore;
  queriesStore: QueriesStore;
  librariesStore: LibrariesStore;
  queryGroupsStore: QueryGroupsStore;
  apiClient: ApiClient;
  toast: ToastLike;
  /** The saved argument-set version to run, or null when running a draft. */
  getSelectedArgumentSetId?: () => string | null;
  /**
   * The draft's values, for when there is no saved version to name. Same
   * shape `useQueryExecution` takes, because it is the same `POST /execute`
   * body on the other end.
   */
  getInlineArguments?: () => {
    arguments?: unknown[];
    limits?: { name: string; value: number }[];
    offsets?: { name: string; value: number }[];
  } | null;
  /**
   * The data graphs to fill the start node's RDF inputs with, one per declared
   * port. Independent of the arguments above rather than an alternative to
   * them: a start node declares tuples and data graphs as separate slots, so a
   * run can carry both.
   */
  getDataGraphInputs?: () => Array<{ port?: string; dataGraphVersionId: string }> | null;
}

export interface UseQueryGroupVersionsResult {
  versionOptions: Ref<VersionOption[]>;
  versionMetadata: Ref<Record<string, VersionMeta>>;
  selectedVersionId: Ref<string | null>;
  selectedVersionNumber: Ref<number | null>;
  currentVersionNumberForDisplay: Ref<number | null>;
  /** Which version the entity says is current, not which one is on screen. */
  currentVersionId: Ref<string | null>;
  versionComment: Ref<string>;
  /**
   * The LIMIT / OFFSET names the loaded version accepts: the union of what its
   * member queries declare, computed server-side so the fields the arguments
   * panel offers and the names `/execute` accepts come from one place.
   */
  pageParameters: Ref<{ limitParameters: string[]; offsetParameters: string[] }>;
  concurrencyTokens: Ref<Record<string, string | null>>;
  loadVersionList: (groupId: string, versions?: QueryGroupVersion[]) => Promise<void>;
  loadVersionById: (groupId: string, versionId: string) => Promise<void>;
  reloadVersionsAndSelect: (groupId: string, versionId: string | null, versions?: QueryGroupVersion[]) => Promise<void>;
  findVersionIdByNumber: (versionNumber: number | null) => string | null;
  setSelectedVersion: (versionId: string | null) => void;
  setCurrentVersion: (versionId: string | null) => void;
  reset: () => void;
}

export interface UseQueryGroupVersionsDeps {
  graph: UseQueryGroupGraphStateResult;
  io: UseQueryGroupIOResult;
  queryGroupsStore: QueryGroupsStore;
  queriesStore: QueriesStore;
  apiClient: ApiClient;
  toast: ToastLike;
}

export interface UseQueryGroupStateResult {
  queryGroupState: Ref<'new' | 'view' | 'edit'>;
  queryGroupId: Ref<string>;
  queryGroupName: Ref<string>;
  queryGroupDescription: Ref<string>;
  queryGroupLibraryId: Ref<string>;
  versionComment: Ref<string>;
  isSaving: Ref<boolean>;
  isLoading: Ref<boolean>;
  isGraphLoading: Ref<boolean>;
  graphLoadError: Ref<string | null>;
  beginCreate: (request: QueryGroupCreationRequest) => void;
  loadFromRoute: (params: { queryGroupId: string; versionNumber?: number | null }) => Promise<void>;
  submitMetadata: (payload: { name: string; description: string | null }) => Promise<void>;
  saveQueryGroup: () => Promise<void>;
  saveNewVersion: () => Promise<void>;
  deleteQueryGroup: () => Promise<void>;
  cloneQueryGroup: (options?: { name?: string; libraryId?: string }) => Promise<string | void>;
  moveQueryGroup: (options?: { libraryId?: string }) => Promise<void>;
}

export interface UseQueryGroupStateDeps {
  graph: UseQueryGroupGraphStateResult;
  versions: UseQueryGroupVersionsResult;
  io: UseQueryGroupIOResult;
  queryGroupsStore: QueryGroupsStore;
  apiClient: ApiClient;
  toast: ToastLike;
  onCreationConsumed?: () => void;
  resetExecutionState?: () => void;
  onGroupDeleted?: (groupId: string) => void;
  onGroupCloned?: (newGroupId: string, libraryId: string) => void;
  onGroupMoved?: (groupId: string, libraryId: string) => void;
}

