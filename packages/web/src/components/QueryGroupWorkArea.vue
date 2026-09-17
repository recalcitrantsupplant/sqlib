<template>
  <!--
    An instance of the canvas archetype — toolbar → surface → rail — rather than
    a layout of its own (design system §6, issue #39). The split, the positioned
    graph box, the empty state and the Vue Flow chrome all belong to the shell
    now; what is left here is what only a query group has.
  -->
  <CanvasShell
    ref="canvasShellRef"
    class="querygroup-work-area"
    :main-width-percent="leftPanelWidth"
    :empty="canvasIsEmpty"
  >
    <template #toolbar>
      <!--
        The same bar the query screen carries, and for the same reason: a group
        is a versioned entity, so "save" is "save the next version", and the
        name is read-only here because it has one editor — the Details tab.
        Format and Diff are off (a canvas has neither) and so is ⋮ (Delete,
        Clone and Move already live in the canvas toolbar's own menu).
      -->
      <SaveBar
        :title="queryGroupName"
        noun="group"
        :is-scratch="isScratch"
        :current-version-number="currentVersionNumberForDisplay"
        :edit-count="0"
        :saving="isSavingVersion || isSaving"
        :can-save="canSave"
        :needs-name="needsName"
        :show-format="false"
        :show-diff="false"
        :show-more="false"
        @save="save"
        @needs-name="promptForNameInDetails"
      />

      <!--
        The run, as one sentence (design 3b).

        A group's "against" is a statement rather than a choice: every execution
        node names its own backend, so there is nothing group-level to pick and
        a dropdown here would claim otherwise. Same for the output format — a
        node names the media type it wants back. What is left is genuinely the
        group's own: what it runs *with*, and what the recipe can be kept as.
      -->
      <RunBar
        :running="isExecuting"
        :run-disabled="isNewQueryGroup"
        :run-title="isNewQueryGroup ? 'Save this group before running it' : 'Run this query group'"
        :inputs="runInputs"
        :backend="PER_NODE_BACKENDS"
        :create-targets="['benchmark', 'test']"
        :create-disabled-reason="createDisabledReason"
        :creating="creatingFromRecipe"
        recipe-noun="arguments"
        @run="executeQueryGroup"
        @pick="showArgumentsTab"
        @create="createFromRecipe"
      />

      <VersionToolbar
        title="Query Group Canvas"
        :version-options="versionOptions"
        :selected-version="selectedVersion"
        :version-id="selectedVersionId"
        :is-new-entity="isNewQueryGroup"
        :is-saving="isSaving"
        :is-loading="isLoading"
        save-label="Save New Version"
        save-title="Save Query Group as New Version"
        save-new-version-label="Overwrite Current Version"
        :show-format-button="false"
        :hide-focus-button="true"
        :hide-save-buttons="true"
        :hide-version-selector="true"
        @update:selectedVersion="handleSelectedVersionChange"
        @save="saveNewVersion"
        @delete="requestDeleteQueryGroup"
        @clone="requestCloneQueryGroup"
        @move="requestMoveQueryGroup"
        @copy-version-id="copyQueryGroupVersionId"
      />
    </template>

    <VueFlow
      ref="vueFlowRef"
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :default-viewport="{ zoom: 1 }"
      :min-zoom="0.2"
      :max-zoom="4"
      fit-view-on-init
      class="vue-flow-container"
      @connect="onConnect"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @node-context-menu="onNodeContextMenu"
      @node-drag-start="dropStaleEdgeRoutes"
    >
      <Background :pattern-color="graphPattern" :gap="16" />
      <Controls />
    </VueFlow>

    <template #empty>
      <EmptyState
        boxed
        size="sm"
        title="This group has no steps yet"
        description="Add a query node to get started, then draw an edge to chain it."
      >
        <template #actions>
          <button class="btn-add-node" type="button" @click="addQueryNode">Add your first query</button>
          <!--
            The templates beside it.
            A blank canvas asks two questions - what goes in the first box, and
            what the group is going to look like - and the button on the left
            only answers the first. Each of these draws a whole Start-to-End
            shape, leaving the author with steps to fill in rather than wiring
            to work out.
          -->
          <button
            v-for="template in CANVAS_TEMPLATES"
            :key="template.id"
            class="btn-add-node btn-template"
            type="button"
            :title="template.description"
            @click="startFromTemplate(template)"
          >
            {{ template.label }}
          </button>
        </template>
      </EmptyState>
    </template>

    <template #overlay>
      <!-- Node context menu. Start and end nodes are structural, so they
           offer no actions and never open one. -->
      <div
        v-if="nodeContextMenu"
        class="node-context-menu"
        :style="{ left: `${nodeContextMenu.x}px`, top: `${nodeContextMenu.y}px` }"
      >
        <button type="button" class="node-context-item" @click="duplicateContextNode">
          <Copy :size="14" />
          Duplicate
        </button>
        <button type="button" class="node-context-item node-context-item-danger" @click="deleteContextNode">
          <Trash2 :size="14" />
          Delete
        </button>
      </div>

      <!-- Add Node Toolbar -->
      <div class="add-node-toolbar">
        <!--
          "Add step" is the linear-chain shortcut and the four beside it are the
          DAG's own vocabulary, so it sits first and apart: from the selected
          node it adds the next one *and* the edge, which is what building a
          chain actually is. Its title carries the reason it is off rather than
          leaving a greyed button unexplained.
        -->
        <button
          class="btn-add-node btn-add-step"
          type="button"
          :disabled="addStepDisabledReason !== null"
          :title="addStepDisabledReason ?? 'Add a query node fed by the selected one'"
          @click="addStep"
        >
          <span>Add step</span>
        </button>
        <span class="add-node-divider" aria-hidden="true"></span>
        <button class="btn-add-node" @click="addQueryNode" title="Add Query Node">
          <span>Query</span>
        </button>
        <button class="btn-add-node" @click="addDynamicQueryNode" title="Add Dynamic Query Node">
          <span>Dynamic Query</span>
        </button>
        <button class="btn-add-node" @click="addRulesetNode" title="Add Ruleset Node">
          <span>Ruleset</span>
        </button>
        <button class="btn-add-node" @click="addPatchNode" title="Add Patch Node (derives what an update would change)">
          <span>Patch</span>
        </button>
        <!-- Tidy up runs the last layout you picked; the caret picks a
             different one. Which arrangement reads best depends on the
             graph, so the choice belongs to the user, not to a default. -->
        <div class="tidy-control">
          <button
            class="btn-add-node btn-tidy"
            :disabled="nodes.length === 0"
            :title="`Arrange nodes: ${activeLayoutPreset.label}`"
            @click="autoLayoutCanvas()"
          >
            <span>Tidy up</span>
          </button>
          <button
            class="btn-add-node btn-tidy-caret"
            type="button"
            :disabled="nodes.length === 0"
            title="Choose a layout"
            aria-haspopup="menu"
            :aria-expanded="layoutMenuOpen"
            @click="layoutMenuOpen = !layoutMenuOpen"
          >
            <ChevronDown :size="12" />
          </button>
          <div v-if="layoutMenuOpen" class="layout-menu" role="menu">
            <button
              v-for="preset in layoutPresets"
              :key="preset.id"
              type="button"
              class="layout-menu-item"
              :class="{ 'layout-menu-item-active': preset.id === layoutPresetId }"
              role="menuitemradio"
              :aria-checked="preset.id === layoutPresetId"
              @click="autoLayoutCanvas(preset.id)"
            >
              <span class="layout-menu-label">{{ preset.label }}</span>
              <span class="layout-menu-hint">{{ preset.hint }}</span>
            </button>
          </div>
        </div>
      </div>
    </template>

    <template #separator>
      <div
        class="vertical-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the inspector panel"
        title="Drag to resize · double-click to reset"
        @mousedown="startVerticalResize"
        @dblclick="resetPanelWidth"
      >
        <div class="resizer-handle"></div>
      </div>
    </template>

    <!--
      The same inspector the query screen carries: Details, Arguments, Results,
      plus the canvas-object Editor, which is the one tab only a group has.
    -->
    <template #rail>
      <div class="right-panel">
        <InspectorPanel v-model:active-tab="activeResultsTab" :tabs="inspectorTabs">
          <template #details>
            <EntityDetailsPanel
              ref="detailsPanelRef"
              v-bind="detailsProps"
              @update:name="queryGroupName = $event"
              @update:description="queryGroupDescription = $event"
              @select-version="handleSelectedVersionChange"
              @set-current-version="setCurrentVersion"
              @annotate-version="annotateVersion"
              @copy-id="copyQueryGroupId"
            />
          </template>

          <!-- Editor Tab -->
          <template #editor>
            <div class="tab-pane">
              <div class="editor-content">
                <CanvasObjectEditor
                  :selection="selectedCanvasDetail"
                  :validation-issues="selectedValidationIssues"
                  :start-tuples="inputTuples"
                  :backend-options="availableBackendObjects"
                  :query-default-backend="queryDefaultBackend"
                  :library-default-backend="libraryDefaultBackend"
                  :query-options="queryAssignmentOptions.options.value"
                  :query-options-loading="queryAssignmentOptions.loading.value"
                  :query-options-error="queryAssignmentOptions.error.value"
                  :flow-type-options="edgeFlowTypeOptions"
                  :io-entities="currentGraphState.ioEntities"
                  :graph-nodes="currentGraphState.nodes"
                  :iri-map="currentGraphState.iriMap"
                  :tuple-members="currentGraphState.tupleMembers"
                  :variables="currentGraphState.variables"
                  @add-tuple="addTuple"
                  @remove-tuple="removeTuple"
                  @add-variable="addVariable"
                  @remove-variable="removeVariable"
                  @update-variable="updateTupleVariable"
                  @save-start-tuples="saveStartInputs"
                  @add-start-data-graph="addStartDataGraphInput"
                  @remove-start-data-graph="removeStartDataGraphInput"
                  @assign-query="handleAssignQuery"
                  @request-ruleset-assignment="handleRequestRuleSetAssignment"
                  @add-query-id-input="addQueryIdInputToNode"
                  @update-node-label="({ nodeId, label }) => updateNodeLabel(nodeId, label)"
                  @update-node-backend="({ nodeId, backendId }) => updateNodeBackend(nodeId, backendId)"
                  @update-node-media-type="({ nodeId, mediaType }) => updateNodeMediaType(nodeId, mediaType)"
                  @update-edge-flow-type="({ edgeId, flowType }) => updateEdgeFlowType(edgeId, flowType as GraphEdgeState['flowType'])"
                  @update-edge-when-empty="({ edgeId, whenEmpty }) => updateEdgeWhenEmpty(edgeId, whenEmpty)"
                  @update-edge-variable-mappings="({ edgeId, variableMappings }) => updateEdgeVariableMappings(edgeId, variableMappings)"
                  @update-edge-source-output="({ edgeId, sourceOutputId }) => updateEdgeSourceOutput(edgeId, sourceOutputId)"
                  @update-edge-target-input="({ edgeId, targetInputId }) => updateEdgeTargetInput(edgeId, targetInputId)"
                  @update-io-name="({ entityId, name }) => updateIoEntityName(entityId, name)"
                  @update-io-description="({ entityId, description }) => updateIoEntityDescription(entityId, description)"
                  @select-io-entity="handleSelectIoEntity"
                  @delete-node="handleDeleteNode"
                  @delete-edge="handleDeleteEdge"
                />
              </div>
            </div>
          </template>

          <!-- Arguments Tab -->
          <template #arguments>
            <QueryGroupArgumentsPanel
              :group-id="queryGroupId"
              :start-tuples="inputTuples"
              :argument-sets-composable="argumentSetsState"
              :limit-parameters="versions.pageParameters.value.limitParameters"
              :offset-parameters="versions.pageParameters.value.offsetParameters"
              :data-graph-ports="startDataGraphInputPorts"
              :data-graph-options="dataGraphOptions"
            >
              <div v-if="allValidationIssues.length" class="validation-issues-panel">
                <p class="validation-issues-title">
                  {{ blockingIssues.length ? 'Validation errors detected' : 'Validation warnings' }}
                </p>
                <ul class="validation-issues-list">
                  <li
                    v-for="(issue, index) in allValidationIssues"
                    :key="`${issue.level}-${index}-${issue.message}`"
                    :class="['validation-issue', issue.level, { 'is-locatable': !!canvasValidation.resolveTarget(issue) }]"
                  >
                    <button
                      v-if="canvasValidation.resolveTarget(issue)"
                      type="button"
                      class="validation-issue-link"
                      :title="`Show on canvas`"
                      @click="focusValidationIssue(issue)"
                    >
                      <strong>{{ issue.level === 'error' ? 'Error' : 'Warning' }}:</strong>
                      <span>{{ issue.message }}</span>
                    </button>
                    <template v-else>
                      <strong>{{ issue.level === 'error' ? 'Error' : 'Warning' }}:</strong>
                      <span>{{ issue.message }}</span>
                    </template>
                    <span v-if="issue.code" class="validation-issue-code">{{ issue.code }}</span>
                  </li>
                </ul>
                <p v-if="graphLevelIssues.length" class="validation-issues-note">
                  {{ graphLevelIssues.length }} issue(s) apply to the group as a whole and have no
                  element to highlight.
                </p>
              </div>
            </QueryGroupArgumentsPanel>
          </template>

          <!-- Results Tab -->
          <template #results>
            <div class="tab-pane">
              <div class="results-content">
                <!-- The three states the viewer cannot describe for itself, in the
                     shared empty-state chrome rather than three hand-drawn cards. -->
                <EmptyState
                  v-if="isExecuting"
                  title="Executing query group…"
                  description="The latest results will appear here shortly."
                />
                <EmptyState
                  v-else-if="executionError"
                  title="Execution failed"
                  :description="executionError"
                />
                <EmptyState
                  v-else-if="requiresBackend && availableBackends.length === 0"
                  title="No backend available"
                  description="Add an execution node with a backend before running the query group."
                />
                <QueryResultsViewer
                  v-else
                  :results="executionResultJson"
                  :raw-content="executionResultRaw"
                  :content-type="executionContentType"
                  :loading="isExecuting"
                  :error="executionError"
                  :executed-at="null"
                />
              </div>
            </div>
          </template>

          <!-- Code Tab -->
          <template #code>
            <CodeSnippetPanel
              :variants="codeVariants"
              :default-variant-id="codeDefaultVariantId"
              :unavailable="codeUnavailable"
              :call-arguments="codeArguments"
              arguments-hint="Edit values in the Arguments tab — the snippet follows."
            />
          </template>

          <!-- Tests Tab: the Tests section, filtered to this group -->
          <template #tests>
            <div class="tab-pane scrollable">
              <SubjectTestsPanel
                v-if="testSubjectId"
                :subject-id="testSubjectId"
                subject-noun="group"
                @open="(testId) => emit('open-entity', { type: 'test', id: testId })"
              />
            </div>
          </template>
        </InspectorPanel>
      </div>
    </template>
  </CanvasShell>

  <!--
    The dialogs are roots of their own rather than children of the shell: each
    teleports to the body when it opens, so nesting them inside the layout said
    something about where they appear that was never true.

    There is no Edit-details dialog any more. Name and description are the
    Details tab's two fields, and they save as you type; a dialog that edits
    the same two fields is a second copy that can disagree with the first.
  -->

  <!-- Ruleset Selector Dialog -->
  <QueryGroupTransferDialog
    v-model:open="transferDialogOpen"
    :mode="transferMode"
    :group-name="queryGroupName"
    :current-library-id="queryGroupLibraryId"
    :libraries="libraryOptions"
    @submit="handleTransferSubmit"
  />

  <AlertDialog v-model:open="deleteConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete query group?</AlertDialogTitle>
        <AlertDialogDescription>
          "{{ queryGroupName }}" and all of its versions, nodes and edges will be
          deleted. This cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction class="delete-action" @click="confirmDeleteQueryGroup">
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <RuleSetSelectorDialog
    :open="showRuleSetSelectorDialog"
    :library-id="queryGroupLibraryId"
    :current-rule-set-version-id="selectedNodeForRuleSet?.ruleSetVersionId ?? null"
    @update:open="handleRuleSetSelectorOpenChange"
    @select="handleRuleSetSelected"
    @cancel="handleRuleSetSelectorCancel"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, markRaw } from 'vue';
import { useCssToken } from '@/composables/useCssToken';
import { useQueryAssignmentOptions } from '@/composables/useQueryAssignmentOptions';
import { ChevronDown, Copy, Trash2 } from '@lucide/vue';
import { VueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import type { Node, Edge, Connection, NodeMouseEvent } from '@vue-flow/core';
import SaveBar from './shared/SaveBar.vue';
import CanvasShell from './shared/CanvasShell.vue';
import InspectorPanel, { type InspectorTab } from './shared/InspectorPanel.vue';
import CodeSnippetPanel, {
  type CodeSnippetArgument,
  type CodeSnippetVariant,
} from './shared/CodeSnippetPanel.vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import EmptyState from './shared/EmptyState.vue';
import EntityDetailsPanel from './shared/EntityDetailsPanel.vue';
import CanvasObjectEditor from './query-group/CanvasObjectEditor.vue';
import QueryGroupCanvasNode from './query-group/QueryGroupCanvasNode.vue';
import QueryGroupCanvasEdge from './query-group/QueryGroupCanvasEdge.vue';
import VersionToolbar from './shared/VersionToolbar.vue';
import RuleSetSelectorDialog from './RuleSetSelectorDialog.vue';
import QueryGroupTransferDialog from './query-group/QueryGroupTransferDialog.vue';
import QueryGroupArgumentsPanel from './query-group/QueryGroupArgumentsPanel.vue';
import SubjectTestsPanel from './tests/SubjectTestsPanel.vue';
import { useTestsSurface } from '../composables/useTestsSurface';
import type { DataGraphOption } from '@/types/data-graphs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import QueryResultsViewer from './QueryResultsViewer.vue';
import { toast } from 'vue-sonner';
import { usePanelResize } from '../composables/usePanelResize';
import { buildCanvasNodeData, LEFT_TO_RIGHT_HANDLES, useQueryGroupGraphState } from '../composables/useQueryGroupGraphState';
import { authoredNodeLabel } from '../composables/queryGroupNodeLabel';
import { useQueryGroupIO } from '../composables/useQueryGroupIO';
import { useQueryGroupExecution } from '../composables/useQueryGroupExecution';
import { useQueryGroupVersions } from '../composables/useQueryGroupVersions';
import { routeVersionForSelection } from '../lib/entityLifecycle';
import { useQueryGroupState } from '../composables/useQueryGroupState';
import { useCanvasValidation } from '../composables/useCanvasValidation';
import { useQueryGroupLiveValidation } from '../composables/useQueryGroupLiveValidation';
import { useCanvasExecutionStatus } from '../composables/useCanvasExecutionStatus';
import { useAutoLayout } from '../composables/useAutoLayout';
import type { LayoutPoint } from '../composables/useAutoLayout';
import { useScratchRecord } from '../composables/useScratchRecord';
import { useCallableDrafts } from '../composables/useCallableDrafts';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useArgumentSets } from '../composables/useArgumentSets';
import { useBenchmarksStore } from '../composables/useBenchmarksStore';
import RunBar from './shared/RunBar.vue';
import type { CreateTarget, RunBarChoice, RunBarPick } from '../lib/runBar';
import { NO_ARGUMENTS_IRI, emptySettings } from '../lib/benchmarkPlan';
import type { QueryGroupCreationRequest, ValidationIssue } from '../composables/queryGroupTypes';
import {
  createGraphStateFromExpanded,
  type GraphNodeState,
  type GraphEdgeState,
  type QueryGroupGraphState,
} from '../composables/useQueryGroupGraph';
import type { IoEntityRecord } from '../composables/queryGroupIoModel';
import type { QueryGroupVersionExpandedWithIriMap } from '@sparql-query-lib/contracts';
import { useQueryGroupsStore } from '../composables/useQueryGroupsStore';
import { useApiClient } from '../composables/useApiClient';
import { useCommand } from '../composables/useCommandRegistry';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useQueriesStore } from '../composables/useQueriesStore';
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { DATA_FLOW_TYPES } from '@sparql-query-lib/types';
import { flowTypeLabel, recommendFlowType } from '../composables/edgeFlowTypeDefaults';
import { CANVAS_TEMPLATES, type CanvasTemplate } from '../composables/canvasTemplates';
import type { TupleEditorUpdatePayload } from '../types/tuple-editor';

const graphPattern = useCssToken('--graph-pattern', '#e9ecef');

const props = defineProps<{
  creationRequest: QueryGroupCreationRequest | null;
  queryGroupId?: string | null;
  /** The browser-local record when this is an unsaved group (nav doc §1). */
  scratchId?: string | null;
  versionNumber?: number | null;
}>();

const emit = defineEmits<{
  'creation-consumed': [];
  'update:versionNumber': [version: number | null];
  'query-group-deleted': [groupId: string];
  'query-group-cloned': [groupId: string, libraryId: string];
  'query-group-moved': [groupId: string, libraryId: string];
  /** A scratch group became a real one; the shell reselects it as saved. */
  'scratch-saved': [payload: { id: string; name: string; libraryId: string }];
  /** A test or a benchmark was created from the run sentence; open it. */
  'open-entity': [payload: { type: 'test' | 'benchmark'; id: string }];
}>();

const lastCreationToken = ref<number>(0);
const queryGroupsStore = useQueryGroupsStore();
const benchmarksStore = useBenchmarksStore();
const apiClient = useApiClient();
const backendsStore = useBackendsStore();
const queriesStore = useQueriesStore();
const librariesStore = useLibrariesStore();

/*
 * Both elements belong to the shell now — the split `usePanelResize` measures
 * the drag against, and the surface an overlay is positioned in. Read through
 * the shell rather than mirrored into refs of our own: a mirror is written by
 * a watcher, and a watcher has a flush order to be wrong about.
 */
const canvasShellRef = ref<InstanceType<typeof CanvasShell> | null>(null);
const workAreaRef = computed<HTMLElement | null>(() => canvasShellRef.value?.rootEl ?? null);
const canvasContainerRef = computed<HTMLElement | null>(() => canvasShellRef.value?.surfaceEl ?? null);
/** The VueFlow instance, for fitting the view after a layout run. */
const vueFlowRef = ref<{
  fitView: (options?: Record<string, unknown>) => void;
  updateNodeInternals: (ids?: string[]) => void;
} | null>(null);
const {
  panelWidthPercent: leftPanelWidth,
  startResize: startVerticalResize,
  resetWidth: resetPanelWidth,
} = usePanelResize({
  containerRef: workAreaRef,
  storageKey: 'queryGroup',
});
// Details first, as on the query screen: what this group is comes before what
// you can pass it and what came back.
const activeResultsTab = ref<string>('details');
const nodeTypes = {
  'query-group-node': markRaw(QueryGroupCanvasNode),
};
const edgeTypes = {
  'query-group-edge': markRaw(QueryGroupCanvasEdge),
};

const collectQueryVersionIdsFromGraph = () => {
  const ids = new Set<string>();
  for (const node of graph.currentGraphState.value.nodes) {
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

const syncQueryNamesToGraph = () => {
  const versionIds = collectQueryVersionIdsFromGraph();
  if (!versionIds.length) {
    return;
  }
  const nameMap = queriesStore.getQueryNamesByVersionIds(versionIds);
  graph.mergeIriMap(nameMap);
};

const mintTempId = (kind: string) => {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `urn:ui-temp:${kind}-${Date.now().toString(36)}-${randomSuffix}`;
};

const sampleExpanded: QueryGroupVersionExpandedWithIriMap = {
  queryGroupVersion: {
    id: 'urn:sqlib:group-version:new',
    version: 1,
    startNode: 'urn:sqlib:startnode:start-1',
    endNode: 'urn:sqlib:endnode:end-1',
    executionNodes: [],
    edges: [],
    canvasData: null,
    comment: null,
    dateCreated: null,
    dateModified: null,
    isPartOf: 'urn:sqlib:group:new',
  },
  executionNodes: [],
  startNode: {
    id: 'urn:sqlib:startnode:start-1',
    outputs: [],
    dateCreated: null,
    dateModified: null,
  },
  endNode: {
    id: 'urn:sqlib:endnode:end-1',
    inputs: [],
    mediaType: null,
    dateCreated: null,
    dateModified: null,
  },
  edges: [],
  queryNodes: [],
  dynamicQueryNodes: [],
  ruleSetNodes: [],
  patchNodes: [],
  startNodes: [],
  endNodes: [],
  tupleMembers: [],
  inputTuples: [],
  outputTuples: [],
  inputs: [],
  outputs: [],
  rdfOutputs: [],
  booleanOutputs: [],
  queryIdInputs: [],
  queryVersions: [],
  iriMap: {
    'urn:__START__': 'urn:sqlib:startnode:start-1',
    'urn:__END__': 'urn:sqlib:endnode:end-1',
  },
};

const initialGraphState = createGraphStateFromExpanded(sampleExpanded);

const graph = useQueryGroupGraphState({
  initialGraphState,
});

const io = useQueryGroupIO({
  graph,
  toast,
});

const versions = useQueryGroupVersions({
  graph,
  io,
  queryGroupsStore,
  queriesStore,
  apiClient,
  toast,
});

let resetExecutionStateImpl: () => void = () => {};

const state = useQueryGroupState({
  graph,
  versions,
  io,
  queryGroupsStore,
  apiClient,
  toast,
  onCreationConsumed: () => emit('creation-consumed'),
  resetExecutionState: () => resetExecutionStateImpl(),
  onGroupDeleted: (groupId) => emit('query-group-deleted', groupId),
  onGroupCloned: (groupId, libraryId) => emit('query-group-cloned', groupId, libraryId),
  onGroupMoved: (groupId, libraryId) => emit('query-group-moved', groupId, libraryId),
});

const {
  queryGroupState,
  queryGroupId,
  queryGroupName,
  queryGroupDescription,
  queryGroupLibraryId,
  versionComment,
  isSaving,
  isLoading,
  isGraphLoading,
  graphLoadError,
  beginCreate,
  loadFromRoute,
  submitMetadata,
  saveQueryGroup,
  saveNewVersion,
  deleteQueryGroup,
  cloneQueryGroup,
  moveQueryGroup,
} = state;

/**
 * Argument sets for this group, over the same composable the query screen uses.
 *
 * It lives here rather than inside the panel so Execute and the Arguments tab
 * agree on what runs — the same arrangement `QueryWorkArea` has with
 * `QueryResultsPanel`. Scratch sets, drafts and saved versions all come
 * with it; the group screen no longer keeps its own list-and-select state.
 */
// The library is passed so the switcher can offer sets made elsewhere in it,
// with their fit against this group. See `useArgumentSets.loadArgumentSets`.
const argumentSetsState = useArgumentSets(
  queryGroupId,
  'queryGroup',
  () => queryGroupLibraryId.value || activeLibraryId.value,
);

const config = useRuntimeConfig();

const execution = useQueryGroupExecution({
  graph,
  io,
  queryGroupId,
  queryGroupLibraryId,
  selectedVersionId: versions.selectedVersionId,
  selectedVersionNumber: versions.selectedVersionNumber,
  activeResultsTab,
  backendsStore,
  queriesStore,
  librariesStore,
  queryGroupsStore,
  apiClient,
  toast,
  getSelectedArgumentSetId: () => argumentSetsState.executionArgumentSetId.value,
  getInlineArguments: () => argumentSetsState.inlineExecutionPayload(),
  getDataGraphInputs: () => runDataGraphInputs.value,
});

resetExecutionStateImpl = () => {
  execution.validationIssues.value = [];
  execution.executionError.value = null;
  execution.executionResultRaw.value = null;
  execution.executionResultJson.value = null;
  execution.executionContentType.value = null;
  execution.isExecuting.value = false;
  execution.selectedBackendId.value = null;
};

const nodes = graph.nodes;
const edges = graph.edges;
const currentGraphState = graph.currentGraphState;
const selectedCanvasDetail = graph.selectedCanvasDetail;

/**
 * The group's data graph inputs — the RDF slots its start node declares.
 *
 * A run fills these from the library the same way it fills the tuple slots from
 * an argument set, and the two are independent: a group may declare both, so
 * choosing a graph here never displaces the argument set chosen above.
 */
const startDataGraphInputPorts = computed(() => {
  const startNode = currentGraphState.value.nodes.find((node) => node.kind === 'start');
  if (!startNode) return [];
  return startNode.outputs
    .filter((port) => port.entityType === 'TriplesQuadsIO')
    .map((port) => ({
      id: port.id,
      label: currentGraphState.value.ioEntities[port.id]?.name ?? port.label ?? port.id,
    }));
});

/** Saved graphs offered for those slots, newest version of each. */
const dataGraphOptions = ref<DataGraphOption[]>([]);

/**
 * The run's `dataGraphs`, in slot order.
 *
 * They live on the argument set now rather than in run-local state beside it,
 * so a group run or test is one pinned object — see `docs/concepts.md`. Which
 * port each fills is the group's, and it routes by position: entry N fills the
 * Nth declared input.
 *
 * Empty while a *saved* version is the run target, on the same either/or the
 * arguments follow: the server exports that version's graphs, and sending them
 * inline as well would be the run supplying a parameter the named set already
 * fills, which `/execute` refuses by design.
 */
const runDataGraphInputs = computed(() => {
  if (argumentSetsState.executionArgumentSetId.value) return [];
  return argumentSetsState.graphBindings.value
    .map((binding) => binding.dataGraphVersionId)
    .filter((versionId): versionId is string => !!versionId)
    .map((dataGraphVersionId) => ({ dataGraphVersionId }));
});

/**
 * Load the saved graphs this group could run against.
 *
 * Scoped to the group's library and to each graph's current version, the same
 * rule the rules editor's picker follows: pinning an older version is a saved
 * Test's job, not a run bar's. A failure costs the picker its contents and
 * nothing else — a group with no data graph slot never reads this.
 */
async function loadDataGraphOptions() {
  const libraryId = queryGroupLibraryId.value || activeLibraryId.value;
  if (!libraryId) {
    dataGraphOptions.value = [];
    return;
  }
  try {
    const graphs = await apiClient.listDataGraphs();
    const inLibrary = graphs.filter(
      (graph) => (graph.isPartOf ?? []).includes(libraryId) && graph.currentVersion,
    );
    const options = await Promise.all(
      inLibrary.map(async (graph) => {
        const versions = await apiClient.listDataGraphVersions(graph.id);
        const current = versions.find((version) => version.id === graph.currentVersion) ?? versions.at(-1);
        if (!current) return null;
        const triples = current.tripleCount ?? 0;
        return {
          versionId: current.id,
          name: graph.name,
          version: current.version,
          detail: `${triples} ${triples === 1 ? 'triple' : 'triples'}, ${current.contentFormat}`,
          graphId: graph.id,
        } satisfies DataGraphOption;
      }),
    );
    dataGraphOptions.value = options.filter((option): option is DataGraphOption => option !== null);
  } catch (error) {
    console.warn('[QueryGroupWorkArea] Failed to load data graphs:', error);
    dataGraphOptions.value = [];
  }
}

// Loaded when the group turns out to declare a data graph slot, and not
// before: a group with none never asks the library for graphs it cannot use.
watch(
  () => startDataGraphInputPorts.value.length > 0,
  (declaresGraphInput) => {
    if (declaresGraphInput && dataGraphOptions.value.length === 0) void loadDataGraphOptions();
  },
);



const ioDraftStore = io.ioDraftStore;
const inputTuples = io.inputTuples;

const {
  addTuple: addTupleInternal,
  removeTuple: removeTupleInternal,
  addVariable: addVariableInternal,
  removeVariable: removeVariableInternal,
  updateVariable: updateVariableInternal,
  saveStartInputs: saveStartInputsInternal,
} = io.tupleEditor;

const addTuple = () => addTupleInternal();
const removeTuple = (tupleIndex: number) => removeTupleInternal(tupleIndex);
const addVariable = (tupleIndex: number) => addVariableInternal(tupleIndex);
const removeVariable = (tupleIndex: number, variableIndex: number) =>
  removeVariableInternal(tupleIndex, variableIndex);
const updateTupleVariable = (payload: TupleEditorUpdatePayload) =>
  updateVariableInternal(payload);
const saveStartInputs = () => saveStartInputsInternal();
const registerRdfIoEntity = io.registerRdfIoEntity;
const registerQueryIdInput = io.registerQueryIdInput;
const unregisterIoEntity = io.unregisterIoEntity;
const unregisterQueryIdInput = io.unregisterQueryIdInput;

const selectedBackendId = execution.selectedBackendId;
const availableBackends = execution.availableBackends;
const requiresBackend = execution.requiresBackend;
const availableBackendObjects = execution.availableBackendObjects;
const validationIssues = execution.validationIssues;

/*
 * Two halves of the same picture, shown as one.
 *
 * `liveIssues` is what the canvas can decide for itself and so follows every
 * edit; `validationIssues` is what only the server can answer - whether the
 * things this graph references still exist - and so describes the version as
 * it was at the last run or save. Merging them is what lets the canvas say
 * something while a group is being built instead of only after it is run.
 */
const { liveIssues } = useQueryGroupLiveValidation({ graphState: currentGraphState });

const allValidationIssues = computed<ValidationIssue[]>(() => {
  /*
   * One entry per problem, at the worse of the two severities.
   *
   * The live pass reuses `/validate`'s codes precisely so the same problem
   * found by both halves collapses to one line rather than reading as two. The
   * severities can legitimately differ - a reference the live pass calls
   * incomplete is one the server, asked about a version someone is about to
   * run, calls blocking - and in that disagreement the blocking answer is the
   * one the author needs to see.
   */
  const byKey = new Map<string, ValidationIssue>();
  const keyOf = (issue: ValidationIssue) => `${issue.entityId ?? ''}|${issue.code ?? issue.message}`;

  for (const issue of [...liveIssues.value, ...validationIssues.value]) {
    const key = keyOf(issue);
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, issue);
    else if (existing.level !== 'error' && issue.level === 'error') byKey.set(key, issue);
  }
  return [...byKey.values()];
});

// Paint validation issues onto the canvas rather than leaving them in a flat list.
const canvasValidation = useCanvasValidation({
  validationIssues: allValidationIssues,
  nodes,
  edges,
  graphState: currentGraphState,
});
const graphLevelIssues = canvasValidation.graphLevelIssues;

/** Jump from a listed issue to the thing it is about. */
const focusValidationIssue = (issue: ValidationIssue) => {
  const target = canvasValidation.resolveTarget(issue);
  if (!target) return;
  activeResultsTab.value = 'editor';
  if (target.type === 'node') {
    graph.selectNode(target.id);
  } else if (target.type === 'edge') {
    graph.selectEdge(target.id);
  } else {
    if (target.parentNodeId) graph.selectNode(target.parentNodeId);
    graph.selectIoEntity(target.id, target.parentNodeId ?? null);
  }
};

const nodeExecutions = execution.nodeExecutions;
const failedNodeId = execution.failedNodeId;
const isExecuting = execution.isExecuting;

/* ------------------------------------------------------------------ *
 * The run sentence (design 3b)
 * ------------------------------------------------------------------ */

/**
 * "against", for a subject that does not get to choose.
 *
 * A group has no backend of its own: each execution node names one, and the
 * same is true of the media type each node asks for. Offering a group-level
 * dropdown would be claiming a knob that does not exist, so the sentence states
 * the fact and the Editor tab is where a node's backend is actually set.
 */
const PER_NODE_BACKENDS: RunBarChoice = {
  value: 'per-node',
  options: [],
  readonly: true,
  label: 'each node’s backend',
  title: 'A query group has no backend of its own — every execution node names one. '
    + 'Select a node and use the Editor tab to change it.',
};

const argumentsSummary = computed(() => {
  const selection = argumentSetsState.selection.value;
  if (selection.kind === 'none') return '';
  const label = argumentSetsState.stateLabel.value;
  const name = argumentSetsState.name.value || 'unnamed set';
  return label ? `${name} ${label}` : name;
});

const runInputs = computed<RunBarPick[]>(() => [{
  key: 'arguments',
  kind: 'arguments',
  value: argumentsSummary.value,
  empty: !argumentsSummary.value,
  icon: 'arguments',
  title: argumentsSummary.value
    ? `Arguments: ${argumentsSummary.value} — open the Arguments tab to change them`
    : 'No arguments — open the Arguments tab to choose a set or type values',
}]);

function showArgumentsTab() {
  activeResultsTab.value = 'arguments';
}

/* ------------------------------------------------------------------ *
 * What the recipe can be kept as
 * ------------------------------------------------------------------ */

const creatingFromRecipe = ref<CreateTarget | null>(null);

/*
 * A group test names an argument set and nothing else — no backend, no data
 * graph — because the group's nodes carry the stores (`subjectKinds.ts`). So
 * the only thing either object needs from this screen is a saved group and,
 * for a benchmark, a version to point its subject spec at.
 */
const createDisabledReason = computed<Partial<Record<CreateTarget, string | null>>>(() => {
  const unsaved = isNewQueryGroup.value || !queryGroupId.value
    ? 'Save this group first — a test and a benchmark both name a saved group.'
    : null;
  return {
    test: unsaved,
    benchmark: unsaved
      ?? (!versions.selectedVersionId.value ? 'Save a version first — a benchmark names one.' : null),
  };
});

async function createFromRecipe(target: CreateTarget) {
  if (createDisabledReason.value[target] || creatingFromRecipe.value) return;
  creatingFromRecipe.value = target;
  try {
    if (target === 'test') await createTestFromRecipe();
    else await createBenchmarkFromRecipe();
  } catch (error: unknown) {
    console.error(`[QueryGroupWorkArea] Failed to create a ${target}:`, error);
    toast.error(error instanceof Error ? error.message : `Failed to create a ${target}`);
  } finally {
    creatingFromRecipe.value = null;
  }
}

async function createTestFromRecipe() {
  const libraryId = queryGroupLibraryId.value || activeLibraryId.value;
  if (!libraryId) {
    toast.error('Choose a library first.');
    return;
  }
  // No `tags`, deliberately: with no form to ask on, the new test takes the
  // server's default — the query group's own tags, copied.
  const { data: created } = await apiClient.createTest({
    name: `${queryGroupName.value.trim() || 'Query group'} — recipe`,
    subject: queryGroupId.value,
    subjectKind: 'queryGroup',
    group: null,
    isPartOf: [libraryId],
  } as never);
  await apiClient.createTestVersion(created.id, {
    expectationKind: 'smoke',
    subjectVersion: versions.selectedVersionId.value,
    backend: null,
    cases: [{
      name: null,
      expected: null,
      expectedFormat: null,
      ordered: null,
      argumentSetVersion: argumentSetsState.executionArgumentSetId.value,
      dataGraphVersion: null,
      tupleSeeds: null,
    }],
  });
  toast.success('Created a test from this recipe — add an expectation when you know what it should return');
  emit('open-entity', { type: 'test', id: created.id });
}

/**
 * The argument reference a promoted benchmark should name — the set, not the
 * version. See the twin in `QueryWorkArea.vue` (issue #246).
 */
function promotedArgumentSetId(): string | null {
  if (!argumentSetsState.executionArgumentSetId.value) return null;
  return argumentSetsState.selectedSetId.value;
}

async function createBenchmarkFromRecipe() {
  const experiment = await benchmarksStore.createExperiment({
    name: `${queryGroupName.value.trim() || 'Query group'} — recipe`,
    description: null,
    status: 'Active',
  });
  await benchmarksStore.createVersion(experiment.id, {
    subjectSpecs: [{
      subject: versions.selectedVersionId.value!,
      inputs: [promotedArgumentSetId() ?? NO_ARGUMENTS_IRI],
    }],
    ...emptySettings(),
  });
  toast.success('Created a benchmark from this recipe — press Run on it to collect timings');
  emit('open-entity', { type: 'benchmark', id: experiment.id });
}

// Per-node execution feedback on the canvas (status ring, duration, row counts).
const canvasExecution = useCanvasExecutionStatus({
  nodeExecutions,
  failedNodeId,
  isExecuting,
  nodes,
});
const totalNodeDurationMs = canvasExecution.totalDurationMs;


const selectedResultFormat = execution.selectedResultFormat;
const executionError = execution.executionError;
const executionResultRaw = execution.executionResultRaw;
const executionResultJson = execution.executionResultJson;
const executionContentType = execution.executionContentType;
const showRuleSetSelectorDialog = ref(false);
const selectedNodeForRuleSet = ref<GraphNodeState | null>(null);

const versionOptions = versions.versionOptions;
const selectedVersion = versions.selectedVersionId;
const selectedVersionNumber = versions.selectedVersionNumber;
const selectedVersionId = versions.selectedVersionId;
const currentVersionNumberForDisplay = versions.currentVersionNumberForDisplay;
const versionMetadata = versions.versionMetadata;

const queryGroupIdShort = computed(() =>
  queryGroupId.value ? queryGroupId.value.slice(-6) : '',
);
const isNewQueryGroup = computed(() => queryGroupState.value === 'new');

const edgeFlowTypeOptions = ['CONTROL_FLOW', ...DATA_FLOW_TYPES];

const selectedNodeQueryId = computed(() => {
  const detail = selectedCanvasDetail.value;
  if (!detail || detail.type !== 'node') return null;
  if (detail.node.kind !== 'query' && detail.node.kind !== 'dynamic') return null;
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

// The inspector reads members and variables from the normalized graph state
// rather than from the save-payload drafts. The drafts are keyed the same way,
// but they are filled by whichever code path last ran - which is exactly the
// assignment-versus-reload asymmetry this panel kept exposing.

const selectedValidationIssues = computed<ValidationIssue[]>(() => {
  const detail = selectedCanvasDetail.value;
  if (!detail) {
    return [];
  }
  if (detail.type === 'node') {
    return allValidationIssues.value.filter(issue => issue.entityId === detail.node.id);
  }
  if (detail.type === 'edge') {
    return allValidationIssues.value.filter(issue => issue.entityId === detail.edge.id);
  }
  if (detail.type === 'io') {
    return allValidationIssues.value.filter(issue => issue.entityId === detail.entity.id);
  }
  return [];
});

const blockingIssues = computed(() =>
  allValidationIssues.value.filter(issue => issue.level === 'error'),
);

const handleSelectedVersionChange = (value: string | null) => {
  versions.setSelectedVersion(value);
};


const copyQueryGroupId = async () => {
  if (!queryGroupId.value) {
    toast.error('No query group selected');
    return;
  }
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(queryGroupId.value);
    toast.success('Query Group ID Copied');
  } catch (error) {
    console.error('Failed to copy query group ID:', error);
    toast.error('Failed to copy Query Group ID');
  }
};

const copyQueryGroupVersionId = async () => {
  const versionId = selectedVersionId.value;
  if (!versionId) {
    toast.error('No version ID available');
    return;
  }
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(versionId);
    toast.success('Query Group Version ID Copied');
  } catch (error) {
    console.error('Failed to copy query group version ID:', error);
    toast.error('Failed to copy Query Group Version ID');
  }
};

/* ------------------------------------------------------------------ *
 * Scratch groups.
 *
 * `+ New` in the Groups sidebar used to open a dialog that asked for a name
 * and a library before it would give you a canvas — the one section that still
 * made you fill in a form before you could start. A group's body is a canvas
 * rather than a string, which is why it was left behind, but a canvas
 * serializes: `QueryGroupGraphState` is plain data, so the browser-local
 * record holds the graph the same way a query's record holds its SPARQL, and
 * Save creates the group and its v1 in one click (nav doc §1).
 * ------------------------------------------------------------------ */

const draftsStore = useCallableDrafts();
const { activeLibraryId, activeLibraryName } = useActiveLibrary();
const isSavingVersion = ref(false);

interface GroupScratchBody {
  graphState?: QueryGroupGraphState;
  /** Node positions, kept beside the graph because the graph does not hold them. */
  canvasData?: string | null;
}

const { isScratch, flush: flushScratch } = useScratchRecord({
  scratchId: () => props.scratchId,
  missingMessage: 'That scratch group is not in this browser',
  track: [() => graph.currentGraphState.value, queryGroupName, queryGroupDescription],
  hydrate: (record) => {
    const body = (record.body ?? {}) as GroupScratchBody;
    queryGroupState.value = 'new';
    queryGroupId.value = '';
    queryGroupName.value = record.name;
    queryGroupDescription.value = record.description ?? '';
    queryGroupLibraryId.value = '';
    versions.reset();
    versions.currentVersionNumberForDisplay.value = null;
    versions.selectedVersionId.value = null;
    versions.selectedVersionNumber.value = null;
    const graphState = body.graphState ?? graph.initialGraphState;
    graph.applyGraphState({
      ...graphState,
      version: { ...graphState.version, canvasData: body.canvasData ?? null },
    });
    io.resetDrafts();
  },
  collect: (record) => ({
    name: queryGroupName.value || record.name,
    description: queryGroupDescription.value || null,
    body: {
      graphState: graph.currentGraphState.value,
      canvasData: graph.serializeCanvasSnapshot(),
    } satisfies GroupScratchBody,
  }),
});

/** A group still wearing its fallback name has to be named before saving. */
const UNTITLED_PATTERN = /^Untitled group \d+$/;
const needsName = computed(() => isScratch.value && UNTITLED_PATTERN.test(queryGroupName.value.trim()));

const canSave = computed(() => {
  if (isSavingVersion.value || isSaving.value) return false;
  // An empty canvas is nothing to save; the start and end nodes are
  // structural and are there before anything has been drawn.
  if (isScratch.value) return graph.currentGraphState.value.nodes.some((node) => node.kind !== 'start' && node.kind !== 'end');
  return !!queryGroupId.value;
});

const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);

function promptForNameInDetails() {
  activeResultsTab.value = 'details';
  toast.info('Give it a name in the Details tab, then save');
  void nextTick(() => detailsPanelRef.value?.focusName());
}

const detailsProps = computed(() => ({
  name: queryGroupName.value,
  description: queryGroupDescription.value,
  isScratch: isScratch.value,
  libraryName: activeLibraryName.value,
  entityId: isScratch.value ? null : (queryGroupId.value || null),
  entityNoun: 'group',
  taggableKind: 'queryGroup' as const,
  // A group has no backend of its own — every execution node carries one — and
  // nothing detects a canvas's inputs and outputs the way the validator does
  // for SPARQL.
  showBackend: false,
  showSignature: false,
  versionOptions: versionOptions.value.map((option) => ({
    value: option.value,
    label: option.label,
    comment: versionMetadata.value[option.value]?.comment ?? null,
    dateModified: versionMetadata.value[option.value]?.dateModified ?? null,
  })),
  selectedVersion: selectedVersionId.value,
  // What the group record points at, not what the canvas happens to be
  // showing: "current" is what a caller that names no version gets, and
  // reading an older one does not change that.
  currentVersion: versions.currentVersionId.value,
  // A scratch group has no server entity to point at anything.
  canSetCurrentVersion: !isScratch.value,
  canAnnotateVersions: !isScratch.value && !!queryGroupId.value,
  editCount: 0,
  draftSavedAt: null,
  draftSelected: false,
}));

/**
 * Point the group at one of its versions — where the Edit-details dialog's
 * Current Version dropdown would have been had a group ever had one, and the
 * same control the query screen's Details tab carries.
 *
 * The canvas keeps showing whatever it was showing: choosing what callers get
 * is not a request to read that version, and clicking the row beside the
 * button is there for when it is.
 */
async function setCurrentVersion(versionId: string) {
  const groupId = queryGroupId.value;
  if (!versionId || isScratch.value || !groupId || versionId === versions.currentVersionId.value) return;

  const previous = versions.currentVersionId.value;
  const versionNumber = versionMetadata.value[versionId]?.versionNumber ?? null;
  versions.setCurrentVersion(versionId);

  try {
    await queryGroupsStore.updateQueryGroup(groupId, { currentVersion: versionId });
    toast.success(
      versionNumber ? `v${versionNumber} is now the current version` : 'Current version updated',
    );
  } catch (error) {
    versions.setCurrentVersion(previous);
    const message = error instanceof Error ? error.message : 'Failed to set the current version';
    console.error('[QueryGroupWorkArea] Failed to set the current version', error);
    toast.error(message);
  }
}

/*
 * The note on a version, written from the row that displays it — the same
 * decision as the query screen's, for the same reason: Save is one click, and
 * the comment belongs where it is read rather than in a prompt in front of the
 * button. Optimistic, with the old note put back if the write fails.
 */
async function annotateVersion({ value, comment }: { value: string; comment: string | null }) {
  const groupId = queryGroupId.value;
  const meta = versionMetadata.value[value];
  if (!groupId || isScratch.value || !meta) return;

  const previous = meta.comment ?? null;
  const apply = (next: string | null) => {
    const entry = versionMetadata.value[value];
    if (entry) versionMetadata.value = { ...versionMetadata.value, [value]: { ...entry, comment: next } };
  };
  apply(comment);

  try {
    await queryGroupsStore.annotateQueryGroupVersion(groupId, meta.version, comment);
  } catch (error) {
    apply(previous);
    console.error('[QueryGroupWorkArea] Failed to save the version note', error);
    toast.error('Failed to save the note');
  }
}

/**
 * Save a scratch group: create the entity in the active library, then give
 * it the canvas as v1. The same two requests the creation dialog used to make,
 * minus the dialog.
 */
async function saveScratch(name: string) {
  const libraryId = activeLibraryId.value;
  if (!libraryId) {
    toast.error('Select a library before saving');
    return;
  }
  const scratchRecordId = props.scratchId!;
  flushScratch();

  let payload;
  try {
    payload = io.buildVersionCreatePayload({ versionComment: null });
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Unable to serialize the canvas');
    throw error;
  }

  let created;
  try {
    created = await queryGroupsStore.createQueryGroupFromForm({
      name,
      description: queryGroupDescription.value || null,
      isPartOf: libraryId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save';
    toast.error(`Could not save “${name}”: ${message}`);
    throw error;
  }

  // The group exists but has no version yet. A failure here leaves the scratch
  // record exactly where it is — the canvas is never the thing that gets lost.
  try {
    await apiClient.createQueryGroupVersion(created.id, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save';
    toast.error(`Created “${name}” but could not save its first version: ${message}`);
    throw error;
  }

  draftsStore.remove(scratchRecordId);
  toast.success(`Saved “${name}” as v1`);
  emit('scratch-saved', { id: created.id, name, libraryId });
}

/*
 * Save. It takes nothing: the bar collects no note and no name.
 */
async function save() {
  if (isSavingVersion.value || !canSave.value) return;
  isSavingVersion.value = true;
  try {
    if (isScratch.value) {
      await saveScratch(queryGroupName.value.trim() || 'Untitled group');
      return;
    }
    /*
     * A new version starts with no note. `versionComment` mirrors the loaded
     * version's, so carrying it over would caption the new version with
     * something written about a different one.
     */
    versionComment.value = '';
    await saveQueryGroup();
  } catch (error) {
    console.error('[QueryGroupWorkArea] Save failed', error);
  } finally {
    isSavingVersion.value = false;
  }
}

/*
 * Identity autosave for a saved group. Name and description are properties
 * of the entity rather than of a version, so the Details fields save directly —
 * exactly what the Edit dialog did, minus the dialog.
 */
let identitySaveHandle: ReturnType<typeof setTimeout> | null = null;
watch([queryGroupName, queryGroupDescription], () => {
  if (isScratch.value || !queryGroupId.value || isLoading.value || isNewQueryGroup.value) return;
  if (identitySaveHandle) clearTimeout(identitySaveHandle);
  identitySaveHandle = setTimeout(() => {
    identitySaveHandle = null;
    void submitMetadata({
      name: queryGroupName.value,
      description: queryGroupDescription.value || null,
    });
  }, 600);
});

/*
 * The Code tab.
 *
 * `POST /execute` with the group's id — the call Execute makes, built from the
 * same argument state, so the snippet and the button send the same body. A
 * group carries no `backendId`: each execution node names its own, and the
 * endpoint rejects the field for group targets.
 */
const executeUrl = computed(
  () => `${String(config.public.apiBaseUrl).replace(/\/$/, '')}/execute`,
);

/*
 * Two ways to pass the same values — a stored set version by id, or the values
 * inline. `POST /execute` takes either and rejects both together; neither is
 * the privileged one, so the tab offers the choice rather than making it. A
 * group carries no limits or offsets: the endpoint rejects them for group
 * targets, since a DAG has no single query to apply them to.
 */
const codeVariants = computed<CodeSnippetVariant[]>(() => {
  const targetId = queryGroupId.value || '<query-group-id>';
  const list: CodeSnippetVariant[] = [];

  const argumentSetId = argumentSetsState.executionArgumentSetId.value;
  if (argumentSetId) {
    list.push({
      id: 'stored',
      label: 'Stored set',
      note: 'Runs the argument set version by id. The values live in the library, frozen — the same call returns the same rows tomorrow.',
      request: {
        method: 'POST',
        url: executeUrl.value,
        body: { targetId, argumentSetIds: [argumentSetId] },
      },
    });
  }

  const inline = argumentSetsState.visibleValuesPayload();
  const inlineBody: Record<string, unknown> = { targetId };
  if (inline?.arguments?.length) inlineBody.arguments = inline.arguments;

  list.push({
    id: 'inline',
    label: 'Inline values',
    note: inputTuples.value.length
      ? 'Sends the values with the call. Nothing is saved in the library, so the caller can pass whatever it likes.'
      : 'This group takes no start tuples, so the call carries no arguments.',
    request: { method: 'POST', url: executeUrl.value, body: inlineBody },
  });

  return list;
});

/** Opens on whichever way Execute is currently running it. */
const codeDefaultVariantId = computed(() =>
  argumentSetsState.executionArgumentSetId.value ? 'stored' : 'inline',
);

const codeUnavailable = computed(() =>
  isNewQueryGroup.value || !queryGroupId.value
    ? 'This query group has not been saved yet — save it to get a callable id.'
    : null,
);

/** The group's start tuples: what a caller has to supply to run it. */
const codeArguments = computed<CodeSnippetArgument[]>(() =>
  inputTuples.value.map((tuple, index) => ({
    name: tuple.label || `tuple ${index + 1}`,
    detail: tuple.variables.map((variable) => variable.name).filter(Boolean).join(', '),
  })),
);

/**
 * The subject a test would name, or null while there is nothing to name.
 *
 * A test points at a saved entity, so a scratch group has no tests and can
 * acquire none — which is why the tab is absent rather than empty, the same
 * rule the rules screen follows. `useTestsSurface` adds the second absence: a
 * build with the feature off has no tests to list either.
 */
const { testSubject } = useTestsSurface();
const testSubjectId = testSubject(() => (isScratch.value ? null : queryGroupId.value));

const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'details', label: 'Details' },
  { id: 'editor', label: 'Editor' },
  { id: 'arguments', label: 'Arguments' },
  { id: 'results', label: 'Results' },
  { id: 'code', label: 'Code' },
  { id: 'tests', label: 'Tests', hidden: !testSubjectId.value },
]);

// Deleting cascades every version, node, edge and tuple on the API side, so it is
// gated behind a confirmation rather than firing straight from the menu.
const deleteConfirmOpen = ref(false);
const requestDeleteQueryGroup = () => {
  if (!queryGroupId.value) {
    toast.error('No query group selected');
    return;
  }
  deleteConfirmOpen.value = true;
};
const confirmDeleteQueryGroup = () => {
  deleteConfirmOpen.value = false;
  void deleteQueryGroup();
};

const transferDialogOpen = ref(false);
const transferMode = ref<'clone' | 'move'>('clone');
const libraryOptions = computed(() =>
  (librariesStore.visibleLibraries.value ?? []).map((library) => ({ id: library.id, name: library.name })),
);

const requestCloneQueryGroup = () => {
  transferMode.value = 'clone';
  transferDialogOpen.value = true;
};

const requestMoveQueryGroup = () => {
  transferMode.value = 'move';
  transferDialogOpen.value = true;
};

const handleTransferSubmit = async (payload: { name?: string; libraryId: string }) => {
  if (transferMode.value === 'clone') {
    await cloneQueryGroup(payload);
  } else {
    await moveQueryGroup({ libraryId: payload.libraryId });
  }
};

const handleSelectIoEntity = (payload: { entityId: string; parentNodeId?: string | null }) => {
  if (payload.parentNodeId) {
    graph.selectNode(payload.parentNodeId);
  }
  graph.selectIoEntity(payload.entityId, payload.parentNodeId ?? null);
};

const handleDeleteNode = (nodeId: string) => {
  const deleted = graph.deleteNode(nodeId);
  if (deleted) {
    toast.success('Node deleted');
  }
};

const handleDeleteEdge = (edgeId: string) => {
  const deleted = graph.deleteEdge(edgeId);
  if (deleted) {
    toast.success('Edge deleted');
  }
};

/**
 * Selecting something on the canvas is how you ask to edit it, so the
 * inspector follows the click to the Editor tab rather than leaving the
 * selection's fields one tab away. Deferred a tick for the same reason edge
 * creation defers it: switching tabs while the canvas element still holds
 * focus trips reka's aria-hidden guard.
 */
const showEditorTab = () => {
  setTimeout(() => {
    activeResultsTab.value = 'editor';
  }, 0);
};

const onNodeClick = (event: { node: Node }) => {
  graph.selectNode(event.node.id);
  showEditorTab();
};

const onEdgeClick = (event: { edge: Edge }) => {
  graph.selectEdge(event.edge.id);
  showEditorTab();
};

const onPaneClick = () => {
  graph.clearSelection();
  nodeContextMenu.value = null;
  layoutMenuOpen.value = false;
};

/**
 * Right-click menu for a canvas node. Positioned against the canvas element
 * rather than the page, so it stays put when the surrounding layout scrolls.
 */
const nodeContextMenu = ref<{ nodeId: string; x: number; y: number } | null>(null);

const onNodeContextMenu = ({ event, node }: NodeMouseEvent) => {
  event.preventDefault();
  const kind = (node.data as { kind?: unknown } | undefined)?.kind
    ?? currentGraphState.value.nodes.find(candidate => candidate.id === node.id)?.kind;
  // Start and end nodes cannot be deleted or duplicated, so offering a menu
  // whose every item is a no-op would just be a dead end.
  if (kind === 'start' || kind === 'end') {
    nodeContextMenu.value = null;
    return;
  }
  // A context menu only ever fires from a right-click, never a touch.
  const mouseEvent = event as MouseEvent;
  const bounds = canvasContainerRef.value?.getBoundingClientRect();
  nodeContextMenu.value = {
    nodeId: node.id,
    x: mouseEvent.clientX - (bounds?.left ?? 0),
    y: mouseEvent.clientY - (bounds?.top ?? 0),
  };
};

const duplicateContextNode = () => {
  const menu = nodeContextMenu.value;
  nodeContextMenu.value = null;
  if (!menu) return;
  const newNodeId = `urn:ui-temp:node-${nodeIdCounter++}`;
  if (graph.duplicateNode(menu.nodeId, newNodeId)) {
    graph.selectNode(newNodeId);
    toast.success('Node duplicated');
  }
};

const deleteContextNode = () => {
  const menu = nodeContextMenu.value;
  nodeContextMenu.value = null;
  if (!menu) return;
  if (graph.deleteNode(menu.nodeId)) {
    toast.success('Node deleted');
  }
};

const handleKeyDown = (event: KeyboardEvent) => {
  // Ignore when typing in inputs/textareas/contenteditable to avoid swallowing Backspace/Delete
  const target = event.target as HTMLElement | null;
  const inEditable = !!target && (
    target.closest('input, textarea, [contenteditable="true"]') !== null ||
    (target as any).isContentEditable === true
  );
  if (inEditable) {
    return;
  }

  // Check if Delete or Backspace key is pressed
  if (event.key === 'Delete' || event.key === 'Backspace') {
    // Prevent default behavior (like browser back navigation on Backspace)
    event.preventDefault();

    // Try to delete the selected item
    const deleted = graph.deleteSelected();

    // Show feedback to user
    if (deleted) {
      const selection = graph.selectedCanvasDetail.value;
      if (selection?.type === 'node') {
        toast.success('Node deleted');
      } else if (selection?.type === 'edge') {
        toast.success('Edge deleted');
      }
    }
  }
};

const toVueFlowEdge = (edge: GraphEdgeState): Edge => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  animated: edge.flowType === 'CONTROL_FLOW',
  data: {
    flowType: edge.flowType,
    sourceOutputId: edge.sourceOutputId,
    targetInputId: edge.targetInputId,
  },
});

let nodeIdCounter = nodes.value.length + 1;
let edgeIdCounter = edges.value.length + 1;

watch(
  () => nodes.value.length,
  (length) => {
    nodeIdCounter = Math.max(nodeIdCounter, length + 1);
  },
);

watch(
  () => edges.value.length,
  (length) => {
    edgeIdCounter = Math.max(edgeIdCounter, length + 1);
  },
);

/**
 * Draw a node the toolbar has just added to the graph state, and select it.
 *
 * Call this *after* the node is in `currentGraphState`: the row it lands on is
 * counted from the execution nodes the state holds.
 *
 * The canvas data is derived from the graph node rather than written out beside
 * it. Each of these four adds used to assemble that object by hand, which meant
 * every node kind had to remember `kind` — and the canvas component defaults a
 * missing one to `query`, so forgetting it produced a node titled "Query Node"
 * rather than an error. A ruleset node read that way until #379.
 *
 * The dynamic node's data has been missing `kind` all along and never showed
 * it: adding one provokes a refresh of every canvas node out of the graph
 * state, and that refresh lands before the node is first painted. Sampled every
 * 100ms from the click, it never once read "Query Node" — while a ruleset node
 * added the same way read it indefinitely, because nothing refreshed it. A
 * canvas that says what its nodes are only while an unrelated refresh happens
 * to fire is one edit away from not saying it at all, which is why this is one
 * function now rather than four.
 */
/*
 * Every node this toolbar adds starts with an empty `label`, because nobody has
 * named it yet. The five buttons used to seed it with the kind's own name, which
 * is what a node with no name is *called* rather than a name it has — and while
 * that was true of every node, the inspector's "Display label" field could not
 * win over it and renaming a node changed nothing on the canvas. What a node is
 * called is `canvasNodeLabel`'s answer, and it draws the same card as before for
 * a node still carrying no name of its own.
 */
const drawAddedNode = (graphNode: GraphNodeState, position?: { x: number; y: number }) => {
  const executionNodeCount = currentGraphState.value.nodes.filter(
    node => node.kind === 'query' || node.kind === 'dynamic' || node.kind === 'ruleset' || node.kind === 'patch',
  ).length;

  const data = buildCanvasNodeData(graphNode, currentGraphState.value.iriMap);

  nodes.value.push({
    id: graphNode.id,
    // The same type and handle sides the graph loader gives a node: a node added
    // here used to come back as a plain default box with top and bottom handles,
    // which is one canvas drawn to two conventions.
    type: 'query-group-node',
    ...LEFT_TO_RIGHT_HANDLES,
    position: position ?? { x: 300, y: 80 + (executionNodeCount - 1) * 180 },
    label: data.label,
    deletable: true,
    data,
  });

  graph.selectNode(graphNode.id);
};

const addQueryNode = () => {
  const newNodeId = `urn:ui-temp:node-${nodeIdCounter++}`;

  const newGraphNode: GraphNodeState = {
    id: newNodeId,
    kind: 'query',
    label: '',
    queryId: null,
    queryVersionId: null,
    queryEntityId: null,
    backendId: null,
    inputs: [],
    outputs: [],
  };

  currentGraphState.value = {
    ...currentGraphState.value,
    nodes: [...currentGraphState.value.nodes, newGraphNode],
  };

  drawAddedNode(newGraphNode);
  toast.success('Query node added');
};

const addDynamicQueryNode = () => {
  const newNodeId = `urn:ui-temp:node-${nodeIdCounter++}`;

  const newGraphNode: GraphNodeState = {
    id: newNodeId,
    kind: 'dynamic',
    label: '',
    queryId: null,
    queryVersionId: null,
    queryEntityId: null,
    backendId: null,
    inputs: [],
    outputs: [],
  };

  currentGraphState.value = {
    ...currentGraphState.value,
    nodes: [...currentGraphState.value.nodes, newGraphNode],
  };

  drawAddedNode(newGraphNode);
  toast.success('Dynamic query node added');
};

const addRulesetNode = () => {
  const newNodeId = `urn:ui-temp:node-${nodeIdCounter++}`;

  const newGraphNode: GraphNodeState = {
    id: newNodeId,
    kind: 'ruleset',
    label: '',
    ruleSetId: null,
    ruleSetVersionId: null,
    inputs: [],
    outputs: [],
  };

  currentGraphState.value = {
    ...currentGraphState.value,
    nodes: [...currentGraphState.value.nodes, newGraphNode],
  };

  drawAddedNode(newGraphNode);
  toast.success('Ruleset node added');
};

/**
 * Add a node that derives what an update would change, without running it.
 *
 * Its two RDF outputs are minted here rather than at assignment, which is the
 * one thing that differs from every other node on this toolbar. They are the
 * node — a patch node with one port, or none, is not a partly-configured patch
 * node but a shape the server refuses (`NODE_PATCH_OUTPUT_PORTS_MISSING`) — and
 * they belong to the group rather than to any query version, so assigning,
 * changing or clearing the update leaves them and the edges that carry them
 * alone.
 */
const addPatchNode = () => {
  const newNodeId = `urn:ui-temp:node-${nodeIdCounter++}`;
  const deletionsPortId = mintTempId('patch-deletions');
  const additionsPortId = mintTempId('patch-additions');

  const halves = [
    { id: deletionsPortId, label: 'deletions', description: 'Quads the update would remove' },
    { id: additionsPortId, label: 'additions', description: 'Quads the update would add' },
  ] as const;

  currentGraphState.value = {
    ...currentGraphState.value,
    ioEntities: {
      ...currentGraphState.value.ioEntities,
      ...Object.fromEntries(
        halves.map(half => [
          half.id,
          {
            id: half.id,
            kind: 'TriplesQuadsIO' as const,
            name: half.label,
            description: half.description,
            memberEntries: null,
            arity: null,
            origin: 'query-group' as const,
          },
        ]),
      ),
    },
  };

  const newGraphNode: GraphNodeState = {
    id: newNodeId,
    kind: 'patch',
    label: '',
    queryId: null,
    queryVersionId: null,
    queryEntityId: null,
    backendId: null,
    deletionsOutputId: deletionsPortId,
    additionsOutputId: additionsPortId,
    inputs: [],
    outputs: halves.map(half => ({
      id: half.id,
      label: half.label,
      entityType: 'TriplesQuadsIO' as const,
      direction: 'output' as const,
      origin: 'query-group' as const,
      resolved: true,
    })),
  };

  currentGraphState.value = {
    ...currentGraphState.value,
    nodes: [...currentGraphState.value.nodes, newGraphNode],
  };

  for (const half of halves) {
    registerRdfIoEntity({
      id: half.id,
      name: half.label,
      description: half.description,
      ioType: 'output',
    });
  }

  drawAddedNode(newGraphNode);
  toast.success('Patch node added');
};

const onConnect = (params: Connection) => {
  if (!params.source || !params.target) {
    toast.error('Invalid connection: missing source or target');
    return;
  }

  const sourceNode = currentGraphState.value.nodes.find((n) => n.id === params.source);
  const targetNode = currentGraphState.value.nodes.find((n) => n.id === params.target);

  if (!sourceNode || !targetNode) {
    toast.error('Invalid connection: source or target node not found');
    return;
  }

  const recommendation = recommendFlowType(sourceNode, targetNode);
  const newEdgeId = `urn:ui-temp:edge-${edgeIdCounter++}`;

  // Endpoint binding lives in the command layer, which binds only when exactly
  // one candidate fits and reports why when it cannot. Guessing here was how
  // the work area and the graph composable came to disagree.
  const { applied, diagnostics } = graph.connectNodes({
    edgeId: newEdgeId,
    sourceId: params.source,
    targetId: params.target,
    flowType: recommendation.defaultFlowType,
  });

  if (!applied) {
    toast.error(diagnostics.find((entry) => entry.level === 'error')?.message ?? 'That connection is not allowed');
    return;
  }

  graph.selectEdge(newEdgeId);
  showEditorTab();

  let message = `Edge created with ${recommendation.defaultFlowType}`;
  if (recommendation.confidence === 'low') {
    message += ' (low confidence - please verify)';
  }
  toast.success(message);

  // An edge whose endpoints could not be chosen for it is a legal draft, but
  // the author has to be told it still needs a decision.
  const unresolved = [...diagnostics, ...(recommendation.warnings ?? []).map((message) => ({ level: 'warning' as const, code: 'recommendation', message }))]
    .filter((entry) => entry.level === 'warning')
    .map((entry) => entry.message);
  if (unresolved.length > 0) {
    setTimeout(() => {
      toast.warning(unresolved.join('; '));
    }, 500);
  }
};

/** How far to the right of its source a new step lands, and how far apart siblings stack. */
const STEP_OFFSET_X = 320;
const STEP_STACK_Y = 180;

/** Where a template's first column and first row land on a fresh canvas. */
const TEMPLATE_ORIGIN_X = 320;
const TEMPLATE_ORIGIN_Y = 80;

/**
 * Draw a whole starting shape, wiring included.
 *
 * The second half of the guided empty state. The command is the one act - a
 * template whose last edge was refused must leave nothing behind - so the ids
 * for every node and edge are minted up front and the canvas draws only what
 * came back applied.
 *
 * Positions come from the template rather than from `positionForStep`: that
 * helper reads where a source *landed* and stacks siblings off it, which is
 * right for one step at a time and wrong for a shape whose rows are the thing
 * being expressed. A fan-in drawn by stacking would put its two sources in the
 * order they were minted rather than the order they are read.
 */
const startFromTemplate = (template: CanvasTemplate) => {
  const nodeIds = template.steps.map(() => `urn:ui-temp:node-${nodeIdCounter++}`);
  const edgeIds = template.edges.map(() => `urn:ui-temp:edge-${edgeIdCounter++}`);

  const { applied, diagnostics, steps } = graph.applyTemplate({ template, nodeIds, edgeIds });

  if (!applied) {
    toast.error(
      diagnostics.find((entry) => entry.level === 'error')?.message ?? 'That template could not be applied',
    );
    return;
  }

  steps.forEach((step, index) => {
    const placement = template.steps[index];
    drawAddedNode(step, {
      x: TEMPLATE_ORIGIN_X + placement.column * STEP_OFFSET_X,
      y: TEMPLATE_ORIGIN_Y + placement.row * STEP_STACK_Y,
    });
  });

  // The first step is what the author acts on next, so it keeps the selection
  // `drawAddedNode` hands to whichever node was drawn last.
  if (steps.length > 0) {
    graph.selectNode(steps[0].id);
  }
  showEditorTab();
  toast.success(`${template.label} added — ${template.steps.length} steps to fill in`);

  // Same delay and the same reason as `onConnect` and `addStep`: what the shape
  // leaves for the author is a second sentence, not a longer first one.
  const note = diagnostics.find((entry) => entry.code === 'template-ports-unbound');
  const unresolved = diagnostics.filter((entry) => entry.level === 'warning').map((entry) => entry.message);
  const followUp = [...(note ? [note.message] : []), ...unresolved];
  if (followUp.length > 0) {
    setTimeout(() => {
      toast.info(followUp.join('; '));
    }, 500);
  }
};

/**
 * Where a step drawn from `sourceId` goes: one column to its right, dropped
 * down a row at a time until the spot is free.
 *
 * A fan-out is the ordinary case — two steps from one source — and landing the
 * second exactly on the first would hide it under a node the author would then
 * have to drag off to find.
 */
const positionForStep = (sourceId: string) => {
  const source = nodes.value.find((node) => node.id === sourceId);
  if (!source) return undefined;

  const x = source.position.x + STEP_OFFSET_X;
  let y = source.position.y;
  while (nodes.value.some((node) => Math.abs(node.position.x - x) < 40 && Math.abs(node.position.y - y) < 120)) {
    y += STEP_STACK_Y;
  }
  return { x, y };
};

/**
 * Why the selected node cannot have a step added after it, or null when it can.
 *
 * Stated rather than merely disabling: "add step" with nothing selected is the
 * first thing anyone tries, and a greyed button that will not say why is a
 * feature the author concludes is broken.
 */
const addStepDisabledReason = computed(() => {
  const detail = selectedCanvasDetail.value;
  if (detail?.type !== 'node') return 'Select the step this one should follow';
  if (detail.node.kind === 'end') return 'Nothing runs after the group output';
  return null;
});

/**
 * The next step in a chain: a query node and the edge feeding it, in one click.
 *
 * The linear-pipeline shape on top of the DAG. Everything the canvas can
 * decide is decided — where it goes, which node feeds it, what the edge
 * carries — leaving the author on the one thing only they know, which is why
 * the new node is what ends up selected with the Editor tab open: the query
 * picker is the next thing under the cursor.
 *
 * The toast names the flow type because from a query node it is nearly always
 * "runs after": a step with no query yet has no query type for the recommender
 * to read, so the edge orders execution and carries nothing until the author
 * has chosen a query and set it. Saying which one it got is the difference
 * between a default and a surprise, and the second toast carries whatever the
 * command could not settle — including a recommendation its target's kind
 * forbade, which is the one an author is most likely to have expected.
 */
const addStep = () => {
  const detail = selectedCanvasDetail.value;
  if (detail?.type !== 'node' || addStepDisabledReason.value) return;

  const sourceId = detail.node.id;
  const newNodeId = `urn:ui-temp:node-${nodeIdCounter++}`;
  const newEdgeId = `urn:ui-temp:edge-${edgeIdCounter++}`;

  const { applied, diagnostics, flowType } = graph.addStep({
    sourceId,
    nodeId: newNodeId,
    edgeId: newEdgeId,
    label: '',
  });

  if (!applied) {
    toast.error(diagnostics.find((entry) => entry.level === 'error')?.message ?? 'That step could not be added');
    return;
  }

  const step = currentGraphState.value.nodes.find((node) => node.id === newNodeId);
  if (step) {
    drawAddedNode(step, positionForStep(sourceId));
  }
  showEditorTab();
  toast.success(`Step added (${flowTypeLabel(flowType)})`);

  // Same delay and the same reason as `onConnect`: what the connection could
  // not settle is a second sentence, not a longer first one.
  const unresolved = diagnostics.filter((entry) => entry.level === 'warning').map((entry) => entry.message);
  if (unresolved.length > 0) {
    setTimeout(() => {
      toast.warning(unresolved.join('; '));
    }, 500);
  }
};

const updateNodeLabel = graph.updateNodeLabel;
const updateNodeBackend = graph.updateNodeBackend;
const updateNodeMediaType = graph.updateNodeMediaType;
/**
 * A flow type the endpoints cannot carry is refused by the command layer, and
 * the refusal has to be said out loud. `onConnect` already toasts the same
 * class of failure when a connection is rejected; a flow-type change was the
 * one path that swallowed it, so picking QUERY_ID on an edge into an ordinary
 * query node looked like it had worked and quietly had not.
 */
const updateEdgeFlowType = (edgeId: string, flowType: GraphEdgeState['flowType']) => {
  const { applied, diagnostics } = graph.updateEdgeFlowType(edgeId, flowType);
  if (!applied) {
    toast.error(
      diagnostics.find((entry) => entry.level === 'error')?.message ?? 'That flow type is not allowed on this edge.',
    );
  }
};
const updateEdgeWhenEmpty = graph.updateEdgeWhenEmpty;
const updateEdgeVariableMappings = graph.updateEdgeVariableMappings;

const { layout: applyAutoLayout } = useAutoLayout();

/**
 * The layouts on offer. All four are dagre - the differences are the rank
 * direction and the ranker, which is what actually decides how a graph reads:
 * a linear pipeline wants a tight chain, a fan-out wants balanced ranks, and
 * a graph whose last steps should line up wants every node pushed as late as
 * its dependencies allow.
 */
const layoutPresets = [
  {
    id: 'flow-lr',
    label: 'Flow, left to right',
    hint: 'Balanced ranks. Best general choice.',
    options: { direction: 'LR' as const, ranker: 'network-simplex' as const, rankSep: 140, nodeSep: 70 },
  },
  {
    id: 'flow-tb',
    label: 'Flow, top to bottom',
    hint: 'Same ranks, stacked. Good for tall, narrow graphs.',
    options: { direction: 'TB' as const, ranker: 'network-simplex' as const, rankSep: 110, nodeSep: 80 },
  },
  {
    id: 'compact',
    label: 'Compact chain',
    hint: 'Keeps chains tight rather than spread out.',
    options: { direction: 'LR' as const, ranker: 'tight-tree' as const, rankSep: 100, nodeSep: 48 },
  },
  {
    id: 'align-ends',
    label: 'Align final steps',
    hint: 'Every step runs as late as it can, so outputs line up.',
    options: { direction: 'LR' as const, ranker: 'longest-path' as const, rankSep: 140, nodeSep: 70 },
  },
] as const;

type LayoutPresetId = (typeof layoutPresets)[number]['id'];

const LAYOUT_PRESET_STORAGE_KEY = 'sqlib:queryGroupLayoutPreset';

const readStoredLayoutPreset = (): LayoutPresetId => {
  if (typeof window === 'undefined') return 'flow-lr';
  try {
    const stored = window.localStorage.getItem(LAYOUT_PRESET_STORAGE_KEY);
    const match = layoutPresets.find((preset) => preset.id === stored);
    return match?.id ?? 'flow-lr';
  } catch {
    // A blocked localStorage costs a remembered preference, nothing more.
    return 'flow-lr';
  }
};

const layoutPresetId = ref<LayoutPresetId>(readStoredLayoutPreset());
const layoutMenuOpen = ref(false);
const activeLayoutPreset = computed(
  () => layoutPresets.find((preset) => preset.id === layoutPresetId.value) ?? layoutPresets[0],
);

/** Start and End are always present, so "empty" means no execution nodes. */
const canvasIsEmpty = computed(() =>
  currentGraphState.value.nodes.every((node) => node.kind === 'start' || node.kind === 'end'),
);

/**
 * Re-position nodes with dagre. Positions are canvas data, so this is a normal
 * unsaved edit - the user still has to save the version to keep it.
 */
const autoLayoutCanvas = (presetId: LayoutPresetId = layoutPresetId.value) => {
  layoutMenuOpen.value = false;
  if (nodes.value.length === 0) return;
  const preset = layoutPresets.find((entry) => entry.id === presetId) ?? layoutPresets[0];
  layoutPresetId.value = preset.id;
  try {
    window.localStorage.setItem(LAYOUT_PRESET_STORAGE_KEY, preset.id);
  } catch {
    // See readStoredLayoutPreset: not remembering the choice is the whole cost.
  }

  /*
   * The nodes carry the sizes VueFlow measured for them, and passing those to
   * dagre is what keeps ranks from colliding: Start and End are ~110px pills
   * while a query card is 220-320px wide and as tall as its label wraps, so a
   * single nominal box size puts cards on top of each other.
   */
  const { nodes: laidOut, edges: routedEdges } = applyAutoLayout(nodes.value, edges.value, {
    ...preset.options,
    withEdgePoints: true,
  });

  const laidOutById = new Map(laidOut.map((node) => [node.id, node]));
  for (const node of nodes.value) {
    const laid = laidOutById.get(node.id);
    if (!laid) continue;
    node.position = { ...laid.position };
    /*
     * Handles move with the layout, and every node moves together. A top-to-
     * bottom arrangement whose nodes still join left-to-right sends each edge
     * out of one card's flank and around to the next card's underside, which
     * is the detour no ranker can lay out its way around.
     */
    node.sourcePosition = laid.sourcePosition;
    node.targetPosition = laid.targetPosition;
  }

  /*
   * Keep the lanes dagre reserved for the edges that skip a rank. Without them
   * such an edge takes the short way to its target and crosses whatever cards
   * stand in between; see QueryGroupCanvasEdge.
   */
  const routeById = new Map(
    routedEdges.map((edge) => [edge.id, (edge.data as { layoutPoints?: LayoutPoint[] } | undefined)?.layoutPoints ?? null]),
  );
  for (const edge of edges.value) {
    edge.data = { ...(edge.data ?? {}), layoutPoints: routeById.get(edge.id) ?? null };
  }

  nextTick(() => {
    // Handles that moved to another side are measured at their old one until
    // the node is re-read, and an edge drawn to a stale handle floats free.
    vueFlowRef.value?.updateNodeInternals(nodes.value.map((node) => node.id));
    // Arranging a graph that no longer fits the viewport is only half the job.
    vueFlowRef.value?.fitView({ padding: 0.2, duration: 300 });
  });
  toast.success(`Canvas arranged - ${preset.label.toLowerCase()}`);
};

/**
 * A dragged node invalidates the routes dagre computed around where it used to
 * be, so the edges go back to routing themselves until the next tidy up.
 */
const dropStaleEdgeRoutes = () => {
  for (const edge of edges.value) {
    if ((edge.data as { layoutPoints?: unknown } | undefined)?.layoutPoints) {
      edge.data = { ...(edge.data ?? {}), layoutPoints: null };
    }
  }
};
const updateEdgeSourceOutput = graph.updateEdgeSourceOutput;
const updateEdgeTargetInput = graph.updateEdgeTargetInput;

const syncIoDraftEntity = (entityId: string) => {
  const entity = currentGraphState.value.ioEntities[entityId];
  if (!entity) {
    return;
  }
  const trimmedName = typeof entity.name === 'string' ? entity.name.trim() : '';
  const normalizedName = trimmedName.length > 0 ? trimmedName : null;
  const normalizedDescription =
    typeof entity.description === 'string' && entity.description.trim().length > 0
      ? entity.description.trim()
      : null;

  switch (entity.kind) {
    case 'QueryInputTuple': {
      const existing = ioDraftStore.inputTuples.value.get(entityId);
      if (existing) {
        ioDraftStore.inputTuples.value.set(entityId, { ...existing, name: normalizedName });
      }
      break;
    }
    case 'QueryOutputTuple': {
      const existing = ioDraftStore.outputTuples.value.get(entityId);
      if (existing) {
        ioDraftStore.outputTuples.value.set(entityId, {
          ...existing,
          name: normalizedName ?? existing.name ?? entityId,
        });
      }
      break;
    }
    case 'TriplesQuadsIO': {
      const existing = ioDraftStore.rdfOutputs.value.get(entityId);
      if (existing) {
        ioDraftStore.rdfOutputs.value.set(entityId, {
          ...existing,
          name: normalizedName,
          description: normalizedDescription,
        });
      }
      break;
    }
    case 'BooleanIO': {
      const existing = ioDraftStore.booleanOutputs.value.get(entityId);
      if (existing) {
        ioDraftStore.booleanOutputs.value.set(entityId, {
          ...existing,
          name: normalizedName,
          description: normalizedDescription,
        });
      }
      break;
    }
    case 'QueryIdInput': {
      const existing = ioDraftStore.queryIdInputs.value.get(entityId);
      if (existing) {
        ioDraftStore.queryIdInputs.value.set(entityId, {
          ...existing,
          name: normalizedName,
          description: normalizedDescription,
        });
      }
      break;
    }
    default:
      break;
  }
};

const updateIoEntityState = (
  entityId: string,
  updater: (entity: IoEntityRecord) => IoEntityRecord,
) => {
  const existing = currentGraphState.value.ioEntities[entityId];
  if (!existing) {
    return;
  }
  currentGraphState.value = {
    ...currentGraphState.value,
    ioEntities: {
      ...currentGraphState.value.ioEntities,
      [entityId]: updater(existing),
    },
  };
  syncIoDraftEntity(entityId);
};

const updateIoEntityName = (entityId: string, name: string) => {
  updateIoEntityState(entityId, (entity) => ({
    ...entity,
    name: name.trim(),
  }));
};

const updateIoEntityDescription = (entityId: string, description: string | null) => {
  const normalized = description && description.trim().length > 0 ? description.trim() : null;
  updateIoEntityState(entityId, (entity) => ({
    ...entity,
    description: normalized ?? null,
  }));
};

/** The node kinds that name a query version, and so can be assigned one. */
const QUERY_ASSIGNABLE_KINDS = new Set(['query', 'dynamic', 'patch']);

/**
 * The library's queries, for the inspector's query dropdown.
 *
 * Loaded against the group's library, falling back to the one the user is
 * working in — a scratch group has no library of its own yet, and asking for
 * the queries of library `''` is how the chooser used to come up empty on a
 * group that had not been saved.
 */
const queryAssignmentOptions = useQueryAssignmentOptions(
  computed(() => queryGroupLibraryId.value || activeLibraryId.value || ''),
  queriesStore,
);

// Loaded when there is something to assign to, rather than on every group open.
watch(
  [selectedCanvasDetail, () => queryGroupLibraryId.value || activeLibraryId.value],
  ([detail]) => {
    if (!detail || detail.type !== 'node') return;
    if (!QUERY_ASSIGNABLE_KINDS.has(detail.node.kind)) return;
    void queryAssignmentOptions.ensureLoaded();
  },
  { immediate: true },
);

/**
 * Assign a query version to a node, from the inspector's dropdown.
 *
 * The dropdown offers what the catalogue holds, so the name and version number
 * the assignment needs are read from there rather than asked for again.
 */
const handleAssignQuery = async (payload: { nodeId: string; queryId: string; queryVersionId: string }) => {
  const option = queryAssignmentOptions.options.value.find((entry) => entry.id === payload.queryId);
  const version = option?.versions.find((entry) => entry.id === payload.queryVersionId);
  if (!option || !version) {
    toast.error('That query version is no longer available');
    return;
  }
  graph.selectNode(payload.nodeId);
  await execution.assignQueryToNode(payload.nodeId, {
    queryId: option.id,
    queryVersionId: version.id,
    queryVersionNumber: version.version,
    queryName: option.name,
  });
};

const executeQueryGroup = execution.executeQueryGroup;

/*
 * The group's commands, on the same footing as the query's: registered while
 * this work area is mounted, gone when it is not. A new group has nothing to
 * run — the run bar says so too — so `when` mirrors the button's disabled
 * state rather than letting the shortcut fail silently.
 */
useCommand([
  {
    id: 'queryGroup.run',
    title: 'Run the query group',
    group: 'Run',
    keys: 'Mod+Enter',
    keywords: 'execute pipeline',
    when: () => !isExecuting.value && !isNewQueryGroup.value,
    run: executeQueryGroup,
  },
  {
    id: 'queryGroup.save',
    title: 'Save the query group',
    group: 'Query group',
    keys: 'Mod+s',
    keywords: 'version commit',
    when: () => canSave.value && !isSavingVersion.value,
    run: () => (needsName.value ? promptForNameInDetails() : save()),
  },
]);

const handleRequestRuleSetAssignment = (nodeId: string) => {
  graph.selectNode(nodeId);
  const node = currentGraphState.value.nodes.find(entry => entry.id === nodeId);
  if (!node || node.kind !== 'ruleset') {
    console.error('[QueryGroupWorkArea] Invalid node for ruleset assignment', { node, nodeKind: node?.kind });
    toast.error('Select a ruleset node to assign a ruleset');
    return;
  }
  selectedNodeForRuleSet.value = node;
  showRuleSetSelectorDialog.value = true;
};

/**
 * Add a data graph input to the start node.
 *
 * A group's start node declares two independent kinds of external input: input
 * tuples, edited above as the group's signature, and data graphs — RDF the
 * caller hands in for the group to work over. They are separate slots rather
 * than alternatives, so a group may declare both and a run fills each from its
 * own source: `arguments` for the tuples, `dataGraphs` for the graphs.
 *
 * The port is a `TriplesQuadsIO` owned by the group, like a ruleset node's RDF
 * ports, so no query version can take it away.
 */
const addStartDataGraphInput = (nodeId: string) => {
  const node = currentGraphState.value.nodes.find(entry => entry.id === nodeId);
  if (!node || node.kind !== 'start') {
    toast.error('Data graph inputs belong to the start node');
    return;
  }

  const existingCount = node.outputs.filter(port => port.entityType === 'TriplesQuadsIO').length;
  const portId = mintTempId('start-data-graph');
  const label = existingCount === 0 ? 'data graph' : `data graph ${existingCount + 1}`;
  const description = 'Data graph supplied to the group at run time';

  currentGraphState.value = {
    ...currentGraphState.value,
    ioEntities: {
      ...currentGraphState.value.ioEntities,
      [portId]: {
        id: portId,
        kind: 'TriplesQuadsIO',
        name: label,
        description,
        memberEntries: null,
        arity: null,
        origin: 'query-group',
      },
    },
  };

  graph.updateGraphNodeState(nodeId, (current) => ({
    ...current,
    outputs: [
      ...current.outputs,
      {
        id: portId,
        label,
        entityType: 'TriplesQuadsIO',
        direction: 'output',
        origin: 'query-group',
        resolved: true,
      },
    ],
  }));

  registerRdfIoEntity({
    id: portId,
    name: label,
    description,
    ioType: 'input',
  });

  graph.selectIoEntity(portId, nodeId);
  toast.success('Data graph input added');
};

/**
 * Remove a data graph input from the start node, and the edges that fed on it.
 *
 * An edge left pointing at a port that no longer exists is refused at save with
 * a message about an undeclared port, which reads as a bug rather than as the
 * consequence of the deletion the author just asked for.
 */
const removeStartDataGraphInput = ({ nodeId, portId }: { nodeId: string; portId: string }) => {
  const node = currentGraphState.value.nodes.find(entry => entry.id === nodeId);
  if (!node || node.kind !== 'start') {
    return;
  }

  graph.updateGraphNodeState(nodeId, (current) => ({
    ...current,
    outputs: current.outputs.filter(port => port.id !== portId),
  }));

  graph.updateGraphEdges((edges) => edges.filter(edge => edge.sourceOutputId !== portId));

  const remainingIoEntities = { ...currentGraphState.value.ioEntities };
  delete remainingIoEntities[portId];
  currentGraphState.value = { ...currentGraphState.value, ioEntities: remainingIoEntities };

  unregisterIoEntity(portId);
  toast.success('Data graph input removed');
};

const addQueryIdInputToNode = (nodeId: string) => {
  const node = currentGraphState.value.nodes.find(entry => entry.id === nodeId);
  if (!node || node.kind !== 'dynamic') {
    toast.error('Query ID inputs are only available on Dynamic Query nodes');
    return;
  }

  const existing = node.inputs.find(port => port.entityType === 'QueryIdInput');
  if (existing) {
    graph.selectIoEntity(existing.id, nodeId);
    toast.info('Dynamic query already has a Query ID input');
    return;
  }

  const inputId = mintTempId('query-id-input');
  /*
   * Named after the node, which for an unnamed one is the short "Dynamic Query"
   * rather than `canvasNodeLabel`'s "Dynamic Query Node": this is a compound
   * name, and the card's own title inside one says "Node" about a port. An
   * author's name flows through, which is the whole reason to read the field.
   */
  const label = `${authoredNodeLabel(node) ?? 'Dynamic Query'} query id`;
  const description = 'Dynamic query selection input';

  currentGraphState.value = {
    ...currentGraphState.value,
    ioEntities: {
      ...currentGraphState.value.ioEntities,
      [inputId]: {
        id: inputId,
        kind: 'QueryIdInput',
        name: label,
        description,
        memberEntries: null,
        arity: null,
        // Authored on the node by the group, so switching the node's query
        // version must not take it away with the version's own ports.
        origin: 'query-group',
      },
    },
  };

  graph.updateGraphNodeState(nodeId, (current) => ({
    ...current,
    inputs: [
      ...current.inputs,
      {
        id: inputId,
        label,
        entityType: 'QueryIdInput',
        direction: 'input',
        origin: 'query-group',
        resolved: true,
      },
    ],
  }));

  registerQueryIdInput({
    id: inputId,
    name: label,
    description,
  });

  graph.selectIoEntity(inputId, nodeId);
  toast.success('Query ID input added');
};

/**
 * Put the ruleset selector away.
 *
 * There are four ways out of this dialog and they used to do three different
 * things. Cancel and a completed assignment cleared both refs; the two
 * refusals in `handleRuleSetSelected` returned without touching either, so a
 * refusal left the dialog open over the node it had just failed to find, with
 * nothing to do but pick the same rule set and be refused again; and dismissal
 * — Escape or the overlay — reached `update:open` only, which the dialog emits
 * without `cancel`, so it lowered the dialog and left `selectedNodeForRuleSet`
 * pointing at the node.
 *
 * One function for all four, so the shape of the flow cannot drift again:
 * the dialog is down and nothing is selected, whichever way it ended.
 */
const closeRuleSetSelector = () => {
  showRuleSetSelectorDialog.value = false;
  selectedNodeForRuleSet.value = null;
};

const handleRuleSetSelectorCancel = () => {
  closeRuleSetSelector();
};

/** The dialog reports its own dismissal, and only ever with `false`. */
const handleRuleSetSelectorOpenChange = (open: boolean) => {
  if (!open) {
    closeRuleSetSelector();
  }
};

const handleRuleSetSelected = (payload: {
  ruleSetId: string;
  ruleSetVersionId: string;
  ruleSetVersionNumber: number;
  ruleSetName: string;
}) => {
  if (!selectedNodeForRuleSet.value) {
    console.error('[QueryGroupWorkArea] No selected node for ruleset assignment');
    toast.error('Unable to update ruleset node');
    closeRuleSetSelector();
    return;
  }
  const nodeId = selectedNodeForRuleSet.value.id;
  const nodeState = currentGraphState.value.nodes.find(node => node.id === nodeId);
  if (!nodeState) {
    console.error('[QueryGroupWorkArea] Node state not found for ruleset assignment', { nodeId });
    toast.error('Unable to update ruleset node');
    closeRuleSetSelector();
    return;
  }

  const inputPortId =
    nodeState.inputs.find(port => port.entityType === 'TriplesQuadsIO')?.id ?? mintTempId('triples-io');
  const outputPortId =
    nodeState.outputs.find(port => port.entityType === 'TriplesQuadsIO')?.id ?? mintTempId('triples-io');
  const inputLabel = `${payload.ruleSetName} input`;
  const outputLabel = `${payload.ruleSetName} output`;

  const updatedIoEntities = { ...currentGraphState.value.ioEntities };
  // A ruleset node's RDF ports are declared by the group, not by a query
  // version, so they are owned here and outlive any node's dependency changes.
  updatedIoEntities[inputPortId] = {
    id: inputPortId,
    kind: 'TriplesQuadsIO',
    name: inputLabel,
    description: 'Initial ruleset data graph',
    memberEntries: null,
    arity: null,
    origin: 'query-group',
  };
  updatedIoEntities[outputPortId] = {
    id: outputPortId,
    kind: 'TriplesQuadsIO',
    name: outputLabel,
    description: 'Ruleset inference output',
    memberEntries: null,
    arity: null,
    origin: 'query-group',
  };

  currentGraphState.value = {
    ...currentGraphState.value,
    iriMap: {
      ...currentGraphState.value.iriMap,
      [payload.ruleSetVersionId]: payload.ruleSetName,
    },
    ioEntities: updatedIoEntities,
  };

  graph.updateGraphNodeState(nodeId, (node) => ({
    ...node,
    label: payload.ruleSetName,
    ruleSetId: payload.ruleSetId,
    ruleSetVersionId: payload.ruleSetVersionId,
    inputs: [
      {
        id: inputPortId,
        label: inputLabel,
        entityType: 'TriplesQuadsIO',
        direction: 'input',
        origin: 'query-group',
        resolved: true,
      },
    ],
    outputs: [
      {
        id: outputPortId,
        label: outputLabel,
        entityType: 'TriplesQuadsIO',
        direction: 'output',
        origin: 'query-group',
        resolved: true,
      },
    ],
  }));

  registerRdfIoEntity({
    id: inputPortId,
    name: inputLabel,
    description: 'Initial ruleset data graph',
    ioType: 'input',
  });
  registerRdfIoEntity({
    id: outputPortId,
    name: outputLabel,
    description: 'Ruleset inference output',
    ioType: 'output',
  });

  // Auto-populate any existing edges connected to this ruleset node
  // This ensures RDF_GRAPH edges get proper sourceOutputId and targetInputId
  const connectedEdges = currentGraphState.value.edges.filter(
    (edge) => edge.source === nodeId || edge.target === nodeId
  );

  if (connectedEdges.length > 0) {
    graph.updateGraphEdges((edges) => {
      return edges.map((edge) => {
        // Only process edges connected to this node
        if (edge.source !== nodeId && edge.target !== nodeId) {
          return edge;
        }

        // Find the source and target nodes
        const sourceNode = currentGraphState.value.nodes.find((n) => n.id === edge.source);
        const targetNode = currentGraphState.value.nodes.find((n) => n.id === edge.target);

        if (!sourceNode || !targetNode) {
          return edge;
        }

        // Auto-populate I/O IDs using the same logic as CONSTRUCT queries
        let sourceOutputId = edge.sourceOutputId;
        let targetInputId = edge.targetInputId;

        // Skip if already populated
        if (sourceOutputId && targetInputId) {
          return edge;
        }

        // For RDF_GRAPH flow type
        if (edge.flowType === 'RDF_GRAPH') {
          // Find TriplesQuadsIO output from source node
          const rdfOutput = sourceNode.outputs.find(port => port.entityType === 'TriplesQuadsIO');
          if (rdfOutput) {
            sourceOutputId = rdfOutput.id;
            // For EndNode, use pass-through semantics (targetInputId = sourceOutputId)
            if (targetNode.kind === 'end') {
              targetInputId = rdfOutput.id;
            } else {
              // For regular query nodes, find TriplesQuadsIO input
              const rdfInput = targetNode.inputs.find(port => port.entityType === 'TriplesQuadsIO');
              if (rdfInput) {
                targetInputId = rdfInput.id;
              }
            }
          }
        }

        // Only update if something changed
        if (sourceOutputId !== edge.sourceOutputId || targetInputId !== edge.targetInputId) {
          return {
            ...edge,
            sourceOutputId,
            targetInputId,
          };
        }

        return edge;
      });
    });
  }

  toast.success('Ruleset assigned to node');
  closeRuleSetSelector();
};

const lastLoadedParams = ref<{ groupId: string | null; versionNumber: number | null }>({
  groupId: null,
  versionNumber: null,
});

watch(
  () => props.creationRequest,
  (request) => {
    if (!request) {
      return;
    }
    if (request.id === lastCreationToken.value) {
      return;
    }
    lastCreationToken.value = request.id;
    beginCreate(request);
  },
);

watch(
  () => [props.queryGroupId ?? null, props.versionNumber ?? null] as const,
  async ([groupId, versionNumber]) => {
    if (!groupId) {
      return;
    }
    const normalizedVersion = versionNumber ?? null;
    // Skip if already loading this combination or if currently saving/loading
    if (
      (lastLoadedParams.value.groupId === groupId &&
        lastLoadedParams.value.versionNumber === normalizedVersion) ||
      isLoading.value ||
      isSaving.value
    ) {
      return;
    }
    // Update tracking FIRST to prevent re-entry
    lastLoadedParams.value = { groupId, versionNumber: normalizedVersion };

    // Use try-finally to ensure we don't get stuck if load fails
    try {
      await loadFromRoute({ queryGroupId: groupId, versionNumber: normalizedVersion });
    } catch (error) {
      console.error('[QueryGroupWorkArea] Failed to load from route:', error);
      // Don't reset lastLoadedParams here to prevent retry loops
    }
  },
  { immediate: true },
);

/**
 * Tell the route which version is on screen — under the same convention the
 * query editor uses.
 *
 * `?version=` means "I deliberately went back to an older version". Showing
 * the current one carries no parameter, so a link copied from the address bar
 * follows the group rather than pinning the reader to whatever was current
 * when it was taken. This used to emit the number unconditionally, which meant
 * saving v3 left `?version=3` behind and every bookmark silently pinned
 * itself.
 */
watch(versions.selectedVersionId, (newVersionId, oldVersionId) => {
  // Skip emit if this is the first load or during programmatic route loading
  if (newVersionId === oldVersionId) {
    return;
  }

  const selectedNumber = newVersionId
    ? versionMetadata.value[newVersionId]?.versionNumber ?? null
    : null;
  const currentId = versions.currentVersionId.value;
  const currentNumber = currentId
    ? versionMetadata.value[currentId]?.versionNumber ?? null
    : null;

  const routeVersion = routeVersionForSelection(selectedNumber, currentNumber);

  // Only emit if it differs from what the route already carries, so a
  // programmatic reload does not churn the URL.
  if (routeVersion !== props.versionNumber) {
    emit('update:versionNumber', routeVersion);
  }
});

watch(
  () => queriesStore.queries.value,
  () => {
    syncQueryNamesToGraph();
  },
  { deep: true },
);

onMounted(async () => {
  await Promise.all([
    backendsStore.loadBackends(),
    queriesStore.loadQueries(),
    librariesStore.loadLibraries(),
  ]);

  syncQueryNamesToGraph();

  // Add keyboard event listener for delete functionality
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  // Clean up keyboard event listener
  window.removeEventListener('keydown', handleKeyDown);
});
</script>


<style scoped>
/*
 * The Vue Flow stylesheets, the split, the graph box and its controls are
 * `CanvasShell`/`CanvasSurface`'s. What is left here is the query group's own
 * canvas: its node and edge theming, the palette that floats over the surface,
 * and the inspector's tab shells.
 */

/* Right Panel */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  overflow: hidden;
}

/* Vertical Resizer (between left and right panels) */
.vertical-resizer {
  width: 8px;
  background: var(--surface-raised);
  cursor: col-resize;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.3s ease, width 0.3s ease;
}

.vertical-resizer:hover {
  background: var(--action);
}

.vertical-resizer .resizer-handle {
  width: 2px;
  height: 40px;
  background: var(--gray-600);
  border-radius: var(--radius-sm);
  pointer-events: none;
}

.vertical-resizer:hover .resizer-handle {
  background: var(--surface);
}

.node-context-menu {
  position: absolute;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  padding: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
}

.node-context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.node-context-item:hover {
  background: var(--action-hover);
}

.node-context-item-danger {
  color: var(--danger);
}

.node-context-item-danger:hover {
  background: var(--danger-surface);
}

.vue-flow-container {
  flex: 1;
  height: 100%;
  width: 100%;
}

/* Add Node Toolbar */
.add-node-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column; /* Change to column */
  gap: 8px;
  z-index: 10;
  background: var(--surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  padding: var(--space-3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.btn-add-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-body);
  font-weight: 500;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  border: 1px solid var(--action);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--action);
  cursor: pointer;
  transition: all 0.2s;
  justify-content: center;
}

.btn-add-node:hover {
  background: var(--action);
  color: var(--action-fg);
}

/*
 * A disabled add button reads as an enabled one without this, which "Add step"
 * makes visible: it is off whenever nothing is selected, which is most of the
 * time. "Tidy up" has been disabled on an empty canvas and indistinguishable
 * from live since it was written.
 */
.btn-add-node:disabled {
  border-color: var(--border-default);
  color: var(--ink-disabled);
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-add-node:disabled:hover {
  background: var(--surface);
  color: var(--ink-disabled);
}

.btn-add-node span {
  white-space: nowrap;
}

/* The chain shortcut above, the node palette below. */
.btn-add-step {
  font-weight: 600;
}

/*
 * Secondary to "Add your first query" beside it. Both do something on a blank
 * canvas, but only one of them is the answer when the author has no shape in
 * mind, and four buttons drawn alike make the empty state a menu rather than a
 * suggestion.
 */
.btn-template {
  border-color: var(--border-default);
  color: var(--ink-secondary);
  font-weight: var(--weight-normal);
}

.btn-template:hover {
  border-color: var(--action);
  background: var(--surface);
  color: var(--action);
}

.add-node-divider {
  height: 1px;
  margin: 0;
  background: var(--border-default);
}

.tidy-control {
  position: relative;
  display: flex;
  gap: 4px;
}

.btn-tidy {
  flex: 1;
}

.btn-tidy-caret {
  padding: var(--space-3);
}

.layout-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  padding: var(--space-2);
  background: var(--surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  box-shadow: 0 6px 18px rgb(0 0 0 / 15%);
}

.layout-menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
}

.layout-menu-item:hover {
  background: var(--surface-subtle);
}

.layout-menu-item-active {
  background: var(--surface-subtle);
}

.layout-menu-label {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink);
}

.layout-menu-hint {
  font-size: var(--text-body);
  color: var(--ink-muted);
}

/* Vue Flow Customization */
:deep(.vue-flow__node) {
  background: var(--surface);
  border: 2px solid var(--action);
  border-radius: var(--radius-lg);
  padding: var(--space-5) var(--space-6);
  font-size: var(--text-body-lg);
  font-weight: 500;
  color: var(--ink);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  min-width: 140px;
  text-align: center;
}

:deep(.vue-flow__node.selected) {
  border-color: var(--action-hover);
  box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.2);
}

:deep(.vue-flow__node-input) {
  background: var(--success-surface);
  border-color: var(--success);
}

:deep(.vue-flow__node-output) {
  background: var(--danger-surface);
  border-color: var(--danger);
}

:deep(.vue-flow__edge-path) {
  stroke: var(--ink-muted);
  stroke-width: 2;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: var(--action);
  stroke-width: 3;
}

:deep(.vue-flow__edge.animated .vue-flow__edge-path) {
  stroke-dasharray: 5;
  animation: dashdraw 0.5s linear infinite;
}

/* Validation state on an edge. Listed after .selected so a selected invalid edge
   still reads as invalid. */
:deep(.vue-flow__edge.has-validation-warning .vue-flow__edge-path) {
  stroke: var(--warning);
  stroke-width: 3;
}

:deep(.vue-flow__edge.has-validation-error .vue-flow__edge-path) {
  stroke: var(--danger-border);
  stroke-width: 3;
}

@keyframes dashdraw {
  0% {
    stroke-dashoffset: 10;
  }
  100% {
    stroke-dashoffset: 0;
  }
}

:deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  background: var(--action);
  border: 2px solid var(--surface);
}

/* The tab shells, matching QueryResultsPanel's. The tab itself never scrolls:
   the editor's own panel body does, and the results viewer manages its own. */
.tab-pane {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* Tests is the exception: a list of rows, as long as the suite is. */
.tab-pane.scrollable {
  padding: var(--space-5);
  overflow: auto;
}

.editor-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
}

.results-content {
  flex: 1;
  position: relative;
  padding: 0 var(--space-6) var(--space-6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.validation-issues-panel {
  border: 1px solid var(--action-border);
  border-radius: var(--radius-panel);
  background: var(--action-surface);
  padding: var(--space-5);
}

.validation-issues-title {
  margin: 0 0 var(--space-4) 0;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--action-ink);
}

.validation-issues-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.validation-issue {
  font-size: var(--text-body);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  color: var(--ink-secondary);
}

.validation-issue.error {
  color: var(--danger-ink);
}

.validation-issue.warning {
  color: var(--warning-ink);
}

.validation-issue-link {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.validation-issue-link:hover span,
.validation-issue-link:focus-visible span {
  text-decoration: underline;
}

.validation-issue-code {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  opacity: 0.75;
}

.validation-issues-note {
  margin: var(--space-4) 0 0 0;
  font-size: var(--text-micro);
  color: var(--ink-secondary);
}

/* Dropdown menu item icons */
:deep(.lucide-icon) {
  flex-shrink: 0;
}
</style>
