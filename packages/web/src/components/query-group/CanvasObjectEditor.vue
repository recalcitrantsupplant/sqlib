<template>
  <div class="canvas-editor">
    <EmptyState
      v-if="!selection"
      title="Nothing selected"
      description="Select a node, edge, or port on the canvas to edit its details here."
    />

    <template v-else>
      <section v-if="selection.type === 'node'" class="panel">
        <PanelHeader :title="nodeTitle" :subtitle="selection.node.id" sunken>
          <template #meta>
            <span class="node-kind">{{ nodeKindLabel }}</span>
          </template>
        </PanelHeader>

        <div class="panel-body">
          <FormField v-if="!isStartOrEndNode" label="Display label">
            <input
              id="node-label-input"
              class="field-input"
              type="text"
              :value="selection.node.label"
              :disabled="isStartOrEndNode"
              @input="emitUpdateNodeLabel(($event.target as HTMLInputElement).value)"
            />
          </FormField>

          <template v-if="isQueryLikeNode">
            <div class="field">
              <SectionLabel>{{ isPatchNode ? 'Update derived' : 'Assigned query' }}</SectionLabel>
              <!--
                The same fuzzy dropdown the backend picker uses, rather than the
                modal this used to open. Assigning a query is one choice from a
                list of names, which is what this control is for; the dialog
                asked for a click to open, a click to pick and a click to
                confirm, and covered the canvas while it did.
              -->
              <SearchSelect
                test-id="node-query-select"
                :aria-label="isPatchNode ? 'Update query' : 'Query'"
                :placeholder="queryPlaceholder"
                :model-value="assignedQueryId"
                :options="queryChoices"
                :disabled="queryOptionsLoading || queryChoices.length === 0"
                @update:model-value="emitAssignQuery"
              />
              <p v-if="queryOptionsError" class="field-hint field-hint-error">{{ queryOptionsError }}</p>
              <p v-else-if="!queryOptionsLoading && queryChoices.length === 0" class="field-hint">
                This library has no saved query versions to assign yet.
              </p>

              <!--
                Which version, once there is a query to have versions. A node
                names a version rather than a query, so this is not a detail:
                it is half of what the node points at.
              -->
              <template v-if="assignedQueryId && versionChoices.length">
                <div class="version-field">
                  <SectionLabel>Version</SectionLabel>
                  <SearchSelect
                    test-id="node-query-version-select"
                    aria-label="Query version"
                    placeholder="Select a version"
                    :model-value="selection.node.queryVersionId ?? selection.node.queryId ?? null"
                    :options="versionChoices"
                    @update:model-value="emitAssignQueryVersion"
                  />
                </div>
              </template>

              <div v-if="selection.node.queryVersionId ?? selection.node.queryId" class="inline-field">
                <EntityIri
                  :name="iriMap[(selection.node.queryVersionId ?? selection.node.queryId) as string] ?? 'Unknown'"
                  :iri="(selection.node.queryVersionId ?? selection.node.queryId) as string"
                />
              </div>
              <!--
                Said on the node rather than left to the run report, because it
                is the whole promise of the node: it reads the store to work out
                what the update would change and writes nothing back.
              -->
              <p v-if="isPatchNode" class="field-hint">
                This node derives what the update would change and leaves the store as it found it.
              </p>
            </div>

            <!--
              Which port carries which half, named rather than positional. An
              edge leaving this node picks one of these two by name, so the
              inspector has to say which is which - "the first output" is not
              something the author can see on the canvas.
            -->
            <div v-if="isPatchNode" class="field">
              <SectionLabel>Patch halves</SectionLabel>
              <ul class="port-list">
                <li v-for="half in patchHalves" :key="half.role" class="port-row">
                  <span class="port-name">{{ half.roleLabel }}</span>
                  <span class="inline-value">{{ half.portLabel }}</span>
                </li>
              </ul>
            </div>

            <div v-if="isDynamicNode" class="field">
              <SectionLabel>Dynamic query input</SectionLabel>
              <div class="inline-field">
                <button class="btn-compact btn-primary" type="button" @click="requestQueryIdInput">
                  Add Query ID Input
                </button>
              </div>
            </div>

            <!--
              A node with an ephemeral store has no backend to choose, and
              showing the picker for one stated the opposite of what executes:
              the placeholder backendId rendered as "SHACL shapes (in memory)"
              on a node that never queried it (issue #301).
            -->
            <FormField v-if="ephemeralStoreId" label="Backend">
              <div class="inline-field">
                <span class="inline-value">Ephemeral store</span>
                <code class="store-id" :title="ephemeralStoreId">{{ ephemeralStoreId }}</code>
              </div>
              <p class="field-hint">
                This node runs against a store created for the run and discarded
                afterwards, not against a registered backend.
              </p>
            </FormField>

            <FormField v-else label="Backend">
              <!--
                Fuzzy rather than a plain list: a library's backends are named
                by hand and a node is assigned one by name, so typing three
                letters beats reading the list.
              -->
              <SearchSelect
                test-id="node-backend-select"
                aria-label="Backend"
                placeholder="Select backend"
                :model-value="selection.node.backendId ?? null"
                :options="backendOptionsWithLabels"
                @update:model-value="emitUpdateNodeBackend"
              />
            </FormField>
          </template>

          <template v-else-if="isRulesetNode">
            <div class="field">
              <SectionLabel>Assigned ruleset</SectionLabel>
              <div class="inline-field">
                <EntityIri
                  v-if="selection.node.ruleSetVersionId"
                  :name="iriMap[selection.node.ruleSetVersionId] ?? 'Unknown'"
                  :iri="selection.node.ruleSetVersionId"
                />
                <span v-else class="inline-value">No ruleset assigned</span>
                <button class="btn-compact btn-primary" type="button" @click="requestRuleSetAssignment">
                  Assign Ruleset
                </button>
              </div>
            </div>
          </template>

          <!--
            A patch node is left off this: what it emits is two RDF ports, and
            the media type of the group's result is the End node's to state.
          -->
          <FormField v-if="selection.node.kind === 'end' || (isQueryLikeNode && !isPatchNode)" label="Media type">
            <Select
              :model-value="selection.node.mediaType ?? ''"
              @update:model-value="emitUpdateNodeMediaType"
            >
              <SelectTrigger id="node-media-type-select" class="select-trigger">
                <SelectValue placeholder="Select media type" />
              </SelectTrigger>
              <MediaTypeSelectContent
                :groups="groupedMediaTypeOptions"
                :query-type="selectedNodeQueryType"
              />
            </Select>
          </FormField>

          <div v-if="selection.node.kind === 'start'" class="start-node-editor">
            <SectionLabel>Input tuples</SectionLabel>
            <TupleValuesEditor
              :tuples="startTuples"
              empty-state-label="Add input tuples"
              @add-tuple="emit('add-tuple')"
              @remove-tuple="(index) => emit('remove-tuple', index)"
              @add-variable="(index) => emit('add-variable', index)"
              @remove-variable="(tupleIndex, variableIndex) => emit('remove-variable', tupleIndex, variableIndex)"
              @update-variable="emit('update-variable', $event)"
            />
            <div class="start-node-actions">
              <button class="btn-compact btn-primary" type="button" @click="emit('save-start-tuples')">
                Save Inputs
              </button>
            </div>

            <!--
              A group's external inputs are of two kinds, and they are not
              alternatives: tuples above are the values a run binds, these are
              the RDF a run hands in. A group may declare both, so they get
              their own section rather than a mode switch.
            -->
            <SectionLabel>Data graph inputs</SectionLabel>
            <ul v-if="startDataGraphPorts.length" class="port-list">
              <li v-for="port in startDataGraphPorts" :key="port.id" class="port-row">
                <button
                  class="port-name"
                  type="button"
                  @click="emit('select-io-entity', { entityId: port.id, parentNodeId: selection.node.id })"
                >
                  {{ port.label }}
                </button>
                <button
                  class="btn-compact"
                  type="button"
                  title="Remove this data graph input"
                  @click="emit('remove-start-data-graph', { nodeId: selection.node.id, portId: port.id })"
                >
                  Remove
                </button>
              </li>
            </ul>
            <p v-else class="io-state">
              This group takes no data graph. Add one to let a run hand it RDF to work over.
            </p>
            <div class="start-node-actions">
              <button
                class="btn-compact"
                type="button"
                @click="emit('add-start-data-graph', selection.node.id)"
              >
                Add Data Graph Input
              </button>
            </div>
          </div>

          <!--
            An empty port list has four causes and they are not interchangeable,
            so each one says which it is instead of rendering nothing.
          -->
          <p
            v-if="nodeIoState.status !== 'ready'"
            class="io-state"
            :class="`io-state-${nodeIoState.status}`"
            :data-io-state="nodeIoState.status"
          >
            {{ nodeIoState.message }}
          </p>

          <div v-if="selection.node.inputs.length" class="ports-section">
            <SectionLabel>Inputs</SectionLabel>

            <!-- Show variable badges if we have QueryInputTuple inputs -->
            <TupleVariableBadges :variables="nodeInputVariables" />

            <!-- Show port list for non-tuple inputs (like RDF, Boolean, etc.) -->
            <ul v-if="nodeInputPorts.filter(p => p.entityType !== 'QueryInputTuple').length > 0" class="port-list">
              <li v-for="port in nodeInputPorts.filter(p => p.entityType !== 'QueryInputTuple')" :key="port.id">
                <span class="port-name">{{ port.label }}</span>
                <button
                  class="btn-compact"
                  type="button"
                  @click="emit('select-io-entity', { entityId: port.id, parentNodeId: selection.node.id })"
                >
                  View Details
                </button>
              </li>
            </ul>
          </div>

          <div v-if="selection.node.outputs.length" class="ports-section">
            <SectionLabel>Outputs</SectionLabel>

            <!-- Show variable badges if we have QueryOutputTuple outputs -->
            <TupleVariableBadges :variables="nodeOutputVariables" />

            <!-- Show port list for non-tuple outputs (like RDF, Boolean, etc.) -->
            <ul v-if="nodeOutputPorts.filter(p => p.entityType !== 'QueryOutputTuple').length > 0" class="port-list">
              <li v-for="port in nodeOutputPorts.filter(p => p.entityType !== 'QueryOutputTuple')" :key="port.id">
                <span class="port-name">{{ port.label }}</span>
              </li>
            </ul>
          </div>

          <div v-if="validationIssues.length" class="validation-list">
            <SectionLabel class="validation-list-title">Validation</SectionLabel>
            <ul>
              <li v-for="(issue, index) in validationIssues" :key="index">
                <strong>{{ issue.level === 'error' ? 'Error' : 'Warning' }}:</strong>
                <span> {{ issue.message }}</span>
              </li>
            </ul>
          </div>

          <!-- Delete Node Button (except for Start and End nodes) -->
          <div v-if="!isStartOrEndNode" class="delete-section">
            <button
              class="btn-compact btn-delete"
              type="button"
              @click="emit('delete-node', selection.node.id)"
              title="Delete node and all connected edges"
            >
              <Trash2 :size="16" />
              Delete Node
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="selection.type === 'edge'" class="panel">
        <PanelHeader title="Edge" :subtitle="selection.edge.id" sunken>
          <template #meta>
            <span class="node-kind">Flow</span>
          </template>
        </PanelHeader>

        <div class="panel-body">
          <FormField label="Flow type">
            <select
              id="edge-flow-select"
              class="field-input"
              :value="selection.edge.flowType"
              @change="emitUpdateEdgeFlowType($event.target as HTMLSelectElement)"
            >
              <option v-for="option in flowTypeOptions" :key="option" :value="option">
                {{ formatFlowTypeLabel(option) }}
              </option>
            </select>
          </FormField>

          <FormField
            v-if="selection.edge.flowType === 'VARIABLE_BINDINGS'"
            label="If this input has no values"
            :hint="whenEmptyHint"
          >
            <select
              id="edge-when-empty"
              class="field-input"
              :value="selection.edge.whenEmpty ?? ''"
              @change="emitUpdateEdgeWhenEmpty(($event.target as HTMLSelectElement).value)"
            >
              <option value="">Use the default</option>
              <option value="propagateEmpty">Return no results</option>
              <option value="unconstrained">Run without this filter</option>
              <option value="require">Fail the run</option>
            </select>
          </FormField>

          <div class="edge-summary">
            <div>
              <span class="summary-label">Source</span>
              <span class="summary-value">{{ sourceNodeSummary }}</span>
              <span v-if="selection.edge.sourceOutputId" class="summary-subvalue">
                Port: {{ selection.edge.sourceOutputId }}
              </span>
            </div>
            <div>
              <span class="summary-label">Target</span>
              <span class="summary-value">{{ targetNodeSummary }}</span>
              <span v-if="selection.edge.targetInputId" class="summary-subvalue">
                Port: {{ selection.edge.targetInputId }}
              </span>
            </div>
          </div>

          <!-- Tuple Mapping Section -->
          <div v-if="showIoMappingSection" class="tuple-mapping-section">
            <SectionLabel>
              {{ isVariableBindingsFlow ? 'Tuple Mapping' : 'I/O Mapping' }}
            </SectionLabel>

            <FormField label="Source Output">
              <div class="select-with-clear">
                <Select
                  :model-value="selection.edge.sourceOutputId ?? undefined"
                  @update:model-value="updateEdgeSourceOutput"
                >
                  <SelectTrigger id="source-output-select" class="select-trigger">
                    <SelectValue :placeholder="sourcePlaceholder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in sourceMappingOptions"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ option.label }}
                      <template v-if="option.meta" #aside>
                        <span class="tuple-meta">{{ option.meta }}</span>
                      </template>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <button
                  v-if="selection.edge.sourceOutputId"
                  class="btn-clear"
                  type="button"
                  title="Clear selection"
                  @click="updateEdgeSourceOutput(null)"
                >
                  ✕
                </button>
              </div>
            </FormField>

            <!-- Only show target input selector when NOT connecting to end node -->
            <FormField v-if="!isTargetEndNode" label="Target Input">
              <div class="select-with-clear">
                <Select
                  :model-value="selection.edge.targetInputId ?? undefined"
                  @update:model-value="updateEdgeTargetInput"
                >
                  <SelectTrigger id="target-input-select" class="select-trigger">
                    <SelectValue :placeholder="targetPlaceholder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in targetMappingOptions"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ option.label }}
                      <template v-if="option.meta" #aside>
                        <span class="tuple-meta">{{ option.meta }}</span>
                      </template>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <button
                  v-if="selection.edge.targetInputId"
                  class="btn-clear"
                  type="button"
                  title="Clear selection"
                  @click="updateEdgeTargetInput(null)"
                >
                  ✕
                </button>
              </div>
            </FormField>

            <!-- Info message when connecting to end node -->
            <div v-else class="end-node-info">
              <p>When connecting to the End Node, the output is automatically passed through as the final result.</p>
            </div>

            <!--
              Variable Mapping, behind the one line that says what it does.

              The grid is four columns and a row per target variable, and what
              it almost always says is "?city goes to ?city". That answer fits
              on the header it was drawn underneath, so the header carries it
              and the positions are one click away - which is the point of the
              state note beside it: a mapping the author never opens is one
              they were told was fine.
            -->
            <div v-if="tupleMapping" class="tuple-mapping-visualization">
              <button
                type="button"
                class="mapping-header"
                data-testid="mapping-summary"
                :data-mapping-state="mappingState"
                :aria-expanded="mappingExpanded"
                aria-controls="variable-mapping-details"
                :title="mappingExpanded ? 'Collapse the variable mapping' : 'Expand the positional mapping'"
                @click="mappingExpanded = !mappingExpanded"
              >
                <ChevronDown v-if="mappingExpanded" :size="13" class="mapping-chevron" />
                <ChevronRight v-else :size="13" class="mapping-chevron" />
                <span class="mapping-title">Variable Mapping</span>
                <span
                  class="mapping-summary-line"
                  data-testid="mapping-summary-line"
                  :title="mappingSummaryLine"
                >{{ mappingSummaryLine }}</span>
                <span class="mapping-spacer"></span>
                <span class="mapping-state-glyph" aria-hidden="true">{{ mappingStateGlyph }}</span>
                <span class="mapping-subtitle">{{ mappingStateNote }}</span>
              </button>

              <div v-if="mappingExpanded" id="variable-mapping-details" class="mapping-grid">
                <div class="mapping-column-headers">
                  <div class="column-header column-header-position">Position</div>
                  <div class="column-header column-header-source">Source Output</div>
                  <div class="column-header-spacer"></div>
                  <div class="column-header column-header-target">Target Input</div>
                </div>

                <div class="mapping-content">
                  <div class="mapping-position-column">
                    <div
                      v-for="(pair, index) in tupleMapping"
                      :key="`position-${index}`"
                      class="position-number"
                    >
                      {{ index + 1 }}
                    </div>
                  </div>

                  <div class="mapping-column mapping-column-source">
                    <div class="variable-group variable-group-source">
                      <select v-for="pair in tupleMapping" :key="`source-${pair.target}`" class="mapping-select" :value="pair.source ?? ''" @change="updateVariableMapping(pair.target, ($event.target as HTMLSelectElement).value)">
                        <option value="">UNDEF</option>
                        <option v-for="source in pair.sourceOptions" :key="source" :value="source">?{{ source }}</option>
                      </select>
                    </div>
                  </div>

                  <div class="mapping-rows-connector">
                    <div
                      v-for="pair in tupleMapping"
                      :key="`arrow-${pair.target}`"
                      class="arrow-row"
                    >
                      <MoveRight :size="16" class="mapping-arrow" />
                    </div>
                  </div>

                  <div class="mapping-column mapping-column-target">
                    <div class="variable-group variable-group-target">
                      <Badge
                        v-for="pair in tupleMapping"
                        :key="`target-${pair.target}`"
                        variant="secondary"
                        class="variable-badge"
                      >
                        ?{{ pair.target }}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <p v-if="ioMappingWarning" class="tuple-warning">{{ ioMappingWarning }}</p>
            <!-- Differing arity is legal, so it warns here rather than removing the option. -->
            <p v-if="mappingArityWarning" class="tuple-warning" data-testid="mapping-arity-warning">
              {{ mappingArityWarning }}
            </p>
            <p
              v-for="(message, index) in edgeDiagnostics"
              :key="`edge-diagnostic-${index}`"
              class="tuple-warning"
              data-testid="edge-diagnostic"
            >
              {{ message }}
            </p>
          </div>

          <div v-if="validationIssues.length" class="validation-list">
            <SectionLabel class="validation-list-title">Validation</SectionLabel>
            <ul>
              <li v-for="(issue, index) in validationIssues" :key="index">
                <strong>{{ issue.level === 'error' ? 'Error' : 'Warning' }}:</strong>
                <span> {{ issue.message }}</span>
              </li>
            </ul>
          </div>

          <!-- Delete Edge Button -->
          <div class="delete-section">
            <button
              class="btn-compact btn-delete"
              type="button"
              @click="emit('delete-edge', selection.edge.id)"
              title="Delete this edge"
            >
              <Trash2 :size="16" />
              Delete Edge
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="selection.type === 'io'" class="panel">
        <PanelHeader title="Port Definition" :subtitle="selection.entity.id" sunken>
          <template #meta>
            <span class="node-kind">{{ selection.entity.kind }}</span>
          </template>
        </PanelHeader>

        <div class="panel-body">
          <FormField label="Name">
            <input
              id="io-name-input"
              class="field-input"
              type="text"
              :value="selection.entity.name ?? ''"
              placeholder="Port label"
              @input="emit('update-io-name', { entityId: selection.entity.id, name: ($event.target as HTMLInputElement).value })"
            />
          </FormField>

          <FormField label="Description">
            <textarea
              id="io-description-input"
              class="field-input field-textarea"
              :value="selection.entity.description ?? ''"
              placeholder="Optional description"
              rows="3"
              @input="emit('update-io-description', { entityId: selection.entity.id, description: ($event.target as HTMLTextAreaElement).value })"
            />
          </FormField>

          <div class="edge-summary" v-if="parentNodeSummary">
            <div>
              <span class="summary-label">Parent node</span>
              <span class="summary-value">{{ parentNodeSummary }}</span>
            </div>
          </div>

          <div v-if="validationIssues.length" class="validation-list">
            <SectionLabel class="validation-list-title">Validation</SectionLabel>
            <ul>
              <li v-for="(issue, index) in validationIssues" :key="index">
                <strong>{{ issue.level === 'error' ? 'Error' : 'Warning' }}:</strong>
                <span> {{ issue.message }}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { canvasNodeLabel } from '../../composables/queryGroupNodeLabel';
import type { AcceptableValue } from 'reka-ui';
import { ChevronDown, ChevronRight, MoveRight, Trash2 } from '@lucide/vue';
import TupleValuesEditor from '../shared/TupleValuesEditor.vue';
import EmptyState from '../shared/EmptyState.vue';
import FormField from '../shared/FormField.vue';
import PanelHeader from '../shared/PanelHeader.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import TupleVariableBadges from '../shared/TupleVariableBadges.vue';
import SearchSelect from '../shared/SearchSelect.vue';
import Select from '../ui/select/Select.vue';
import SelectContent from '../ui/select/SelectContent.vue';
import SelectItem from '../ui/select/SelectItem.vue';
import SelectTrigger from '../ui/select/SelectTrigger.vue';
import SelectValue from '../ui/select/SelectValue.vue';
import EntityIri from '../shared/EntityIri.vue';
import MediaTypeSelectContent from '../shared/MediaTypeSelectContent.vue';
import Badge from '../ui/badge/Badge.vue';
import type { GraphNodeState, GraphEdgeState } from '../../composables/useQueryGroupGraph';
import type { QueryAssignmentOption } from '../../composables/useQueryAssignmentOptions';
import {
  describeArity,
  tupleArity,
  variablesForPort,
  type GraphPort,
  type IoEntityRecord,
  type IoModel,
  type TupleMemberRecord,
  type VariableRecord,
} from '../../composables/queryGroupIoModel';
import {
  arityDiagnostics,
  sourceCandidates,
  targetCandidates,
  validateEdge,
  type Diagnostic,
} from '../../composables/queryGroupCompatibility';
import type {
  TupleDefinition,
  TupleEditorUpdatePayload,
} from '../../types/tuple-editor';
import { getGroupedMediaTypeOptions, type QueryType } from '../../lib/mediaTypes';
import { toQueryTypeIri } from '@sparql-query-lib/types';

type ValidationIssue = {
  level: 'error' | 'warning';
  message: string;
  entityType?: string;
  entityId?: string | null;
  code?: string | null;
};

type CanvasSelectionDetail =
  | { type: 'node'; node: GraphNodeState }
  | { type: 'edge'; edge: GraphEdgeState }
  | { type: 'io'; entity: IoEntityRecord; parentNodeId: string | null }
  | null;

type BackendOption = {
  id: string;
  name: string;
};

type TupleInfo = {
  id: string;
  label: string;
  /** Member count, or null when unknown. Never 0 standing in for unknown. */
  arity: number | null;
  memberEntries: string[] | null;
  resolved: boolean;
};

type MappingOption = {
  id: string;
  label: string;
  meta?: string;
};

const props = defineProps<{
  selection: CanvasSelectionDetail;
  validationIssues: ValidationIssue[];
  startTuples: TupleDefinition[];
  backendOptions: BackendOption[];
  flowTypeOptions: string[];
  ioEntities: Record<string, IoEntityRecord>;
  graphNodes: GraphNodeState[];
  iriMap: Record<string, string>;
  queryDefaultBackend?: string | null;
  libraryDefaultBackend?: string | null;
  /** The library's queries, each with its versions, for the query dropdown. */
  queryOptions?: QueryAssignmentOption[];
  queryOptionsLoading?: boolean;
  queryOptionsError?: string | null;
  tupleMembers: Record<string, TupleMemberRecord>;
  variables: Record<string, VariableRecord>;
}>();

/** The normalized I/O model, as the shared helpers expect it. */
const ioModel = computed<IoModel>(() => ({
  entities: props.ioEntities,
  members: props.tupleMembers,
  variables: props.variables,
}));

const emit = defineEmits<{
  (e: 'add-tuple'): void;
  (e: 'remove-tuple', tupleIndex: number): void;
  (e: 'add-variable', tupleIndex: number): void;
  (e: 'remove-variable', tupleIndex: number, variableIndex: number): void;
  (e: 'update-variable', payload: TupleEditorUpdatePayload): void;
  (e: 'save-start-tuples'): void;
  (e: 'add-start-data-graph', nodeId: string): void;
  (e: 'remove-start-data-graph', payload: { nodeId: string; portId: string }): void;
  (e: 'assign-query', payload: { nodeId: string; queryId: string; queryVersionId: string }): void;
  (e: 'request-ruleset-assignment', nodeId: string): void;
  (e: 'add-query-id-input', nodeId: string): void;
  (e: 'update-node-label', payload: { nodeId: string; label: string }): void;
  (e: 'update-node-backend', payload: { nodeId: string; backendId: string }): void;
  (e: 'update-node-media-type', payload: { nodeId: string; mediaType: string }): void;
  (e: 'update-edge-flow-type', payload: { edgeId: string; flowType: string }): void;
  (e: 'update-edge-when-empty', payload: { edgeId: string; whenEmpty: string | null }): void;
  (e: 'update-edge-source-output', payload: { edgeId: string; sourceOutputId: string | null }): void;
  (e: 'update-edge-target-input', payload: { edgeId: string; targetInputId: string | null }): void;
  (e: 'update-edge-variable-mappings', payload: { edgeId: string; variableMappings: string | null }): void;
  (e: 'update-io-name', payload: { entityId: string; name: string }): void;
  (e: 'update-io-description', payload: { entityId: string; description: string }): void;
  (e: 'select-io-entity', payload: { entityId: string; parentNodeId?: string | null }): void;
  (e: 'delete-node', nodeId: string): void;
  (e: 'delete-edge', edgeId: string): void;
}>();

/**
 * Formats flow type names into human-readable labels.
 * Converts UPPERCASE_UNDERSCORE to Title Case.
 */
const formatFlowTypeLabel = (flowType: string): string => {
  const acronyms = new Set(['RDF', 'ID']);

  return flowType
    .split('_')
    .map(word => {
      // Keep known acronyms uppercase
      if (acronyms.has(word)) {
        return word;
      }
      // Otherwise convert to title case
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(' ');
};

const selection = computed(() => props.selection);

/*
 * A query node knows what shape its result is, so its mediatype dropdown can
 * suggest accordingly. A start or end node does not, and then nothing is
 * played down. Either way every format stays selectable.
 */
const selectedNodeQueryType = computed<QueryType>(() => {
  const current = selection.value;
  if (!current || current.type !== 'node') return null;
  return toQueryTypeIri((current.node as { queryType?: string | null }).queryType) ?? null;
});

const groupedMediaTypeOptions = computed(() =>
  getGroupedMediaTypeOptions(selectedNodeQueryType.value),
);

/*
 * The nodes that name a query version and a store to read it against. A patch
 * node is one of them: it differs in what it does with the query, not in what it
 * needs to be pointed at, so it takes the same assignment and backend controls.
 */
const isQueryLikeNode = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return false;
  const kind = selection.value.node.kind;
  return kind === 'query' || kind === 'dynamic' || kind === 'patch';
});

const isPatchNode = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return false;
  return selection.value.node.kind === 'patch';
});

const isRulesetNode = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return false;
  return selection.value.node.kind === 'ruleset';
});

const isDynamicNode = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return false;
  return selection.value.node.kind === 'dynamic';
});

/**
 * The node's ephemeral store, when it has one instead of a backend.
 *
 * Drives the Backend field's whole presentation rather than being shown beside
 * the picker: an ephemeral node has no backend to pick, and offering one is
 * what let the inspector display a backend the node never queried.
 */
const ephemeralStoreId = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return null;
  return selection.value.node.backendConfig?.storeId ?? null;
});

const isStartOrEndNode = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return false;
  return selection.value.node.kind === 'start' || selection.value.node.kind === 'end';
});

const nodeTitle = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return '';
  switch (selection.value.node.kind) {
    case 'start':
      return 'Start Node';
    case 'end':
      return 'End Node';
    case 'dynamic':
      return 'Dynamic Query Node';
    case 'ruleset':
      return 'Ruleset Node';
    case 'patch':
      return 'Patch Node';
    default:
      return 'Query Node';
  }
});

const nodeKindLabel = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return '';
  return selection.value.node.kind.toUpperCase();
});

/**
 * A patch node's two halves, each with the port it leaves by.
 *
 * Read off `deletionsOutputId`/`additionsOutputId` rather than off the order of
 * `outputs`, which is the same reason the node stores them: the halves are
 * opposite facts, so a positional reading would state the wrong one whenever the
 * array came back in a different order.
 */
const patchHalves = computed(() => {
  if (!selection.value || selection.value.type !== 'node' || selection.value.node.kind !== 'patch') return [];
  const node = selection.value.node;
  const labelFor = (portId: string | null | undefined) => {
    if (!portId) return 'Not set';
    return props.ioEntities[portId]?.name
      ?? node.outputs.find(port => port.id === portId)?.label
      ?? portId;
  };
  return [
    { role: 'deletions', roleLabel: 'Deletions', portLabel: labelFor(node.deletionsOutputId) },
    { role: 'additions', roleLabel: 'Additions', portLabel: labelFor(node.additionsOutputId) },
  ];
});

const nodeInputPorts = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return [];
  return selection.value.node.inputs.map((port) => ({
    ...port,
    label: props.ioEntities[port.id]?.name ?? port.label ?? port.id,
  }));
});

const nodeOutputPorts = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return [];
  return selection.value.node.outputs.map((port) => ({
    ...port,
    label: props.ioEntities[port.id]?.name ?? port.label ?? port.id,
  }));
});

/**
 * The start node's data graph inputs — its RDF ports.
 *
 * Read off the node's declared outputs rather than kept as separate state: the
 * port list is what the group saves, so anything else could disagree with it.
 */
const startDataGraphPorts = computed(() => {
  if (!selection.value || selection.value.type !== 'node' || selection.value.node.kind !== 'start') return [];
  return selection.value.node.outputs
    .filter((port) => port.entityType === 'TriplesQuadsIO')
    .map((port) => ({ ...port, label: props.ioEntities[port.id]?.name ?? port.label ?? port.id }));
});

const displayVariable = (name: string) => (name.startsWith('?') ? name : `?${name}`);

/**
 * The variables behind a node's tuple ports, in member order.
 *
 * A port whose members could not be resolved contributes nothing here but is
 * reported by `nodeIoState` below, so an incompletely described node reads as
 * "we could not load this" rather than as a query with no variables.
 */
const variablesForPorts = (ports: GraphPort[], kind: GraphPort['entityType'], fallbackName: string) => {
  const collected: Array<{ variable: string; tupleId: string; tupleName: string }> = [];
  let unresolvedPorts = 0;

  for (const port of ports) {
    if (port.entityType !== kind) continue;
    const entity = props.ioEntities[port.id];
    const tupleName = entity?.name ?? port.label ?? fallbackName;
    const variables = variablesForPort(port.id, ioModel.value);
    if (!variables) {
      unresolvedPorts += 1;
      continue;
    }
    for (const variable of variables) {
      collected.push({ variable: displayVariable(variable.variableName), tupleId: port.id, tupleName });
    }
  }

  return { variables: collected, unresolvedPorts };
};

const nodeInputVariableSummary = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return { variables: [], unresolvedPorts: 0 };
  return variablesForPorts(selection.value.node.inputs, 'QueryInputTuple', 'Input Tuple');
});

const nodeOutputVariableSummary = computed(() => {
  if (!selection.value || selection.value.type !== 'node') return { variables: [], unresolvedPorts: 0 };
  return variablesForPorts(selection.value.node.outputs, 'QueryOutputTuple', 'Output Tuple');
});

const nodeInputVariables = computed(() => nodeInputVariableSummary.value.variables);
const nodeOutputVariables = computed(() => nodeOutputVariableSummary.value.variables);

/**
 * Which of the four states a node's I/O is in.
 *
 * These used to render identically - an empty list - so a query still being
 * fetched, a query whose metadata failed to load, a partially described one and
 * a query that genuinely takes no inputs were indistinguishable on screen.
 */
type NodeIoState =
  | { status: 'ready' }
  | { status: 'empty'; message: string }
  | { status: 'loading'; message: string }
  | { status: 'error'; message: string }
  | { status: 'incomplete'; message: string };

const nodeIoState = computed<NodeIoState>(() => {
  const current = selection.value;
  if (!current || current.type !== 'node') return { status: 'ready' };
  const node = current.node;

  const resolution = node.queryVersionResolution ?? { status: 'unloaded' as const };
  if (resolution.status === 'loading') {
    return { status: 'loading', message: 'Loading this query version’s inputs and outputs…' };
  }
  if (resolution.status === 'error') {
    return { status: 'error', message: resolution.message };
  }
  if (resolution.status === 'unloaded' && (node.kind === 'query' || node.kind === 'dynamic') && !node.queryVersionId) {
    return { status: 'empty', message: 'Assign a query version to give this node inputs and outputs.' };
  }
  /*
   * A patch node's outputs are its own two halves, minted with the node, so an
   * assignment gives it the update's *inputs* and nothing else. Saying "inputs
   * and outputs" about it would name something the assignment never changes.
   */
  if (resolution.status === 'unloaded' && node.kind === 'patch' && !node.queryVersionId) {
    return { status: 'empty', message: 'Assign an update version to say which effect this node derives.' };
  }
  /*
   * A ruleset node has no query version at all, so the query-shaped answers
   * above and the "this query version declares no inputs or outputs" one below
   * are both about something it does not have. Its ports come from the ruleset,
   * which is the thing to say.
   */
  if (node.kind === 'ruleset' && !node.ruleSetVersionId) {
    return { status: 'empty', message: 'Assign a ruleset to give this node its RDF input and output.' };
  }

  const unresolvedPorts =
    nodeInputVariableSummary.value.unresolvedPorts + nodeOutputVariableSummary.value.unresolvedPorts;
  const unbackedPorts = [...node.inputs, ...node.outputs].filter((port) => port.resolved === false).length;
  if (unresolvedPorts > 0 || unbackedPorts > 0) {
    return {
      status: 'incomplete',
      message: `${unresolvedPorts + unbackedPorts} port(s) on this node could not be resolved to I/O metadata.`,
    };
  }

  if (node.inputs.length === 0 && node.outputs.length === 0) {
    return { status: 'empty', message: 'This query version declares no inputs or outputs.' };
  }

  return { status: 'ready' };
});



// Each of these narrows `selection` and then reads it inside a callback. A
// ref's `.value` is a mutable property, so the narrowing does not survive the
// closure - hence the local const, which does.
const sourceNodeSummary = computed(() => {
  const current = selection.value;
  if (!current || current.type !== 'edge') return '';
  const node = props.graphNodes.find((entry) => entry.id === current.edge.source);
  return node ? `${canvasNodeLabel(node, props.iriMap)} (${node.id})` : current.edge.source;
});

const targetNodeSummary = computed(() => {
  const current = selection.value;
  if (!current || current.type !== 'edge') return '';
  const node = props.graphNodes.find((entry) => entry.id === current.edge.target);
  return node ? `${canvasNodeLabel(node, props.iriMap)} (${node.id})` : current.edge.target;
});

const parentNodeSummary = computed(() => {
  const current = selection.value;
  if (!current || current.type !== 'io') return '';
  if (!current.parentNodeId) return '';
  const node = props.graphNodes.find((entry) => entry.id === current.parentNodeId);
  return node ? `${canvasNodeLabel(node, props.iriMap)} (${node.id})` : current.parentNodeId;
});

const backendOptionsWithLabels = computed(() => {
  return props.backendOptions.map((backend) => {
    const isQueryDefault = props.queryDefaultBackend === backend.id;
    const isLibraryDefault = props.libraryDefaultBackend === backend.id;

    let label = backend.name;

    // If both query and library default are the same, just show "(Query Default)"
    if (isQueryDefault && isLibraryDefault) {
      label = `${backend.name} (Query Default)`;
    } else if (isQueryDefault) {
      label = `${backend.name} (Query Default)`;
    } else if (isLibraryDefault) {
      label = `${backend.name} (Library Default)`;
    }

    return {
      value: backend.id,
      label,
    };
  });
});

const emitUpdateNodeLabel = (label: string) => {
  if (!selection.value || selection.value.type !== 'node') return;
  emit('update-node-label', { nodeId: selection.value.node.id, label });
};

// reka-ui's Select emits the generic AcceptableValue; every SelectItem here is
// given a plain string value, so the runtime value is always a string.
const emitUpdateNodeBackend = (backendId: AcceptableValue) => {
  if (!selection.value || selection.value.type !== 'node') return;
  emit('update-node-backend', { nodeId: selection.value.node.id, backendId: backendId as string });
};

const emitUpdateNodeMediaType = (mediaType: AcceptableValue) => {
  if (!selection.value || selection.value.type !== 'node') return;
  emit('update-node-media-type', { nodeId: selection.value.node.id, mediaType: mediaType as string });
};

/**
 * The picker follows the edge, not the click.
 *
 * A flow type the endpoints cannot carry is refused by the command layer, which
 * leaves `selection.edge.flowType` where it was — and because the bound value
 * never changed, Vue has nothing to patch and the `<select>` keeps showing the
 * option the browser selected. The inspector then names a flow type the edge
 * does not have. Writing the model's answer back afterwards costs nothing when
 * the change applied and is the whole correction when it did not.
 */
const emitUpdateEdgeFlowType = async (select: HTMLSelectElement) => {
  if (!selection.value || selection.value.type !== 'edge') return;
  emit('update-edge-flow-type', { edgeId: selection.value.edge.id, flowType: select.value });
  await nextTick();
  if (selection.value?.type === 'edge') {
    select.value = selection.value.edge.flowType;
  }
};

const emitUpdateEdgeWhenEmpty = (value: string) => {
  if (!selection.value || selection.value.type !== 'edge') return;
  emit('update-edge-when-empty', { edgeId: selection.value.edge.id, whenEmpty: value || null });
};

/**
 * The default differs by where the input comes from, so spell out which one applies
 * rather than leaving "Use the default" ambiguous.
 */
const whenEmptyHint = computed(() => {
  const sel = selection.value;
  if (!sel || sel.type !== 'edge') return '';
  switch (sel.edge.whenEmpty) {
    case 'unconstrained':
      return 'Optional enrichment: if the upstream finds nothing, this query still runs.';
    case 'propagateEmpty':
      return 'An empty upstream result yields no results here.';
    case 'require':
      return 'The run fails with a named error if this input receives nothing.';
    default:
      return 'Default: an upstream that ran and produced nothing yields no results; an external parameter that was never supplied is left open.';
  }
});

/**
 * The query the selected node names.
 *
 * A node saves only its query *version*, so a group loaded from the server
 * arrives with no query id on it at all — the owning query is found by looking
 * the version up in the catalogue. `queryEntityId`, when the node carries one,
 * is the same answer without the search.
 */
const assignedQueryId = computed<string | null>(() => {
  if (!selection.value || selection.value.type !== 'node') return null;
  const node = selection.value.node;
  if (node.queryEntityId) return node.queryEntityId;
  const versionId = node.queryVersionId ?? node.queryId ?? null;
  if (!versionId) return null;
  const owner = (props.queryOptions ?? []).find((option) =>
    option.versions.some((version) => version.id === versionId),
  );
  return owner?.id ?? null;
});

const queryChoices = computed(() =>
  (props.queryOptions ?? []).map((option) => ({ value: option.id, label: option.name })),
);

const queryPlaceholder = computed(() => {
  if (props.queryOptionsLoading) return 'Loading queries…';
  if (queryChoices.value.length === 0) return 'No queries available';
  return isPatchNode.value ? 'Select an update query' : 'Select a query';
});

const versionChoices = computed(() => {
  const option = (props.queryOptions ?? []).find((entry) => entry.id === assignedQueryId.value);
  if (!option) return [];
  return option.versions.map((version) => ({
    value: version.id,
    label: version.isCurrent ? `v${version.version} (current)` : `v${version.version}`,
  }));
});

const emitAssignQuery = (queryId: string) => {
  if (!selection.value || selection.value.type !== 'node' || !queryId) return;
  const option = (props.queryOptions ?? []).find((entry) => entry.id === queryId);
  // Newest first, so the head of the list is the fallback when no version is
  // flagged current — never a version chosen at random.
  const version = option?.versions.find((entry) => entry.isCurrent) ?? option?.versions[0];
  if (!version) return;
  emit('assign-query', { nodeId: selection.value.node.id, queryId, queryVersionId: version.id });
};

const emitAssignQueryVersion = (queryVersionId: string) => {
  if (!selection.value || selection.value.type !== 'node' || !queryVersionId) return;
  const queryId = assignedQueryId.value;
  if (!queryId) return;
  emit('assign-query', { nodeId: selection.value.node.id, queryId, queryVersionId });
};

const requestQueryIdInput = () => {
  if (!selection.value || selection.value.type !== 'node') return;
  emit('add-query-id-input', selection.value.node.id);
};

const requestRuleSetAssignment = () => {
  if (!selection.value || selection.value.type !== 'node') return;
  emit('request-ruleset-assignment', selection.value.node.id);
};

// ========== Tuple Mapping Logic ==========

const flowType = computed(() => {
  if (!selection.value || selection.value.type !== 'edge') return null;
  return selection.value.edge.flowType ?? null;
});

const isVariableBindingsFlow = computed(() => flowType.value === 'VARIABLE_BINDINGS');

const showIoMappingSection = computed(() => {
  return !!flowType.value && flowType.value !== 'CONTROL_FLOW';
});


const isTargetEndNode = computed(() => {
  const current = selection.value;
  if (!current || current.type !== 'edge') return false;
  const targetNode = props.graphNodes.find(n => n.id === current.edge.target);
  return targetNode?.kind === 'end';
});

const sourcePlaceholder = computed(() => {
  if (isVariableBindingsFlow.value) return 'Select output tuple';
  return 'Select source output';
});

const targetPlaceholder = computed(() => {
  if (isVariableBindingsFlow.value) return 'Select input tuple';
  return 'Select target input';
});

const toTupleInfo = (port: GraphPort): TupleInfo => {
  const entity = props.ioEntities[port.id];
  const memberEntries = Array.isArray(entity?.memberEntries) ? entity.memberEntries : null;
  return {
    id: port.id,
    label: entity?.name ?? port.label ?? port.id,
    // Unknown stays null. It used to collapse to 0, which then matched the
    // "no source selected" branch below and silently changed the filtering.
    arity: tupleArity(entity),
    memberEntries,
    resolved: port.resolved !== false && !!entity,
  };
};

// Which ports are legal endpoints is decided in queryGroupCompatibility; this
// panel only decides how to describe them. Re-deriving the rules here is how the
// inspector came to disagree with the code that creates and validates edges.
const sourceOutputTuples = computed((): TupleInfo[] => {
  const current = selection.value;
  if (!current || current.type !== 'edge') return [];
  const sourceNode = props.graphNodes.find(n => n.id === current.edge.source);
  if (!sourceNode) return [];
  return sourceCandidates(current.edge.flowType, sourceNode).map(toTupleInfo);
});

const targetInputTuples = computed((): TupleInfo[] => {
  const current = selection.value;
  if (!current || current.type !== 'edge') return [];
  const targetNode = props.graphNodes.find(n => n.id === current.edge.target);
  if (!targetNode) return [];
  return targetCandidates(current.edge.flowType, targetNode).map(toTupleInfo);
});

/**
 * Every kind-compatible target tuple, whatever its arity.
 *
 * Arity used to gate this list: a target had to have exactly as many variables
 * as the source or it disappeared, which is how an edge with a perfectly valid
 * target came to show no options at all. A mapping may legally select, reorder
 * or omit variables, so differing arity is a reason to warn (see
 * `mappingArityWarning`), never to hide a candidate.
 */
const targetInputTuplesFiltered = computed((): TupleInfo[] => targetInputTuples.value);

/**
 * Says what differing or unknown arity will do, without removing the option.
 * The wording comes from the compatibility module so that the inspector and
 * validation cannot describe the same situation differently.
 */
const mappingArityWarning = computed((): string => {
  const current = selection.value;
  if (!current || current.type !== 'edge') return '';
  if (!isVariableBindingsFlow.value) return '';
  return arityDiagnostics(current.edge.sourceOutputId, current.edge.targetInputId, ioModel.value)
    .map(entry => entry.message)
    .join(' ');
});

/** A tuple option shows its arity; a scalar port has none to show. */
const toMappingOption = (tuple: TupleInfo): MappingOption => ({
  id: tuple.id,
  label: tuple.label,
  ...(isVariableBindingsFlow.value ? { meta: describeArity(tuple.arity) } : {}),
});

const sourceMappingOptions = computed<MappingOption[]>(() => sourceOutputTuples.value.map(toMappingOption));

const targetMappingOptions = computed<MappingOption[]>(() =>
  targetInputTuplesFiltered.value.map(toMappingOption),
);

const ioMappingWarning = computed(() => {
  if (!selection.value || selection.value.type !== 'edge') return '';
  if (!showIoMappingSection.value) return '';
  if (!selection.value.edge.sourceOutputId) {
    return 'Select a source output for this edge.';
  }
  if (!isTargetEndNode.value && !selection.value.edge.targetInputId) {
    return 'Select a target input for this edge.';
  }
  return '';
});

/**
 * Everything else wrong with this edge, from the same rules the commands use.
 * The panel used to restate a couple of them - "QUERY_ID must target a Dynamic
 * Query node" was written out here and again in the flow-type validator.
 */
const edgeDiagnosticEntries = computed<Diagnostic[]>(() => {
  const current = selection.value;
  if (!current || current.type !== 'edge') return [];
  const sourceNode = props.graphNodes.find(n => n.id === current.edge.source);
  const targetNode = props.graphNodes.find(n => n.id === current.edge.target);
  return validateEdge(current.edge, sourceNode, targetNode, ioModel.value);
});

/**
 * The same diagnostics as prose.
 *
 * This used to map to messages at the point it called `validateEdge`, which
 * threw the level away before anything could read it - and so the panel could
 * only ever draw one tone of warning, whether the edge was merely lossy or
 * outright invalid. The level is kept now and the strings are derived from it.
 */
const edgeDiagnostics = computed<string[]>(() =>
  edgeDiagnosticEntries.value
    // Arity already has its own line below; showing it twice reads as two problems.
    .filter(entry => entry.code !== 'mapping-arity-differs' && entry.code !== 'mapping-arity-unknown')
    .map(entry => entry.message),
);

const tupleMapping = computed(() => {
  if (!selection.value || selection.value.type !== 'edge') return null;
  const sourceOutputId = selection.value.edge.sourceOutputId;
  const targetInputId = selection.value.edge.targetInputId;

  if (!sourceOutputId || !targetInputId) return null;

  const sourceVariables = variablesForPort(sourceOutputId, ioModel.value);
  const targetVariables = variablesForPort(targetInputId, ioModel.value);
  if (!sourceVariables || !targetVariables) return null;
  if (sourceVariables.length === 0 || targetVariables.length === 0) return null;

  const sourceNames = sourceVariables.map((entry) => entry.variableName);
  const targetNames = targetVariables.map((entry) => entry.variableName);
  const configured = new Map<string, string>();
  try { for (const item of JSON.parse(selection.value.edge.variableMappings ?? '[]')) if (typeof item?.source === 'string' && typeof item?.target === 'string') configured.set(item.target, item.source); } catch { /* defaults */ }
  const remaining = sourceNames.filter(name => !targetNames.includes(name));
  return targetNames.map((target, index) => ({ target, source: configured.get(target) ?? (sourceNames.includes(target) ? target : remaining[index] ?? null), sourceOptions: sourceNames }));
});

/**
 * Whether the positional grid is open.
 *
 * Sticky for as long as the panel lives, rather than reset on every selection:
 * "show me the positions" is how an author is working, not a fact about one
 * edge, and an author checking five edges in a row would otherwise open the
 * same drawer five times. It starts closed, which is what a default is.
 */
const mappingExpanded = ref(false);

/**
 * The mapping on one line: what each target variable is fed, in target order.
 *
 * Reads off `tupleMapping`, so the summary and the grid cannot disagree - the
 * grid's own defaulting (positional fill for the variables that do not simply
 * share a name) is applied before either of them draws. `UNDEF` is spelled the
 * way the grid's own empty option spells it, because it is the same answer.
 */
const mappingSummaryLine = computed((): string => {
  const pairs = tupleMapping.value;
  if (!pairs) return '';
  const sources = pairs.map(pair => (pair.source ? `?${pair.source}` : 'UNDEF')).join(' ');
  const targets = pairs.map(pair => `?${pair.target}`).join(' ');
  return `${sources} → ${targets}`;
});

/**
 * Everything the lines under the summary say, with the level each was raised
 * at. `ioMappingWarning` is this panel's own and has no `Diagnostic` to come
 * from, so it is given one here rather than counted separately.
 */
const mappingIssues = computed((): Diagnostic[] => {
  const entries = [...edgeDiagnosticEntries.value];
  if (ioMappingWarning.value) {
    entries.push({ level: 'warning', code: 'endpoint-unset', message: ioMappingWarning.value });
  }
  return entries;
});

/**
 * What the summary says about the mapping underneath it.
 *
 * The whole reason the grid may be collapsed by default: a closed drawer is
 * only honest if the header already answered "is this edge all right?". Drawn
 * from the same diagnostics the panel prints below, so the tone and the
 * reasons can never disagree.
 */
const mappingState = computed((): 'ok' | 'warning' | 'error' => {
  if (mappingIssues.value.some(entry => entry.level === 'error')) return 'error';
  if (mappingIssues.value.some(entry => entry.level === 'warning')) return 'warning';
  return 'ok';
});

const mappingStateGlyph = computed(() => (mappingState.value === 'ok' ? '✓' : '⚠'));

/** The glyph in words, since the glyph is decoration and a count is not. */
const mappingStateNote = computed((): string => {
  const errors = mappingIssues.value.filter(entry => entry.level === 'error').length;
  if (errors > 0) return `${errors} problem${errors === 1 ? '' : 's'}`;
  const warnings = mappingIssues.value.filter(entry => entry.level === 'warning').length;
  if (warnings > 0) return `${warnings} warning${warnings === 1 ? '' : 's'}`;
  return 'mapped';
});

const updateVariableMapping = (target: string, source: string) => {
  if (!selection.value || selection.value.type !== 'edge' || !tupleMapping.value) return;
  const mappings = tupleMapping.value.map(pair => ({ source: pair.target === target ? source : pair.source, target: pair.target })).filter((pair): pair is { source: string; target: string } => Boolean(pair.source));
  emit('update-edge-variable-mappings', { edgeId: selection.value.edge.id, variableMappings: JSON.stringify(mappings) });
};

// Called both from the Select's @update:model-value (AcceptableValue) and
// directly with `null` from the clear button; every SelectItem value here is
// a plain string, so the runtime value is always string | null.
const updateEdgeSourceOutput = (value: AcceptableValue) => {
  if (!selection.value || selection.value.type !== 'edge') return;

  // Pass-through to the End node is handled by the command, which moves the
  // alias with the source. Emitting a second target update from here was the
  // panel re-implementing that rule.
  emit('update-edge-source-output', {
    edgeId: selection.value.edge.id,
    sourceOutputId: value as string | null
  });
};

const updateEdgeTargetInput = (value: AcceptableValue) => {
  if (!selection.value || selection.value.type !== 'edge') return;
  emit('update-edge-target-input', {
    edgeId: selection.value.edge.id,
    targetInputId: value as string | null
  });
};
</script>

<style scoped>
.canvas-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel {
  background: var(--surface);
  display: flex;
  flex-direction: column;
  height: 100%;
}

/*
 * The kind chip beside the title. `StatusBadge` is for run state — valid,
 * stale, running — and this is a noun, so it stays a plain chip on the same
 * tokens rather than borrowing a state colour it does not mean.
 */
.node-kind {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  background: var(--surface-raised);
  color: var(--ink-secondary);
  letter-spacing: 0.05em;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* A labelled block whose control is not a single form control — a value plus
   the button that changes it. `FormField` owns the rest. */
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

/*
 * The one control box, matching `EntityDetailsPanel`'s: 28px on the grid,
 * 4px corner, 13px text. It was 8px/10px padding with an 8px corner and 14px
 * text here, which is why the Editor tab read a size larger than Details.
 */
.field-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-content);
}

.field-input:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: 1px;
  border-color: var(--action-border);
}

.field-input:disabled {
  background: var(--surface-subtle);
  color: var(--ink-disabled);
}

select.field-input {
  padding-right: var(--space-2);
  cursor: pointer;
}

textarea.field-textarea {
  height: auto;
  padding: var(--space-3) var(--space-4);
  resize: vertical;
}

.inline-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
}

.inline-value {
  font-size: var(--text-content);
  color: var(--ink-secondary);
  white-space: nowrap;
  flex-grow: 1;
}

.field-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.field-hint-error {
  color: var(--danger);
}

/* The version chooser sits under its query, not beside it. */
.version-field {
  margin-top: var(--space-3);
}

.store-id {
  font-family: var(--font-mono);
  font-size: var(--text-code);
  color: var(--ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.start-node-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.start-node-actions {
  display: flex;
  justify-content: flex-end;
}

.ports-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.port-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.port-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.port-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  padding: var(--space-3) var(--space-4);
}

.port-name {
  font-size: var(--text-content);
  color: var(--ink-secondary);
  font-weight: var(--weight-medium);
}

.edge-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
}

.summary-label {
  display: block;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--ink-muted);
}

.summary-value {
  display: block;
  font-size: var(--text-content);
  color: var(--ink);
  font-weight: var(--weight-medium);
}

.summary-subvalue {
  display: block;
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.validation-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  border-radius: var(--radius-panel);
  background: var(--danger-surface);
  border: 1px solid var(--danger-border);
}

.validation-list-title {
  color: var(--danger-ink);
}

.validation-list ul {
  margin: 0;
  padding-left: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.validation-list li {
  font-size: var(--text-body);
  color: var(--danger-ink);
}

.select-trigger {
  width: 100%;
}

/* Tuple Mapping Section */
.tuple-mapping-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  border-radius: var(--radius-panel);
  background: var(--action-surface);
  border: 1px solid var(--action-border);
}

.tuple-meta {
  font-size: var(--text-label);
  color: var(--ink-muted);
  margin-left: var(--space-3);
}

.tuple-warning {
  font-size: var(--text-body);
  color: var(--danger-ink);
  margin: 0;
}

.io-state {
  font-size: var(--text-body);
  color: var(--ink-muted);
  margin: 0 0 var(--space-4);
}

.io-state-error,
.io-state-incomplete {
  color: var(--danger-ink);
}

.select-with-clear {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-with-clear .select-trigger {
  flex: 1;
}

.btn-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h);
  height: var(--control-h);
  min-width: var(--control-h);
  border-radius: var(--radius);
  border: 1px solid var(--border-default);
  background: var(--surface);
  font-size: var(--text-content);
  color: var(--ink-muted);
  cursor: pointer;
  transition: all var(--duration);
  flex-shrink: 0;
}

.btn-clear:hover {
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  border-color: var(--border-strong);
}

/*
 * The padding moved onto the two halves. The box holds a single row when it is
 * collapsed, and a box with its own padding around a row that has its own is a
 * header floating in the middle of a card.
 */
.tuple-mapping-visualization {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--action-border);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

/*
 * The header is the control now, so the whole row is the hit target. A chevron
 * on its own is 13px of target sitting beside a line of text that reads like a
 * label and would not respond to being clicked.
 */
.mapping-header {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  padding: var(--space-4) var(--space-5);
  border: 0;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.mapping-header[aria-expanded='true'] {
  border-bottom: 1px solid var(--border-subtle);
}

.mapping-header:hover {
  background: var(--surface-subtle);
}

.mapping-header:focus-visible {
  outline: 2px solid var(--action);
  outline-offset: -2px;
}

.mapping-chevron {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.mapping-title {
  flex-shrink: 0;
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ink-muted);
}

/*
 * The mapping itself, and the only part of the row allowed to be cut short: the
 * label says which section this is and the state note is the answer, so a tuple
 * of nine variables ellipsises rather than pushing either off the end. The full
 * line stays in the `title`.
 */
.mapping-summary-line {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapping-spacer {
  flex: 1;
}

.mapping-state-glyph {
  flex-shrink: 0;
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.mapping-subtitle {
  flex-shrink: 0;
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-weight: 600;
}

/* The state, in the one row that is visible whether or not the grid is. */
.mapping-header[data-mapping-state='ok'] .mapping-state-glyph {
  color: var(--success-ink);
}

.mapping-header[data-mapping-state='warning'] .mapping-state-glyph,
.mapping-header[data-mapping-state='warning'] .mapping-subtitle {
  color: var(--warning-ink);
}

.mapping-header[data-mapping-state='error'] .mapping-state-glyph,
.mapping-header[data-mapping-state='error'] .mapping-subtitle {
  color: var(--danger-ink);
}

.mapping-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--space-5);
}

.mapping-column-headers {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 4px;
  margin-bottom: var(--space-2);
}

.column-header {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--ink-muted);
  display: flex;
}

.column-header-position {
  justify-content: flex-start;
  padding-left: var(--space-2);
  min-width: 60px;
}

.column-header-source {
  justify-content: flex-end;
  padding-right: var(--space-5); /* 8px box padding + 6px edge padding */
}

.column-header-target {
  justify-content: flex-start;
  padding-left: var(--space-5); /* 8px box padding + 6px edge padding */
}

.column-header-spacer {
  width: auto;
}

.mapping-content {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 4px;
  align-items: center;
}

.mapping-position-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-4) var(--space-2);
  min-width: 60px;
}

.position-number {
  height: var(--control-h);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  font-style: italic;
  font-size: var(--text-content);
  color: var(--ink-muted);
  padding-left: var(--space-2);
}

.mapping-column {
  display: flex;
}

.mapping-column-source {
  justify-content: flex-end;
}

.mapping-column-target {
  justify-content: flex-start;
}

.variable-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  min-width: 100px;
}

.variable-group-source {
  align-items: flex-end;
  padding-right: var(--space-3);
}

.variable-group-target {
  align-items: flex-start;
  padding-left: var(--space-3);
}

.variable-badge {
  font-family: var(--font-mono);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  padding: var(--space-1) var(--space-4);
  white-space: nowrap;
}

.mapping-rows-connector {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-4) var(--space-2);
}

.arrow-row {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--control-h);
}

.mapping-arrow {
  color: var(--ink-muted);
  flex-shrink: 0;
}

.end-node-info {
  padding: var(--space-5);
  background: var(--action-surface);
  border: 1px solid var(--action-border);
  border-radius: var(--radius-panel);
}

.end-node-info p {
  margin: 0;
  font-size: var(--text-body);
  color: var(--action-ink);
  line-height: var(--leading-normal);
}

.delete-section {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-default);
  margin-top: auto;
}

</style>
