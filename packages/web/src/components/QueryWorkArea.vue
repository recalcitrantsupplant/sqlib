<template>
  <div class="query-work-area" ref="workAreaRef">
    <div class="left-panel" :class="{ 'resizing': isResizing }" :style="{ width: rightPanelCollapsed ? 'calc(100% - 48px)' : leftPanelWidth + '%' }">
      <!--
        There is no metadata panel above the editor any more. Identity, versions
        and signature are the Details tab on the right, and having them in two
        places meant two sources of truth for the same five fields — one of
        which silently discarded edits (see `persistIdentity` below).
        What the panel uniquely carried has moved: its banners to the editor
        overlay, its Edit and Delete to the save bar's ⋮ menu.
      -->
      <SaveBar
        :title="queryName"
        :is-scratch="isScratch"
        :current-version-number="currentVersionNumberForDisplay"
        :edit-count="editCount"
        :saving="isSavingVersion"
        :can-save="canSave"
        :needs-name="needsName"
        :can-format="!!queryCode.trim()"
        :code="queryCode"
        content-type="application/sparql-query"
        :diff-active="showDiff"
        :show-edit="false"
        @save="save"
        @needs-name="promptForNameInDetails"
        @discard="discardDraft"
        @delete="requestDeleteQuery"
        @format="formatQueryCode"
        @update:code="(value) => (queryCode = value)"
        @toggle-diff="handleDiffToggle"
      />

      <!--
        The run, as one sentence (design 3b). "Run with these arguments against
        this backend as this format" is one decision, so it is one row with Run
        at its head — and beyond the rule is what that decision can be kept as,
        because a test or a benchmark made here *is* this recipe.
      -->
      <ExpandRunStrip>
        <RunBar
          :run-label="runLabel"
          :running="isExecuting"
          :run-disabled="!queryCode.trim()"
          :run-title="queryCode.trim() ? 'Run this query' : 'Write a query first'"
          :inputs="runInputs"
          :backend="{ value: selectedBackend, options: backendOptions, loading: backendsLoading, title: 'The store this query runs against' }"
          :format="{ value: selectedMediaType, options: mediaTypeOptions, groups: mediaTypeChoiceGroups, title: 'The format the results come back in' }"
          :create-targets="['benchmark', 'test']"
          :create-disabled-reason="createDisabledReason"
          :creating="creatingFromRecipe"
          recipe-noun="arguments"
          @run="() => executeQuery()"
          @pick="showArgumentsTab"
          @update:backend="(value) => (selectedBackend = value)"
          @update:format="(value) => (selectedMediaType = value)"
          @create="createFromRecipe"
        />
      </ExpandRunStrip>

      <!--
        `isNewEntity` means "unsaved, so it cannot be run" — the assumption that
        predates the draft model. A scratch query breaks it: running an unsaved
        body is the entire point of one, and the direct-execution path has
        always been able to. Validation errors do not block it either, for the
        same reason the playground never blocked them: run it, break it, throw
        it away.
      -->
      <!--
        The editor pops out over the page, with the run strip along with it.
        Reading a hundred lines of SPARQL through a half-width column is the
        problem it solves, and a pop-out you cannot run from would only be
        half of the answer.
      -->
      <ExpandableEditor
        v-slot="{ expanded: editorExpanded, toggle: expandEditor }"
        title="Query Editor"
        testid="query-editor-expand"
      >
        <SparqlEditorPanel
          editor-title="Query Editor"
          expandable
          :expanded="editorExpanded"
          :sparql-code="queryCode"
          :selected-version="selectedVersion"
          :version-id="selectedVersion"
          :version-options="versionOptions"
          :is-new-entity="isNewQuery && !isScratch"
          :allow-execute-on-validation-error="isScratch"
          :is-saving="isSaving"
          :is-loading="queryLoading"
          :editor-overlay-active="editorOverlayActive"
          :editor-overlay-message="editorOverlayMessage"
          :extensions="extensions"
          :show-execution-row="true"
          :selected-backend="selectedBackend"
          :backend-options="backendOptions"
          :selected-media-type="selectedMediaType"
          :backends-loading="backendsLoading"
          :validation-state="validationState"
          :validation-error="validationError"
          :query-type="queryType"
          :detected-outputs="detectedOutputs"
          :argument-set-options="argumentSetOptions"
          :selected-argument-set-id="argumentSetsComposable.selectedSetId.value"
          :argument-set-loading="argumentSetLoading"
          :is-dirty="isDirty"
          :show-diff-button="!isScratch"
          :prefix-source="prefixSource"
          :document-key="editorDocumentKey"
          :diff-active="showDiff"
          chrome="minimal"
          :show-query-outputs="false"
          :hide-save-buttons="true"
          :hide-version-selector="true"
          @update:sparql-code="applyEditedQueryCode"
          @update:selected-version="(value) => selectedVersion = value"
          @update:selected-backend="(value) => selectedBackend = value"
          @update:selected-media-type="(value) => selectedMediaType = value"
          @update:selected-argument-set-id="(value) => argumentSetsComposable.selectSet(value)"
          @request-code-dialog="activeResultsTab = 'code'"
          @request-focus="openEditorFocus"
          @request-expand="expandEditor"
          @request-format="formatQueryCode"
          @save-new-version="saveNewVersion"
          @delete="requestDeleteQuery"
          @execute="executeQuery"
          @copy-version-id="copyQueryVersionId"
          @toggle-diff="handleDiffToggle"
        >
          <template #footer>
            <QueryEditorFooter
              :validation-state="validationState"
              :query-type-label="queryTypeLabel"
              :sparql-code="queryCode"
            />
          </template>
        </SparqlEditorPanel>
      </ExpandableEditor>

    </div>

    <div
      class="vertical-resizer"
      :class="{ 'hidden': rightPanelCollapsed }"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the results panel"
      title="Drag to resize · double-click to reset"
      @mousedown="startVerticalResize"
      @dblclick="resetPanelWidth"
    >
      <div class="resizer-handle"></div>
    </div>

    <div class="right-panel" :class="{ 'collapsed': rightPanelCollapsed }">
      <QueryResultsPanel
        ref="queryResultsPanelRef"
        v-model:active-tab="activeResultsTab"
        v-model:collapsed="rightPanelCollapsed"
        :result="executionResult"
        :results-prefix-source="resultsPrefixSource"
        :results-overlay-active="resultsOverlayActive"
        :results-overlay-message="resultsOverlayMessage"
        :arguments-overlay-active="argumentsOverlayActive"
        :arguments-overlay-message="argumentsOverlayMessage"
        :is-new-query="isNewQuery"
        :query-loading="queryLoading"
        :detected-inputs="detectedInputs"
        :detected-outputs="detectedOutputs"
        :validation-state="validationState"
        :query-id="queryId"
        :query-text="queryCode"
        :argument-sets-composable="argumentSetsComposable"
        :details="detailsProps"
        @request-focus="handleFocusRequest"
        @update:details-name="(value) => queryName = value"
        @update:details-description="(value) => queryDescription = value"
        @update:details-backend="handleDetailsBackendChange"
        @select-version="showVersionBody"
        @set-current-version="setCurrentVersion"
        @select-draft="restoreDraftBody"
        @compare-version="compareVersionWithCurrent"
        @annotate-version="annotateVersion"
        @copy-id="copyQueryId"
        @delete-query="confirmDeleteQuery"
        @open-test="(testId) => emit('open-entity', { type: 'test', id: testId })"
      />
    </div>

    <QueryFocusOverlay
      v-if="showEditorFocus"
      :show="showEditorFocus"
      :query-code="queryCode"
      :document-key="editorDocumentKey"
      :extensions="extensions"
      :show-diff="showDiff"
      :version-options="versionOptions"
      :diff-left-version="diffLeftVersion"
      :diff-right-version="diffRightVersion"
      :diff-left-query="diffLeftQuery"
      :diff-right-query="diffRightQuery"
      :diff-left-label="diffLeftLabel"
      :diff-right-label="diffRightLabel"
      @update:show="(value) => showEditorFocus = value"
      @update:queryCode="applyEditedQueryCode"
      @toggle-diff="toggleDiff"
      @update-diff-left-version="updateDiffLeftVersion"
      @update-diff-right-version="updateDiffRightVersion"
      @swap-diff-versions="swapDiffVersions"
    />

    <!-- Results Focus Mode Overlay -->
    <div v-if="showResultsFocus" class="focus-overlay" @click.self="showResultsFocus = false">
      <div class="focus-container">
        <PanelHeader title="Query Results" size="lg" sunken>
          <template #actions>
            <button class="btn-icon" title="Close Focus Mode" @click="showResultsFocus = false">
              <X :size="20" />
            </button>
          </template>
        </PanelHeader>
        <div class="focus-content">
          <QueryResultsViewer
            :results="executionResult?.structured ?? null"
            :raw-content="executionResult?.rawContent ?? null"
            :content-type="executionResult?.contentType ?? null"
            :timing="executionResult?.timing ?? undefined"
            :executed-at="executedAtFocus"
            :prefix-source="resultsPrefixSource"
          />
        </div>
      </div>
    </div>

    <!-- Arguments Focus Mode Overlay -->
    <div v-if="showArgumentsFocus" class="focus-overlay" @click.self="showArgumentsFocus = false">
      <div class="focus-container">
        <PanelHeader title="Query Arguments" size="lg" sunken>
          <template #actions>
            <button class="btn-icon" title="Close Focus Mode" @click="showArgumentsFocus = false">
              <X :size="20" />
            </button>
          </template>
        </PanelHeader>
        <div class="focus-content">
          <div class="arguments-content-focus">
            <!-- Detected Outputs Section -->
            <div v-if="hasDetectedOutputs" class="outputs-section">
              <div class="outputs-header">
                <span class="outputs-label">Query Outputs</span>
                <span class="outputs-count">{{ detectedOutputs.length }}</span>
              </div>
              <div class="outputs-list">
                <span v-for="output in detectedOutputs" :key="output" class="output-badge">
                  {{ output }}
                </span>
              </div>
            </div>

            <!-- Limit Parameters -->
            <div v-for="(param, index) in detectedInputs?.limitParameters" :key="`limit-${index}`" class="argument-group">
              <div class="argument-group-header">
                <SectionLabel as="span" size="md" class="argument-group-label">Limit</SectionLabel>
                <span class="argument-group-type">LimitParameter</span>
              </div>
              <div class="argument-tuple-row">
                <input
                  type="number"
                  class="argument-input"
                  :placeholder="`e.g., 100`"
                />
              </div>
            </div>

            <!-- Offset Parameters -->
            <div v-for="(param, index) in detectedInputs?.offsetParameters" :key="`offset-${index}`" class="argument-group">
              <div class="argument-group-header">
                <SectionLabel as="span" size="md" class="argument-group-label">Offset</SectionLabel>
                <span class="argument-group-type">OffsetParameter</span>
              </div>
              <div class="argument-tuple-row">
                <input
                  type="number"
                  class="argument-input"
                  :placeholder="`e.g., 0`"
                />
              </div>
            </div>

            <!-- VALUES Input Tuples -->
            <div v-for="(tuple, tupleIndex) in detectedInputs?.valuesInputs" :key="`tuple-${tupleIndex}`" class="argument-group">
              <div class="argument-group-header">
                <SectionLabel as="span" size="md" class="argument-group-label">Input Tuple {{ tupleIndex + 1 }}</SectionLabel>
                <span class="argument-group-type">QueryInputTuple</span>
              </div>
              <div class="tuple-variables-header">
                <span v-for="variable in tuple" :key="variable" class="tuple-var-label">
                  {{ variable }}
                </span>
              </div>
              <div class="argument-tuple-row">
                <input
                  v-for="variable in tuple"
                  :key="variable"
                  type="text"
                  class="argument-input"
                  :placeholder="`Value for ${variable}`"
                />
              </div>
            </div>

            <!-- Empty State -->
            <div v-if="!hasDetectedArguments && !hasDetectedOutputs" class="arguments-empty">
              <span class="arguments-empty-icon">📭</span>
              <span>No arguments detected in query</span>
            </div>

            <!--
            MOCK DATA PRESERVED FOR REFERENCE:

            Limit Parameter:
            <div class="argument-group">
              <div class="argument-group-header">
                <SectionLabel as="span" size="md" class="argument-group-label">Limit</SectionLabel>
                <span class="argument-group-type">LimitParameter</span>
              </div>
              <div class="argument-tuple-row">
                <input type="number" class="argument-input" placeholder="e.g., 100" value="100" />
                <button class="btn-tuple-action" title="Remove"><X :size="14" /></button>
              </div>
            </div>

            Offset Parameter:
            <div class="argument-group">
              <div class="argument-group-header">
                <SectionLabel as="span" size="md" class="argument-group-label">Offset</SectionLabel>
                <span class="argument-group-type">OffsetParameter</span>
              </div>
              <div class="argument-tuple-row">
                <input type="number" class="argument-input" placeholder="e.g., 0" value="0" />
                <button class="btn-tuple-action" title="Remove"><X :size="14" /></button>
              </div>
            </div>

            Input Tuple: Two Variables:
            <div class="argument-group">
              <div class="argument-group-header">
                <SectionLabel as="span" size="md" class="argument-group-label">Input Tuple</SectionLabel>
                <span class="argument-group-type">QueryInputTuple</span>
                <button class="btn-add-tuple-row" title="Add Row"><Plus :size="14" />Add Row</button>
              </div>
              <div class="tuple-variables-header">
                <span class="tuple-var-label">?country<span class="var-nodekind-badge">IRI</span></span>
                <span class="tuple-var-label">?population<span class="var-nodekind-badge var-literal">Literal</span><span class="var-datatype-badge">xsd:integer</span></span>
              </div>
              <div class="argument-tuple-row">
                <input type="text" class="argument-input" placeholder="Country value" value="wd:Q30" />
                <input type="text" class="argument-input" placeholder="Population value" value="331000000" />
                <button class="btn-tuple-action" title="Remove Row"><X :size="14" /></button>
              </div>
              <div class="argument-tuple-row">
                <input type="text" class="argument-input" placeholder="Country value" value="wd:Q145" />
                <input type="text" class="argument-input" placeholder="Population value" value="67000000" />
                <button class="btn-tuple-action" title="Remove Row"><X :size="14" /></button>
              </div>
            </div>

            Input Tuple: Single Variable:
            <div class="argument-group">
              <div class="argument-group-header">
                <SectionLabel as="span" size="md" class="argument-group-label">Input Tuple</SectionLabel>
                <span class="argument-group-type">QueryInputTuple</span>
                <button class="btn-add-tuple-row" title="Add Row"><Plus :size="14" />Add Row</button>
              </div>
              <div class="tuple-variables-header">
                <span class="tuple-var-label">?language<span class="var-nodekind-badge var-literal">Literal</span></span>
              </div>
              <div class="argument-tuple-row">
                <input type="text" class="argument-input" placeholder="Language value" value="en" />
                <button class="btn-tuple-action" title="Remove Row"><X :size="14" /></button>
              </div>
              <div class="argument-tuple-row">
                <input type="text" class="argument-input" placeholder="Language value" value="es" />
                <button class="btn-tuple-action" title="Remove Row"><X :size="14" /></button>
              </div>
            </div>
            -->
          </div>
        </div>
      </div>
    </div>

    <AlertDialog v-model:open="deleteConfirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this query?</AlertDialogTitle>
          <AlertDialogDescription>
            “{{ queryName || 'Untitled query' }}” and every saved version of it will be
            removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="delete-action"
            data-testid="confirm-delete-query"
            :disabled="isDeleting"
            @click.prevent="confirmDeleteQuery"
          >
            {{ isDeleting ? 'Deleting…' : 'Delete' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!--
      There is no Edit-details dialog any more. Every field it carried — name,
      description, default backend and which version is current — is a control
      on the Details tab now, and each saves on its own; a dialog editing the
      same four is a second copy that can disagree with the first.
    -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, shallowRef, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { X } from '@lucide/vue';
import { languageExtensionsFor } from '@/lib/codeLanguage';
import { useCommentKeymap } from '@/composables/useCommentKeymap';
import { useEditorKeymaps } from '@/composables/useEditorKeymaps';
import { useExecuteKeymap } from '@/composables/useExecuteKeymap';
import { EPHEMERAL_BACKEND_ID, EPHEMERAL_BACKEND_LABEL } from '@sparql-query-lib/types';
import RunBar from './shared/RunBar.vue';
import type { CreateTarget, RunBarPick } from '../lib/runBar';
import { useBenchmarksStore } from '../composables/useBenchmarksStore';
import { NO_ARGUMENTS_IRI, emptySettings } from '../lib/benchmarkPlan';
import type { Query as ApiQuery, Backend as ApiBackend, QueryCreateInput } from '@sparql-query-lib/contracts';
import QueryResultsViewer from './QueryResultsViewer.vue';
import SparqlEditorPanel from './shared/SparqlEditorPanel.vue';
import ExpandableEditor from './shared/ExpandableEditor.vue';
import ExpandRunStrip from './shared/ExpandRunStrip.vue';
import { useEditorExpand } from '../composables/useEditorExpand';
import QueryResultsPanel from './query-work-area/QueryResultsPanel.vue';
import type { QueryInspectorTab } from '@/types/execution';
import QueryFocusOverlay from './query-work-area/QueryFocusOverlay.vue';
import SaveBar from './shared/SaveBar.vue';
import PanelHeader from './shared/PanelHeader.vue';
import SectionLabel from './shared/SectionLabel.vue';
import { useCommand } from '../composables/useCommandRegistry';
import QueryEditorFooter from './query-work-area/QueryEditorFooter.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { toast } from 'vue-sonner';
import { useQueriesStore } from '../composables/useQueriesStore';
import { useBackendsStore } from '../composables/useBackendsStore';
import { useApiClient } from '../composables/useApiClient';
import { getAllMediaTypeOptions, getMediaTypeChoiceGroups } from '@/lib/mediaTypes';
import { OUTPUT_MEDIA_TYPES, isGraphQueryType, isResultSetQueryType, isUpdateQueryType, getQueryTypeKeyFromIri } from '@sparql-query-lib/types';
import { usePanelResize } from '../composables/usePanelResize';
import { useQueryValidation } from '../composables/useQueryValidation';
import { useQueryExecution } from '../composables/useQueryExecution';
import { useQueryVersions } from '../composables/useQueryVersions';
import { useQueryMetadata } from '../composables/useQueryMetadata';
import { useArgumentSets } from '@/composables/useArgumentSets';
import { useQueryDirtyState } from '../composables/useQueryDirtyState';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from '../composables/useCallableDrafts';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useScratchRecord } from '../composables/useScratchRecord';
import { useEditorDocumentKey } from '../composables/useEditorDocumentKey';
import { rdfSyntaxHighlighting } from '../lib/codemirrorHighlight';
import { prefixSourceToken } from '@/lib/prefixSources';
import type { QueryTypeValue } from '@sparql-query-lib/types';

interface QueryCreationRequest {
  id: number;
  libraryId: string;
  libraryName: string;
}

interface QueryCreatedPayload {
  id: string;
  name: string;
  libraryId: string;
  libraryName: string;
}

const props = defineProps<{
  creationRequest: QueryCreationRequest | null;
  queryId: string | null;
  /**
   * The scratch record this work area is editing, if any. A scratch query has
   * no server identity at all — no id, no versions — so it is a source of
   * content, not a thing to fetch (nav doc §1).
   */
  scratchId?: string | null;
  versionNumber?: number | null;
  /**
   * An argument set to open with, from `?argumentSet=`.
   *
   * How "Run with…" on an argument set's Fits list arrives. The page owns the
   * route, so it reads the param and hands it down rather than this component
   * reaching for router state it otherwise has no use for.
   */
  preselectArgumentSetId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'creation-consumed'): void;
  (e: 'query-created', payload: QueryCreatedPayload): void;
  (e: 'update:versionNumber', version: number | null): void;
  (e: 'query-load-failed'): void;
  (e: 'scratch-saved', payload: { id: string; name: string; libraryId: string }): void;
  (e: 'query-deleted', id: string): void;
  /**
   * A test or a benchmark was created from the run sentence, or an existing
   * test was clicked in the Tests tab. The object exists in the library either
   * way; this is the page taking you to it, which is the only reasonable next
   * step after "create test" and the whole point of the row.
   */
  (e: 'open-entity', payload: { type: 'test' | 'benchmark'; id: string }): void;
}>();

const creationContext = ref<{ libraryId: string; libraryName: string } | null>(null);
const lastCreationToken = ref<number | null>(null);
const queriesStore = useQueriesStore();
const backendsStore = useBackendsStore();
const benchmarksStore = useBenchmarksStore();
const apiClient = useApiClient();

// Query state management
type QueryState = 'creating' | 'saving' | 'active' | 'editing';
const queryState = ref<QueryState>('creating');

// Query data
const queryName = ref('');
const queryDescription = ref('');
const versionComment = ref('');
const queryId = ref('');
// The Details footer's "Created" note; the query list never needed it, so it
// was never kept.
const queryCreatedAt = ref<string | null>(null);
const queryConcurrency = ref<string | null>(null);

// Backend selection (query level - default backend)
const NONE_BACKEND = 'none';
const defaultBackend = ref<string>(EPHEMERAL_BACKEND_ID);

// Backend selection (execution context - which backend to execute against)
const selectedBackend = ref<string>(EPHEMERAL_BACKEND_ID);

/**
 * What a chosen default backend is stored as.
 *
 * The in-memory Oxigraph is not a Backend entity — it is an execution mode with
 * a reserved id — so writing that id into `defaultBackend` would leave a
 * reference to something the store does not contain, which is why the library
 * dialog keeps it out of its own default-backend list. "Names no backend" and
 * "runs in memory" are the same state here, so it is stored as null and read
 * back as the in-memory option; nothing is lost and no dangling IRI is written.
 */
function toStoredBackend(value: string): string | null {
  return !value || value === NONE_BACKEND || value === EPHEMERAL_BACKEND_ID ? null : value;
}

// Media type selection (execution context - which format to request)
const selectedMediaType = ref<string>('application/sparql-results+json');
// Details, not Arguments: opening a query — new or saved — you want to know
// what it is before you want to know what you can pass it. Run moves you to
// Results, which is the only tab worth being taken to without asking.
const editorExpansion = useEditorExpand();

const activeResultsTab = ref<QueryInspectorTab>('details');
const queryResultsPanelRef = ref<InstanceType<typeof QueryResultsPanel> | null>(null);
// The library is passed so the switcher can offer sets made elsewhere in it,
// with their fit against this query. See `useArgumentSets.loadArgumentSets`.
const argumentSetsComposable = useArgumentSets(queryId, 'query', () => queryLibraryId.value || activeLibraryId.value);

// Loading state
const queryLoading = ref(false);
const loadError = ref<string | null>(null);
const currentQueryId = ref<string | null>(null);

// Backends cache
const availableBackends = computed<ApiBackend[]>(() => backendsStore.backends.value);
const backendsLoading = computed(() => backendsStore.loading.value);
const backendsError = computed(() => backendsStore.error.value);

// SPARQL editor state
const queryCode = ref(`SELECT ?country ?countryLabel WHERE {
  ?country wdt:P31 wd:Q6256 .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
LIMIT 100`);
// Extensions defined after executeQuery is available
let extensions = shallowRef([
  ...languageExtensionsFor('application/sparql-query'),
  rdfSyntaxHighlighting,
  useCommentKeymap(),
  useEditorKeymaps(),
]);
const queryType = ref<QueryTypeValue | null>(null); // Stores the detected query type (sqlibQueryType:* IRIs)

/** SELECT / ASK / CONSTRUCT for the footer pill — "valid" alone does not say
 *  what a caller gets back. */
const queryTypeLabel = computed(() => {
  const key = getQueryTypeKeyFromIri(queryType.value);
  return key ? key.toUpperCase() : null;
});

const { validationState, validationError, detectedInputs, detectedOutputs } = useQueryValidation({
  apiClient,
  queryCode,
});

/*
 * Read by the arguments focus overlay, which had the markup but not these —
 * they were left behind when the panel was extracted to QueryResultsPanel.vue,
 * where the same two computeds live over props. In a template an undefined name
 * is simply falsy, so nothing errored: the overlay's "Query Outputs" section
 * never rendered, and its "No arguments detected in query" empty state rendered
 * always, including for a query whose arguments were sitting right above it.
 * See issue #52.
 */
const hasDetectedArguments = computed(() => {
  const inputs = detectedInputs.value;
  if (!inputs) return false;
  return (
    (inputs.limitParameters?.length ?? 0) > 0 ||
    (inputs.offsetParameters?.length ?? 0) > 0 ||
    (inputs.valuesInputs?.length ?? 0) > 0
  );
});

const hasDetectedOutputs = computed(() => (detectedOutputs.value?.length ?? 0) > 0);

const {
  currentVersion,
  selectedVersion,
  selectedVersionNumber,
  currentVersionNumberForDisplay,
  versionOptions,
  showDiff,
  diffLeftVersion,
  diffRightVersion,
  diffLeftQuery,
  diffRightQuery,
  diffLeftLabel,
  diffRightLabel,
  applyCurrentVersionLocalState,
  adoptNewVersion,
  loadVersionsForQuery,
  toggleDiff,
  updateDiffLeftVersion,
  updateDiffRightVersion,
  swapDiffVersions,
  loadDiffVersions,
  loadedVersionQueryString,
} = useQueryVersions({
  apiClient,
  toast,
  queryId,
  queryCode,
  versionComment,
  queryType,
  queryConcurrency,
  emitVersionNumber: (version) => emit('update:versionNumber', version),
});

/*
 * One editor serves the whole section, so the query you switch to arrives as
 * new text in the instance the last one was written in — undo history and all,
 * until this re-creates it. See `useEditorDocumentKey`: the identity is the
 * query (or scratch record) and the version being viewed, since selecting
 * another version swaps the body just as thoroughly as selecting another
 * query does.
 */
const { documentKey: editorDocumentKey, noteUserEdit: noteQueryCodeEdit } = useEditorDocumentKey(
  () => [
    props.scratchId ?? '',
    currentQueryId.value ?? props.queryId ?? '',
    selectedVersion.value ?? '',
  ].join('|'),
  () => queryCode.value,
);

/** What the editor types into. Everything else that writes `queryCode` — a
 *  load, Format, discarding changes — is not a keystroke and must not stop the
 *  editor being re-created for a document that is still on its way. */
function applyEditedQueryCode(value: string) {
  noteQueryCodeEdit();
  queryCode.value = value;
}

// Dirty state tracking for unsaved query changes
const { isDirty, resetDirtyState } = useQueryDirtyState({
  queryCode,
  currentVersion,
  selectedVersion,
  loadedQueryString: loadedVersionQueryString,
});

const { executionResult, isExecuting, executeQuery: executeQueryOriginal } = useQueryExecution({
  apiClient,
  toast,
  queryId,
  selectedBackend,
  selectedMediaType,
  selectedVersion,
  currentVersion,
  activeResultsTab,
  queryType,
  noneBackendId: NONE_BACKEND,
  /*
   * What "Run with" is pointing at. A saved version executes by id; the
   * draft has no server copy, so its values go inline instead — which is the
   * whole point of being able to run a draft at all (design §1).
   */
  getSelectedArgumentSetId: () => argumentSetsComposable.executionArgumentSetId.value,
  getInlineArguments: () => argumentSetsComposable.inlineExecutionPayload(),
  /*
   * The ad-hoc run has no version to name — not the query's, so not the
   * argument set's either. What is on screen is what runs, arguments included.
   */
  getAdHocArguments: () => argumentSetsComposable.visibleValuesPayload(),
  isDirty,
  queryCode,
});

const executedAtFocus = computed<string | null>(() => {
  return executionResult.value?.executedAt ?? null;
});

// Panel sizing
const workAreaRef = ref<HTMLElement | null>(null);
const {
  panelWidthPercent: leftPanelWidth,
  startResize: startVerticalResize,
  isResizing,
  collapsed: rightPanelCollapsed,
  resetWidth: resetPanelWidth,
} = usePanelResize({
  containerRef: workAreaRef,
  storageKey: 'query',
  collapsible: true,
  initialWidthPercent: 60,
});

// Wrap executeQuery to expand the results panel when executing
const executeQuery = async () => {
  // Always expand the panel when executing (whether it was collapsed or not)
  rightPanelCollapsed.value = false;

  // Switch to the results tab to show query results
  activeResultsTab.value = 'results';

  // Execute the query
  return await executeQueryOriginal();
};

// Add execute keymap now that executeQuery is available
extensions.value = [...extensions.value, useExecuteKeymap(executeQuery)];

/*
 * The Code button no longer opens a dialog: the snippet lives in the
 * inspector's Code tab, built from the same execute payload the Run button
 * sends. The button selects that tab.
 */

// Computed states
const isCreating = computed(() => queryState.value === 'creating');
const isSaving = computed(() => queryState.value === 'saving');
const isActive = computed(() => queryState.value === 'active');
const isEditing = computed(() => queryState.value === 'editing');
const isNewQuery = computed(() => queryState.value === 'creating' || queryState.value === 'saving');

// Helper to get a concurrency token
const fetchLatestConcurrencyToken = async (id: string): Promise<string | null> => {
  try {
    const detail = await queriesStore.fetchQuery(id);
    return detail.ifMatch ?? queriesStore.concurrency[id] ?? null;
  } catch (error) {
    console.error('[QueryWorkArea] Failed to fetch latest concurrency token:', error);
    return queriesStore.concurrency[id] ?? null;
  }
};

const {
  // The Details tab's fields all save through `persistQueryFields` below, and
  // these are how it handles a 412: one answer to a concurrent write rather
  // than one per field.
  isConcurrencyError,
  refreshQueryConcurrency,
} = useQueryMetadata({
  queriesStore,
  queryConcurrency,
  selectedVersionNumber,
  currentVersionNumberForDisplay,
  versionOptions,
  applyCurrentVersionLocalState,
  hydrateFromQuery,
});

/*
 * The execution row's list — which backend Run goes to this time.
 *
 * No None here either: it was a choice that could only produce a failed run,
 * and the in-memory store is always there to run against instead.
 */
const backendOptions = computed(() => {
  const optionMap = new Map<string, string>();
  optionMap.set(EPHEMERAL_BACKEND_ID, EPHEMERAL_BACKEND_LABEL);
  for (const backend of availableBackends.value) {
    optionMap.set(backend.id, backend.name);
  }
  const ensureOption = (value: string) => {
    if (!value || value === NONE_BACKEND || optionMap.has(value)) {
      return;
    }
    optionMap.set(value, value);
  };
  ensureOption(defaultBackend.value);
  ensureOption(selectedBackend.value);
  return Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
});

/*
 * The Details tab's Default Backend dropdown.
 *
 * No None: a query that points at no backend cannot be run, and there is
 * always somewhere to run it — the in-memory Oxigraph needs no configuring and
 * is never unavailable, so it heads the list and is what a query falls back to
 * when it names nothing. Whatever the query currently points at stays in the
 * list even if it is no longer a known backend, so opening such a query shows
 * the id rather than silently reading as the first option.
 */
const detailsBackendOptions = computed(() => {
  const optionMap = new Map<string, string>();
  optionMap.set(EPHEMERAL_BACKEND_ID, EPHEMERAL_BACKEND_LABEL);
  for (const backend of availableBackends.value) {
    optionMap.set(backend.id, backend.name);
  }
  const current = defaultBackend.value;
  if (current && current !== NONE_BACKEND && !optionMap.has(current)) {
    optionMap.set(current, current);
  }
  return Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
});

const mediaTypeOptions = computed(() => getAllMediaTypeOptions());
// The run bar heads the formats by result shape and greys the ones this query
// type would not usually answer with — selectable still, just not suggested.
const mediaTypeChoiceGroups = computed(() => getMediaTypeChoiceGroups(queryType.value));
const argumentSetOptions = computed(() =>
  argumentSetsComposable.argumentSets.value.map(set => ({
    value: set.id,
    label: set.name || set.id,
  })),
);
const argumentSetLoading = computed(() => argumentSetsComposable.isLoading.value);

/* ------------------------------------------------------------------ *
 * The run sentence (design 3b)
 * ------------------------------------------------------------------ */

/**
 * The "with" clause.
 *
 * A query's inputs are its arguments, and there is exactly one term: either a
 * named set (saved or scratch) or whatever is typed into the Arguments
 * panel. Pressing it shows that panel — the values are a table, and a dropdown
 * is not somewhere you read one.
 */
const runInputs = computed<RunBarPick[]>(() => {
  const summary = argumentsSummary.value;
  return [{
    key: 'arguments',
    kind: 'arguments',
    value: summary,
    empty: !summary,
    icon: 'arguments',
    title: summary
      ? `Arguments: ${summary} — open the Arguments tab to change them`
      : 'No arguments — open the Arguments tab to choose a set or type values',
  }];
});

const argumentsSummary = computed(() => {
  const selection = argumentSetsComposable.selection.value;
  if (selection.kind !== 'none') {
    const label = argumentSetsComposable.stateLabel.value;
    const name = argumentSetsComposable.name.value || 'unnamed set';
    return label ? `${name} ${label}` : name;
  }
  const inputs = detectedInputs.value;
  const count = (inputs?.valuesInputs?.length ?? 0)
    + (inputs?.limitParameters?.length ?? 0)
    + (inputs?.offsetParameters?.length ?? 0);
  return count ? `${count} inline` : '';
});

function showArgumentsTab() {
  /*
   * The arguments live in the right-hand panel, which a popped-out editor is
   * covering. Asking for them is asking to see them, so the pop-out gets out
   * of the way rather than switching a tab nobody can look at. Where arguments
   * themselves should live when the editor is enlarged is a separate question,
   * still open.
   */
  editorExpansion.collapse();
  activeResultsTab.value = 'arguments';
  rightPanelCollapsed.value = false;
}

/* ------------------------------------------------------------------ *
 * What the recipe can be kept as
 * ------------------------------------------------------------------ */

/*
 * Saving is "the next version", and running is "what is in the editor" —
 * which for a saved query with unsaved edits is the draft, not vN. With
 * no edits there is no draft to run: the saved version is what executes,
 * and a "Run draft" label would name a thing that is not there.
 */
/*
 * What a prefix discovered in this editor is recorded against. A draft points
 * at its scratch record, which is still a query — the Prefix Manager says
 * "Query (draft)" and links there, rather than naming the scratch machinery.
 */
const prefixSource = computed(() =>
  prefixSourceToken('query', isScratch.value ? (props.scratchId ?? null) : (queryId.value || null)),
);

/*
 * A response's prefixes are the store's, not the query's: the same query
 * answered by two endpoints can come back with two different prefix maps.
 */
const resultsPrefixSource = computed(() =>
  prefixSourceToken('results', selectedBackend.value || null),
);

const runLabel = computed(() => (isScratch.value || !isDirty.value ? 'Run' : 'Run draft'));

const creatingFromRecipe = ref<CreateTarget | null>(null);

/**
 * Why a test or a benchmark cannot be made from what is on screen.
 *
 * Both freeze *this* recipe, so both need the parts of it to be nameable: a
 * saved query for a test to point at, a saved version for a benchmark's
 * subject spec, and a real endpoint for either to run against. The ephemeral
 * store is the interesting refusal — it is empty at the start of every run, so
 * a test asserted against it would assert against nothing. `subjectKinds.ts`
 * states the same rule from the server's side: a query test names a backend or
 * gives every case a data graph, and this screen has no data graph to give.
 */
const createDisabledReason = computed<Partial<Record<CreateTarget, string | null>>>(() => {
  const noBackend = toStoredBackend(selectedBackend.value) === null
    ? 'Choose a real backend first — an ephemeral store is empty at the start of every run, '
      + 'so there would be nothing to measure or to assert against.'
    : null;
  const unsaved = isScratch.value || !queryId.value
    ? 'Save this query first — a test and a benchmark both name a saved query.'
    : null;
  return {
    test: unsaved ?? noBackend,
    benchmark: unsaved
      ?? (!selectedVersion.value ? 'Save a version first — a benchmark names one.' : null)
      ?? noBackend,
  };
});

async function createFromRecipe(target: CreateTarget) {
  if (createDisabledReason.value[target] || creatingFromRecipe.value) return;
  creatingFromRecipe.value = target;
  try {
    if (target === 'test') await createTestFromRecipe();
    else await createBenchmarkFromRecipe();
  } catch (error: unknown) {
    console.error(`[QueryWorkArea] Failed to create a ${target}:`, error);
    toast.error(error instanceof Error ? error.message : `Failed to create a ${target}`);
  } finally {
    creatingFromRecipe.value = null;
  }
}

async function createTestFromRecipe() {
  const libraryId = queryLibraryId.value || activeLibraryId.value;
  if (!libraryId) {
    toast.error('Choose a library first.');
    return;
  }
  // No `tags`, and that is the request: a one-click test from a record page
  // has no form to ask on, so it takes the server's default — the query's own
  // tags, copied.
  const { data: created } = await apiClient.createTest({
    name: `${queryName.value.trim() || 'Query'} — recipe`,
    subject: queryId.value,
    subjectKind: 'query',
    group: null,
    isPartOf: [libraryId],
  } as never);
  await apiClient.createTestVersion(created.id, {
    expectationKind: 'smoke',
    subjectVersion: selectedVersion.value,
    backend: toStoredBackend(selectedBackend.value),
    cases: [{
      name: null,
      expected: null,
      expectedFormat: null,
      ordered: null,
      argumentSetVersion: argumentSetsComposable.executionArgumentSetId.value,
      dataGraphVersion: null,
      tupleSeeds: null,
    }],
  });
  toast.success('Created a test from this recipe — add an expectation when you know what it should return');
  emit('open-entity', { type: 'test', id: created.id });
}

/**
 * The argument reference a promoted benchmark should name.
 *
 * A **test** pins a version — it asserts a result, and a result is only an
 * assertion about the values that produced it. A **benchmark** names the set
 * and lets it float, because the plan screen's argument axis is built from set
 * IRIs and because argument sets are meant to become generators, which have no
 * version to pin. Reproducibility is carried by the run, which records what the
 * reference resolved to (issue #246).
 *
 * Null when the panel is on an unsaved draft: there is nothing on the server to
 * name, and pointing at the set would run values the user is not looking at.
 */
function promotedArgumentSetId(): string | null {
  if (!argumentSetsComposable.executionArgumentSetId.value) return null;
  return argumentSetsComposable.selectedSetId.value;
}

async function createBenchmarkFromRecipe() {
  const experiment = await benchmarksStore.createExperiment({
    name: `${queryName.value.trim() || 'Query'} — recipe`,
    description: null,
    status: 'Active',
  });
  await benchmarksStore.createVersion(experiment.id, {
    subjectSpecs: [{
      subject: selectedVersion.value!,
      backends: [toStoredBackend(selectedBackend.value)!],
      inputs: [promotedArgumentSetId() ?? NO_ARGUMENTS_IRI],
    }],
    ...emptySettings(),
  });
  toast.success('Created a benchmark from this recipe — press Run on it to collect timings');
  emit('open-entity', { type: 'benchmark', id: experiment.id });
}

/*
 * The metadata panel used to carry a persistent error banner for a failed
 * load. Its toast still fires, but a toast expires and the editor is left
 * showing an empty body that looks like an empty query rather than a failure,
 * so the overlay says so until something else is selected.
 */
const editorOverlayActive = computed(() => queryLoading.value || loadError.value !== null);
const editorOverlayMessage = computed(() => {
  if (queryLoading.value) {
    return 'Loading query data…';
  }
  if (loadError.value) {
    return loadError.value;
  }
  return '';
});

/*
 * The panel is unavailable when there is nothing to detect arguments from —
 * not merely because the query is unsaved.
 *
 * It used to close over any unsaved change, because a draft ran through
 * `POST /sparql`, which took a query string and nothing else: the values were
 * unusable, so showing them would have been a lie. That route now takes the
 * same argument payload `/execute` does, so an edited query runs with what is
 * on screen and the panel is telling the truth again.
 */
const argumentsOverlayActive = computed(() => {
  if (queryLoading.value) return true;
  if (validationState.value === 'error') return true;
  if (validationState.value === 'idle' && !queryCode.value.trim()) return true;
  return false;
});

const argumentsOverlayMessage = computed(() => {
  if (queryLoading.value) {
    return 'Loading query data…';
  }
  if (validationState.value === 'error') {
    return 'Query is invalid';
  }
  if (validationState.value === 'idle' && !queryCode.value.trim()) {
    return 'Enter a query to detect arguments';
  }
  return '';
});

const resultsOverlayActive = computed(() => queryLoading.value || isExecuting.value);
const resultsOverlayMessage = computed(() => {
  if (queryLoading.value) {
    return 'Loading query data…';
  }
  if (isExecuting.value) {
    return 'Executing query…';
  }
  return '';
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
    beginCreate(request);
    lastCreationToken.value = request.id;
    emit('creation-consumed');
  },
);

/* ------------------------------------------------------------------ *
 * Scratch mode.
 *
 * The editor is the same component; what changes is where the body lives.
 * A scratch query has no version endpoints behind it, so `currentVersion`
 * stays null and Run routes down the direct-execution path on its own —
 * running an unsaved body is not a special case here, it is the only case.
 * ------------------------------------------------------------------ */

const draftsStore = useCallableDrafts();
// Scratch inherits the selected library at save; no target picker in v1
// (the nav doc's open question, resolved that way in the plan).
const { activeLibraryId } = useActiveLibrary();

/*
 * Load, autosave, flush — the four hazards of an unsaved body, handled the
 * same way in every section that has one. This work area only says what a
 * scratch *query* is: its body is the SPARQL, and its signature is whatever
 * the validator last detected in it.
 */
const {
  isScratch,
  hydrating: hydratingScratch,
  savedAt: scratchSavedAt,
  flush: flushScratch,
} = useScratchRecord({
  scratchId: () => props.scratchId,
  missingMessage: 'That scratch query is not in this browser',
  track: [queryCode, queryName, queryDescription, defaultBackend],
  hydrate: (record) => {
    resetDraftState();
    creationContext.value = null;
    loadError.value = null;
    queryLoading.value = false;
    queryState.value = 'creating';
    queryName.value = record.name;
    queryDescription.value = record.description ?? '';
    queryCode.value = typeof record.body === 'string' ? record.body : (record.queryString ?? '');
    // Chosen in Details before save; without it the choice survives only
    // until the tab is reloaded, which is the kind of silent loss the scratch
    // record exists to prevent.
    defaultBackend.value = record.defaultBackend ?? EPHEMERAL_BACKEND_ID;
    selectedBackend.value = defaultBackend.value;
    // Nothing on the server to compare against, so nothing is ever "dirty".
    loadedVersionQueryString.value = queryCode.value;
  },
  collect: (record) => ({
    name: queryName.value || record.name,
    description: toNullable(queryDescription.value),
    defaultBackend: toStoredBackend(defaultBackend.value),
    body: queryCode.value,
    outputs: detectedOutputs.value ?? [],
    inputTuples: detectedInputs.value?.valuesInputs ?? [],
    limitParameters: detectedInputs.value?.limitParameters ?? [],
    offsetParameters: detectedInputs.value?.offsetParameters ?? [],
  }),
});

/* ------------------------------------------------------------------ *
 * Details autosave for a *saved* query.
 *
 * The Details tab renders Name, Description and Default Backend as editable
 * fields, and until the metadata panel was removed the same three were editable
 * through its Edit dialog — which was the only one of the two that actually
 * saved. Typing in the Details fields updated a local ref and nothing else, so
 * the change looked accepted and vanished on the next load. Now the panel is
 * gone, these fields are the only way to edit any of it, so they have to
 * persist.
 *
 * The body is not touched here: a query's SPARQL is versioned and goes through
 * save, while these are properties of the entity and are saved directly,
 * exactly as the Edit dialog saved them.
 * ------------------------------------------------------------------ */

let identitySaveHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Write a few entity fields, retrying once past a lost concurrency race.
 *
 * The update is a partial one: only the named fields are sent, so a replay
 * after a 412 cannot clobber a body edit or anything else the other writer
 * touched.
 */
/** True when the write landed, so a caller that changed local state first can
 *  put it back when it did not. */
async function persistQueryFields(payload: Record<string, unknown>, failureMessage: string): Promise<boolean> {
  const id = queryId.value;
  if (!id || isScratch.value) return false;

  const send = async (token: string | null) =>
    queriesStore.updateQuery(id, payload, token ?? undefined);

  try {
    await send(await fetchLatestConcurrencyToken(id));
    return true;
  } catch (error) {
    // A 412 here means something else wrote the entity between our read and
    // our write. Re-read the token and try once.
    if (isConcurrencyError(error)) {
      try {
        await send(await refreshQueryConcurrency(id));
        return true;
      } catch (retryError) {
        const message = retryError instanceof Error ? retryError.message : failureMessage;
        toast.error(message);
        return false;
      }
    }
    const message = error instanceof Error ? error.message : failureMessage;
    console.error(`[QueryWorkArea] ${failureMessage}:`, error);
    toast.error(message);
    return false;
  }
}

async function persistIdentity() {
  await persistQueryFields(
    { name: queryName.value, description: queryDescription.value || null },
    'Failed to save name',
  );
}

watch([queryName, queryDescription], () => {
  if (isScratch.value || hydratingScratch.value || queryLoading.value || isNewQuery.value) return;
  if (identitySaveHandle) clearTimeout(identitySaveHandle);
  identitySaveHandle = setTimeout(() => {
    identitySaveHandle = null;
    void persistIdentity();
  }, 600);
});

/**
 * The Details tab's Default Backend dropdown.
 *
 * One click is the whole edit — there is nothing to debounce the way typing a
 * name needs — so it saves immediately, and on its own: a query left on the
 * in-memory fallback stores nothing until someone actually picks something,
 * rather than having a rename quietly write a backend it never chose. While the
 * query is still scratch there is nothing to save to and the choice rides along
 * in the create call at save.
 *
 * The execution selector follows only when it was sitting on the old default,
 * which is where loading a query leaves it. Once it has been pointed somewhere
 * else deliberately, changing the default does not drag it back.
 */
function handleDetailsBackendChange(value: string) {
  const previous = defaultBackend.value;
  if (value === previous) return;
  defaultBackend.value = value;
  if (selectedBackend.value === previous) {
    selectedBackend.value = value;
  }
  if (isScratch.value || queryLoading.value || isNewQuery.value) return;
  void persistQueryFields({ defaultBackend: toStoredBackend(value) }, 'Failed to save default backend');
}

/**
 * Point the query at one of its versions — the Details tab's version list,
 * where the Edit-details dialog's Current Version dropdown used to be.
 *
 * "Current" is what a caller that names no version gets, so this is a
 * saved-entity decision and a single write. The editor is left showing
 * whatever it was showing: choosing what callers get is not a request to read
 * that version, and the row beside the button is there for when it is.
 */
async function setCurrentVersion(versionId: string) {
  if (!versionId || isScratch.value || versionId === currentVersion.value) return;

  const previousVersion = currentVersion.value;
  const previousNumber = currentVersionNumberForDisplay.value;
  const option = versionOptions.value.find((entry) => entry.value === versionId);
  const parsedNumber = option ? parseInt(option.label, 10) : Number.NaN;

  currentVersion.value = versionId;
  if (!Number.isNaN(parsedNumber)) {
    currentVersionNumberForDisplay.value = parsedNumber;
  }

  const saved = await persistQueryFields(
    { currentVersion: versionId },
    'Failed to set the current version',
  );
  if (!saved) {
    currentVersion.value = previousVersion;
    currentVersionNumberForDisplay.value = previousNumber;
    return;
  }
  toast.success(option ? `v${option.label} is now the current version` : 'Current version updated');
}

/*
 * The note on a version, written from the row that displays it.
 *
 * This is where a version comment is collected now: the save bar used to ask
 * for one before saving, which made every save two steps and put the input
 * nowhere near the button. Writing it here instead means Save is one click,
 * the note is typed against the version it describes, and a version saved
 * without one can be annotated later.
 *
 * Optimistic, with the previous value put back on failure: it is one short
 * string, and a note that vanishes on its own is worse than one that fails
 * loudly.
 */
async function annotateVersion({ value, comment }: { value: string; comment: string | null }) {
  if (!queryId.value || isScratch.value) return;
  const option = versionOptions.value.find((entry) => entry.value === value);
  if (!option) return;
  const versionNumber = parseInt(option.label, 10);
  if (Number.isNaN(versionNumber)) return;

  const previous = option.comment ?? null;
  const apply = (next: string | null) => {
    versionOptions.value = versionOptions.value.map((entry) => (
      entry.value === value ? { ...entry, comment: next } : entry
    ));
  };
  apply(comment);

  try {
    await queriesStore.annotateQueryVersion(queryId.value, versionNumber, comment);
  } catch (error) {
    apply(previous);
    console.error('[QueryWorkArea] Failed to save the version note', error);
    toast.error('Failed to save the note');
  }
}

/* ------------------------------------------------------------------ *
 * Drafts on saved queries.
 *
 * A versioned entity cannot be edited in place, so there is no "save": edits
 * accumulate in a browser-local draft and Save turns them into vN+1. The
 * dot in the sidebar, the pill here and the record in the store are one thing
 * seen three ways.
 * ------------------------------------------------------------------ */

/** The library the open query belongs to — where a save would land. */
const queryLibraryId = ref<string | null>(null);
const isSavingVersion = ref(false);
const locallySavedAt = ref<string | null>(null);
let draftSaveHandle: ReturnType<typeof setTimeout> | null = null;
// Set while a version is being loaded into the editor, so hydration is not
// mistaken for typing and does not manufacture a draft of an unchanged body.
const hydratingVersion = ref(false);

const openDraft = computed(() => {
  void draftsStore.allDrafts.value;
  return queryId.value ? draftsStore.draftFor(queryId.value) : null;
});

const editCount = computed(() => {
  if (isScratch.value) return 0;
  return openDraft.value?.edits ?? 0;
});

const canSave = computed(() => {
  if (!queryCode.value.trim()) return false;
  if (isScratch.value) return true;
  // Saving an unchanged body would mint a version identical to the last
  // one. Nothing to save is not an error, it is a disabled button.
  return editCount.value > 0;
});

function persistDraft() {
  const id = queryId.value;
  if (!id || isScratch.value) return;
  const existing = draftsStore.draftFor(id);
  draftsStore.save({
    id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
    libraryId: queryLibraryId.value ?? UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'draft',
    section: 'query',
    name: queryName.value,
    description: toNullable(queryDescription.value),
    queryString: queryCode.value,
    body: queryCode.value,
    resultKind: 'BINDINGS',
    inputTuples: detectedInputs.value?.valuesInputs ?? [],
    limitParameters: detectedInputs.value?.limitParameters ?? [],
    offsetParameters: detectedInputs.value?.offsetParameters ?? [],
    outputs: detectedOutputs.value ?? [],
    basedOn: id,
    edits: (existing?.edits ?? 0) + 1,
  });
  locallySavedAt.value = new Date().toISOString();
}

function removeDraft() {
  const id = queryId.value;
  if (!id) return;
  const existing = draftsStore.draftFor(id);
  if (existing) draftsStore.remove(existing.id);
  locallySavedAt.value = null;
}

watch(queryCode, () => {
  if (isScratch.value || hydratingVersion.value) return;
  // A query with no version yet is still a saved entity with a draft
  // against it: the first Save is v1, and the edits leading to it deserve
  // the same browser-local safety net as every later one.
  if (!queryId.value) return;
  if (draftSaveHandle) clearTimeout(draftSaveHandle);
  draftSaveHandle = setTimeout(() => {
    draftSaveHandle = null;
    // Typing back to what is saved is not an edit — it is an undo, and it
    // must leave no draft behind or the dot never clears.
    if (queryCode.value.trim() === (loadedVersionQueryString.value ?? '').trim()) {
      removeDraft();
      return;
    }
    persistDraft();
  }, 500);
});

function flushDraft() {
  if (!draftSaveHandle) return;
  clearTimeout(draftSaveHandle);
  draftSaveHandle = null;
  if (queryCode.value.trim() !== (loadedVersionQueryString.value ?? '').trim()) {
    persistDraft();
  }
}

/** Throw the unsaved edits away and go back to the saved version. */
function discardDraft() {
  if (draftSaveHandle) {
    clearTimeout(draftSaveHandle);
    draftSaveHandle = null;
  }
  removeDraft();
  hydratingVersion.value = true;
  queryCode.value = loadedVersionQueryString.value ?? '';
  void Promise.resolve().then(() => { hydratingVersion.value = false; });
  toast.success('Draft discarded');
}

/**
 * Show a saved version's body.
 *
 * Selecting a *different* version already loads it, but the common case is
 * one version and an open draft: "let me see v1 again" must work when v1 is
 * already the selected version, or the draft is a one-way door. Hydrating
 * rather than typing, so looking at the saved text does not count as
 * editing back to it and quietly discard the draft.
 */
function showVersionBody(versionId: string) {
  if (versionId !== selectedVersion.value) {
    selectedVersion.value = versionId;
    return;
  }
  hydratingVersion.value = true;
  queryCode.value = loadedVersionQueryString.value ?? '';
  void Promise.resolve().then(() => { hydratingVersion.value = false; });
}

/** Go back to the draft after looking at a saved version. */
function restoreDraftBody() {
  const draft = openDraft.value;
  if (!draft || typeof draft.body !== 'string') return;
  hydratingVersion.value = true;
  queryCode.value = draft.body;
  void Promise.resolve().then(() => { hydratingVersion.value = false; });
}

/*
 * The Details tab. One prop bag rather than a dozen props: it is a single view
 * of this component's state, and splitting it up here would only mean
 * reassembling it in the child.
 */
const detailsProps = computed(() => ({
  name: queryName.value,
  description: queryDescription.value,
  isScratch: isScratch.value,
  entityId: isScratch.value ? null : (queryId.value || null),
  taggableKind: 'query' as const,
  // A query saved before the field existed, or through a surface that could
  // still write None, reads as what it actually runs on.
  backendValue: defaultBackend.value === NONE_BACKEND ? EPHEMERAL_BACKEND_ID : defaultBackend.value,
  backendOptions: detailsBackendOptions.value,
  versionOptions: versionOptions.value.map((option) => ({
    value: option.value,
    label: option.label,
    comment: option.comment ?? null,
    dateModified: option.dateModified,
  })),
  selectedVersion: selectedVersion.value,
  currentVersion: currentVersion.value,
  // A scratch query has no server entity to point at anything.
  canSetCurrentVersion: !isScratch.value,
  canAnnotateVersions: !isScratch.value && !!queryId.value,
  editCount: editCount.value,
  draftSavedAt: locallySavedAt.value,
  // The editor is showing the draft whenever the body has diverged from the
  // version that was loaded — which is exactly when the draft row is the
  // one that should look selected.
  draftSelected: editCount.value > 0
    && queryCode.value.trim() !== (loadedVersionQueryString.value ?? '').trim(),
  detectedInputs: detectedInputs.value,
  detectedOutputs: detectedOutputs.value ?? [],
  // One version is not a comparison, and a scratch query has no saved
  // versions to compare at all.
  canCompareVersions: !isScratch.value && versionOptions.value.length > 1,
  createdAt: isScratch.value ? null : queryCreatedAt.value,
  // A scratch query lives in this browser: Discard in the save bar is what
  // removes it, and there is no server entity for Delete to address.
  canDelete: !isScratch.value && !!queryId.value,
  deleting: isDeleting.value,
}));

/** A scratch item still wearing its fallback name has to be named at save. */
const UNTITLED_PATTERN = /^Untitled query \d+$/;
const needsName = computed(() => isScratch.value && UNTITLED_PATTERN.test(queryName.value.trim()));

/**
 * Save a scratch query: create the entity in the current library, then give
 * it a body. Two requests, because that is what "a query with a first version"
 * is — the same two the Add Query dialog always made, minus the dialog.
 */
async function saveScratch(name: string) {
  const libraryId = activeLibraryId.value;
  if (!libraryId) {
    toast.error('Select a library before saving');
    return;
  }

  const scratchRecordId = props.scratchId!;
  flushScratch();

  let created;
  try {
    created = await queriesStore.createQuery({
      name,
      description: toNullable(queryDescription.value),
      defaultBackend: toStoredBackend(defaultBackend.value),
      isPartOf: [libraryId],
    });
  } catch (error) {
    // Say what happened. A Save click that produces nothing and explains
    // nothing is indistinguishable from a broken button.
    const message = error instanceof Error ? error.message : 'Failed to save';
    toast.error(`Could not save “${name}”: ${message}`);
    throw error;
  }

  /*
   * The entity exists but has no body yet. If this second call fails the
   * scratch record stays exactly where it is — the user's text is never the
   * thing that gets lost — and they are told the query was created empty,
   * because silently leaving a bodyless query in the library is worse than
   * saying so.
   */
  try {
    await apiClient.createQueryVersion(created.id, {
      queryVersion: {
        queryString: queryCode.value.trim(),
        comment: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save';
    toast.error(`Created “${name}” but could not save its first version: ${message}`);
    throw error;
  }

  draftsStore.remove(scratchRecordId);
  toast.success(`Saved “${name}” as v1`);
  emit('scratch-saved', { id: created.id, name, libraryId });
}

/**
 * Save pressed on a still-unnamed scratch query. The name lives in exactly
 * one field, so this opens that field rather than asking again somewhere else.
 */
function promptForNameInDetails() {
  activeResultsTab.value = 'details';
  rightPanelCollapsed.value = false;
  toast.info('Give it a name in the Details tab, then save');
  void nextTick(() => queryResultsPanelRef.value?.focusDetailsName?.());
}

/*
 * Save. It takes nothing: the bar collects no note and no name.
 */
async function save() {
  if (isSavingVersion.value || !canSave.value) return;
  isSavingVersion.value = true;
  try {
    if (isScratch.value) {
      await saveScratch(queryName.value.trim() || 'Untitled query');
      return;
    }
    /*
     * A new version starts with no note. `versionComment` mirrors the note on
     * the version that is *loaded*, so carrying it over would caption the new
     * version with something written about a different one; the note is
     * written on its own row in Details once it exists.
     */
    versionComment.value = '';
    flushDraft();
    const savedVersion = await saveNewVersion();
    // Only once the version has landed: a failed save must leave the draft
    // exactly where it was, or the edits are gone with nothing to show for it.
    if (savedVersion) removeDraft();
  } catch (error) {
    // saveScratch has already said what went wrong; anything else would be
    // a second toast for one failure.
    console.error('[QueryWorkArea] Save failed', error);
  } finally {
    isSavingVersion.value = false;
  }
}

watch(
  () => [props.queryId, props.versionNumber] as const,
  ([id, version]) => {
    // Scratch owns the editor while it is selected; the saved loader must
    // not reset the body out from under it.
    if (isScratch.value) return;
    if (!id) {
      if (!props.creationRequest) {
        resetDraftState();
        creationContext.value = null;
        queryState.value = 'creating';
      }
      return;
    }
    if (id === currentQueryId.value && version === selectedVersionNumber.value) {
      return;
    }
    loadQuery(id, version);
  },
  { immediate: true },
);


function resetDraftState() {
  queryName.value = '';
  queryDescription.value = '';
  versionComment.value = '';
  queryId.value = '';
  queryCreatedAt.value = null;
  currentQueryId.value = null;
  queryConcurrency.value = null;
  defaultBackend.value = EPHEMERAL_BACKEND_ID;
  selectedBackend.value = EPHEMERAL_BACKEND_ID;
  currentVersion.value = null;
  selectedVersion.value = null;
  currentVersionNumberForDisplay.value = null;
  versionOptions.value = [];
  queryCode.value = '';
}

function beginCreate(request: QueryCreationRequest) {
  creationContext.value = {
    libraryId: request.libraryId,
    libraryName: request.libraryName,
  };
  resetDraftState();
  loadError.value = null;
  queryLoading.value = false;
  queryState.value = 'creating';
  showEditorFocus.value = false;
  showResultsFocus.value = false;
  showArgumentsFocus.value = false;
  toast.info(`Drafting new query for ${request.libraryName}`);
}

function hydrateFromQuery(query: ApiQuery, options: { ifMatch?: string | null } = {}) {
  queryId.value = query.id;
  currentQueryId.value = query.id;
  queryCreatedAt.value = query.dateCreated ?? null;
  queryName.value = query.name;
  queryDescription.value = query.description ?? '';
  // The comment lives on the version, not the query; it is set for real once
  // the version content loads (useQueryVersions#loadVersionContent).
  versionComment.value = '';
  // A query that names no backend runs against the in-memory store rather than
  // against nothing; see `detailsBackendOptions`.
  defaultBackend.value = query.defaultBackend ?? EPHEMERAL_BACKEND_ID;
  selectedBackend.value = defaultBackend.value;
  applyCurrentVersionLocalState(query.currentVersion ?? null);
  // versionOptions will be populated when we load the full version list
  versionOptions.value = [];
  queryConcurrency.value = options.ifMatch ?? queriesStore.concurrency[query.id] ?? null;
  queryLibraryId.value = Array.isArray(query.isPartOf) ? (query.isPartOf[0] ?? null) : null;
}

async function loadQuery(id: string, versionOverride?: number | null) {
  if (!id) {
    return;
  }
  queryLoading.value = true;
  hydratingVersion.value = true;
  loadError.value = null;
  try {
    const detail = await queriesStore.fetchQuery(id);
    creationContext.value = null;
    hydrateFromQuery(detail.query, { ifMatch: detail.ifMatch ?? null });

    if (detail.query.currentVersion) {
      try {
        const { targetVersion } = await loadVersionsForQuery(id, detail.query.currentVersion, {
          versionOverride,
          onInvalidOverride: () => emit('update:versionNumber', null),
        });

        if (!targetVersion) {
          console.error('[QueryWorkArea] Current version not found in versions list');
          toast.error('Current version not found');
          queryCode.value = '';
          versionComment.value = '';
        }
      } catch (versionError) {
        console.error('[QueryWorkArea] Failed to load query versions:', versionError);
        toast.error('Failed to load query versions');
      }
    } else {
      queryCode.value = '';
      versionComment.value = '';
    }

    queryState.value = 'active';

    /*
     * A draft outranks the saved version in the editor. It is what you
     * were last writing, and the whole reason it is kept in the browser is so
     * that coming back to the query means coming back to your work — the pill
     * and the sidebar dot say which of the two you are looking at.
     */
    const draft = draftsStore.draftFor(id);
    if (draft && typeof draft.body === 'string' && draft.body.trim().length > 0) {
      queryCode.value = draft.body;
      locallySavedAt.value = draft.updatedAt;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load query';
    console.error('[QueryWorkArea] Failed to load query:', {
      queryId: id,
      error: error,
      errorMessage: message,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorStack: error instanceof Error ? error.stack : undefined
    });
    loadError.value = message;
    toast.error(message);
    resetDraftState();
    queryState.value = 'creating';
    emit('query-load-failed');
  } finally {
    queryLoading.value = false;
    // One tick later, so the editor's own update from the hydration above has
    // already flushed and cannot be read back as a keystroke.
    void Promise.resolve().then(() => { hydratingVersion.value = false; });
  }
}

function toNullable(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadBackends() {
  await backendsStore.loadBackends();
}

// Functions

/*
 * There is no entity-level save any more, and no PATCH of a version from this
 * screen. A version is immutable: editing one in place contradicted the model
 * every other part of the app was already following. Edits accumulate in a
 * browser-local draft and Save turns them into the next version.
 */
/** Returns whether the version actually landed — Save needs to know. */
const saveNewVersion = async (): Promise<boolean> => {
  if (!queryId.value) {
    console.error('Cannot save: No query ID');
    toast.error('Cannot save: query not created yet');
    return false;
  }

  if (!queryCode.value.trim()) {
    console.error('Query code is required');
    toast.error('Query code is required');
    return false;
  }

  try {
    queryState.value = 'saving';

    const result = await apiClient.createQueryVersion(queryId.value, {
      queryVersion: {
        queryString: queryCode.value.trim(),
        comment: versionComment.value.trim() || null,
      }
    });

    const newVersion = result.data.queryVersion;
    const newVersionNumber = newVersion.version;
    // Local refs, the options list and the route, in one call — they used to
    // be set here and the route left out, which is design §7.1.
    adoptNewVersion(newVersion);

    queryConcurrency.value = result.etag;

    toast.success(`New version ${newVersionNumber} created successfully`);

    // Reset dirty state after successful save
    loadedVersionQueryString.value = queryCode.value.trim();
    resetDirtyState();

    queryState.value = 'active';
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create new version';
    console.error('Failed to create new version:', error);
    toast.error(message);
    queryState.value = 'active';
    return false;
  }
};

const handleFocusRequest = (tab: 'arguments' | 'results') => {
  if (tab === 'arguments') {
    showArgumentsFocus.value = true;
  } else {
    showResultsFocus.value = true;
  }
};

const formatQueryCode = async () => {
  if (!queryCode.value || queryCode.value.trim().length === 0) {
    toast.error('No code to format');
    return;
  }

  try {
    const result = await apiClient.formatCode(queryCode.value);
    queryCode.value = result.formatted;
    toast.success('Query formatted successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to format code';
    toast.error(`Format failed: ${message}`);
    console.error('[QueryWorkArea] Format failed:', error);
  }
};

/*
 * The query's own commands, registered for as long as this work area is
 * mounted — which is what makes "Save the query" exist while a query is open
 * and not exist while it is not, without a predicate that has to guess.
 *
 * Ctrl+Enter is bound twice on purpose: CodeMirror owns it while the cursor is
 * in the editor (`useExecuteKeymap`, which has to outrank the default keymap),
 * and this binding covers the rest of the screen. Both call `executeQuery`, so
 * there is still one implementation.
 */
useCommand([
  {
    id: 'query.run',
    title: 'Run the query',
    group: 'Run',
    keys: 'Mod+Enter',
    keywords: 'execute',
    when: () => !isExecuting.value,
    run: executeQuery,
  },
  {
    id: 'query.save',
    title: 'Save the query',
    group: 'Query',
    keys: 'Mod+s',
    keywords: 'version commit',
    when: () => canSave.value && !isSavingVersion.value,
    // An unnamed scratch cannot be saved silently; the bar's own Save asks for
    // a name the same way, so the shortcut lands in the same dialog.
    run: () => (needsName.value ? promptForNameInDetails() : save()),
  },
  {
    id: 'query.format',
    title: 'Format the query',
    group: 'Query',
    keys: 'Mod+Shift+f',
    keywords: 'pretty print indent',
    when: () => queryCode.value.trim().length > 0,
    run: formatQueryCode,
  },
]);

const copyQueryId = async () => {
  if (!queryId.value) {
    console.error('[QueryWorkArea] Cannot copy: queryId is empty');
    toast.error('Cannot copy: Query ID is empty');
    return;
  }

  try {
    await navigator.clipboard.writeText(queryId.value);
    toast.success('Query ID Copied');
  } catch (err) {
    console.error('[QueryWorkArea] Failed to copy query ID:', err);
    toast.error(`Failed to copy Query ID: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
};

const copyQueryVersionId = async () => {
  if (!selectedVersion.value) {
    toast.error('No version ID available');
    return;
  }

  try {
    await navigator.clipboard.writeText(selectedVersion.value);
    toast.success('Query Version ID Copied');
  } catch (err) {
    console.error('[QueryWorkArea] Failed to copy query version ID:', err);
    toast.error(`Failed to copy Query Version ID: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
};

const handleDiffToggle = async () => {
  if (versionOptions.value.length <= 1) {
    return;
  }

  if (!showEditorFocus.value) {
    if (!showDiff.value) {
      await toggleDiff();
    } else {
      await loadDiffVersions();
    }
    showEditorFocus.value = true;
    return;
  }

  await toggleDiff();
};

/*
 * Diff a version against current, from its row on the Details tab.
 *
 * No picker: the comparison a version list is asking about is "what changed
 * between this and what callers get", so the row names the left-hand side and
 * `current` is always the right. It opens in the focus overlay because that is
 * where the diff view lives.
 */
const compareVersionWithCurrent = async (versionId: string) => {
  if (!currentVersion.value || versionId === currentVersion.value) return;

  diffLeftVersion.value = versionId;
  diffRightVersion.value = currentVersion.value;
  showDiff.value = true;
  await loadDiffVersions();
  showEditorFocus.value = true;
};

const openEditorFocus = () => {
  showDiff.value = false;
  showEditorFocus.value = true;
};

/*
 * Delete was a console.log behind a dropdown nobody could reach twice. It has
 * to work now: removing the metadata panel took away the only other route to
 * it, and a query you cannot delete is a query you cannot undo creating.
 *
 * Confirmed rather than immediate, because unlike everything else on this
 * screen it is not held in the browser first — it goes straight to the server
 * and takes every version with it.
 */
const deleteConfirmOpen = ref(false);
const isDeleting = ref(false);

const requestDeleteQuery = () => {
  if (!queryId.value || isScratch.value) return;
  deleteConfirmOpen.value = true;
};

const confirmDeleteQuery = async () => {
  const id = queryId.value;
  if (!id) return;
  isDeleting.value = true;
  try {
    await queriesStore.deleteQuery(id);
    // Any browser draft for it is now orphaned; leaving it would put a draft
    // dot beside a query that no longer exists.
    removeDraft();
    deleteConfirmOpen.value = false;
    toast.success('Query deleted');
    emit('query-deleted', id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete query';
    console.error('[QueryWorkArea] Failed to delete query:', error);
    toast.error(message);
  } finally {
    isDeleting.value = false;
  }
};

// Watch queryType for changes and auto-select appropriate media type
watch(queryType, (newQueryType) => {
  if (!newQueryType) {
    return;
  }

  // Auto-select N-Triples for graph queries (CONSTRUCT/DESCRIBE)
  if (isGraphQueryType(newQueryType)) {
    selectedMediaType.value = OUTPUT_MEDIA_TYPES.N_TRIPLES;
  }
  // Auto-select CSV for tabular queries (SELECT/ASK)
  else if (isResultSetQueryType(newQueryType)) {
    selectedMediaType.value = OUTPUT_MEDIA_TYPES.CSV;
  }
  // An update has exactly one output: the patch it would make (#290). Running
  // it as a patch derives rather than writes, which is the safer of the two to
  // land on by default and the only one with something to show afterwards.
  else if (isUpdateQueryType(newQueryType)) {
    selectedMediaType.value = OUTPUT_MEDIA_TYPES.RDF_PATCH;
  }
});


// Focus mode state
const showEditorFocus = ref(false);
const showResultsFocus = ref(false);
const showArgumentsFocus = ref(false);

// Event listeners
onMounted(() => {
  loadBackends();

  /*
   * The set has to be loaded before it can be selected, and it may be one made
   * elsewhere in the library — which is exactly what that listing now offers.
   */
  void (async () => {
    const setId = props.preselectArgumentSetId;
    if (!setId) return;
    await argumentSetsComposable.loadArgumentSets();
    await argumentSetsComposable.selectSet(setId);
    showArgumentsTab();
  })();
});

onUnmounted(() => {
  flushScratch();
  flushDraft();
});
</script>

<style scoped>
.query-work-area {
  display: flex;
  height: 100%;
  min-height: 100%;
  background: var(--surface-raised);
  position: relative;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

/* Left Panel */
.left-panel {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  overflow-x: hidden;
  overflow-y: hidden;
  min-height: 0;
  position: relative;
  transition: width 0.3s ease;
  flex-shrink: 0;
  will-change: width;
}

/* Disable transition while actively resizing for immediate feedback */
.left-panel.resizing {
  transition: none;
}

/* Right Panel */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  overflow: hidden;
  min-width: 48px;
  transition: flex 0.3s ease, min-width 0.3s ease;
}

.right-panel.collapsed {
  flex: 0 0 48px;
  max-width: 48px;
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

.vertical-resizer.hidden {
  opacity: 0;
  width: 0;
  pointer-events: none;
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

/* Editor Section */
.editor-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Argument Groups (Limit, Offset, InputTuple) */
.argument-group {
  margin-bottom: var(--space-6);
  padding: var(--space-5);
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
}

.argument-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--space-4);
}

.argument-group-type {
  font-size: var(--text-label);
  color: var(--ink-muted);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  background: var(--surface-raised);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
}

.btn-add-tuple-row {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-label);
  font-weight: 500;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-add-tuple-row:hover {
  background: var(--action);
  color: var(--action-fg);
  border-color: var(--action);
}

/* Tuple Variables Header */
.tuple-variables-header {
  display: flex;
  gap: 8px;
  margin-bottom: var(--space-3);
  padding: 0 var(--space-4);
}

.tuple-var-label {
  flex: 1;
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--ink-muted);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.var-nodekind-badge {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  color: var(--action);
  background: var(--action-surface);
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

.var-nodekind-badge.var-literal {
  color: var(--violet-500);
  background: var(--violet-50);
}

.var-datatype-badge {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
  background: var(--surface-raised);
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

/* Tuple Rows */
.argument-tuple-row {
  display: flex;
  gap: 8px;
  margin-bottom: var(--space-3);
}

.argument-tuple-row:last-child {
  margin-bottom: 0;
}

.argument-input {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-body);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  transition: border-color 0.2s;
}

.argument-input:focus {
  outline: none;
  border-color: var(--action);
  box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.1);
}

.argument-input::placeholder {
  color: var(--ink-muted);
}

.btn-tuple-action {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-tuple-action:hover {
  background: var(--danger);
  color: var(--danger-fg);
  border-color: var(--danger);
}

/*
 * A row, not the primitive's panel: a glyph and a sentence on one line, and the
 * focus overlay restyles both below. Named for the pane it stands in so the
 * primitive's own class means the primitive.
 */
.arguments-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: var(--space-7);
  color: var(--ink-muted);
  font-size: var(--text-body-lg);
}

.arguments-empty-icon {
  opacity: 0.5;
}

/* Focus Mode Overlay */
.focus-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* No backdrop-filter: blurring the full viewport halves the frame rate of
     the open animation. See tests/e2e/perf/ablation.spec.ts. */
  background: rgba(0, 0, 0, 0.72);
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5vh 5vw;
  animation: fadeIn 0.12s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.focus-container {
  width: 100%;
  height: 100%;
  background: var(--surface);
  border-radius: var(--radius-xl);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.15s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.focus-content {
  flex: 1;
  overflow: auto;
  background: var(--surface);
}

.focus-content-editor :deep(.cm-editor) {
  height: 100%;
  font-size: var(--text-code);
}

.focus-content-editor :deep(.cm-scroller) {
  overflow: auto;
}

.focus-content-editor :deep(.cm-content) {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  padding: var(--space-6);
}

/* Focus mode scrollbar */
.focus-content::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

.focus-content::-webkit-scrollbar-track {
  background: var(--surface-subtle);
}

.focus-content::-webkit-scrollbar-thumb {
  background: var(--surface-raised);
  border-radius: var(--radius-panel);
  border: 3px solid var(--border-subtle);
}

.focus-content::-webkit-scrollbar-thumb:hover {
  background: var(--gray-500);
}

/* Arguments Content in Focus Mode */
.arguments-content-focus {
  padding: var(--space-7);
  overflow-y: auto;
  height: 100%;
}

.arguments-content-focus .argument-group {
  margin-bottom: var(--space-6);
  padding: var(--space-6);
}

.arguments-content-focus .argument-group-header {
  margin-bottom: var(--space-5);
}

.arguments-content-focus .argument-group-label {
  font-size: var(--text-body-lg);
}

.arguments-content-focus .argument-group-type {
  font-size: var(--text-body);
}

.arguments-content-focus .tuple-var-label {
  font-size: var(--text-body);
}

.arguments-content-focus .argument-input {
  font-size: var(--text-body-lg);
  padding: var(--space-4) var(--space-5);
}

.arguments-content-focus .btn-tuple-action {
  width: 32px;
  height: 32px;
}

.arguments-content-focus .btn-add-tuple-row {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-body);
}

.arguments-content-focus .arguments-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: var(--space-9);
  color: var(--ink-muted);
  font-size: var(--text-body);
}

/* Dropdown menu item icons */
:deep(.lucide-icon) {
  flex-shrink: 0;
}

.delete-action {
  background: var(--danger);
  color: var(--danger-fg);
}

.delete-action:hover {
  background: var(--danger-hover);
}
</style>
