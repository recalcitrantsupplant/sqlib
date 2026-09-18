<template>
  <div class="ruleset-work-area" ref="workAreaRef">
    <div
      class="left-panel"
      :class="{ resizing: isResizingVertical }"
      :style="{ width: rightPanelCollapsed ? 'calc(100% - 48px)' : leftPanelWidth + '%' }"
    >
      <!--
        The same shell as the query work area: a save bar over the body, a
        status strip under it, and everything derived from the body in tabs on
        the right. A rule set is one SRL document, so it gets the editor a
        document deserves rather than a stack of per-rule cards.
      -->
      <!--
        No ⋮ here. Everything it held is reachable without it: Code is a tab and
        was only ever a shortcut to one, Details is the sole editor of the name
        and description, and Delete now sits in Details next to the versions it
        destroys — where a query keeps it. Preview changes is the diff button,
        which is what it always was: this draft against the saved version.
      -->
      <SaveBar
        :title="ruleSetName"
        noun="rule set"
        :is-scratch="isScratch"
        :current-version-number="currentVersionNumberForDisplay"
        :edit-count="editCount"
        :saving="isSaving"
        :can-save="canSave"
        :needs-name="needsName"
        :show-format="false"
        :show-more="false"
        show-import
        import-title="Append a rule built from a CONSTRUCT query"
        @save="save"
        @needs-name="promptForNameInDetails"
        @discard="discardDraft"
        @toggle-diff="openPreview"
        @import="openImportDialog"
      />

      <!--
        The run, as one sentence (design 3b). Inputs, not definition: the
        pickers and the Inputs tab are two views of one selection, and the
        document below is SRL and nothing else. A rule set has no backend to
        choose — it runs in an in-process store by construction — so "against"
        states that rather than offering a dropdown with one entry in it.
      -->
      <ExpandRunStrip>
        <RunBar
          :running="isExecuting"
          :run-disabled="!hasDocument"
          :run-title="hasDocument ? 'Run this rule set' : 'Write a rule set first'"
          :inputs="runInputs"
          :backend="RULES_STORE"
          :format="{ value: inferenceFormat, options: INFERENCE_FORMATS, title: 'The format the inferred graph comes back in' }"
          :create-targets="['benchmark', 'test']"
          :create-disabled-reason="{ test: testDisabledReason, benchmark: benchmarkDisabledReason }"
          :creating="savingTest ? 'test' : savingBenchmark ? 'benchmark' : null"
          recipe-noun="inputs"
          :help="RUN_HELP"
          @run="() => run()"
          @pick="() => focusTab('inputs')"
          @update:format="(value) => (inferenceFormat = value)"
          @create="createFromRecipe"
        />
      </ExpandRunStrip>

      <!--
        Same pop-out as the query editor, and for the same reason: a rule set
        is read top to bottom, and a stratified one is longer than the column
        it is written in. The run strip comes along, so a rule set can still
        be run from inside it.
      -->
      <ExpandableEditor
        v-slot="{ expanded: editorExpanded, toggle: expandEditor }"
        title="Rule Set Editor"
        testid="rule-set-editor-expand"
      >
        <SparqlEditorPanel
          editor-title="Rule Set Editor"
          expandable
          :expanded="editorExpanded"
          placeholder="PREFIX : <http://example/>&#10;&#10;DATA { :a :parent :b }&#10;&#10;RULE { ?s :q ?o } WHERE { ?s :p ?o }"
          chrome="minimal"
          content-type="application/srl"
          validation-label="rule set"
          :sparql-code="srlDocument"
          :selected-version="selectedVersionId"
          :version-options="[]"
          :is-new-entity="false"
          :is-saving="false"
          :is-loading="ruleSetLoading"
          :editor-overlay-active="ruleSetLoading"
          editor-overlay-message="Loading rule set…"
          :extensions="extensions"
          :show-query-outputs="false"
          :prefix-source="prefixSource"
          :document-key="editorDocumentKey"
          @update:sparql-code="applyEditedDocument"
          @editor-ready="handleEditorReady"
          @request-expand="expandEditor"
        >
          <template #footer>
            <RuleSetEditorFooter
              :validation-state="validationState"
              :parse-error="parseError"
              :rule-count="analysis?.ruleCount ?? 0"
              :data-block-count="analysis?.dataBlockCount ?? 0"
              :strata-count="stratification?.strataCount ?? 0"
              :stratified="stratification?.stratified ?? true"
              @focus-stratification="focusTab('stratification')"
            />
          </template>
        </SparqlEditorPanel>
      </ExpandableEditor>
    </div>

    <div
      class="vertical-resizer"
      :class="{ hidden: rightPanelCollapsed }"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the inspector panel"
      title="Drag to resize · double-click to reset"
      @mousedown="startVerticalResize"
      @dblclick="resetPanelWidth"
    >
      <div class="resizer-handle"></div>
    </div>

    <div class="right-panel" :class="{ collapsed: rightPanelCollapsed }">
      <RuleSetInspectorPanel
        ref="inspectorRef"
        v-model:active-tab="activeTab"
        v-model:collapsed="rightPanelCollapsed"
        v-model:selected-rule-id="selectedRuleId"
        v-model:tuple-source="tupleSource"
        v-model:tuple-set-version-id="tupleSetVersionId"
        v-model:inline-tuples="tupleSeeds"
        v-model:data-source="dataSource"
        v-model:data-graph-version-id="dataGraphVersionId"
        v-model:data-graph-inline="dataGraphInline"
        v-model:data-graph-inline-format="dataGraphInlineFormat"
        :details="detailsProps"
        :blocks="blocks"
        :stratification="stratification"
        :analyzing="analyzing"
        :document="srlDocument"
        :document-valid="validationState !== 'error'"
        :tuples-enabled="tuplesEnabled"
        :graph-nodes="graphNodes"
        :graph-edges="graphEdges"
        :analysed-at="analysedAt"
        :tuple-set-options="tupleSetOptions"
        :tuple-declarations="tupleDeclarations"
        :data-graph-options="dataGraphOptions"
        :saved-tuple-preview="savedTuplePreview"
        :saved-data-preview="savedDataPreview"
        :saving-tuples="savingTupleSet"
        :saving-data="savingDataGraph"
        :saving-test="savingTest"
        :test-disabled-reason="testDisabledReason"
        :execution-result="executionResult"
        :executed-at="executionTimestamp"
        :editor-extensions="readOnlyExtensions"
        :input-editor-extensions="inputExtensions"
        :tuple-editor-extensions="tupleExtensions"
        :rule-set-id="isScratch ? null : ruleSetIdValue"
        :code-request="codeRequest"
        :code-draft-note="codeDraftNote"
        :code-unavailable="codeUnavailable"
        :can-delete="!isScratch && !!ruleSetIdValue"
        :deleting="isDeleting"
        @update:details-name="(value) => (ruleSetName = value)"
        @update:details-description="(value) => (ruleSetDescription = value)"
        @delete="deleteRuleSet"
        @update:tuples-enabled="setTuplesEnabled"
        @select-version="showVersionBody"
        @annotate-version="annotateVersion"
        @select-draft="restoreDraftBody"
        @copy-id="copyRuleSetId"
        @go-to-line="goToLine"
        @open-test="(testId) => emit('open-test', testId)"
        @save-to-tuples="saveInlineTupleSet"
        @save-to-data="saveInlineDataGraph"
        @save-as-test="saveAsTest"
        @open-tuple-set="(id) => emit('open-entity', { type: 'tupleSet', id })"
        @open-data-graph="(id) => emit('open-entity', { type: 'dataGraph', id })"
        @open-in-query="(sparql) => emit('open-in-query', sparql)"
      />
    </div>

    <SrlPreviewDialog
      v-model:open="showPreviewDialog"
      :result="previewResult"
      :loading="previewLoading"
      :error="previewError"
    />

    <ImportSparqlDialog
      v-model:open="showImportDialog"
      :library-id="ruleSetLibraryId || activeLibraryId"
      :target-prologue="prologueLines().join('\n')"
      @append="appendImportedRule"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { toast } from 'vue-sonner';
import { languageExtensionsFor } from '../lib/codeLanguage';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import SaveBar from './shared/SaveBar.vue';
import ImportSparqlDialog from './rules/ImportSparqlDialog.vue';
import SparqlEditorPanel from './shared/SparqlEditorPanel.vue';
import { prefixSourceToken } from '@/lib/prefixSources';
import ExpandableEditor from './shared/ExpandableEditor.vue';
import ExpandRunStrip from './shared/ExpandRunStrip.vue';
import { useEditorExpand } from '../composables/useEditorExpand';
import RuleSetEditorFooter from './rules/RuleSetEditorFooter.vue';
import RuleSetInspectorPanel from './rules/RuleSetInspectorPanel.vue';
import RunBar from './shared/RunBar.vue';
import type { CreateTarget, RunBarChoice, RunBarPick } from '../lib/runBar';
import { NO_ARGUMENTS_IRI, emptySettings } from '../lib/benchmarkPlan';
import type { InputSource } from './rules/RuleSetInputsPanel.vue';
import type { StratificationPanelNode } from './rules/StratificationPanel.vue';
import SrlPreviewDialog from './rules/SrlPreviewDialog.vue';
import type { DataGraphFormat, DataGraphOption, TupleSetOption } from '@/types/data-graphs';
import { useRuleSetsStore } from '../composables/useRuleSetsStore';
import { useBenchmarksStore } from '../composables/useBenchmarksStore';
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { useApiClient, type RuleSetSrlPreview, type RuleSetVersion } from '../composables/useApiClient';
import { useRuntimeConfig } from '#imports';
import type { SnippetRequest } from '@/lib/codeSnippets';
import { usePanelResize } from '../composables/usePanelResize';
import { usePrefixManager } from '../composables/usePrefixManager';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { useScratchRecord } from '../composables/useScratchRecord';
import { loadLastRun, runCacheKey, saveLastRun } from '@/lib/lastRunCache';
import { useEditorDocumentKey } from '../composables/useEditorDocumentKey';
import { useSrlAnalysis } from '../composables/useSrlAnalysis';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from '../composables/useCallableDrafts';
import { useCommentKeymap } from '../composables/useCommentKeymap';
import { useEditorKeymaps } from '../composables/useEditorKeymaps';
import { useExecuteKeymap } from '../composables/useExecuteKeymap';
import { setStratumBands, stratumGutter, type StratumBand } from '../lib/srlStratumGutter';
import {
  TupleRowError,
  bindingsToTupleRows,
  readProloguePrefixes,
  tupleRowsToTable,
} from '../lib/srlTupleRows';
import { parseTupleDeclarations } from '../lib/tupleSetLabels';
import { rdfSyntaxHighlighting } from '../lib/codemirrorHighlight';
import type { Library, RuleSetUpdateInput } from '@sparql-query-lib/contracts';

/*
 * One rules screen. A draft is not a different place, it is this screen with
 * nothing saved yet — the same arrangement Queries, Groups, Benchmarks and ETL
 * already use (nav doc §1). `scratchId` is set for a draft and `ruleSetId` for
 * a saved rule set; never both.
 */
const props = defineProps<{
  ruleSetId: string | null;
  /** The scratch record being edited, or null when showing a saved rule set. */
  scratchId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'ruleset-deleted'): void;
  (e: 'ruleset-load-failed'): void;
  (e: 'scratch-saved', payload: { id: string; name: string; libraryId: string }): void;
  /** A test in the Tests tab was opened; the page routes to the Tests section. */
  (e: 'open-test', testId: string): void;
  /**
   * "Open in Tuples" / "Open in Data". The inputs are their own entities in
   * their own rail sections, so pointing at one is navigation, not a dialog.
   */
  (e: 'open-entity', payload: { type: 'tupleSet' | 'dataGraph'; id: string }): void;
  /** A benchmark made from the run sentence; the page routes to Benchmarks. */
  (e: 'open-benchmark', benchmarkId: string): void;
  /** A compiled program, as an unsaved query — the SPARQL tab's last button. */
  (e: 'open-in-query', sparql: string): void;
}>();

const ruleSetsStore = useRuleSetsStore();
const benchmarksStore = useBenchmarksStore();
const librariesStore = useLibrariesStore();
const apiClient = useApiClient();
const config = useRuntimeConfig();
const draftsStore = useCallableDrafts();
const { activeLibraryId, activeLibraryName } = useActiveLibrary();
const { autoDiscoverFromRule } = usePrefixManager();

const INFERENCE_FORMATS = [
  { value: 'application/n-triples', label: 'N-Triples' },
  { value: 'text/turtle', label: 'Turtle' },
  { value: 'application/rdf+xml', label: 'RDF/XML' },
  { value: 'application/ld+json', label: 'JSON-LD' },
];

/*
 * "against", for a subject that does not get to choose. Rules are evaluated in
 * an in-process Oxigraph store seeded with the selected data graph; there is no
 * remote endpoint in the picture, so the sentence says so as a fact. A select
 * with one option in it would read as a decision someone made for you.
 */
const RULES_STORE: RunBarChoice = {
  value: 'ephemeral',
  options: [],
  readonly: true,
  label: 'Ephemeral Oxigraph',
  title: 'A rule set is evaluated in an in-process store seeded with the data graph above. '
    + 'There is no backend to choose.',
};

const RUN_HELP = 'Inputs, not definition. Named tuples and a data graph are what you run this rule set '
  + 'against — the document below stays pure SRL. Edit them in the Inputs tab; keep the pair as a test '
  + 'with "create test".';

// --- Entity state -----------------------------------------------------------

const ruleSetIdValue = ref<string | null>(null);
const ruleSetName = ref('');
const ruleSetDescription = ref('');
const ruleSetLibraryId = ref('');
const ruleSetLoading = ref(false);
const ruleSetConcurrency = ref<string | null>(null);
const ruleSetCurrentVersionId = ref<string | null>(null);
const currentVersionNumberForDisplay = ref<number | null>(null);
const ruleSetVersions = ref<RuleSetVersion[]>([]);
const versionOptions = ref<Array<{ value: string; label: string; version: number; comment?: string | null; dateModified?: string | null }>>([]);
const selectedVersionId = ref<string | null>(null);

// --- The document -----------------------------------------------------------

/*
 * The document is the rule set. It is owned here rather than in a child
 * because it is what gets autosaved into a scratch record, what gets run, and
 * what gets saved — three things that all live at this level.
 */
const srlDocument = ref('');
const tupleSeeds = ref('');
const tuplesEnabled = ref(false);

/*
 * The deployment's rule-tuples setting. A stored version, a saved draft or a
 * stale toggle can all still claim the extension is on; on a build that
 * withholds it none of them may turn it on here, because the API refuses every
 * request that carries the field and the editor would be offering something no
 * save could keep. Every assignment to `tuplesEnabled` goes through
 * `applyTuplesEnabled`, so the ref is false throughout such a build and the
 * request bodies below carry `tuples: false` with no seeds.
 */
const { isEnabled: featureEnabled } = useFeatureFlags();
const ruleTuplesAllowed = computed(() => featureEnabled('ruleTuples'));
function applyTuplesEnabled(next: boolean) {
  tuplesEnabled.value = next && ruleTuplesAllowed.value;
}
const inferenceFormat = ref<string>('application/n-triples');

/*
 * The run inputs — named tuples and a data graph.
 *
 * Both are *arguments*, not definition: they have the same relationship to this
 * rule set that an argument set has to a query, which is why neither is in the
 * document and both are edited in the Inputs tab. Each is either a saved entity
 * (reproducible, and a real thing in the library's Tuples / Data sections) or
 * inline text (ephemeral: it lives in this browser's scratch record and never
 * in the library until it is saved). Never both — `source` is the one fact that
 * says which, and the server rejects a request naming a saved version *and*
 * inline content rather than picking a winner.
 */
const tupleSource = ref<InputSource>('inline');
const tupleSetVersionId = ref<string | null>(null);
const tupleSetOptions = ref<TupleSetOption[]>([]);
/** The selected tuple set's rows, as SRL — read-only, and what a run is given. */
const savedTuplePreview = ref('');
const savingTupleSet = ref(false);

const dataSource = ref<InputSource>('inline');
const dataGraphVersionId = ref<string | null>(null);
const dataGraphInline = ref('');
const dataGraphInlineFormat = ref<DataGraphFormat>('text/turtle');
const dataGraphOptions = ref<DataGraphOption[]>([]);
/** The selected data graph's content, so the Inputs tab can show it. */
const savedDataPreview = ref('');
const savingDataGraph = ref(false);
const savingTest = ref(false);
const savingBenchmark = ref(false);
/** The saved version's text, so "has this been edited?" is answerable. */
const loadedVersionDocument = ref<string>('');
/** And its seed rows, so "have the inputs been changed?" is answerable too. */
const loadedVersionTupleSeeds = ref<string>('');

const hasDocument = computed(() => srlDocument.value.trim().length > 0);

/**
 * The shapes this document declares, for the Inputs tab's bind-time note.
 *
 * Read off the text rather than off an analysis pass: the note is about what is
 * on screen right now, and a shape typed a keystroke ago is exactly the one
 * someone is about to bind a tuple set to.
 */
const tupleDeclarations = computed(() => parseTupleDeclarations(srlDocument.value));

/** The document a `+ New` rule set starts from — SRL, written as SRL is. */
const DEFAULT_SRL = `PREFIX ex: <http://example.org/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

DATA {
    ex:Alice a foaf:Person ;
        foaf:knows ex:Bob .

    ex:Bob a foaf:Person ;
        foaf:knows ex:Charlie .

    ex:Charlie a foaf:Person .
}

# Infer transitive friendship: if A knows B and B knows C, then A knows C
RULE {
    ?person1 ex:friendOfFriend ?person3 .
}
WHERE {
    ?person1 foaf:knows ?person2 .
    ?person2 foaf:knows ?person3 .
    FILTER (?person1 != ?person3)
}`;

// --- Live analysis ----------------------------------------------------------

/*
 * One parse feeds the gutter, the outline, the graph and the footer, so they
 * can never disagree about what the document says.
 */
const { analysis, analyzing, blocks, stratification, validationState, parseError } = useSrlAnalysis(
  srlDocument,
  tuplesEnabled,
);

// --- The editor -------------------------------------------------------------

/*
 * SRL's own grammar, which is what colours `RULE`, `DATA` and `TUPLE(…)` and
 * what folds a rule's head and body. The document was highlighted with the
 * SPARQL grammar until #157: close enough for the terms a body is made of, and
 * silent on everything that makes the document SRL.
 *
 * Asked for by media type rather than imported, so that swap lives in
 * `lib/codeLanguage.ts` with every other one — this file says which language
 * each editor holds, and that file says which grammar answers for it.
 *
 * Computed rather than fixed because `tuplesEnabled` is a property of the
 * document: `TUPLE( … )` is sqlib's extension rather than SPARQL-RL, and the
 * completion list must offer it on exactly the terms the same rule set is
 * parsed with server-side. `vue-codemirror` applies this prop through a
 * compartment, so a change reconfigures the live editor rather than rebuilding
 * it, and the document and cursor survive toggling.
 */
const editorView = shallowRef<EditorView | null>(null);
const extensions = computed<Extension[]>(() => [
  ...languageExtensionsFor('application/srl', { tuples: tuplesEnabled.value }),
  rdfSyntaxHighlighting,
  stratumGutter(),
  useCommentKeymap(),
  useEditorKeymaps(),
  /*
   * Run-on-keystroke. Appended to the array after the fact while this was a
   * `shallowRef`, because `run` is declared far below; it is folded in here now
   * that the extensions are computed, which is safe because `run` is a hoisted
   * function declaration and this getter does not evaluate during setup.
   */
  useExecuteKeymap(() => run()),
]);
/*
 * The Inputs tab's two editors, which hold two different languages: the seed
 * rows are SRL — `TUPLE( … )` and the prologue above them — while the data
 * graph beside them is Turtle. Only the first of those has a grammar of its
 * own here; the graph keeps the SPARQL skin it has always had, which reads its
 * terms correctly and its `@prefix` lines approximately.
 */
const tupleExtensions = computed<Extension[]>(() => [
  ...languageExtensionsFor('application/srl', { tuples: tuplesEnabled.value }),
  rdfSyntaxHighlighting,
]);
const inputExtensions = shallowRef<Extension[]>([
  ...languageExtensionsFor('application/sparql-query'),
  rdfSyntaxHighlighting,
]);
const readOnlyExtensions = shallowRef<Extension[]>([
  ...languageExtensionsFor('application/sparql-query'),
  rdfSyntaxHighlighting,
  EditorState.readOnly.of(true),
]);

/*
 * The rules screen keeps one editor and swaps rule sets through it, so without
 * this the first Ctrl-Z after switching brings the previous rule set's SRL
 * back. See `useEditorDocumentKey`.
 */
const { documentKey: editorDocumentKey, noteUserEdit: noteDocumentEdit } = useEditorDocumentKey(
  () => [props.scratchId ?? '', ruleSetIdValue.value ?? '', selectedVersionId.value ?? ''].join('|'),
  () => srlDocument.value,
);

/** What the editor types into; a load writing `srlDocument` is not this. */
function applyEditedDocument(value: string) {
  noteDocumentEdit();
  srlDocument.value = value;
}

const handleEditorReady = (view: EditorView) => {
  editorView.value = view;
  pushBands();
};

/** The stratum band beside each rule, redrawn whenever the analysis changes. */
const pushBands = () => {
  const view = editorView.value;
  if (!view) return;
  const bands: StratumBand[] = blocks.value.map((block) => ({
    startLine: block.startLine,
    endLine: block.endLine,
    stratum: block.stratum,
    kind: block.kind,
    label: block.label,
  }));
  view.dispatch({ effects: setStratumBands.of(bands) });
};

watch(blocks, pushBands);

/** Put the cursor on a line and bring it into view — the outline and DAG do this. */
const goToLine = (line: number) => {
  const view = editorView.value;
  if (!view || line < 1) return;
  if (line > view.state.doc.lines) return;
  const position = view.state.doc.line(line).from;
  view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
  });
  view.focus();
};

// --- Scratch records and drafts --------------------------------------------

interface RulesScratchBody {
  /** The rule set as one SRL document. */
  srl?: string;
  tupleSeeds?: string;
  tuplesEnabled?: boolean;
  inferenceFormat?: string;
  /*
   * The data graph the document runs against. Inline content is browser-local
   * by design — the library never stores it until it is promoted — so scratch
   * is exactly where it belongs.
   */
  dataGraphVersionId?: string | null;
  dataGraphInline?: string;
  dataGraphInlineFormat?: DataGraphFormat;
  /**
   * Which half of each input is live. Kept beside the values rather than
   * inferred from "which one is non-empty": picking a saved graph while inline
   * text is still in the record has to survive a reload as a *choice*.
   */
  tupleSource?: InputSource;
  tupleSetVersionId?: string | null;
  dataSource?: InputSource;
  /**
   * Pre-document scratch records, kept only so one already in a browser is
   * migrated rather than dropped. Their parts were always fragments of one
   * document, saved separately.
   */
  dataBlocks?: string[];
  rules?: string[];
}

/**
 * Fold a pre-document scratch body into one SRL document.
 *
 * Each part carried its own prologue (they were separate editors), so the
 * result repeats PREFIX lines. That is legal SRL — declarations may sit between
 * rules — and it is left as the author wrote it rather than deduplicated,
 * because rewriting someone's text on load is how you lose the one prefix that
 * was deliberately different.
 */
function documentFromParts(body: RulesScratchBody): string {
  return [...(body.dataBlocks ?? []), ...(body.rules ?? [])]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

const {
  isScratch,
  hydrating: hydratingScratch,
  savedAt: scratchSavedAt,
  flush: flushScratch,
} = useScratchRecord({
  scratchId: () => props.scratchId ?? null,
  missingMessage: 'That scratch rule set is not in this browser',
  track: [
    srlDocument,
    tupleSeeds,
    tuplesEnabled,
    inferenceFormat,
    ruleSetName,
    tupleSource,
    tupleSetVersionId,
    dataSource,
    dataGraphVersionId,
    dataGraphInline,
    dataGraphInlineFormat,
  ],
  hydrate: (record) => {
    const body = (record.body ?? {}) as RulesScratchBody;
    ruleSetName.value = record.name;
    const migrated = documentFromParts(body);
    srlDocument.value = body.srl ?? (migrated || DEFAULT_SRL);
    tupleSeeds.value = body.tupleSeeds ?? '';
    applyTuplesEnabled(body.tuplesEnabled ?? false);
    inferenceFormat.value = body.inferenceFormat ?? 'application/n-triples';
    tupleSource.value = body.tupleSource ?? (body.tupleSetVersionId ? 'saved' : 'inline');
    tupleSetVersionId.value = body.tupleSetVersionId ?? null;
    dataGraphVersionId.value = body.dataGraphVersionId ?? null;
    dataGraphInline.value = body.dataGraphInline ?? '';
    dataGraphInlineFormat.value = body.dataGraphInlineFormat ?? 'text/turtle';
    // A record written before the toggle existed picked its side by which
    // field was filled, so read it back the same way rather than defaulting a
    // saved selection into an empty inline editor.
    dataSource.value = body.dataSource ?? (body.dataGraphVersionId ? 'saved' : 'inline');
  },
  collect: (record) => ({
    name: ruleSetName.value || record.name,
    body: {
      srl: srlDocument.value,
      tupleSeeds: tupleSeeds.value,
      tuplesEnabled: tuplesEnabled.value,
      inferenceFormat: inferenceFormat.value,
      tupleSource: tupleSource.value,
      tupleSetVersionId: tupleSetVersionId.value,
      dataSource: dataSource.value,
      dataGraphVersionId: dataGraphVersionId.value,
      dataGraphInline: dataGraphInline.value,
      dataGraphInlineFormat: dataGraphInlineFormat.value,
    },
  }),
});

/*
 * A saved rule set gets the same browser-local safety net a saved
 * query does: edits are a draft until they are saved, and a draft survives
 * a reload. Copied in behaviour, not in code, from the query work area — the
 * bodies differ, the lifecycle does not.
 */
const locallySavedAt = ref<string | null>(null);
let draftSaveHandle: ReturnType<typeof setTimeout> | null = null;
/** Set while a version is being read into the editor, so a load is not an edit. */
const hydratingVersion = ref(false);

const openDraft = computed(() => {
  void draftsStore.allDrafts.value;
  return ruleSetIdValue.value ? draftsStore.draftFor(ruleSetIdValue.value) : null;
});

const editCount = computed(() => (isScratch.value ? 0 : openDraft.value?.edits ?? 0));

const draftBody = computed(() => {
  const body = openDraft.value?.body;
  return body && typeof body === 'object' ? (body as RulesScratchBody) : null;
});

function persistDraft() {
  const id = ruleSetIdValue.value;
  if (!id || isScratch.value) return;
  const existing = draftsStore.draftFor(id);
  draftsStore.save({
    id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
    libraryId: ruleSetLibraryId.value || UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'draft',
    section: 'rule',
    name: ruleSetName.value,
    description: ruleSetDescription.value || null,
    queryString: null,
    body: {
      srl: srlDocument.value,
      tupleSeeds: tupleSeeds.value,
      tuplesEnabled: tuplesEnabled.value,
      inferenceFormat: inferenceFormat.value,
      tupleSource: tupleSource.value,
      tupleSetVersionId: tupleSetVersionId.value,
      dataSource: dataSource.value,
      dataGraphVersionId: dataGraphVersionId.value,
      dataGraphInline: dataGraphInline.value,
      dataGraphInlineFormat: dataGraphInlineFormat.value,
    },
    resultKind: 'GRAPH',
    inputTuples: [],
    limitParameters: [],
    offsetParameters: [],
    outputs: [],
    basedOn: id,
    edits: (existing?.edits ?? 0) + 1,
  });
  locallySavedAt.value = new Date().toISOString();
}

function removeDraft() {
  const id = ruleSetIdValue.value;
  if (!id) return;
  const existing = draftsStore.draftFor(id);
  if (existing) draftsStore.remove(existing.id);
  locallySavedAt.value = null;
}

const documentMatchesVersion = () =>
  srlDocument.value.trim() === (loadedVersionDocument.value ?? '').trim();

watch([srlDocument, tupleSeeds, tuplesEnabled], () => {
  if (isScratch.value || hydratingVersion.value || hydratingScratch.value) return;
  if (!ruleSetIdValue.value) return;
  if (draftSaveHandle) clearTimeout(draftSaveHandle);
  draftSaveHandle = setTimeout(() => {
    draftSaveHandle = null;
    // Typing back to what is saved is an undo, not an edit; leaving a draft
    // behind would keep the dot lit over a body identical to the version.
    if (documentMatchesVersion()) {
      removeDraft();
      return;
    }
    persistDraft();
  }, 500);
});

/** Throw the unsaved edits away and go back to the saved version. */
function discardDraft() {
  if (draftSaveHandle) {
    clearTimeout(draftSaveHandle);
    draftSaveHandle = null;
  }
  removeDraft();
  hydrateDocument(loadedVersionDocument.value);
  toast.success('Draft discarded');
}

function hydrateDocument(text: string) {
  hydratingVersion.value = true;
  srlDocument.value = text;
  void Promise.resolve().then(() => { hydratingVersion.value = false; });
}

/** Show a saved version's body — the Details tab's version rows. */
function showVersionBody(versionId: string) {
  if (versionId !== selectedVersionId.value) {
    selectedVersionId.value = versionId;
    return;
  }
  hydrateDocument(loadedVersionDocument.value);
}

/*
 * The note on a version, written from the row that displays it.
 *
 * Save collects nothing now — it is one click — so this is where a version
 * gets its comment, against the version it describes and at any time after it
 * exists. A version's document is frozen; the comment is the one field a PATCH
 * may carry. Optimistic, with the old note put back if the write fails.
 */
async function annotateVersion({ value, comment }: { value: string; comment: string | null }) {
  const id = ruleSetIdValue.value;
  const option = versionOptions.value.find((entry) => entry.value === value);
  if (!id || isScratch.value || !option) return;

  const previous = option.comment ?? null;
  const apply = (next: string | null) => {
    versionOptions.value = versionOptions.value.map((entry) => (
      entry.value === value ? { ...entry, comment: next } : entry
    ));
    ruleSetVersions.value = ruleSetVersions.value.map((entry) => (
      entry.id === value ? { ...entry, comment: next } : entry
    ));
  };
  apply(comment);

  try {
    await apiClient.patchRuleSetVersion(id, option.version, { comment });
  } catch (error) {
    apply(previous);
    console.error('[RuleSetWorkArea] Failed to save the version note', error);
    toast.error('Failed to save the note');
  }
}

/** Go back to the draft after looking at a saved version. */
function restoreDraftBody() {
  const body = draftBody.value;
  if (!body || typeof body.srl !== 'string') return;
  hydrateDocument(body.srl);
  tupleSeeds.value = body.tupleSeeds ?? tupleSeeds.value;
  applyTuplesEnabled(body.tuplesEnabled ?? tuplesEnabled.value);
}

// --- Panels -----------------------------------------------------------------

const workAreaRef = ref<HTMLElement | null>(null);
/*
 * The same handle, the same floors and the same persistence shape as the query
 * screen's. Two screens that look identical and drag differently is the
 * divergence users notice; see `usePanelResize`.
 */
const {
  panelWidthPercent: leftPanelWidth,
  startResize: startVerticalResize,
  isResizing: isResizingVertical,
  collapsed: rightPanelCollapsed,
  resetWidth: resetPanelWidth,
} = usePanelResize({
  containerRef: workAreaRef,
  storageKey: 'ruleSet',
  collapsible: true,
  initialWidthPercent: 62,
});
/*
 * Inputs, not Details. Opening a rule set, the next thing you want is to run it
 * against something — and the tab that says what it runs against is where the
 * one selection this screen makes for you can be seen and changed.
 */
const activeTab = ref('inputs');
const inspectorRef = ref<InstanceType<typeof RuleSetInspectorPanel> | null>(null);

/**
 * The current rule, shared by the graph and the footer's stratum chip.
 *
 * They are the same act on the same selection; two selections would let the
 * chip focus a tab that is highlighting something else.
 */
const selectedRuleId = ref<string | null>(null);

const showPreviewDialog = ref(false);

/** Show a tab, expanding the panel if it is closed — a tab nobody can see is not shown. */
const editorExpansion = useEditorExpand();

function focusTab(tab: string) {
  /*
   * The tabs are in the right-hand panel, which a popped-out editor covers.
   * Asking for one is asking to see it, so the pop-out gets out of the way
   * first rather than switching a tab nobody can look at.
   */
  editorExpansion.collapse();
  activeTab.value = tab;
  rightPanelCollapsed.value = false;
}

// --- Details ----------------------------------------------------------------

const libraryLookup = computed(() => {
  const map = new Map<string, Library>();
  for (const library of librariesStore.libraries.value) map.set(library.id, library);
  return map;
});

const ruleSetLibraryName = computed(() => {
  const id = ruleSetLibraryId.value;
  if (!id) return activeLibraryName.value;
  return libraryLookup.value.get(id)?.name ?? id;
});

const detailsProps = computed(() => ({
  name: ruleSetName.value,
  description: ruleSetDescription.value,
  isScratch: isScratch.value,
  libraryName: ruleSetLibraryName.value,
  entityId: isScratch.value ? null : ruleSetIdValue.value,
  versionOptions: versionOptions.value.map((option) => ({
    value: option.value,
    label: String(option.version),
    comment: option.comment ?? null,
    dateModified: option.dateModified,
  })),
  selectedVersion: selectedVersionId.value,
  currentVersion: ruleSetCurrentVersionId.value,
  canAnnotateVersions: !isScratch.value && !!ruleSetIdValue.value,
  editCount: editCount.value,
  draftSavedAt: locallySavedAt.value,
  draftSelected: editCount.value > 0 && !documentMatchesVersion(),
}));

// --- The graph --------------------------------------------------------------

const ruleBlocks = computed(() => blocks.value.filter((block) => block.kind === 'rule'));

const graphNodes = computed<StratificationPanelNode[]>(() =>
  ruleBlocks.value.map((block) => ({
    id: block.id,
    label: block.label,
    stratum: block.stratum,
    monotonicity: block.monotonicity,
    runOnce: block.runOnce === true,
    line: block.startLine,
    code: documentSlice(block.startLine, block.endLine),
  })),
);

const graphEdges = computed(() => stratification.value?.edges ?? []);

/*
 * When the analysis last landed, for the Stratification header's "computed 1m
 * ago". Stamped from the blocks rather than from a timer, so it says when the
 * picture was last true rather than how long the tab has been open.
 */
const analysedAt = ref<string | null>(null);
watch([blocks, stratification], () => { analysedAt.value = new Date().toISOString(); });

/** The lines a block occupies, for the graph's source pane. */
function documentSlice(startLine: number, endLine: number): string {
  return srlDocument.value
    .split('\n')
    .slice(Math.max(0, startLine - 1), endLine)
    .join('\n');
}

// --- Saving -------------------------------------------------------------

const isSaving = ref(false);

/**
 * A scratch item still wearing the name `+ New` gave it has to be named at
 * save — the same rule, and the same pattern, as a scratch query.
 */
const UNTITLED_PATTERN = /^Untitled rule set \d+$/;
const needsName = computed(() => isScratch.value && UNTITLED_PATTERN.test(ruleSetName.value.trim()));

const canSave = computed(() => {
  if (!hasDocument.value || isSaving.value) return false;
  if (isScratch.value) return Boolean(activeLibraryId.value);
  // Saving an unchanged document would mint a version identical to the
  // last one. Nothing to save is a disabled button, not an error.
  return Boolean(ruleSetIdValue.value) && editCount.value > 0;
});

function promptForNameInDetails() {
  activeTab.value = 'details';
  rightPanelCollapsed.value = false;
  void Promise.resolve().then(() => inspectorRef.value?.focusName());
}

/**
 * Save: mint the rule set if it has no identity yet, then post the document
 * to the SRL import route, which splits it, mints the rules and data blocks,
 * and names them. Saving a draft and saving a scratch item are the
 * same import — only whether the entity already exists differs.
 */
/*
 * Save. It takes nothing: the bar collects no note and no name, so a new
 * version starts without a comment and gets one — if it deserves one — from
 * its row in the Details tab afterwards.
 */
async function save() {
  if (!canSave.value) return;
  isSaving.value = true;
  try {
    if (isScratch.value) {
      await saveScratch();
      return;
    }
    const id = ruleSetIdValue.value!;
    const response = await apiClient.importRuleSetSrl(id, srlDocument.value, {
      comment: null,
      tuples: tuplesEnabled.value,
      tupleSeeds: tuplesEnabled.value ? tupleSeeds.value : null,
    });
    removeDraft();
    toast.success(`Saved v${response.version} (${response.ruleCount} rules)`);
    await loadRuleSetVersions(id);
    selectedVersionId.value = response.ruleSetVersionId;
    await loadDocumentForSelectedVersion();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to save');
  } finally {
    isSaving.value = false;
  }
}

async function saveScratch() {
  const libraryId = activeLibraryId.value!;
  const name = ruleSetName.value.trim() || 'Untitled rule set';
  const scratchRecordId = props.scratchId ?? null;

  flushScratch();
  try {
    const created = await apiClient.createRuleSet({ name, description: null, isPartOf: [libraryId] });
    await apiClient.importRuleSetSrl(created.data.id, srlDocument.value, {
      comment: null,
      tuples: tuplesEnabled.value,
      tupleSeeds: tuplesEnabled.value ? tupleSeeds.value : null,
    });
    /*
     * Only now is the scratch record safe to drop. A failure above leaves it
     * exactly where it was — the user's text is never the thing that gets lost,
     * even when the rule set entity was already created.
     */
    if (scratchRecordId) draftsStore.remove(scratchRecordId);
    toast.success(`Saved “${name}” as v1`);
    emit('scratch-saved', { id: created.data.id, name, libraryId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save';
    toast.error(`Could not save “${name}”: ${message}`);
  }
}

// --- Preview ----------------------------------------------------------------

const previewResult = ref<RuleSetSrlPreview | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

async function openPreview() {
  showPreviewDialog.value = true;
  previewResult.value = null;
  previewError.value = null;
  const id = ruleSetIdValue.value;
  if (!id) {
    previewError.value = 'Nothing to compare against yet — this rule set has no versions.';
    return;
  }
  previewLoading.value = true;
  try {
    previewResult.value = await apiClient.previewRuleSetSrl(
      id,
      srlDocument.value,
      selectedVersionNumber.value,
      { tuples: tuplesEnabled.value, tupleSeeds: tuplesEnabled.value ? tupleSeeds.value : null },
    );
  } catch (error) {
    previewError.value = error instanceof Error ? error.message : 'Could not preview the changes';
  } finally {
    previewLoading.value = false;
  }
}

// --- Loading ----------------------------------------------------------------

const selectedVersionNumber = computed(
  () => versionOptions.value.find((option) => option.value === selectedVersionId.value)?.version ?? null,
);

const resetState = () => {
  ruleSetIdValue.value = null;
  ruleSetName.value = '';
  ruleSetDescription.value = '';
  ruleSetLibraryId.value = '';
  ruleSetVersions.value = [];
  versionOptions.value = [];
  selectedVersionId.value = null;
  ruleSetCurrentVersionId.value = null;
  currentVersionNumberForDisplay.value = null;
  ruleSetConcurrency.value = null;
  loadedVersionDocument.value = '';
  loadedVersionTupleSeeds.value = '';
  srlDocument.value = '';
  tupleSeeds.value = '';
  applyTuplesEnabled(false);
  tupleSource.value = 'inline';
  tupleSetVersionId.value = null;
  savedTuplePreview.value = '';
  dataSource.value = 'inline';
  savedDataPreview.value = '';
  selectedRuleId.value = null;
  executionResult.value = null;
  executionTimestamp.value = null;
  locallySavedAt.value = null;
};

const ensureLibraryPresent = async (libraryId: string | null) => {
  if (!libraryId || libraryLookup.value.has(libraryId)) return;
  try {
    await librariesStore.loadLibraries();
  } catch (error) {
    console.error('[RuleSetWorkArea] Failed to load libraries for rule set:', error);
  }
};

const loadRuleSetVersions = async (ruleSetId: string) => {
  try {
    const versions = await apiClient.listRuleSetVersions(ruleSetId);
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    ruleSetVersions.value = sorted;
    versionOptions.value = sorted.map((entry) => ({
      value: entry.id,
      label: `Version ${entry.version}`,
      version: entry.version,
      comment: entry.comment ?? null,
      dateModified: entry.dateModified,
    }));
    const currentMatch = sorted.find((entry) => entry.id === ruleSetCurrentVersionId.value);
    currentVersionNumberForDisplay.value = currentMatch?.version ?? sorted[0]?.version ?? null;
    if (!selectedVersionId.value || !sorted.some((entry) => entry.id === selectedVersionId.value)) {
      selectedVersionId.value = (currentMatch ?? sorted[0])?.id ?? null;
    }
    return sorted;
  } catch (error) {
    console.error('[RuleSetWorkArea] Failed to load rule set versions:', error);
    toast.error('Failed to load rule set versions');
    ruleSetVersions.value = [];
    versionOptions.value = [];
    selectedVersionId.value = null;
    return [];
  }
};

/**
 * Prefixes to render the exported document with.
 *
 * Rules are stored with expanded IRIs, so the server needs a prologue to
 * abbreviate against. It is taken from whatever the editor currently declares,
 * so a reload keeps the author's own prefixes; on first load there is nothing
 * to take, and the default seeds an empty rule set with something usable.
 */
const DEFAULT_PROLOGUE = 'PREFIX : <http://example/>';

/** The PREFIX/BASE lines the document actually declares, in document order. */
function prologueLines(): string[] {
  return srlDocument.value
    .split('\n')
    .filter((line) => /^\s*(PREFIX|BASE)\b/i.test(line))
    .map((line) => line.trim());
}

function currentPrologue(): string {
  const lines = prologueLines();
  return lines.length ? lines.join('\n') : DEFAULT_PROLOGUE;
}

/*
 * Only the most recently started load may write to the editor: the watchers
 * below can fire twice in quick succession (rule set and version both
 * changing), and a slow earlier response landing after a fast later one shows
 * the wrong version's document.
 */
let loadSeq = 0;

async function loadDocumentForSelectedVersion() {
  const id = ruleSetIdValue.value;
  if (!id) return;
  const seq = ++loadSeq;
  const prologue = currentPrologue();
  try {
    const response = await apiClient.exportRuleSetSrl(id, {
      version: selectedVersionNumber.value,
      prologue,
    });
    if (seq !== loadSeq) return;
    loadedVersionDocument.value = response.srl;
    const draft = draftBody.value;
    /*
     * A draft wins over the saved text, because it is the newer of the two
     * and the one the author was last looking at. The version is still kept in
     * `loadedVersionDocument` so Discard and the version rows can get back to
     * it.
     */
    hydratingVersion.value = true;
    srlDocument.value = typeof draft?.srl === 'string' ? draft.srl : response.srl;
    loadedVersionTupleSeeds.value = response.tupleSeeds ?? '';
    tupleSeeds.value = draft?.tupleSeeds ?? response.tupleSeeds ?? '';
    applyTuplesEnabled(draft?.tuplesEnabled ?? response.tuplesEnabled === true);
    locallySavedAt.value = openDraft.value?.updatedAt ?? null;
    void Promise.resolve().then(() => { hydratingVersion.value = false; });

    for (const warning of response.warnings ?? []) toast.warning(warning);
  } catch (error) {
    if (seq !== loadSeq) return;
    console.error('[RuleSetWorkArea] Failed to load the rule set document:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to load the rule set document');
  }
}

const loadRuleSet = async (id: string) => {
  if (!id) {
    resetState();
    return;
  }
  ruleSetLoading.value = true;
  try {
    const { ruleSet, ifMatch } = await ruleSetsStore.fetchRuleSet(id);
    ruleSetIdValue.value = ruleSet.id;
    ruleSetName.value = ruleSet.name;
    ruleSetDescription.value = ruleSet.description ?? '';
    ruleSetLibraryId.value = Array.isArray(ruleSet.isPartOf) ? ruleSet.isPartOf[0] : ruleSet.isPartOf;
    ruleSetCurrentVersionId.value = (ruleSet.currentVersion ?? null) as string | null;
    ruleSetConcurrency.value = ifMatch ?? ruleSetsStore.concurrency[ruleSet.id] ?? null;
    executionResult.value = null;
    executionTimestamp.value = null;

    await ensureLibraryPresent(ruleSetLibraryId.value ?? null);
    await loadRuleSetVersions(ruleSet.id);
    await loadDocumentForSelectedVersion();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load rule set';
    console.error('[RuleSetWorkArea] Failed to load rule set:', error);
    toast.error(message);
    resetState();
    emit('ruleset-load-failed');
  } finally {
    ruleSetLoading.value = false;
  }
};

// --- Metadata ---------------------------------------------------------------

/**
 * Persist a rename from the Details tab.
 *
 * Details is now the only editor of the name and description — the dialog that
 * used to own them is gone with the ⋮ — so the tab has to write them, the way
 * the query editor's does. Debounced because it fires per keystroke, and held
 * back while the rule set is scratch or still loading: there is nothing to save
 * to yet, and the name rides along in the create call at save.
 */
let identitySaveHandle: ReturnType<typeof setTimeout> | null = null;

async function persistIdentity() {
  if (!ruleSetIdValue.value) return;
  try {
    await updateRuleSetWithRetry({
      name: ruleSetName.value,
      description: ruleSetDescription.value || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save name';
    console.error('[RuleSetWorkArea] Failed to save rule set details:', error);
    toast.error(message);
  }
}

watch([ruleSetName, ruleSetDescription], () => {
  if (isScratch.value || ruleSetLoading.value) return;
  if (identitySaveHandle) clearTimeout(identitySaveHandle);
  identitySaveHandle = setTimeout(() => {
    identitySaveHandle = null;
    void persistIdentity();
  }, 600);
});

const fetchLatestConcurrencyToken = async (id: string) => {
  try {
    const detail = await ruleSetsStore.fetchRuleSet(id);
    ruleSetCurrentVersionId.value = (detail.ruleSet.currentVersion ?? null) as string | null;
    ruleSetConcurrency.value = detail.ifMatch ?? ruleSetsStore.concurrency[id] ?? ruleSetConcurrency.value;
    return ruleSetConcurrency.value;
  } catch (error) {
    console.error('[RuleSetWorkArea] Failed to refresh concurrency token before update:', error);
    return ruleSetConcurrency.value ?? ruleSetsStore.concurrency[id] ?? null;
  }
};

const updateRuleSetWithRetry = async (payload: RuleSetUpdateInput) => {
  const id = ruleSetIdValue.value;
  if (!id) throw new Error('No rule set selected');

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let ifMatch = ruleSetConcurrency.value ?? ruleSetsStore.concurrency[id] ?? null;
    if (!ifMatch) ifMatch = await fetchLatestConcurrencyToken(id);
    try {
      const updated = await ruleSetsStore.updateRuleSet(id, payload, ifMatch);
      ruleSetConcurrency.value = ruleSetsStore.concurrency[id] ?? ruleSetConcurrency.value;
      return updated;
    } catch (error: unknown) {
      const err = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown }; data?: { expected?: unknown } };
      const statusCode = err.statusCode ?? err.status ?? err.response?.status ?? null;
      if (statusCode === 412 && attempt === 0) {
        const expectedToken = typeof err.data?.expected === 'string' && err.data.expected.trim()
          ? err.data.expected.trim()
          : null;
        if (expectedToken) {
          ruleSetsStore.concurrency[id] = expectedToken;
          ruleSetConcurrency.value = expectedToken;
        }
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Failed to update rule set after retry');
};

/*
 * Import from SPARQL.
 *
 * The dialog is given what the document *actually* declares rather than
 * `currentPrologue()`'s fallback: abbreviating against a prefix the document
 * does not declare would produce a rule spelled `:foo` in a document with no
 * `:` binding, which is a document that no longer parses.
 */
const showImportDialog = ref(false);

function openImportDialog() {
  showImportDialog.value = true;
}

// The page opens the dialog for "+ New ▾ Import from SPARQL…", which creates a
// scratch rule set and then imports into it.
defineExpose({ openImport: openImportDialog });

/**
 * Append an imported rule, and the prefixes it needs, to the document.
 *
 * The rule goes at the end — a rule set is order-independent, so appending is
 * the honest place for it — and any new PREFIX joins the existing prologue
 * rather than being stranded above the rule that uses it.
 */
function appendImportedRule(payload: {
  rule: string;
  prefixes: Array<{ prefix: string; namespace: string }>;
}) {
  const declarations = payload.prefixes.map(({ prefix, namespace }) => `PREFIX ${prefix}: <${namespace}>`);

  let text = srlDocument.value;
  if (declarations.length > 0) {
    const lines = text.split('\n');
    // After the last existing declaration, so the prologue stays one block.
    let lastPrologue = -1;
    lines.forEach((line, index) => {
      if (/^\s*(PREFIX|BASE)\b/i.test(line)) lastPrologue = index;
    });
    if (lastPrologue >= 0) {
      lines.splice(lastPrologue + 1, 0, ...declarations);
      text = lines.join('\n');
    } else {
      text = `${declarations.join('\n')}\n\n${text}`;
    }
  }

  const body = text.replace(/\s+$/, '');
  srlDocument.value = body ? `${body}\n\n${payload.rule}\n` : `${payload.rule}\n`;
  toast.success('Rule appended');
}

const isDeleting = ref(false);

const deleteRuleSet = async () => {
  if (!ruleSetIdValue.value) return;
  isDeleting.value = true;
  try {
    await ruleSetsStore.deleteRuleSet(ruleSetIdValue.value);
    toast.success('Rule set deleted');
    emit('ruleset-deleted');
    resetState();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete rule set';
    console.error('[RuleSetWorkArea] Failed to delete rule set:', error);
    toast.error(message);
  } finally {
    isDeleting.value = false;
  }
};

const copyRuleSetId = async () => {
  if (!ruleSetIdValue.value) return;
  try {
    await navigator.clipboard.writeText(ruleSetIdValue.value);
    toast.success('Rule Set ID copied');
  } catch (error) {
    console.error('[RuleSetWorkArea] Failed to copy rule set ID:', error);
    toast.error('Failed to copy Rule Set ID');
  }
};

/**
 * Turning the extension off with tuple content present warns and blocks rather
 * than discarding: a document containing `TUPLE( … )` cannot be parsed at all
 * with the extension off, so every later action would fail with a syntax error
 * whose cause is off-screen — and nothing here deletes what someone wrote.
 */
function setTuplesEnabled(next: boolean) {
  // The control is not drawn on a build that withholds the extension; this is
  // the backstop for anything that reaches the handler another way.
  if (!ruleTuplesAllowed.value) return;
  if (!next && (/\bTUPLE\s*\(/i.test(srlDocument.value) || tupleSeeds.value.trim())) {
    toast.error(
      'This rule set still uses TUPLE( … ). Remove the tuple rules and the initial tuples before '
      + 'turning the extension off — nothing is discarded for you.',
    );
    return;
  }
  applyTuplesEnabled(next);
}

// --- Execution --------------------------------------------------------------

// intentional any: executeRuleSet's schema-inferred result and the display
// component's local ExecutionResults interface are independently defined.
const executionResult = ref<any>(null);
const executionTimestamp = ref<string | null>(null);
const isExecuting = ref(false);

/**
 * The last run, kept in the browser between visits — the same bargain the
 * scratch store makes for unsaved bodies. One run per record, replaced by the
 * next; see `lib/lastRunCache.ts` for what it will and will not keep.
 */
interface CachedRuleSetRun {
  result: unknown;
  ranAt: string | null;
}

const lastRunKey = computed(() => (isScratch.value
  ? runCacheKey('rule-set-scratch', props.scratchId)
  : runCacheKey('rule-set', ruleSetIdValue.value)));

/** What the cache holds for the open record, so a restore is not re-saved. */
let heldRun: string | null = null;

watch(
  lastRunKey,
  (key, previous) => {
    if (key === previous) return;
    const restored = loadLastRun<CachedRuleSetRun>(key);
    heldRun = restored ? JSON.stringify(restored) : null;
    executionResult.value = restored?.result ?? null;
    executionTimestamp.value = restored?.ranAt ?? null;
  },
  { immediate: true },
);

watch([executionResult, executionTimestamp], ([result, ranAt]) => {
  // A run in progress clears the panel first; that is not a run to remember.
  if (!result) return;
  const run: CachedRuleSetRun = { result, ranAt };
  const serialised = JSON.stringify(run);
  // Restoring is not running: re-writing here would move this record to the
  // front of the eviction queue every time it was merely looked at.
  if (serialised === heldRun) return;
  heldRun = serialised;
  saveLastRun(lastRunKey.value, run);
});

/**
 * Run: add everything the rules entail to the store.
 *
 * What runs is what is on screen. A saved version with no unsaved
 * edits runs through the rule set's own execute route; a draft or a scratch
 * document has no version to name, so it goes to the inline-execution route,
 * which splits it with the parser and runs it against an ephemeral store.
 * Saving changes which path runs, not what the document means.
 */
/**
 * The data-graph half of an execute request.
 *
 * Both routes take the same three fields, and both reject a request that names
 * a saved version *and* inline content — so this returns one or the other,
 * never a merge of what the two refs happen to hold. `source` decides, not
 * whichever ref happens to be non-empty: a saved graph selected while inline
 * text is still in the scratch record must send the version.
 */
function dataGraphRunInput(): {
  dataGraphVersionId?: string;
  dataGraphInline?: string;
  dataGraphInlineFormat?: DataGraphFormat;
} {
  if (dataSource.value === 'saved') {
    return dataGraphVersionId.value ? { dataGraphVersionId: dataGraphVersionId.value } : {};
  }
  const inline = dataGraphInline.value.trim();
  if (inline) return { dataGraphInline: inline, dataGraphInlineFormat: dataGraphInlineFormat.value };
  return {};
}

/**
 * The named-tuple half: the rows a run seeds the ephemeral tuple store with.
 *
 * A saved tuple set is resolved to its rows here rather than sent as a
 * reference, because the seed document is the shape both execute routes already
 * take. `lib/srlTupleRows.ts` owns the mapping between the two spellings.
 */
function tupleSeedsForRun(): string | null {
  if (!tuplesEnabled.value) return null;
  const text = tupleSource.value === 'saved' ? savedTuplePreview.value : tupleSeeds.value;
  return text.trim() ? text : null;
}

async function run() {
  if (!hasDocument.value) {
    toast.error('Write a rule set first.');
    return;
  }
  const savedVersion = ruleSetVersions.value.find((entry) => entry.id === selectedVersionId.value);
  /*
   * The rule set's own execute route runs the version's *stored* seeds, and has
   * no field to override them with. So a tuple selection made on screen is only
   * honoured by the playground route, which takes the seed document — picking a
   * different tuple set and having the run quietly ignore it is the one outcome
   * worth an extra parse to avoid.
   */
  const seeds = tupleSeedsForRun();
  const overridesSeeds = tupleSource.value === 'saved'
    ? seeds !== null
    : (seeds ?? '').trim() !== loadedVersionTupleSeeds.value.trim();
  const runsDocument = isScratch.value || !savedVersion || !documentMatchesVersion() || overridesSeeds;

  isExecuting.value = true;
  executionResult.value = null;
  executionTimestamp.value = null;
  activeTab.value = 'results';
  rightPanelCollapsed.value = false;

  try {
    /*
     * The editor already discovers as you type; this covers the document that
     * arrived some other way — pasted whole, imported, or loaded and run
     * without an edit.
     */
    autoDiscoverFromRule(srlDocument.value, prefixSource.value);

    executionResult.value = runsDocument
      ? await apiClient.executeRulesPlayground({
        srl: srlDocument.value,
        tuples: tuplesEnabled.value,
        tupleSeeds: seeds,
        inferenceFormat: inferenceFormat.value,
        ...dataGraphRunInput(),
      })
      : await apiClient.executeRuleSet(ruleSetIdValue.value!, {
        version: savedVersion!.version,
        inferenceFormat: inferenceFormat.value,
        ...dataGraphRunInput(),
      });
    executionTimestamp.value = new Date().toISOString();
    toast.success('Rule set run');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run rule set';
    console.error('[RuleSetWorkArea] Failed to run rule set:', error);
    toast.error(message);
  } finally {
    isExecuting.value = false;
  }
}

/*
 * A rule set is a rule set whether or not it has been saved: the draft points
 * at its scratch record, and the Prefix Manager still calls it a rule set.
 */
const prefixSource = computed(() =>
  prefixSourceToken(
    'rule-set',
    isScratch.value ? (props.scratchId ?? null) : (ruleSetIdValue.value || null),
  ),
);

/*
 * The Code tab.
 *
 * `POST /rule-sets/{id}/execute`, carrying the same fields Run sends:
 * the version on screen, the inference format, and whichever data graph is
 * selected — a saved version or inline RDF, never both, because the route
 * rejects a request naming both.
 */
const codeRequest = computed<SnippetRequest>(() => {
  const apiBaseUrl = String(config.public.apiBaseUrl).replace(/\/$/, '');
  const id = ruleSetIdValue.value || '<rule-set-id>';
  const body: Record<string, unknown> = { inferenceFormat: inferenceFormat.value };
  if (selectedVersionNumber.value !== null) body.version = selectedVersionNumber.value;
  Object.assign(body, dataGraphRunInput());

  return {
    method: 'POST',
    url: `${apiBaseUrl}/rule-sets/${encodeURIComponent(id)}/execute`,
    body,
  };
});

const codeUnavailable = computed(() =>
  isScratch.value || !ruleSetIdValue.value
    ? 'This rule set has not been saved yet — save it to get a callable id.'
    : null,
);

/*
 * An unsaved document runs through the playground route in the app, which
 * takes the SRL text rather than an id. The snippet names the rule set, so it
 * runs the saved version — worth saying before someone wonders why their
 * latest rule had no effect.
 */
const codeDraftNote = computed(() => {
  if (codeUnavailable.value) return null;
  const savedVersion = ruleSetVersions.value.find((entry) => entry.id === selectedVersionId.value);
  if (!savedVersion || !documentMatchesVersion()) {
    return 'Draft — the snippet is correct, but it runs the saved version, not your unsaved edits.';
  }
  return null;
});

// --- Lifecycle --------------------------------------------------------------

watch(
  () => props.ruleSetId,
  (id) => {
    // A draft has no entity to load, and resetting would wipe the document the
    // scratch record just hydrated.
    if (isScratch.value) return;
    if (id) loadRuleSet(id);
    else resetState();
  },
  { immediate: true },
);

watch(selectedVersionId, (versionId, previous) => {
  if (!versionId || versionId === previous || !ruleSetIdValue.value) return;
  executionResult.value = null;
  executionTimestamp.value = null;
  void loadDocumentForSelectedVersion();
});

/**
 * The saved data graphs this rule set could run against.
 *
 * Scoped to the library the rule set is in — a data graph is library-scoped
 * like everything else, and offering another library's graphs would be
 * offering a run that reads across a boundary the rest of the app keeps.
 *
 * Only the current version of each graph is offered. Picking an *older*
 * version is a real need for a saved Test (issue #152), which names a version
 * id directly; it is not what the run bar on an editor is for.
 */
async function loadDataGraphOptions() {
  const libraryId = isScratch.value ? activeLibraryId.value : (ruleSetLibraryId.value || activeLibraryId.value);
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
    // A failure here costs the dropdown its contents, not the editor its use:
    // inline data still works, and so does running with no data graph at all.
    console.warn('[RuleSetWorkArea] Failed to load data graphs:', error);
    dataGraphOptions.value = [];
  }
}

/**
 * The saved tuple sets this rule set could run against.
 *
 * Same scoping and same "current version only" rule as the data graphs above,
 * and for the same reasons: both are library assets, and pinning an older
 * version is a saved Test's job, not a run bar's.
 */
async function loadTupleSetOptions() {
  const libraryId = isScratch.value ? activeLibraryId.value : (ruleSetLibraryId.value || activeLibraryId.value);
  if (!libraryId) {
    tupleSetOptions.value = [];
    return;
  }
  try {
    const sets = await apiClient.listTupleSets({ library: libraryId });
    const options = await Promise.all(
      sets.filter((set) => set.currentVersion).map(async (set) => {
        const versions = await apiClient.listTupleSetVersions(set.id);
        const current = versions.find((version) => version.id === set.currentVersion) ?? versions.at(-1);
        if (!current) return null;
        const rows = current.rowCount ?? 0;
        return {
          versionId: current.id,
          name: set.name,
          version: current.version,
          detail: `${rows} ${rows === 1 ? 'row' : 'rows'}`,
          tupleSetId: set.id,
          columns: current.tupleColumns ?? [],
        } satisfies TupleSetOption;
      }),
    );
    tupleSetOptions.value = options.filter((option): option is TupleSetOption => option !== null);
  } catch (error) {
    // Losing the dropdown costs the saved half of the choice, not the editor
    // its use: inline rows still work, and so does running with none at all.
    console.warn('[RuleSetWorkArea] Failed to load tuple sets:', error);
    tupleSetOptions.value = [];
  }
}

/*
 * What the Inputs tab shows on the Saved side, and what a run is given.
 *
 * Fetched rather than derived, because a version's rows are the version's, not
 * something the listing carries — and read back through
 * `lib/srlTupleRows.ts`, which is the one place the tabular spelling and the
 * SRL spelling are allowed to meet.
 */
async function loadSavedTuplePreview() {
  const option = tupleSetOptions.value.find((entry) => entry.versionId === tupleSetVersionId.value);
  if (!option) {
    savedTuplePreview.value = '';
    return;
  }
  try {
    const { data: version } = await apiClient.getTupleSetVersion(option.tupleSetId, option.version);
    const parsed = JSON.parse(version.contentString) as {
      head?: { vars?: string[] };
      results?: { bindings?: Array<Record<string, { type?: string; value?: string }>> };
    };
    const columns = version.tupleColumns?.length ? version.tupleColumns : parsed.head?.vars ?? [];
    savedTuplePreview.value = bindingsToTupleRows(columns, parsed.results?.bindings ?? []);
  } catch (error) {
    console.warn('[RuleSetWorkArea] Failed to read the selected tuple set:', error);
    savedTuplePreview.value = '';
  }
}

async function loadSavedDataPreview() {
  const option = dataGraphOptions.value.find((entry) => entry.versionId === dataGraphVersionId.value);
  if (!option) {
    savedDataPreview.value = '';
    return;
  }
  try {
    const { data: version } = await apiClient.getDataGraphVersion(option.graphId, option.version);
    savedDataPreview.value = version.contentString ?? '';
  } catch (error) {
    console.warn('[RuleSetWorkArea] Failed to read the selected data graph:', error);
    savedDataPreview.value = '';
  }
}

watch([tupleSetVersionId, tupleSetOptions], () => { void loadSavedTuplePreview(); });
watch([dataGraphVersionId, dataGraphOptions], () => { void loadSavedDataPreview(); });

/** What the Run with strip says it is about to run against. */
const tuplesSummary = computed(() => {
  if (tupleSource.value === 'saved') {
    return tupleSetOptions.value.find((option) => option.versionId === tupleSetVersionId.value)?.name ?? '';
  }
  const rows = tupleSeeds.value.split('\n').filter((line) => line.trim()).length;
  return rows ? `${rows} ${rows === 1 ? 'row' : 'rows'} inline` : '';
});

const dataSummary = computed(() => {
  if (dataSource.value === 'saved') {
    return dataGraphOptions.value.find((option) => option.versionId === dataGraphVersionId.value)?.name ?? '';
  }
  return dataGraphInline.value.trim() ? 'inline' : '';
});

/**
 * The "with" clause of the run sentence.
 *
 * Both picks lead to the same place. A tuple set and a data graph are
 * documents, and a dropdown is not somewhere you read one — so pressing either
 * shows the Inputs tab, where the choice is actually made and the content is
 * visible while you make it.
 */
const runInputs = computed<RunBarPick[]>(() => [
  /*
   * The named-tuples pick is absent, not empty, on a build that withholds the
   * extension: an empty pick invites you to press it, and the Inputs tab it
   * leads to has no tuples block to show.
   */
  ...(ruleTuplesAllowed.value
    ? [{
      key: 'tuples',
      kind: 'tuples',
      value: tuplesSummary.value,
      empty: !tuplesSummary.value,
      icon: 'tuples',
      title: tuplesSummary.value
        ? `Named tuples: ${tuplesSummary.value} — open the Inputs tab to change them`
        : 'No named tuples — open the Inputs tab to choose or type some',
    } as RunBarPick]
    : []),
  {
    key: 'data',
    kind: 'data',
    value: dataSummary.value,
    empty: !dataSummary.value,
    icon: 'data',
    title: dataSummary.value
      ? `Data graph: ${dataSummary.value} — open the Inputs tab to change it`
      : 'No data graph — open the Inputs tab to choose or type one',
  },
]);

/**
 * Save inline tuple rows to the library as a TupleSet.
 *
 * The rows are positional SRL on this side and a SPARQL Results table on the
 * other; `lib/srlTupleRows.ts` states that mapping, including why a prefixed
 * name the document does not declare is a refusal rather than a guess.
 */
async function saveInlineTupleSet() {
  const content = tupleSeeds.value.trim();
  if (!content) return;
  const libraryId = isScratch.value ? activeLibraryId.value : (ruleSetLibraryId.value || activeLibraryId.value);
  if (!libraryId) {
    toast.error('Choose a library before saving a tuple set.');
    return;
  }

  savingTupleSet.value = true;
  try {
    const table = tupleRowsToTable(content, readProloguePrefixes(srlDocument.value));
    const name = `${ruleSetName.value.trim() || 'Rule set'} tuples`;
    const { data: set } = await apiClient.createTupleSet({ name, isPartOf: [libraryId] });
    const { data: version } = await apiClient.createTupleSetVersion(set.id, {
      contentString: table.tsv,
      sourceFormat: 'sparql-results-tsv',
    });
    tupleSeeds.value = '';
    tupleSetVersionId.value = version.id;
    tupleSource.value = 'saved';
    await loadTupleSetOptions();
    toast.success(`Saved “${name}” as a tuple set`);
  } catch (error) {
    // A TupleRowError is the author's to fix, so it is said plainly rather than
    // wrapped in "failed to save": nothing went wrong with the request.
    const message = error instanceof TupleRowError || error instanceof Error
      ? error.message
      : 'Failed to save the tuple set';
    toast.error(message);
  } finally {
    savingTupleSet.value = false;
  }
}

/**
 * Save this rule set with these inputs as a Test.
 *
 * A rule set plus its inputs *is* a test — that is what the Test entity already
 * models — so promotion is one explicit button and nothing else writes to
 * Tests. The expectation is left empty, which is a smoke test in the model
 * already: it asserts the run completes and converges, and the author fills in
 * what it should produce when they know.
 *
 * Only a saved rule set can be a subject: a test names its subject, and a
 * scratch document has no name to be given.
 */
const testDisabledReason = computed(() => {
  if (isScratch.value || !ruleSetIdValue.value) {
    return 'Save this rule set first — a test names a saved subject.';
  }
  if (dataSource.value === 'inline' && dataGraphInline.value.trim()) {
    return 'Save the inline data graph first — a test names a saved data graph version.';
  }
  return null;
});

async function saveAsTest() {
  if (testDisabledReason.value) return;
  const libraryId = ruleSetLibraryId.value || activeLibraryId.value;
  if (!libraryId) {
    toast.error('Choose a library first.');
    return;
  }

  savingTest.value = true;
  try {
    // No `tags`: the button has no form to ask on, so the new test takes the
    // server's default — the rule set's own tags, copied.
    const { data: created } = await apiClient.createTest({
      name: `${ruleSetName.value.trim() || 'Rule set'} — inputs`,
      subject: ruleSetIdValue.value!,
      subjectKind: 'ruleSet',
      isPartOf: [libraryId],
    } as never);
    await apiClient.createTestVersion(created.id, {
      expectationKind: 'smoke',
      subjectVersion: selectedVersionId.value,
      backend: null,
      cases: [{
        name: null,
        expected: null,
        expectedFormat: null,
        ordered: null,
        argumentSetVersion: null,
        dataGraphVersion: dataSource.value === 'saved' ? dataGraphVersionId.value : null,
        tupleSeeds: tupleSeedsForRun(),
      }],
    });
    toast.success('Saved as a test — add an expectation when you know what it should produce');
    emit('open-test', created.id);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to save as a test');
  } finally {
    savingTest.value = false;
  }
}

/* ------------------------------------------------------------------ *
 * Create a benchmark from the recipe
 *
 * The pair this screen has been missing (#247). A rule set is a benchmark
 * subject with two multiplying axes and no store axis: the selected tuple set
 * goes on `inputs`, the selected data graph on `dataGraphs`, and the spec
 * carries no backends at all — the API refuses them for this kind rather than
 * ignoring them.
 *
 * Both axes name the **entity**, not the version on screen. That is the same
 * float an argument set gets on a query benchmark: a plan names a library
 * object and the run records which version it resolved to, so re-running the
 * benchmark next month measures the graph as it is then. A test pins, because a
 * test asserts a result; a benchmark measures a moving library on purpose.
 * ------------------------------------------------------------------ */

/**
 * Whether the on-screen tuple selection can be named in a plan.
 *
 * Inline rows cannot: a benchmark axis holds a `TupleSet` IRI and there is
 * nothing in the library to point at. Refusing is only right when those rows
 * would actually change the run — inline text identical to what the version
 * stored is what a spec with no `inputs` already executes.
 */
const inlineSeedsWouldBeLost = computed(() => {
  if (!tuplesEnabled.value || tupleSource.value === 'saved') return false;
  return tupleSeeds.value.trim() !== loadedVersionTupleSeeds.value.trim();
});

const benchmarkDisabledReason = computed(() => {
  if (isScratch.value || !ruleSetIdValue.value) {
    return 'Save this rule set first — a benchmark names a saved subject.';
  }
  if (!selectedVersionId.value) {
    return 'Save a version first — a benchmark names one.';
  }
  if (dataSource.value === 'inline' && dataGraphInline.value.trim()) {
    return 'Save the inline data graph first — a benchmark’s graph axis names a saved data graph.';
  }
  if (inlineSeedsWouldBeLost.value) {
    return 'Save the inline rows as a tuple set first — a benchmark’s tabular axis names a saved tuple set, '
      + 'and running the version’s stored seeds instead would measure something else.';
  }
  return null;
});

function createFromRecipe(target: CreateTarget) {
  if (target === 'test') return saveAsTest();
  return saveAsBenchmark();
}

async function saveAsBenchmark() {
  if (benchmarkDisabledReason.value || savingBenchmark.value) return;

  const tupleSetId = tupleSource.value === 'saved'
    ? tupleSetOptions.value.find((option) => option.versionId === tupleSetVersionId.value)?.tupleSetId ?? null
    : null;
  const dataGraphId = dataSource.value === 'saved'
    ? dataGraphOptions.value.find((option) => option.versionId === dataGraphVersionId.value)?.graphId ?? null
    : null;

  savingBenchmark.value = true;
  try {
    const experiment = await benchmarksStore.createExperiment({
      name: `${ruleSetName.value.trim() || 'Rule set'} — inputs`,
      description: null,
      status: 'Active',
    });
    await benchmarksStore.createVersion(experiment.id, {
      subjectSpecs: [{
        subject: selectedVersionId.value!,
        // No `backends` key at all rather than an empty list: the store axis is
        // collapsed for a rule set, and the API refuses a spec that names one.
        inputs: [tupleSetId ?? NO_ARGUMENTS_IRI],
        ...(dataGraphId ? { dataGraphs: [dataGraphId] } : {}),
      }],
      ...emptySettings(),
    });
    toast.success('Created a benchmark from this recipe — press Run on it to collect timings');
    emit('open-benchmark', experiment.id);
  } catch (error) {
    console.error('[RuleSetWorkArea] Failed to create a benchmark:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to create a benchmark');
  } finally {
    savingBenchmark.value = false;
  }
}

/**
 * Save inline data to the library as a DataGraph.
 *
 * Inline content is scratch, and the Inputs tab is where someone looks at it
 * long enough to want it kept. Saving swaps the selection over to the version
 * that was just written, so the next run is reproducible and the same bytes are
 * not held in two places.
 */
async function saveInlineDataGraph() {
  const content = dataGraphInline.value.trim();
  if (!content) return;
  const libraryId = isScratch.value ? activeLibraryId.value : (ruleSetLibraryId.value || activeLibraryId.value);
  if (!libraryId) {
    toast.error('Choose a library before saving a data graph.');
    return;
  }

  savingDataGraph.value = true;
  try {
    const name = (ruleSetName.value.trim() || 'Data graph') + ' data';
    // `request` returns the envelope (etag, last-modified); the entity is `.data`.
    const { data: graph } = await apiClient.createDataGraph({ name, isPartOf: [libraryId] });
    const { data: version } = await apiClient.createDataGraphVersion(graph.id, {
      contentString: content,
      contentFormat: dataGraphInlineFormat.value,
    });
    dataGraphInline.value = '';
    dataGraphVersionId.value = version.id;
    dataSource.value = 'saved';
    await loadDataGraphOptions();
    toast.success(`Saved “${name}” as a data graph`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save the data graph';
    toast.error(message);
  } finally {
    savingDataGraph.value = false;
  }
}

onMounted(() => {
  if (props.ruleSetId && !isScratch.value) loadRuleSet(props.ruleSetId);
  void loadDataGraphOptions();
  void loadTupleSetOptions();
});

// The list is library-scoped, so it follows the library the way every other
// library-scoped list does.
watch([activeLibraryId, ruleSetLibraryId], () => {
  void loadDataGraphOptions();
  void loadTupleSetOptions();
});

onUnmounted(() => {
  if (draftSaveHandle) {
    clearTimeout(draftSaveHandle);
    draftSaveHandle = null;
    // A pending save that never lands is the last half-second of typing, gone.
    if (!isScratch.value && ruleSetIdValue.value && !documentMatchesVersion()) persistDraft();
  }
});

// A scratch document's "saved locally" line reads from the scratch record; a
// saved one's from its draft. One footer, two sources, same meaning.
watch(scratchSavedAt, (value) => {
  if (isScratch.value) locallySavedAt.value = value;
});
</script>

<style scoped>
.ruleset-work-area {
  position: relative;
  display: flex;
  height: 100%;
  background: var(--surface-raised);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

.left-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--surface);
  overflow: hidden;
  transition: width 0.3s ease;
  will-change: width;
}

/* Disable the transition while actively resizing, for immediate feedback. */
.left-panel.resizing {
  transition: none;
}

.right-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 48px;
  background: var(--surface);
  border-left: 1px solid var(--border-default);
  overflow: hidden;
  transition: flex 0.3s ease, min-width 0.3s ease;
}

.right-panel.collapsed {
  flex: 0 0 48px;
  max-width: 48px;
}

.vertical-resizer {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 8px;
  background: var(--surface-raised);
  cursor: col-resize;
  transition: opacity 0.3s ease, width 0.3s ease;
}

.vertical-resizer.hidden {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.vertical-resizer:hover {
  background: var(--action);
}

.vertical-resizer .resizer-handle {
  width: 2px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--gray-600);
  pointer-events: none;
}

.vertical-resizer:hover .resizer-handle {
  background: var(--surface);
}

</style>
