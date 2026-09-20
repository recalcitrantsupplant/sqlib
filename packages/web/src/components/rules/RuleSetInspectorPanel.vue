<script lang="ts">
/**
 * The rule set inspector: what the document is, what it runs against, and what
 * is derived from it.
 *
 * Details · Inputs · Stratification · SPARQL · Results — the same right-hand
 * panel the query work area uses, with the tabs a rule set has instead of the
 * tabs a query has.
 *
 * **Inputs is the default.** Opening a rule set, the next thing you want is to
 * run it against something.
 *
 * There is no Rules tab. Everything it held exists better elsewhere: its
 * outline duplicated the document already on screen, jumping to a rule is what
 * the gutter and the graph nodes do, its strata counts are in the Stratification
 * header, and the rule-tuples extension toggle is document metadata, so it is
 * in Details.
 */
export interface RuleSetDetailsProps {
  name: string;
  description: string;
  isScratch: boolean;
  entityId: string | null;
  versionOptions: DetailsVersionOption[];
  selectedVersion: string | null;
  currentVersion: string | null;
  /** True once there is a saved rule set whose versions can carry a note. */
  canAnnotateVersions: boolean;
  editCount: number;
  draftSavedAt: string | null;
  draftSelected: boolean;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { Extension } from '@codemirror/state';
import InspectorPanel, { type InspectorTab } from '../shared/InspectorPanel.vue';
import CodeSnippetPanel from '../shared/CodeSnippetPanel.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import type { SnippetRequest } from '@/lib/codeSnippets';
import EntityDetailsPanel, { type DetailsVersionOption } from '../shared/EntityDetailsPanel.vue';
import RuleSetExecutionResults from '../RuleSetExecutionResults.vue';
import SubjectTestsPanel from '../tests/SubjectTestsPanel.vue';
import { useTestsSurface } from '@/composables/useTestsSurface';
import { useInputSections } from '@/composables/useInputSections';
import { useFeatureFlags } from '../../composables/useFeatureFlags';
import RuleSetInputsPanel, { type InputSource } from './RuleSetInputsPanel.vue';
import RuleSetSparqlPanel from './RuleSetSparqlPanel.vue';
import StratificationPanel, {
  type StratificationPanelEdge,
  type StratificationPanelNode,
} from './StratificationPanel.vue';
import type { DataGraphFormat, DataGraphOption, TupleSetOption } from '@/types/data-graphs';
import type { SrlDocumentBlock, SrlStratificationSummary } from '@/composables/useApiClient';

const props = withDefaults(defineProps<{
  details: RuleSetDetailsProps;
  /** Every rule and DATA block of the document, in document order. */
  blocks: SrlDocumentBlock[];
  stratification: SrlStratificationSummary | null;
  /** The document itself — the SPARQL tab compiles it. */
  document: string;
  tuplesEnabled: boolean;
  documentValid: boolean;
  /** False for a scratch rule set: nothing on the server to delete. */
  canDelete?: boolean;
  /** True while a delete is in flight, for the confirm button's label. */
  deleting?: boolean;

  /** The DAG, with each rule's source for the inspector. */
  graphNodes: StratificationPanelNode[];
  graphEdges: StratificationPanelEdge[];
  analysedAt?: string | null;

  /** Inputs: what a run is given. */
  tupleSetOptions: TupleSetOption[];
  dataGraphOptions: DataGraphOption[];
  savedTuplePreview: string;
  savedDataPreview: string;
  savingTuples?: boolean;
  savingData?: boolean;
  savingTest?: boolean;
  testDisabledReason?: string | null;

  // intentional any: the execution payload is schema-inferred at the call site
  // and shaped by RuleSetExecutionResults' own local interface.
  executionResult?: any;
  executedAt?: string | null;
  /** CodeMirror extensions for the read-only views (Stratification, SPARQL). */
  editorExtensions?: Extension[];
  /** And the editable ones, for the Inputs tab — the read-only set would make
   * an editor you cannot type into, which is exactly what it looks like. */
  inputEditorExtensions?: Extension[];
  /** The seed-rows editor's own set: `TUPLE( … )` is SRL, the graph beside it
   * is not, so the Inputs tab takes one language per box. */
  tupleEditorExtensions?: Extension[];
  /** The saved rule set's id, or null on a scratch document. */
  ruleSetId?: string | null;
  /**
   * The execute call for the Code tab, built by the work area from the same
   * fields Run sends — the panel only renders it.
   */
  codeRequest: SnippetRequest;
  codeDraftNote?: string | null;
  codeUnavailable?: string | null;
}>(), {
  analysedAt: null,
  savingTuples: false,
  savingData: false,
  savingTest: false,
  testDisabledReason: null,
  executionResult: null,
  ruleSetId: null,
  codeDraftNote: null,
  codeUnavailable: null,
  executedAt: null,
  editorExtensions: () => [],
  inputEditorExtensions: () => [],
  tupleEditorExtensions: () => [],
});

const emit = defineEmits<{
  (e: 'update:activeTab', value: string): void;
  (e: 'update:collapsed', value: boolean): void;
  (e: 'update:detailsName', value: string): void;
  (e: 'update:detailsDescription', value: string): void;
  (e: 'update:tuplesEnabled', value: boolean): void;
  (e: 'select-version', value: string): void;
  (e: 'annotate-version', payload: { value: string; comment: string | null }): void;
  (e: 'select-draft'): void;
  (e: 'copy-id'): void;
  /** Delete lives in Details, beside the versions it destroys. */
  (e: 'delete'): void;
  /** Put the cursor on a line of the document — the graph nodes do this. */
  (e: 'go-to-line', line: number): void;
  /** A row in the Tests tab was clicked; the page decides where that goes. */
  (e: 'open-test', testId: string): void;
  (e: 'save-to-tuples'): void;
  (e: 'save-to-data'): void;
  (e: 'save-as-test'): void;
  (e: 'open-tuple-set', tupleSetId: string): void;
  (e: 'open-data-graph', graphId: string): void;
  (e: 'open-in-query', sparql: string): void;
}>();

const activeTab = defineModel<string>('activeTab', { default: 'inputs' });
const collapsed = defineModel<boolean>('collapsed', { default: false });

/*
 * The selected rule, shared with the editor. Clicking a node here and clicking
 * the footer's stratum chip are the same act on the same "current rule"; a
 * selection private to the graph would make them two.
 */
const selectedRuleId = defineModel<string | null>('selectedRuleId', { default: null });

/** Inputs: the pair a run is given, owned above and edited here. */
const tupleSource = defineModel<InputSource>('tupleSource', { default: 'inline' });
const tupleSetVersionId = defineModel<string | null>('tupleSetVersionId', { default: null });
const inlineTuples = defineModel<string>('inlineTuples', { default: '' });
const dataSource = defineModel<InputSource>('dataSource', { default: 'inline' });
const dataGraphVersionId = defineModel<string | null>('dataGraphVersionId', { default: null });
const dataGraphInline = defineModel<string>('dataGraphInline', { default: '' });
const dataGraphInlineFormat = defineModel<DataGraphFormat>('dataGraphInlineFormat', { default: 'text/turtle' });

const { testsEnabled, testSubject } = useTestsSurface();
const testSubjectId = testSubject(() => props.ruleSetId);

/*
 * The Inputs tab draws two doors into sections that are not this one, so it
 * asks the same question the ETL pipeline's tuple-set sink already asks. The
 * tab itself is never withheld: a rule set's tuple seeds and data graph are
 * inputs it has to run against, and a closed section does not take them away.
 */
const { sectionOpen } = useInputSections();

/*
 * The deployment's rule-tuples setting, distinct from this document's own
 * `tuplesEnabled`. With the extension withheld there is nothing to toggle, so
 * the control is absent rather than disabled: a switch that cannot move is a
 * worse answer than no switch. Every panel below is told the document has the
 * extension off, which is what the API now reports as well. See
 * `packages/api/src/lib/ruleTuples.ts`.
 */
const { isEnabled } = useFeatureFlags();
const ruleTuplesAllowed = computed(() => isEnabled('ruleTuples'));
const tuplesInEffect = computed(() => props.tuplesEnabled && ruleTuplesAllowed.value);
const tupleSetSectionOpen = sectionOpen('tupleSet');
const dataGraphSectionOpen = sectionOpen('dataGraph');

const tabs = computed<InspectorTab[]>(() => {
  const list: InspectorTab[] = [
    { id: 'details', label: 'Details' },
    { id: 'inputs', label: 'Inputs' },
    { id: 'stratification', label: 'Stratification' },
    { id: 'sparql', label: 'SPARQL' },
    { id: 'results', label: 'Results' },
    { id: 'code', label: 'Code' },
  ];
  // Only on a saved rule set: a test names a saved subject, so there is
  // nothing for the tab to list — or to point at — on a scratch document. The
  // same absence covers a build with the feature off; see `useTestsSurface`.
  if (testSubjectId.value) list.push({ id: 'tests', label: 'Tests' });
  return list;
});

const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);
defineExpose({ focusName: () => detailsPanelRef.value?.focusName() });

const ruleCount = computed(() => props.graphNodes.length);
const strataCount = computed(() => props.stratification?.strataCount ?? 0);

/*
 * The checkbox has already flipped itself in the DOM by the time the change
 * event fires, and the work area may refuse the change (turning the extension
 * off with TUPLE(…) still in the document). A refusal leaves the bound state
 * unchanged, so Vue has nothing to re-render and the control would go on
 * claiming the extension is off while it is on — put it back by hand.
 */
const onTuplesChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  emit('update:tuplesEnabled', input.checked);
  await nextTick();
  input.checked = props.tuplesEnabled;
};
</script>

<template>
  <InspectorPanel
    v-model:active-tab="activeTab"
    v-model:collapsed="collapsed"
    :tabs="tabs"
    testid="rules-inspector"
  >
    <!-- Details -->
    <template #details>
      <div class="tab-pane scrollable">
        <EntityDetailsPanel
          ref="detailsPanelRef"
          v-bind="details"
          entity-noun="rule set"
          taggable-kind="ruleSet"
          :show-backend="false"
          :show-signature="false"
          :can-delete="canDelete"
          :deleting="deleting"
          @update:name="(value) => emit('update:detailsName', value)"
          @update:description="(value) => emit('update:detailsDescription', value)"
          @select-version="(value) => emit('select-version', value)"
          @annotate-version="(payload) => emit('annotate-version', payload)"
          @select-draft="emit('select-draft')"
          @copy-id="emit('copy-id')"
          @delete="emit('delete')"
        >
          <!--
            The rule-tuples extension is metadata about the document, not part
            of it, so it belongs here rather than above the editor: it changes
            what the grammar accepts, and with it whether other tools can read
            what you wrote.
          -->
          <div v-if="ruleTuplesAllowed" class="details-rule" />
          <section v-if="ruleTuplesAllowed" class="details-group">
            <SectionLabel>Document</SectionLabel>
            <label class="tuples-toggle" :class="{ on: tuplesEnabled }">
              <input
                type="checkbox"
                data-testid="tuples-toggle"
                :checked="tuplesEnabled"
                @change="onTuplesChange"
              />
              <span class="toggle-text">
                <span class="toggle-title">Rule tuples (extension)</span>
                <span class="toggle-hint">
                  {{
                    tuplesEnabled
                      ? 'TUPLE(…) accepted. The document is extended SRL — other tools will reject it.'
                      : 'Off — the document is conformant SRL. TUPLE(…) is a syntax error.'
                  }}
                </span>
              </span>
            </label>
          </section>
        </EntityDetailsPanel>
      </div>
    </template>

    <!-- Inputs: what the rule set is run against -->
    <template #inputs>
      <RuleSetInputsPanel
        v-model:tuple-source="tupleSource"
        v-model:tuple-set-version-id="tupleSetVersionId"
        v-model:inline-tuples="inlineTuples"
        v-model:data-source="dataSource"
        v-model:data-graph-version-id="dataGraphVersionId"
        v-model:data-graph-inline="dataGraphInline"
        v-model:data-graph-inline-format="dataGraphInlineFormat"
        :tuples-enabled="tuplesInEffect"
        :tuple-set-options="tupleSetOptions"
        :data-graph-options="dataGraphOptions"
        :saved-tuple-preview="savedTuplePreview"
        :saved-data-preview="savedDataPreview"
        :saving-tuples="savingTuples"
        :saving-data="savingData"
        :saving-test="savingTest"
        :tests-enabled="testsEnabled"
        :tuple-set-section-open="tupleSetSectionOpen"
        :data-graph-section-open="dataGraphSectionOpen"
        :test-disabled-reason="testDisabledReason"
        :editor-extensions="inputEditorExtensions"
        :tuple-editor-extensions="tupleEditorExtensions"
        @save-to-tuples="emit('save-to-tuples')"
        @save-to-data="emit('save-to-data')"
        @save-as-test="emit('save-as-test')"
        @open-tuple-set="(id) => emit('open-tuple-set', id)"
        @open-data-graph="(id) => emit('open-data-graph', id)"
      />
    </template>

    <!-- Stratification: the DAG and its inspector -->
    <template #stratification>
      <StratificationPanel
        v-model:selected-id="selectedRuleId"
        :nodes="graphNodes"
        :edges="graphEdges"
        :issues="stratification?.issues ?? []"
        :rule-count="ruleCount"
        :strata-count="strataCount"
        :computed-at="analysedAt"
        @go-to-line="(line) => emit('go-to-line', line)"
      />
    </template>

    <!-- SPARQL: the compiled programs -->
    <template #sparql>
      <RuleSetSparqlPanel
        :document="document"
        :document-valid="documentValid"
        :tuples-enabled="tuplesInEffect"
        :blocks="blocks"
        :active="activeTab === 'sparql'"
        :editor-extensions="editorExtensions"
        @open-in-query="(sparql) => emit('open-in-query', sparql)"
      />
    </template>

    <template #tests>
      <div class="tab-pane scrollable">
        <SubjectTestsPanel
          v-if="testSubjectId"
          :subject-id="testSubjectId"
          subject-noun="rule set"
          @open="(testId) => emit('open-test', testId)"
        />
      </div>
    </template>

    <template #results>
      <div class="tab-pane scrollable">
        <RuleSetExecutionResults
          :results="executionResult"
          :executed-at="executedAt"
          :tuples-enabled="tuplesInEffect"
        />
      </div>
    </template>

    <!-- Code -->
    <template #code>
      <CodeSnippetPanel
        :request="codeRequest"
        :draft-note="codeDraftNote"
        :unavailable="codeUnavailable"
      />
    </template>
  </InspectorPanel>
</template>

<style scoped>
.tab-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}

.tab-pane.scrollable {
  padding: var(--space-5);
  overflow: auto;
}

/* Matches EntityDetailsPanel's own groups, which this slot content sits among. */
.details-rule {
  height: 1px;
  background: var(--border-subtle);
}

.details-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.tuples-toggle {
  display: flex;
  gap: 9px;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  cursor: pointer;
}

.tuples-toggle.on {
  border-color: var(--warning-border);
  background: var(--warning-surface);
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.toggle-title {
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
}

.toggle-hint {
  color: var(--ink-muted);
  font-size: var(--text-body);
  line-height: 1.4;
}

.tuples-toggle.on .toggle-hint {
  color: var(--warning-ink);
}
</style>
