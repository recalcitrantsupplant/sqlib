<template>
  <div ref="workAreaRef" class="test-work-area">
    <div
      class="left-panel"
      :class="{ resizing: isResizingVertical }"
      :style="{ width: rightPanelCollapsed ? 'calc(100% - 48px)' : leftPanelWidth + '%' }"
    >
    <!--
      The run's own screen, in the pane the editor otherwise fills. Which of
      the two is showing is the sidebar's tab and nothing else; the inspector
      on the right is the same one either way, so Details and Code stay where
      they were while only the middle changes.
    -->
    <TestRunDetail
      v-if="runView && testId"
      :test-id="testId"
      :run="lastRun"
      :running="running || runBusy"
      @rerun="run"
      @open-config="emit('open-config')"
    />
    <template v-else>
    <SaveBar
      :title="testName"
      noun="test"
      :is-scratch="isScratch"
      :current-version-number="currentVersionNumber"
      :edit-count="editCount"
      :saving="isSaving"
      :can-save="canSave"
      :needs-name="!testName.trim()"
      :show-format="false"
      :show-diff="false"
      :show-edit="false"
      @save="save"
      @needs-name="promptForNameInDetails"
      @discard="discardDraft"
      @delete="removeTest"
    />

    <!--
      The run, as one sentence (design 3b) — the same row Queries, Groups,
      Rules and ETL carry, saying here what a test already is: a subject, some
      inputs and a store, frozen.

      Every term is a statement rather than a control. On the other screens the
      sentence *is* where the recipe is chosen; here the recipe is the document
      being edited below, and a second set of pickers over the same four fields
      would be two sources of truth for them. Pressing a term takes you to the
      field that owns it. There is no "create test / benchmark" pair for the
      same reason: this is the kept recipe.
    -->
    <ExpandRunStrip>
      <RunBar
        :running="running"
        :run-disabled="!testId"
        :run-title="testId ? 'Run this test' : 'Save the test before running it'"
        :inputs="runInputs"
        :backend="runStore"
        @run="run"
        @pick="showInputs"
      >
        <!--
          Beside Run, because it *is* a run: picking a format runs the test and
          hands back the report. The library keeps no run to export afterwards.
        -->
        <template #trailing>
          <TestReportExportMenu
            heading="Run and download this test"
            :busy="exporting"
            :disabled="!testId"
            disabled-reason="Publish the test before exporting a report"
            @export="exportReport"
          />
        </template>
      </RunBar>
    </ExpandRunStrip>

    <!--
      Subject, inputs, expectation, in that order and identical for every
      subject type. The page states values; what a field *means* is in the
      `i` beside its heading rather than standing beneath it — a page of
      permanent explanation reads as a page of caveats, and each caveat
      competes with the value it explains.
    -->
    <div class="editor-column">
        <!--
          Why Save is disabled, said rather than left to be inferred. A dead
          button with no reason is the worst of the three available outcomes;
          these are the server's own rules, so the sentence here is the sentence
          the save would have returned. It sits over the fields it is about now
          that the run is no longer beside them.
        -->
        <ul v-if="subject && saveProblems.length" class="save-problems" data-testid="test-save-problems">
          <li v-for="problem in saveProblems" :key="problem">{{ problem }}</li>
        </ul>

        <section class="block">
          <header class="block-head">
            <SectionLabel as="h3">Subject</SectionLabel>
            <InfoHint label="subject">{{ subjectHint }}</InfoHint>
            <div class="block-actions">
              <SegmentedToggle
                :model-value="subjectVersion ? 'pinned' : 'current'"
                :options="[
                  { value: 'current', label: 'Current', testId: 'test-subject-current' },
                  { value: 'pinned', label: 'Pinned', testId: 'test-subject-pinned', disabled: subjectVersionOptions.length === 0 },
                ]"
                group-label="Subject version"
                @update:model-value="(mode) => mode === 'pinned' ? pinLatestSubjectVersion() : (subjectVersion = null)"
              />
            </div>
          </header>

          <!--
            The kind first and on its own row, because it decides what the rest
            of the page *is*: the inputs below are a rule set's or a query's,
            not one form with parts greyed out. Locked once saved — the
            server refuses to repoint a saved test's subject, since every
            reference to a test means the thing it tests.
          -->
          <div class="kind-row">
            <SegmentedToggle
              :model-value="subjectKind"
              :options="subjectKindOptions"
              :disabled="!isScratch"
              group-label="What this test is testing"
              @update:model-value="(kind) => onSubjectKindChange(kind as SubjectKind)"
            />
            <span v-if="!isScratch" class="muted">Fixed once saved.</span>
          </div>

          <!--
            Name and Tags are the Details tab's, as on every other record page:
            what a test is called belongs with its versions and its id rather
            than in the middle of the thing it is testing, and two editors of
            one field is how one of them silently loses.
          -->
          <Toolbar variant="plain" wrap>
            <!--
              Labelled by the kind rather than "Subject", which the section
              above already says: with Name and Tags gone to Details this field
              is alone in the row, and a second "Subject" over it was the same
              word twice.
            -->
            <FormField :label="SUBJECT_NOUN[subjectKind]" grow>
              <SearchSelect
                test-id="test-subject"
                :disabled="!isScratch"
                :model-value="subject"
                :options="subjectSelectOptions"
                @update:model-value="(id) => (subject = id)"
              />
            </FormField>

            <FormField v-if="subjectVersion" label="Version" data-testid="test-subject-version-field">
              <select
                class="control"
                data-testid="test-subject-version"
                :value="subjectVersion"
                @change="(event) => (subjectVersion = (event.target as HTMLSelectElement).value || null)"
              >
                <option v-for="option in subjectVersionOptions" :key="option.id" :value="option.id">
                  v{{ option.version }}
                </option>
              </select>
            </FormField>
          </Toolbar>

          <!--
            Only while scratch, and only under the subject: this decides what
            the *first* save writes, and once the test exists its tags are the
            Details panel's — two editors of one field is how one of them
            silently loses, the same reason Name lives there and not here.
          -->
          <InheritTagsToggle
            v-if="isScratch"
            v-model="copySubjectTags"
            :tags="inheritedTags"
            :source-label="SUBJECT_NOUN[subjectKind].toLowerCase()"
          />
        </section>

        <!--
          The cases. One is the ordinary test; adding a second parametrises it,
          and the Inputs and Expectation below are the selected case's. They are
          one editor rather than two because a parametrised test is not a
          different kind of test — it is the same test with more rows.
        -->
        <section class="block">
          <header class="block-head">
            <SectionLabel as="h3">Cases</SectionLabel>
            <InfoHint label="cases">
              Each case runs the subject against its own inputs and is judged on
              its own expected result — changing the arguments changes what is
              correct. One case is an ordinary test.
            </InfoHint>
            <div class="block-actions">
              <button type="button" class="ghost-button" data-testid="test-add-case" @click="addCase">
                <Plus :size="13" />
                Add case
              </button>
            </div>
          </header>

          <div class="case-tabs" role="tablist" aria-label="Cases">
            <button
              v-for="(testCase, index) in cases"
              :key="index"
              type="button"
              role="tab"
              class="case-tab"
              :class="{ on: index === selectedCaseIndex }"
              :aria-selected="index === selectedCaseIndex"
              :data-testid="`test-case-tab-${index}`"
              @click="selectedCaseIndex = index"
            >
              <span
                v-if="lastRun?.cases[index]"
                class="case-dot"
                :class="lastRun.cases[index].passed ? 'case-dot-pass' : 'case-dot-fail'"
              ></span>
              {{ caseLabel(testCase, index) }}
              <span
                v-if="cases.length > 1"
                class="case-remove"
                :data-testid="`test-case-remove-${index}`"
                title="Remove this case"
                @click.stop="removeCase(index)"
              >×</span>
            </button>
          </div>

          <FormField v-if="cases.length > 1" label="Case name">
            <input
              class="control"
              data-testid="test-case-name"
              :value="activeCase.name"
              placeholder="What makes this case different"
              @input="(event) => (activeCase.name = (event.target as HTMLInputElement).value)"
            />
          </FormField>
        </section>

        <section class="block" ref="inputsBlockRef">
          <header class="block-head">
            <SectionLabel as="h3">Inputs</SectionLabel>
            <InfoHint label="inputs">
              The same slots for every subject type, per case. Empty means the
              subject's own default; only the slots that apply are live.
            </InfoHint>
            <div class="block-actions">
              <!--
                A tone, not a status: hermetic-or-integration is a kind, and
                this badge said `valid` for it only because the paint had no
                other way in. The colours are the ones it always had.
              -->
              <StatusBadge :tone="isHermetic ? 'success' : 'warning'" data-testid="test-hermetic">
                {{ isHermetic ? 'Hermetic · CI-runnable' : 'Integration' }}
              </StatusBadge>
              <InfoHint label="hermetic">
                Derived, not set: with no backend named the run happens in an
                ephemeral in-process store and is deterministic. Attach a backend
                and this reads Integration instead — as does any query group,
                whose nodes name their own backends, so the test's silence says
                nothing about where the run went.
              </InfoHint>
            </div>
          </header>

          <!--
            Where the query runs, when there is a choice to make. Only a query
            has one: a rule set runs in-process against its base graph, and a
            query group's nodes name their own backends. Two mutually exclusive
            stores rather than two fields, because picking one is what decides
            whether this test can run in CI.
          -->
          <div v-if="slots.exclusiveStore" class="kind-row">
            <SegmentedToggle
              v-model="storeMode"
              :options="STORE_MODE_OPTIONS"
              group-label="Where the query runs"
            />
          </div>

          <Toolbar variant="plain" wrap>
            <FormField
              v-if="slots.dataGraph && storeMode === 'dataGraph' && !argumentSetFillsGraph"
              :label="subjectKind === 'queryGroup' ? 'Graph (for a port the argument set leaves open)' : 'Data graph'"
              grow
            >
              <SearchSelect
                test-id="test-data-graph"
                aria-label="Data graph"
                placeholder="None"
                empty-label="None"
                :model-value="dataGraphVersion"
                :options="dataGraphSelectOptions"
                @update:model-value="(value) => (dataGraphVersion = value || null)"
              />
            </FormField>

            <!--
              An argument set may carry the graphs itself. When the chosen one
              does, the select above is absent rather than present and inert:
              a case graph is appended after the set's, so offering the field
              here would invite a run that supplies one graph more than the
              group declares inputs for.
            -->
            <p
              v-if="slots.dataGraph && storeMode === 'dataGraph' && argumentSetFillsGraph"
              class="hint"
              data-testid="test-graph-from-argument-set"
            >
              The argument set supplies the data graph.
            </p>

            <!-- Version-level, not per case: one test runs against one store. -->
            <FormField v-if="slots.backend && storeMode === 'backend'" label="Backend (all cases)" grow>
              <SearchSelect
                test-id="test-backend"
                aria-label="Backend"
                placeholder="None"
                empty-label="None"
                :model-value="backend"
                :options="backendSelectOptions"
                @update:model-value="(value) => (backend = value || null)"
              />
            </FormField>

            <FormField v-if="slots.argumentSet" :label="subjectKind === 'queryGroup' ? 'Arguments (start node)' : 'Argument set'" grow>
              <SearchSelect
                test-id="test-argument-set"
                aria-label="Argument set"
                placeholder="None"
                empty-label="None"
                :model-value="argumentSetVersion"
                :options="argumentSetSelectOptions"
                @update:model-value="(value) => (argumentSetVersion = value || null)"
              />
            </FormField>
          </Toolbar>

          <!--
            What the named inputs hold. Bounded rather than closed: the inputs
            are the premise and the expectation is the claim, so a premise that
            grew with its content would push the claim off the screen. A peek
            is a fixed height whatever is in it, and opens on the lines that
            say something.
          -->
          <InputPreview
            v-if="slots.dataGraph && storeMode === 'dataGraph' && dataGraphVersion"
            label="Data graph"
            :content="dataGraphContent.get(dataGraphVersion)?.text"
            :content-type="dataGraphContent.get(dataGraphVersion)?.format ?? 'text/turtle'"
            :meta="dataGraphContent.get(dataGraphVersion)?.meta"
            test-id="test-data-graph-preview"
            class="preview"
          />

          <InputPreview
            v-if="slots.argumentSet && argumentSetVersion"
            label="Arguments"
            :content="argumentSetContent.get(argumentSetVersion)?.text"
            content-type="application/json"
            :meta="argumentSetContent.get(argumentSetVersion)?.meta"
            test-id="test-argument-set-preview"
            class="preview"
          />

          <!--
            Named tuples, when the rule set has them.

            `tuplesEnabled` is a field on the rule set version, so a rule set
            that never opted into the tuples extension has no tuple store for
            seeds to go into: the box is absent rather than disabled, on the
            same rule as the input slots above. A greyed field reads as
            something broken; the truth is that this rule set has no such
            thing, and the switch that would change that is on the rule set,
            not here. Nothing stands in its place — an empty slot on a form
            that never showed the field needs no explaining.
          -->
          <FormField v-if="showTupleSeeds" label="Named tuples" as="div">
            <!-- Expand sits on the field's label row, not over the seeds. -->
            <template #actions>
              <ExpandButton
                v-if="!tupleSeedsExpanded"
                subject="the tuple seeds"
                testid="test-tuple-seeds-expand-button"
                @click="toggleTupleSeedsExpand"
              />
            </template>
            <ExpandableEditor
              :id="TUPLE_SEEDS_REGION_ID"
              title="Named tuples"
              testid="test-tuple-seeds-expand"
            >
              <CodeEditor
                v-model="tupleSeeds"
                content-type="application/sparql-query"
                placeholder="TUPLE(:reach, :a, :b)"
                test-id="test-tuple-seeds"
                min-height="96px"
                max-height="220px"
                :show-line-numbers="false"
                :expanded="tupleSeedsExpanded"
                :prefix-source="prefixSource"
              />
            </ExpandableEditor>
          </FormField>

          <!--
            The rows an ETL job's SQL reads.

            SQL rather than a table of values: the ETL sandbox leaves no file
            for a fixture to live in, and only DDL can say a column is
            DECIMAL(18,4) — which is most of what a column mapping is about.
          -->
          <FormField v-if="slots.sqlFixture" label="SQL fixture" as="div">
            <template #actions>
              <ExpandButton
                v-if="!sqlFixtureExpanded"
                subject="the SQL fixture"
                testid="test-sql-fixture-expand-button"
                @click="toggleSqlFixtureExpand"
              />
            </template>
            <ExpandableEditor
              :id="SQL_FIXTURE_REGION_ID"
              title="SQL fixture"
              testid="test-sql-fixture-expand"
            >
              <CodeEditor
                v-model="sqlFixture"
                content-type="text/x-sql"
                placeholder="CREATE TABLE orders AS SELECT * FROM (VALUES (1, 'a')) t(id, label)"
                test-id="test-sql-fixture"
                min-height="96px"
                max-height="220px"
                :show-line-numbers="false"
                :expanded="sqlFixtureExpanded"
              />
            </ExpandableEditor>
          </FormField>

          <!--
            A query group takes its input through its start node and nothing
            else, so there is no store to choose: saying that beats an empty
            panel a reader has to interpret.
          -->
          <p v-if="subjectKind === 'queryGroup'" class="muted">
            The group's nodes name their own backends, so this test supplies only
            what the start node declares.
          </p>
        </section>

        <!--
          What the subject actually says, under the inputs rather than over
          them.

          A test names a subject and a version; neither tells a reader what is
          being tested, and that is the first thing they want to know. It reads
          in the order the run happens in: here is what goes in, here is the
          thing it goes into, here is what should come out. The document is also
          the longest thing on the page and the one least often edited, so
          putting it above the inputs pushed the fields you actually change off
          the screen.
        -->
        <section v-if="subjectPreview" class="block">
          <CodePeek
            :label="SUBJECT_DOCUMENT_LABEL[subjectKind]"
            :content="subjectPreview.text"
            :content-type="SUBJECT_DOCUMENT_CONTENT_TYPE[subjectKind]"
            :meta="subjectPreview.meta"
            test-id="test-subject-preview"
          />
        </section>

        <section class="block block-grow">
          <header class="block-head">
            <SectionLabel as="h3">Expectation</SectionLabel>
            <InfoHint label="expectation">
              Comparators come from the subject's result kind, not its entity
              type: GRAPH for a rule set or a CONSTRUCT, BINDINGS for most
              queries, BOOLEAN for an ASK. Choose Smoke for "runs without error".
              ANALYSIS is the odd one — it asks whether a rule set's SRL document
              passes a check rather than what running it produces, so it is the
              only kind that can expect a document to be <em>rejected</em>.
            </InfoHint>
            <div class="block-actions">
              <FormField v-if="expectationKind === 'bindings'" label="Ordered" inline>
                <input
                  type="checkbox"
                  data-testid="test-ordered"
                  :checked="ordered"
                  @change="(event) => (ordered = (event.target as HTMLInputElement).checked)"
                />
              </FormField>
              <select
                class="control control-auto"
                data-testid="test-expectation-kind"
                :value="expectationKind"
                @change="(event) => (expectationKind = (event.target as HTMLSelectElement).value as ExpectationKind)"
              >
                <option
                  v-for="option in expectationKindOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <!--
                Expand joins the block's own header rather than hovering over
                the expectation: this row already says what kind of expectation
                this is, and enlarging it is the same sort of thing.
              -->
              <ExpandButton
                v-if="expectationKind !== 'smoke' && !expectedExpanded"
                subject="the expectation"
                testid="test-expected-expand-button"
                @click="toggleExpectedExpand"
              />
            </div>
          </header>

          <!--
            The expectation is the longest document on this page — a whole
            result set, written out — and the column it is written in is a
            third of the screen. It pops out over the page, with the run strip
            along with it, so what a run produced can be compared against it
            without leaving.
          -->
          <ExpandableEditor
            v-if="expectationKind !== 'smoke'"
            :id="EXPECTED_REGION_ID"
            title="Expectation"
            testid="test-expected-expand"
          >
            <CodeEditor
              v-model="expected"
              class="expected-editor"
              :content-type="expectedContentType"
              :placeholder="expectedPlaceholder"
              test-id="test-expected"
              min-height="220px"
              :expanded="expectedExpanded"
              :prefix-source="prefixSource"
            />
          </ExpandableEditor>
          <EmptyState
            v-else
            size="sm"
            title="Nothing is compared"
            description="A smoke test asserts only that the subject runs, converges and does not error."
          />
        </section>
    </div>
    </template>
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

    <!--
      The same inspector every other record page carries. The run is not one of
      its tabs: a verdict is read on the Runs tab, at the scope of the run that
      produced it, and this screen is the test as an editable object.
    -->
    <div class="right-panel" :class="{ collapsed: rightPanelCollapsed }">
      <InspectorPanel
        v-model:active-tab="activeTab"
        v-model:collapsed="rightPanelCollapsed"
        :tabs="inspectorTabs"
        testid="test-inspector"
      >
        <template #details>
          <EntityDetailsPanel
            ref="detailsPanelRef"
            v-bind="detailsProps"
            @update:name="testName = $event"
            @update:description="testDescription = $event"
            @select-version="selectVersion"
            @set-current-version="setCurrentVersion"
            @annotate-version="annotateVersion"
            @select-draft="selectDraft"
            @copy-id="copyTestId"
            @delete="removeTest"
          />
        </template>

        <!--
          Running a test is one call, and it is the call CI makes: the report
          formats the export menu offers are the same route under an Accept
          header, so both are here rather than only in a menu.
        -->
        <template #code>
          <CodeSnippetPanel
            :variants="codeVariants"
            :unavailable="codeUnavailable"
            arguments-hint="A test carries its own inputs — the call names the test and, optionally, the version to judge."
          />
        </template>
      </InspectorPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One test: a subject, its inputs, and what it should produce.
 *
 * Two columns, per the Tests mock: the test as an editable object, and the run
 * beside it. The verdict answers what the left column asks, so it sits next to
 * the question rather than under it — scrolling to find out whether it passed
 * is what this layout exists to avoid.
 *
 * The page states values. What a field *means* lives behind the `i` next to its
 * heading rather than standing under it, which is the mock's rule and the
 * Backends page's: a page of permanent explanation reads as a page of caveats,
 * and every caveat competes with the value it is explaining.
 *
 * The subject is chosen once, on a scratch test, and is read-only afterwards.
 * That is not a UI shortcut: the server refuses to repoint a saved test's
 * subject, because every reference to a test means the thing it tests, and
 * silently changing that keeps the history while changing the meaning.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { Plus } from '@lucide/vue';
import SaveBar from './shared/SaveBar.vue';
import EmptyState from './shared/EmptyState.vue';
import TestRunDetail from './tests/TestRunDetail.vue';
import FormField from './shared/FormField.vue';
import InfoHint from './shared/InfoHint.vue';
import InputPreview from './shared/InputPreview.vue';
import CodeEditor from './shared/CodeEditor.vue';
import { prefixSourceToken } from '@/lib/prefixSources';
import ExpandableEditor from './shared/ExpandableEditor.vue';
import ExpandButton from './shared/ExpandButton.vue';
import ExpandRunStrip from './shared/ExpandRunStrip.vue';
import { useEditorExpand } from '../composables/useEditorExpand';
import { useEditorAsPrefixTarget } from '../composables/usePrefixTarget';
import CodePeek from './shared/CodePeek.vue';
import CodeSnippetPanel, { type CodeSnippetVariant } from './shared/CodeSnippetPanel.vue';
import InspectorPanel, { type InspectorTab } from './shared/InspectorPanel.vue';
import EntityDetailsPanel from './shared/EntityDetailsPanel.vue';
import SearchSelect from './shared/SearchSelect.vue';
import InheritTagsToggle from './tags/InheritTagsToggle.vue';
import SectionLabel from './shared/SectionLabel.vue';
import SegmentedToggle from './shared/SegmentedToggle.vue';
import StatusBadge from './shared/StatusBadge.vue';
import Toolbar from './shared/Toolbar.vue';
import RunBar from './shared/RunBar.vue';
import TestReportExportMenu from './tests/TestReportExportMenu.vue';
import { downloadTextFile } from '../lib/downloadFile';
import { useTestRunScope } from '../composables/useTestRunScope';
import { usePanelResize } from '../composables/usePanelResize';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { TEST_REPORT_FORMATS } from '../lib/testReportFormats';
import type { TestReportFormat } from '../lib/testReportFormats';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import type { RunBarChoice, RunBarPick } from '../lib/runBar';
import { useTestsStore } from '@/composables/useTestsStore';
import { useQueriesStore } from '@/composables/useQueriesStore';
import { useQueryGroupsStore } from '@/composables/useQueryGroupsStore';
import { useRuleSetsStore } from '@/composables/useRuleSetsStore';
import { useEtlJobsStore } from '@/composables/useEtlJobsStore';
import { useBackendsStore } from '@/composables/useBackendsStore';
import { useApiClient, type TestRunResult, type TestVersion } from '@/composables/useApiClient';
import { useActiveLibrary } from '@/composables/useActiveLibrary';
import { useTagsStore } from '@/composables/useTagsStore';
import { useInheritedTags } from '@/composables/useInheritedTags';
import { taggableKindFor } from '@/composables/useEntityTags';
import { useScratchRecord } from '@/composables/useScratchRecord';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from '@/composables/useCallableDrafts';
import {
  FEATURE_FOR_SUBJECT_KIND,
  INPUTS_FOR_SUBJECT_KIND,
  SUBJECT_KINDS,
  checkSubjectKindInputs,
  type SubjectKind,
} from '@sparql-query-lib/types';

type ExpectationKind = 'graph' | 'bindings' | 'boolean' | 'analysis' | 'smoke';

/**
 * Which store a query test runs against.
 *
 * Not a stored field: it is `backend ? 'backend' : 'dataGraph'`, and the toggle
 * writes whichever half it names while clearing the other. Storing it would be
 * a third thing that can disagree with the two that already decide the answer.
 */
type StoreMode = 'dataGraph' | 'backend';

const props = defineProps<{
  testId?: string | null;
  scratchId?: string | null;
  /** Preselected subject, when the test is being written from a record page. */
  initialSubject?: { id: string; kind: SubjectKind } | null;
  /**
   * Show the run rather than the editor in the main pane.
   *
   * The Runs tab's screen for this row. It is a prop rather than a second
   * component beside this one because the inspector — Details and Code — is
   * the test's either way: swapping the whole screen took the tabs with it,
   * and the strip reappearing at whatever tab it had before is the thing this
   * avoids.
   */
  runView?: boolean;
  /** A run this screen did not start is still a run in progress. */
  runBusy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'scratch-saved', payload: { id: string; name: string; libraryId: string }): void;
  (e: 'test-deleted'): void;
  /** From the run's header: take me to this test's configuration. */
  (e: 'open-config'): void;
}>();

const testsStore = useTestsStore();
const runScope = useTestRunScope();
const queriesStore = useQueriesStore();
const queryGroupsStore = useQueryGroupsStore();
const ruleSetsStore = useRuleSetsStore();
const etlJobsStore = useEtlJobsStore();
const backendsStore = useBackendsStore();
const apiClient = useApiClient();
const draftsStore = useCallableDrafts();
const { activeLibraryId } = useActiveLibrary();

const testId = ref<string | null>(props.testId ?? null);
const testName = ref('');
const testDescription = ref('');
const testCreatedAt = ref<string | null>(null);
const isDeleting = ref(false);
/** The versions of this test, for the Details tab's list. */
const testVersions = ref<TestVersion[]>([]);
const currentVersionId = ref<string | null>(null);
/** Which version the editor was loaded from — the row Details highlights. */
const loadedVersionId = ref<string | null>(null);
const { isEnabled: featureEnabled } = useFeatureFlags();

const subject = ref<string | null>(props.initialSubject?.id ?? null);
/*
 * A new test starts on the kind it was opened for, or on the first kind this
 * build has. Rule sets are the default where they exist; a build with the rules
 * suite off would otherwise open every new test on a kind it cannot point at.
 */
const subjectKind = ref<SubjectKind>(
  props.initialSubject?.kind
  ?? (featureEnabled('rulesSuite')
    ? 'ruleSet'
    : (SUBJECT_KINDS.find(kind => featureEnabled(FEATURE_FOR_SUBJECT_KIND[kind])) ?? 'ruleSet')),
);

/**
 * Whether the first save should carry the subject's tags across.
 *
 * On by default, and it is the checkbox rather than this flag that does the
 * explaining — see `InheritTagsToggle`. What it controls is one field of the
 * create body: left ticked the body omits `tags` and the server copies, and
 * unticked it sends `[]`, which is the only way to tell a seeding server
 * "none". Nothing reads it after the test exists.
 */
const copySubjectTags = ref(true);

const tagsStore = useTagsStore();
const { inheritedTags } = useInheritedTags(
  // `taggableKindFor`, not the kind itself: an ETL job carries no tags, so
  // there is nothing for a test over one to inherit. Narrowed rather than cast
  // so adding tags to a kind is one entry in `TAGGABLE_KINDS` and nothing here.
  computed(() => (isScratch.value ? taggableKindFor(subjectKind.value) : null)),
  subject,
);
const backend = ref<string | null>(null);
const expectationKind = ref<ExpectationKind>('graph');
const currentVersionNumber = ref<number | null>(null);
const isSaving = ref(false);
const running = ref(false);
/*
 * A run that could not run at all. Not a verdict — the store has none to give
 * for it — so it is held here to blank the panel rather than leave the
 * previous answer standing under a failed attempt.
 */
const runErrored = ref(false);
const exporting = ref(false);
const dataGraphOptions = ref<Array<{ versionId: string; label: string }>>([]);
// `id` is the version a run names; `setId` is its parent, which is what the
// export route is keyed by.
const argumentSetOptions = ref<Array<{ id: string; setId: string; label: string }>>([]);
/** Version id -> how many graphs that set carries, so the case can stand down. */
const argumentSetGraphCount = ref<Record<string, number>>({});
const subjectVersionOptions = ref<Array<{ id: string; version: number }>>([]);
const subjectVersion = ref<string | null>(null);

/*
 * What the named inputs actually contain.
 *
 * Fetched rather than derived: a test names versions, and the bytes behind a
 * version id are not otherwise on this page. Kept beside the selects they
 * explain so "what is this running against?" — the question a reader of a test
 * nearly always has — is answered without navigating away from the answer.
 */
const subjectPreview = ref<{ text: string; meta: string } | null>(null);
const dataGraphContent = ref(new Map<string, { text: string; meta: string; format: string | null }>());
const argumentSetContent = ref(new Map<string, { text: string; meta: string }>());

/**
 * Whether the subject rule set opted into the rule-tuples extension.
 *
 * `null` until the subject has been read, or when the subject is not a rule
 * set. Read from the same SRL export the preview comes from — the field is on
 * the rule set *version*, so this follows a pinned version rather than the
 * rule set's current switch, which is the whole point of pinning.
 */
const subjectTuplesEnabled = ref<boolean | null>(null);

/**
 * One parametrised case: its inputs, and what is correct given them.
 *
 * A test always has at least one. One case is the ordinary single test; adding
 * a second is `@pytest.mark.parametrize` — and the expectation moves with the
 * inputs because changing the arguments changes what is correct.
 */
interface CaseDraft {
  name: string;
  dataGraphVersion: string | null;
  argumentSetVersion: string | null;
  tupleSeeds: string;
  /** DuckDB statements run before an ETL subject's own SQL — the rows it reads. */
  sqlFixture: string;
  expected: string;
  /**
   * The serialisation `expected` is written in.
   *
   * Carried through the editor untouched rather than exposed as a field: it is
   * set by whatever wrote the case — the W3C suite seeds Turtle — and dropping
   * it on an edit would turn a passing test red for a reason the author never
   * touched.
   */
  expectedFormat: string | null;
  ordered: boolean;
}

function emptyCase(): CaseDraft {
  return {
    name: '',
    dataGraphVersion: null,
    argumentSetVersion: null,
    tupleSeeds: '',
    sqlFixture: '',
    expected: '',
    expectedFormat: null,
    ordered: false,
  };
}

const cases = ref<CaseDraft[]>([emptyCase()]);
const selectedCaseIndex = ref(0);

const activeCase = computed(() => cases.value[selectedCaseIndex.value] ?? cases.value[0]);

/**
 * The selected case's fields, as writable refs.
 *
 * The editor below is the same one whether a test has one case or six; only
 * *which* case it is pointed at changes. Proxying keeps that true without a
 * second set of controls for the parametrised shape.
 */
function caseField<K extends keyof CaseDraft>(key: K) {
  return computed({
    get: () => activeCase.value[key],
    set: (value: CaseDraft[K]) => { activeCase.value[key] = value; },
  });
}

const dataGraphVersion = caseField('dataGraphVersion');
const argumentSetVersion = caseField('argumentSetVersion');
const tupleSeeds = caseField('tupleSeeds');
const sqlFixture = caseField('sqlFixture');
const expected = caseField('expected');

const ordered = caseField('ordered');

function addCase() {
  // Seeded from the case in view rather than empty: a second case usually
  // varies one input, and retyping the rest is how a "parametrised" test
  // becomes two unrelated ones.
  cases.value = [...cases.value, { ...activeCase.value, name: '' }];
  selectedCaseIndex.value = cases.value.length - 1;
}

function removeCase(index: number) {
  // Never to zero: a test with no cases runs nothing, and the single-case test
  // is the ordinary shape rather than a special one.
  if (cases.value.length <= 1) return;
  cases.value = cases.value.filter((_, position) => position !== index);
  selectedCaseIndex.value = Math.min(selectedCaseIndex.value, cases.value.length - 1);
}

function caseLabel(testCase: CaseDraft, index: number) {
  return testCase.name.trim() || `Case ${index + 1}`;
}

interface ScratchBody {
  subject?: string | null;
  subjectKind?: SubjectKind;
  subjectVersion?: string | null;
  backend?: string | null;
  expectationKind?: ExpectationKind;
  cases?: CaseDraft[];
}

/*
 * An expected graph declares its prefixes like any other document here, so it
 * teaches them like any other document here.
 */
const prefixSource = computed(() =>
  prefixSourceToken('test', props.scratchId ?? testId.value ?? null),
);

const { isScratch } = useScratchRecord({
  scratchId: () => props.scratchId ?? null,
  missingMessage: 'That scratch test is not in this browser',
  track: [testName, subject, subjectKind, subjectVersion, backend, expectationKind, cases],
  hydrate: (record) => {
    const body = (record.body ?? {}) as ScratchBody;
    testName.value = record.name;
    subject.value = body.subject ?? null;
    subjectKind.value = body.subjectKind ?? 'ruleSet';
    subjectVersion.value = body.subjectVersion ?? null;
    backend.value = body.backend ?? null;
    expectationKind.value = body.expectationKind ?? 'graph';
    cases.value = body.cases?.length ? body.cases.map(testCase => ({ ...emptyCase(), ...testCase })) : [emptyCase()];
    selectedCaseIndex.value = 0;
  },
  collect: (record) => ({
    name: testName.value || record.name,
    body: {
      subject: subject.value,
      subjectKind: subjectKind.value,
      subjectVersion: subjectVersion.value,
      backend: backend.value,
      expectationKind: expectationKind.value,
      cases: cases.value,
    },
  }),
});

const subjectOptions = computed(() => {
  const libraryId = activeLibraryId.value;
  const inLibrary = (entity: { isPartOf?: string | string[] | null }) => {
    if (!libraryId) return true;
    const value = entity.isPartOf;
    return Array.isArray(value) ? value.includes(libraryId) : value === libraryId;
  };
  switch (subjectKind.value) {
    case 'query':
      return queriesStore.queries.value.filter(inLibrary);
    case 'queryGroup':
      return queryGroupsStore.queryGroups.value.filter(inLibrary);
    case 'ruleSet':
      return ruleSetsStore.ruleSets.value.filter(inLibrary);
    case 'etlJob':
      // An ETL job records its libraries as `libraryIds` rather than
      // `isPartOf`, so it is reshaped here rather than teaching `inLibrary` a
      // second spelling that only one caller uses.
      return etlJobsStore.etlJobs.value
        .filter(job => !libraryId || job.libraryIds.includes(libraryId))
        .map(job => ({ id: job.id, name: job.name, isPartOf: libraryId ?? null }));
  }
});

/* The chooser wants flat value/label pairs, and it types to filter them. */
const subjectSelectOptions = computed(() =>
  subjectOptions.value.map((option) => ({ value: option.id, label: option.name || option.id })),
);

const backendOptions = computed(() => backendsStore.backends.value);

/*
 * The other three inputs a case names are chosen the same way as the subject:
 * every one of them is a hand-named entity out of a library that grows, so
 * every one is typed at rather than scrolled through. Versions stay a native
 * select — they are a short list of numbers, and there is nothing to spell.
 */
const backendSelectOptions = computed(() =>
  backendOptions.value.map((option) => ({ value: option.id, label: option.name })),
);
const dataGraphSelectOptions = computed(() =>
  dataGraphOptions.value.map((option) => ({ value: option.versionId, label: option.label })),
);
const argumentSetSelectOptions = computed(() =>
  argumentSetOptions.value.map((option) => ({ value: option.id, label: option.label })),
);

/* ------------------------------------------------------------------ *
 * What this kind of subject takes as input.
 *
 * Read from the same table the writer refuses versions with
 * (`INPUTS_FOR_SUBJECT_KIND`), so the page cannot offer a slot the server
 * rejects. Slots that do not apply are *absent* rather than disabled: a greyed
 * "Argument set" on a rule-set test reads as something broken, when the truth
 * is that a rule set has no such thing.
 * ------------------------------------------------------------------ */

const slots = computed(() => INPUTS_FOR_SUBJECT_KIND[subjectKind.value]);

/** What the subject itself is called, per kind — the field's label. */
const SUBJECT_NOUN: Record<SubjectKind, string> = {
  query: 'Query',
  ruleSet: 'Rule set',
  queryGroup: 'Query group',
  etlJob: 'ETL job',
};

/** What the subject's own document is called, per kind. */
const SUBJECT_DOCUMENT_LABEL: Record<SubjectKind, string> = {
  query: 'Query text',
  ruleSet: 'Rules',
  queryGroup: 'Query group',
  etlJob: 'SQL',
};

/**
 * What language the preview beside the subject is written in.
 *
 * A group has no single document and never reaches the preview, so its entry is
 * the one that never renders; it is listed anyway because a `Record` that has to
 * be complete is what makes a new kind a compile error rather than a document
 * coloured as the wrong language.
 */
const SUBJECT_DOCUMENT_CONTENT_TYPE: Record<SubjectKind, string> = {
  query: 'application/sparql-query',
  ruleSet: 'application/srl',
  queryGroup: 'application/srl',
  etlJob: 'text/x-sql',
};

const SUBJECT_KIND_OPTIONS = [
  { value: 'query', label: 'Queries', testId: 'test-kind-query' },
  { value: 'ruleSet', label: 'Rules', testId: 'test-kind-ruleSet' },
  { value: 'queryGroup', label: 'Query groups', testId: 'test-kind-queryGroup' },
  { value: 'etlJob', label: 'ETL jobs', testId: 'test-kind-etlJob' },
] as const;

/**
 * The kinds this build can actually test.
 *
 * A kind whose feature is off has nothing to point at — the chooser under it
 * would be empty and the API refuses the test — so it is absent rather than
 * offered. The kind a *saved* test already carries stays listed whatever the
 * flags say: the toggle is fixed once saved, and dropping the option would
 * leave the row showing none of its choices selected.
 */
const subjectKindOptions = computed(() => SUBJECT_KIND_OPTIONS.filter(
  option => featureEnabled(FEATURE_FOR_SUBJECT_KIND[option.value]) || option.value === subjectKind.value,
));

/**
 * Which expectations this kind of subject can be judged by.
 *
 * An ETL job produces the RDF its template constructs and nothing else, so the
 * other comparators have nothing to compare — the runner refuses them by name.
 * Absent rather than offered-and-rejected, on the same rule as the input slots.
 */
const EXPECTATION_KIND_OPTIONS = [
  { value: 'graph', label: 'GRAPH — isomorphic' },
  { value: 'bindings', label: 'BINDINGS' },
  { value: 'boolean', label: 'BOOLEAN' },
  { value: 'analysis', label: 'ANALYSIS — document check' },
  { value: 'smoke', label: 'Smoke' },
] as const;

const ETL_EXPECTATION_KINDS: readonly ExpectationKind[] = ['graph', 'smoke'];

const expectationKindOptions = computed(() =>
  subjectKind.value === 'etlJob'
    ? EXPECTATION_KIND_OPTIONS.filter(option => ETL_EXPECTATION_KINDS.includes(option.value))
    : EXPECTATION_KIND_OPTIONS,
);

/**
 * Which store the query runs against, derived from the backend rather than
 * stored — see `StoreMode`. A rule set and a query group have no choice to
 * make, so the toggle is only rendered for a query.
 */
const storeMode = computed<StoreMode>({
  get: () => (backend.value ? 'backend' : 'dataGraph'),
  set: (mode: StoreMode) => {
    if (mode === 'backend') {
      // The data graphs go with it. Leaving them would store inputs nothing
      // reads and leave the version invalid on the server's own rule.
      cases.value = cases.value.map(testCase => ({ ...testCase, dataGraphVersion: null }));
      backend.value = backendOptions.value[0]?.id ?? null;
      return;
    }
    backend.value = null;
  },
});

const STORE_MODE_OPTIONS = [
  { value: 'dataGraph', label: 'Data graph', testId: 'test-store-dataGraph', title: 'Load a saved graph into an in-process store and run against that. Deterministic, and runnable in CI.' },
  { value: 'backend', label: 'Backend', testId: 'test-store-backend', title: 'Run against a live endpoint. Depends on what that endpoint holds when the test runs.' },
] as const;

/** Hermetic is a fact about the inputs, not a setting — see the runner. */
/* ------------------------------------------------------------------ *
 * The run sentence (design 3b)
 * ------------------------------------------------------------------ */

const inputsBlockRef = ref<HTMLElement | null>(null);

/** Every term of the sentence is owned by a field in the Inputs block. */
const editorExpansion = useEditorExpand();

/*
 * Both pop-outs on this screen are named, because the buttons that open them
 * are no longer inside them: Expand sits in the header row above each editor —
 * the field's label row for the seeds, the block's header for the expectation
 * — and a row above a region can only address it by id.
 */
const TUPLE_SEEDS_REGION_ID = 'test-tuple-seeds-region';
const SQL_FIXTURE_REGION_ID = 'test-sql-fixture-region';
const EXPECTED_REGION_ID = 'test-expected-region';

const tupleSeedsExpanded = computed(() => editorExpansion.isExpanded(TUPLE_SEEDS_REGION_ID));
const toggleTupleSeedsExpand = () => editorExpansion.toggle(TUPLE_SEEDS_REGION_ID);

const sqlFixtureExpanded = computed(() => editorExpansion.isExpanded(SQL_FIXTURE_REGION_ID));
const toggleSqlFixtureExpand = () => editorExpansion.toggle(SQL_FIXTURE_REGION_ID);

const expectedExpanded = computed(() => editorExpansion.isExpanded(EXPECTED_REGION_ID));
const toggleExpectedExpand = () => editorExpansion.toggle(EXPECTED_REGION_ID);

function showInputs() {
  // Scrolling the page behind a popped-out editor moves nothing anyone can
  // see, so the pop-out closes first.
  editorExpansion.collapse();
  inputsBlockRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const argumentSetLabel = computed(() =>
  argumentSetOptions.value.find((option) => option.id === argumentSetVersion.value)?.label ?? '');

const dataGraphLabel = computed(() =>
  dataGraphOptions.value.find((option) => option.versionId === dataGraphVersion.value)?.label ?? '');

/**
 * The "with" clause, from the slots this subject kind actually accepts.
 *
 * A slot that cannot apply is absent rather than empty — the same rule the
 * Inputs block follows, and for the same reason: a greyed term reads as
 * "broken" where the truth is "not a thing for this kind of subject".
 */
const runInputs = computed<RunBarPick[]>(() => {
  const picks: RunBarPick[] = [];
  if (slots.value.argumentSet) {
    picks.push({
      key: 'arguments',
      kind: 'arguments',
      value: argumentSetLabel.value,
      empty: !argumentSetLabel.value,
      icon: 'arguments',
      title: 'The argument set this case runs with — set it in Inputs',
    });
  }
  // Tuples before data, the order the rules screen says the same pair in.
  // `showTupleSeeds`, not `slots.tupleSeeds`: a rule set that never opted into
  // the extension has no seed store, and the Inputs block draws no box for it —
  // the sentence must not name a slot the page below says is not there.
  if (showTupleSeeds.value) {
    picks.push({
      key: 'tuples',
      kind: 'tuples',
      value: tupleSeeds.value?.trim() ? 'inline' : '',
      empty: !tupleSeeds.value?.trim(),
      icon: 'tuples',
      title: 'The tuple seeds this case runs with — set them in Inputs',
    });
  }
  // The ETL twin of the seeds above: the rows the subject reads. Same icon,
  // because it is the same term of the sentence — tabular input — spelled the
  // way this kind of subject spells it.
  if (slots.value.sqlFixture) {
    picks.push({
      key: 'fixture',
      kind: 'fixture',
      value: sqlFixture.value?.trim() ? 'inline SQL' : '',
      empty: !sqlFixture.value?.trim(),
      icon: 'tuples',
      title: 'The SQL fixture this case runs with — set it in Inputs',
    });
  }
  if (slots.value.dataGraph && storeMode.value === 'dataGraph') {
    picks.push({
      key: 'data',
      kind: 'data',
      value: dataGraphLabel.value,
      empty: !dataGraphLabel.value,
      icon: 'data',
      title: 'The data graph loaded into the ephemeral store — set it in Inputs',
    });
  }
  if (cases.value.length > 1) {
    picks.push({
      key: 'cases',
      value: `${cases.value.length} cases`,
      icon: 'cases',
      inert: true,
      title: 'Each case runs with its own inputs against the store named below',
    });
  }
  return picks;
});

/**
 * "against", stated rather than offered.
 *
 * Which store a test runs against is the difference between a hermetic run and
 * an integration one, and it is chosen in the Inputs block where the toggle
 * that decides it lives. Here it only has to be true.
 */
const runStore = computed<RunBarChoice>(() => {
  if (backend.value) {
    const name = backendOptions.value.find((option) => option.id === backend.value)?.name ?? backend.value;
    return {
      value: backend.value,
      options: [],
      readonly: true,
      label: name,
      title: 'A live endpoint. This test is an integration test — what it asserts depends on '
        + 'what that endpoint holds when it runs.',
    };
  }
  return {
    value: 'ephemeral',
    options: [],
    readonly: true,
    label: 'Ephemeral Oxigraph',
    title: slots.value.backend
      ? 'No backend named, so the run happens in an in-process store seeded with the case\u2019s '
        + 'data graph. That is what makes this test hermetic.'
      : 'This kind of subject names no backend on the test — it runs in-process, or its own nodes '
        + 'name the endpoints.',
  };
});

const isHermetic = computed(() => {
  // A query group names no backend because its *nodes* do, so the test's
  // silence says nothing about where the run went. The runner reports these as
  // integration for the same reason.
  if (subjectKind.value === 'queryGroup') return false;
  return !backend.value;
});

/**
 * Whether to offer tuple seeds for this subject.
 *
 * The slot table says a rule set takes them; the rule set itself says whether
 * it has a tuple store to put them in. Both have to agree, and while the
 * subject is still being read (`null`) the box stays — a field that appears a
 * moment after the page settles is worse than one that was always there.
 */
const showTupleSeeds = computed(() => (
  // A third condition, and the only one that does not depend on the subject:
  // a build that withholds the rule-tuples extension has no seeds to take, and
  // the API refuses a test case that carries them.
  featureEnabled('ruleTuples')
  && slots.value.tupleSeeds
  && subjectTuplesEnabled.value !== false
));

/**
 * What the expectation is written in, so the editor colours it as the language
 * it is.
 *
 * GRAPH is compared as RDF and written as Turtle; BINDINGS is a SPARQL results
 * document and ANALYSIS is the check's own JSON. BOOLEAN is the word `true` or
 * `false`, which no grammar improves.
 */
const expectedContentType = computed(() => {
  switch (expectationKind.value) {
    case 'graph':
      return 'text/turtle';
    case 'bindings':
    case 'analysis':
      return 'application/json';
    default:
      return null;
  }
});

/*
 * Where the Prefix Manager's "Add to editor" lands on this screen: the
 * expectation, which is the document written out here. It takes prefixes only
 * while it is one — a graph expectation is Turtle; bindings and analysis are
 * JSON, and a smoke test has no expectation at all.
 */
useEditorAsPrefixTarget({
  label: 'the expectation',
  contentType: () => expectedContentType.value,
  read: () => expected.value,
  write: (text) => { expected.value = text; },
});

const expectedPlaceholder = computed(() => {
  switch (expectationKind.value) {
    case 'graph':
      return '<http://example/a> <http://example/reaches> <http://example/b> .';
    case 'bindings':
      return '{ "head": { "vars": ["s"] }, "results": { "bindings": [] } }';
    case 'boolean':
      return 'true';
    case 'analysis':
      return '{ "check": "syntax", "accepted": true }';
    default:
      return '';
  }
});

const subjectHint = computed(() =>
  subjectVersion.value
    ? 'Pinned: the test keeps judging the same version as the subject moves on — what a regression suite wants. Switch to Current to follow edits.'
    : 'Current: resolved at run time, so the test follows the subject as you edit it. Pin a version once the behaviour is settled.',
);

/* ------------------------------------------------------------- inspector */

/*
 * The same split every other work area drags on, with the same floors and the
 * same remembered width — a record page that resized differently from the one
 * beside it is the divergence users notice (`usePanelResize`).
 */
const workAreaRef = ref<HTMLElement | null>(null);
const {
  panelWidthPercent: leftPanelWidth,
  startResize: startVerticalResize,
  isResizing: isResizingVertical,
  collapsed: rightPanelCollapsed,
  resetWidth: resetPanelWidth,
} = usePanelResize({
  containerRef: workAreaRef,
  storageKey: 'test',
  collapsible: true,
  initialWidthPercent: 68,
});

/* Details first: opening a test, the question is what this is. */
const activeTab = ref('details');

const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'details', label: 'Details' },
  { id: 'code', label: 'Code' },
]);

const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);

/** Save on an unnamed test sends you to the one field that names it. */
function promptForNameInDetails() {
  activeTab.value = 'details';
  rightPanelCollapsed.value = false;
  void nextTick(() => detailsPanelRef.value?.focusName());
}

/**
 * The version rows, newest first.
 *
 * Where the author left no comment the row says what the version *is* — how
 * many cases it judges and what it compares them as — which is the fact that
 * distinguishes two versions of a test.
 */
const versionOptions = computed(() =>
  [...testVersions.value]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      value: version.id,
      label: String(version.version),
      // The note and the stand-in for it are separate: editing a version
      // nobody commented starts from an empty field, not from the summary.
      comment: version.comment ?? null,
      summary: versionSummary(version),
      dateModified: version.dateModified ?? version.dateCreated ?? null,
    })),
);

function versionSummary(version: TestVersion) {
  const count = version.cases.length;
  return `${count} ${count === 1 ? 'case' : 'cases'} · ${version.expectationKind}`;
}

/*
 * The Details tab. One prop bag rather than a dozen props, as on the query and
 * rule set screens: it is a single view of this component's state.
 */
const detailsProps = computed(() => ({
  name: testName.value,
  description: testDescription.value,
  isScratch: isScratch.value,
  entityId: isScratch.value ? null : (testId.value || null),
  entityNoun: 'test',
  taggableKind: 'test' as const,
  // A test names no backend of its own — the version does, in Inputs — and
  // nothing detects a signature in an expectation.
  showBackend: false,
  showSignature: false,
  versionOptions: versionOptions.value,
  selectedVersion: loadedVersionId.value,
  currentVersion: currentVersionId.value,
  canSetCurrentVersion: !isScratch.value,
  canAnnotateVersions: !isScratch.value && !!testId.value,
  editCount: editCount.value,
  draftSavedAt: locallySavedAt.value,
  // The editor is showing the draft whenever its body has diverged from the
  // version it was loaded from — the same test the query screen makes.
  draftSelected: editCount.value > 0 && !matchesSaved(),
  createdAt: isScratch.value ? null : testCreatedAt.value,
  // A scratch test lives in this browser: Discard in the save bar is what
  // removes it, and there is no server entity for Delete to address.
  canDelete: !isScratch.value && !!testId.value,
  deleting: isDeleting.value,
}));

/** Read one of the saved versions back into the editor. */
function selectVersion(versionId: string) {
  const version = testVersions.value.find((candidate) => candidate.id === versionId);
  if (!version) return;
  hydratingRecord.value = true;
  applyEditorBody(bodyOfVersion(version));
  selectedCaseIndex.value = 0;
  loadedVersionId.value = version.id;
  void Promise.resolve().then(() => { hydratingRecord.value = false; });
  toast.success(`Loaded v${version.version} into the editor`);
}

/** Go back to the unsaved edits after reading an older version. */
function selectDraft() {
  const draft = openDraft.value?.body;
  if (!draft || typeof draft !== 'object') return;
  hydratingRecord.value = true;
  applyEditorBody(draft as TestDraftBody);
  loadedVersionId.value = currentVersionId.value;
  void Promise.resolve().then(() => { hydratingRecord.value = false; });
}

/**
 * Point the test at one of its versions.
 *
 * The editor keeps showing whatever it was showing: choosing which version a
 * run with no version named judges is not a request to read that version.
 */
async function setCurrentVersion(versionId: string) {
  if (!testId.value) return;
  try {
    await apiClient.updateTest(testId.value, { currentVersion: versionId } as never);
    currentVersionId.value = versionId;
    const version = testVersions.value.find((candidate) => candidate.id === versionId);
    if (version) currentVersionNumber.value = version.version;
    toast.success(version ? `v${version.version} is now current` : 'Current version updated');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to set the current version');
  }
}

/*
 * The note on a version, written from the row that displays it.
 *
 * Save collects nothing now — it is one click — so this is where a version
 * gets its comment, against the version it describes and at any time after it
 * exists. Optimistic, with the old note put back if the write fails.
 */
async function annotateVersion({ value, comment }: { value: string; comment: string | null }) {
  const id = testId.value;
  const version = testVersions.value.find((candidate) => candidate.id === value);
  if (!id || !version) return;

  const previous = version.comment ?? null;
  const apply = (next: string | null) => {
    testVersions.value = testVersions.value.map((entry) => (
      entry.id === value ? { ...entry, comment: next } : entry
    ));
  };
  apply(comment);

  try {
    await testsStore.annotateVersion(id, version.version, comment);
  } catch (error) {
    apply(previous);
    console.error('[TestWorkArea] Failed to save the version note', error);
    toast.error('Failed to save the note');
  }
}

async function copyTestId() {
  if (!testId.value) return;
  try {
    await navigator.clipboard.writeText(testId.value);
    toast.success('Test ID copied');
  } catch {
    toast.error('Could not copy the ID');
  }
}

/* ------------------------------------------------------------------ code */

/*
 * `POST /tests/{id}/run` — the call this screen's Run button makes, and the
 * one CI makes. The second variant is the same route under an `Accept`, which
 * is what the export menu sends: an export *is* a run, so it is one endpoint
 * with two readings rather than two calls.
 */
const config = useRuntimeConfig();

const runUrl = computed(() => {
  const apiBaseUrl = String(config.public.apiBaseUrl).replace(/\/$/, '');
  return `${apiBaseUrl}/tests/${encodeURIComponent(testId.value || '<test-id>')}/run`;
});

const codeVariants = computed<CodeSnippetVariant[]>(() => [
  {
    id: 'run',
    label: 'Run',
    note: 'The verdict as JSON: one entry per case, with the diff behind each failure.',
    request: {
      method: 'POST',
      url: runUrl.value,
      body: currentVersionNumber.value ? { version: currentVersionNumber.value } : {},
    },
  },
  {
    id: 'report',
    label: 'Report',
    note: 'The same run, asked for as a report. The library stores no run to fetch afterwards, so a report is a run with an Accept header.',
    request: {
      method: 'POST',
      url: runUrl.value,
      headers: { Accept: TEST_REPORT_FORMATS[0]?.accept ?? 'application/json' },
      body: {},
    },
  },
]);

const codeUnavailable = computed(() =>
  testId.value
    ? null
    : 'This test has not been saved yet — save it once to get an id, then the run goes to the call below.',
);

/**
 * The last verdict, for the dots on the case tabs.
 *
 * It is the store's rather than this component's: a test can be run from four
 * places — this screen's Run, a heading in the Tests tab, the tag menu and the
 * Runs tab's re-run — and they all write one verdict per test to the same
 * store. The verdict itself is read on the Runs tab now; what is left here is
 * the pass/fail mark beside each case, which is the editor's own business.
 */
const lastRun = computed<TestRunResult | null>(() => {
  if (runErrored.value) return null;
  const id = testId.value;
  return id ? testsStore.lastRunByTest.value[id] ?? null : null;
});

// A different test is a different question; the last one's failure to run says
// nothing about it.
watch(testId, () => { runErrored.value = false; });

/* ------------------------------------------------------------------ *
 * Unsaved edits to a saved test.
 *
 * This screen used to keep none. A saved test's edits lived in the open
 * tab and nowhere else, so closing it — or a reload, or opening another test —
 * threw the work away with no warning, where every other versioned section
 * would have had it waiting. That was defensible only while you could imagine
 * amending a version in place; versions are snapshots now (#191), so a draft
 * is the only home in-progress work has (#190, design §7a).
 *
 * The same shape as the data graph's and the rule set's, over a different
 * body: what a test edits is the version payload — expectation, pinned subject
 * version, backend and the cases — rather than one string. The name and the
 * tags belong to the test rather than to any version and are deliberately not
 * in here.
 * ------------------------------------------------------------------ */

interface TestDraftBody {
  expectationKind?: ExpectationKind;
  subjectVersion?: string | null;
  backend?: string | null;
  cases?: CaseDraft[];
}

const testLibraryId = ref<string | null>(null);
/** When the browser-local draft was last written, for the Details draft row. */
const locallySavedAt = ref<string | null>(null);
/** Set while a test is being read, so hydration never lands as an edit. */
const hydratingRecord = ref(false);
/** The editor payload of the version on screen, to compare edits against. */
const savedBody = ref('');
let draftSaveHandle: ReturnType<typeof setTimeout> | null = null;

/** What the editor holds now, in the shape a draft records it. */
function editorBody(): TestDraftBody {
  return {
    expectationKind: expectationKind.value,
    subjectVersion: subjectVersion.value,
    backend: backend.value,
    cases: cases.value.map((testCase) => ({ ...testCase })),
  };
}

/**
 * A saved version, as the editor's payload.
 *
 * One reader rather than two: opening a test and clicking a row in the Details
 * version list are the same act over different versions, and the shapes drifted
 * the moment they were written out twice.
 */
function bodyOfVersion(version: TestVersion): TestDraftBody {
  return {
    expectationKind: (version.expectationKind as ExpectationKind) ?? 'graph',
    subjectVersion: version.subjectVersion ?? null,
    backend: version.backend ?? null,
    // A version stored before cases existed has none; it still edits as the
    // one case it runs as, rather than as a test with nothing in it.
    cases: version.cases.map((testCase) => ({
      name: testCase.name ?? '',
      dataGraphVersion: testCase.dataGraphVersion ?? null,
      argumentSetVersion: testCase.argumentSetVersion ?? null,
      tupleSeeds: testCase.tupleSeeds ?? '',
      sqlFixture: testCase.sqlFixture ?? '',
      expected: testCase.expected ?? '',
      expectedFormat: testCase.expectedFormat ?? null,
      ordered: testCase.ordered ?? false,
    })),
  };
}

function applyEditorBody(body: TestDraftBody) {
  expectationKind.value = body.expectationKind ?? 'graph';
  subjectVersion.value = body.subjectVersion ?? null;
  backend.value = body.backend ?? null;
  cases.value = body.cases?.length
    ? body.cases.map((testCase) => ({ ...emptyCase(), ...testCase }))
    : [emptyCase()];
  selectedCaseIndex.value = Math.min(selectedCaseIndex.value, cases.value.length - 1);
}

const openDraft = computed(() => {
  void draftsStore.allDrafts.value;
  return testId.value ? draftsStore.draftFor(testId.value) : null;
});

const editCount = computed(() => (isScratch.value ? 0 : openDraft.value?.edits ?? 0));

/** Typing back to what is saved is an undo, not an edit. */
const matchesSaved = () => JSON.stringify(editorBody()) === savedBody.value;

function persistDraft() {
  const id = testId.value;
  if (!id || isScratch.value) return;
  const existing = draftsStore.draftFor(id);
  draftsStore.save({
    id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
    libraryId: testLibraryId.value || activeLibraryId.value || UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'draft',
    section: 'test',
    name: testName.value,
    description: null,
    queryString: null,
    body: editorBody(),
    resultKind: 'BOOLEAN',
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
  const id = testId.value;
  if (!id) return;
  const existing = draftsStore.draftFor(id);
  if (existing) draftsStore.remove(existing.id);
  locallySavedAt.value = null;
}

function cancelDraftSave() {
  if (!draftSaveHandle) return;
  clearTimeout(draftSaveHandle);
  draftSaveHandle = null;
}

watch(
  [expectationKind, subjectVersion, backend, cases],
  () => {
    if (isScratch.value || hydratingRecord.value || !testId.value) return;
    cancelDraftSave();
    draftSaveHandle = setTimeout(() => {
      draftSaveHandle = null;
      if (matchesSaved()) {
        removeDraft();
        return;
      }
      persistDraft();
    }, 500);
  },
  { deep: true },
);

/** Throw the unsaved edits away and go back to the saved version. */
function discardDraft() {
  cancelDraftSave();
  removeDraft();
  hydratingRecord.value = true;
  applyEditorBody(JSON.parse(savedBody.value || '{}') as TestDraftBody);
  void Promise.resolve().then(() => { hydratingRecord.value = false; });
  toast.success('Draft discarded');
}

/**
 * Why this cannot be saved yet, or empty when it can.
 *
 * The reasons come from the same table the server refuses versions with, so
 * the button is honest rather than the save being a surprise — and they are
 * *shown*, because a disabled button that does not say why is the worst of the
 * three available outcomes.
 */
const saveProblems = computed(() => {
  if (!subject.value) return ['Choose a subject.'];
  const problems = checkSubjectKindInputs(
    subjectKind.value,
    { backend: backend.value },
    // Only the slots this kind actually sends — the same projection
    // `versionBody` saves, so the check is over what would be written
    // rather than over what happens to be in the editor.
    cases.value.map(testCase => savedCaseInputs(testCase)),
    index => caseLabel(cases.value[index], index),
  );
  if (expectationKind.value !== 'smoke' && cases.value.some(testCase => !testCase.expected.trim())) {
    problems.push('Every case needs an expected result.');
  }
  return problems;
});

const canSave = computed(() => {
  if (!testName.value.trim() || !subject.value) return false;
  if (saveProblems.value.length > 0) return false;
  // Saving an unchanged body would mint a version identical to the last
  // one. Nothing to save is not an error, it is a disabled button.
  if (!isScratch.value && testId.value) return editCount.value > 0;
  return true;
});

function onSubjectKindChange(kind: SubjectKind) {
  if (kind === subjectKind.value) return;
  subjectKind.value = kind;
  // The subject list changed underneath, so the old choice is meaningless —
  // and so is a version of it, or a preview of it.
  subject.value = null;
  subjectVersion.value = null;
  subjectVersionOptions.value = [];
  subjectPreview.value = null;
  subjectTuplesEnabled.value = null;
  // The inputs go too, rather than being hidden and silently saved: a
  // backend left over from a query test would make a rule-set version the
  // server refuses, and the control that could clear it is no longer on screen.
  if (!slots.value.backend) backend.value = null;
  // Same rule for the expectation: the select no longer offers the kind it was
  // on, and leaving it set would show a blank control over a version the runner
  // refuses. `graph` is the one every kind can be judged by.
  if (!expectationKindOptions.value.some((option) => option.value === expectationKind.value)) {
    expectationKind.value = 'graph';
  }
  cases.value = cases.value.map((testCase) => {
    const kept = savedCaseInputs(testCase);
    // `tupleSeeds` and `sqlFixture` are textarea values in the editor and
    // nullable fields on the wire; the editor's empty string is the one this
    // side wants.
    return { ...testCase, ...kept, tupleSeeds: kept.tupleSeeds ?? '', sqlFixture: kept.sqlFixture ?? '' };
  });
}

/**
 * One case's inputs, with the slots this subject kind does not take dropped.
 *
 * Only the applicable slots are sent: storing a rule set's argument set or a
 * query group's data graph would leave a value nothing reads, that the page
 * cannot show, and that the server would refuse anyway. Editing the kind then
 * switching back is the common way one gets set, so this is a filter rather
 * than an assumption about what the editor holds.
 */
function savedCaseInputs(testCase: CaseDraft) {
  const applicable = INPUTS_FOR_SUBJECT_KIND[subjectKind.value];
  return {
    dataGraphVersion: applicable.dataGraph ? testCase.dataGraphVersion : null,
    tupleSeeds: applicable.tupleSeeds ? testCase.tupleSeeds || null : null,
    sqlFixture: applicable.sqlFixture ? testCase.sqlFixture || null : null,
    argumentSetVersion: applicable.argumentSet ? testCase.argumentSetVersion : null,
  };
}

function versionBody() {
  return {
    expectationKind: expectationKind.value,
    subjectVersion: subjectVersion.value,
    // Same rule, one level up: only a query has a backend to name.
    backend: INPUTS_FOR_SUBJECT_KIND[subjectKind.value].backend ? backend.value : null,
    cases: cases.value.map(testCase => ({
      name: testCase.name.trim() || null,
      expected: expectationKind.value === 'smoke' ? null : testCase.expected,
      expectedFormat: testCase.expectedFormat,
      ordered: expectationKind.value === 'bindings' ? testCase.ordered : null,
      ...savedCaseInputs(testCase),
    })),
  };
}

/**
 * Pin to the subject's newest version.
 *
 * "Pinned" needs *a* version to mean anything, and the newest is the only
 * defensible default — it is what the author is looking at. Which version can
 * then be changed in the select the toggle reveals.
 */
function pinLatestSubjectVersion() {
  subjectVersion.value = subjectVersionOptions.value.at(-1)?.id ?? null;
}

async function save() {
  if (!canSave.value) return;
  const libraryId = activeLibraryId.value;
  if (!libraryId) {
    toast.error('Choose a library first.');
    return;
  }

  isSaving.value = true;
  try {
    if (!testId.value) {
      const created = await testsStore.createTest({
        name: testName.value.trim(),
        description: testDescription.value.trim() || null,
        subject: subject.value!,
        subjectKind: subjectKind.value,
        isPartOf: [libraryId],
        // Omitted, the server copies the subject's tags; `[]` is how the
        // unticked box says none. Sending the list we drew would be a second
        // implementation of the same rule, and the one that goes stale.
        ...(copySubjectTags.value ? {} : { tags: [] }),
      } as never);
      testId.value = created.id;
      emit('scratch-saved', { id: created.id, name: created.name, libraryId });
    } else {
      // Name and description live on the test rather than on a version, and
      // nothing else on this screen writes them: before Details owned them
      // they were editable here and silently dropped on save.
      await apiClient.updateTest(testId.value, {
        name: testName.value.trim(),
        description: testDescription.value.trim() || null,
      } as never);
      await testsStore.loadTests();
    }

    const version = await testsStore.createVersion(testId.value!, versionBody());
    currentVersionNumber.value = version.version;
    currentVersionId.value = version.id;
    loadedVersionId.value = version.id;
    testVersions.value = await testsStore.loadVersions(testId.value!);
    // The editor's body is now a saved version, so there are no
    // unsaved edits left to keep: the draft and its pill go together.
    savedBody.value = JSON.stringify(editorBody());
    cancelDraftSave();
    removeDraft();
    toast.success(`Saved v${version.version}`);
  } catch (error) {
    // The draft is left exactly as it was. A save that failed and took the
    // edits with it is the one outcome that loses work outright.
    toast.error(error instanceof Error ? error.message : 'Failed to save test');
  } finally {
    isSaving.value = false;
  }
}

async function run() {
  if (!testId.value) return;
  running.value = true;
  runErrored.value = false;
  /*
   * One test is a run too, and the Runs tab is where a run goes. Recording the
   * scope here rather than in the page is what makes that true of every way of
   * starting one — a row, a heading, a tag, or this button.
   */
  runScope.beginRun({ kind: 'test', label: testName.value || 'this test', testIds: [testId.value] });
  try {
    const result = await testsStore.runTest(testId.value);
    // Land on the first failure: with several cases, the one that failed is
    // what the run was for, and hunting for it is the work this saves.
    const firstFailure = result.cases.findIndex(testCase => !testCase.passed);
    if (firstFailure >= 0) selectedCaseIndex.value = firstFailure;
    toast[result.passed ? 'success' : 'error'](
      result.passed ? 'Test passed' : `Test failed: ${result.message}`,
    );
  } catch (error) {
    // A test that *cannot* run is not a failing test, and saying so is the
    // difference between "the subject is wrong" and "the test is wrong".
    runErrored.value = true;
    toast.error(error instanceof Error ? error.message : 'Test could not be run');
  } finally {
    running.value = false;
    runScope.endRun({
      testIds: testId.value ? [testId.value] : [],
      // A run that threw answered for nothing; one that returned answered for
      // this test, pass or fail.
      answeredIds: testId.value && !runErrored.value ? [testId.value] : [],
    });
  }
}

/**
 * Run this test and save the report.
 *
 * The verdict panel is deliberately left alone: this is an export of a run, and
 * quietly repainting the page from it would make a download look like a second
 * kind of Run button. What lands on disk is the run the button just made.
 */
async function exportReport(format: TestReportFormat) {
  if (!testId.value || exporting.value) return;
  exporting.value = true;
  try {
    const report = await apiClient.exportTestRun(testId.value, {
      accept: format.accept,
      filename: format.filename,
    });
    downloadTextFile(report.body, report.filename, report.contentType);
    toast.success(`Exported ${format.label}`);
  } catch (error) {
    // A test that cannot run has no report to export, and says so rather than
    // saving an empty file that reads as a pass.
    toast.error(error instanceof Error ? error.message : 'Could not export the report');
  } finally {
    exporting.value = false;
  }
}

async function removeTest() {
  if (!testId.value) return;
  isDeleting.value = true;
  try {
    await testsStore.deleteTest(testId.value);
    // A draft of a test that no longer exists is a sidebar row that opens
    // nothing, so it goes with the test.
    cancelDraftSave();
    removeDraft();
    emit('test-deleted');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to delete test');
  } finally {
    isDeleting.value = false;
  }
}

async function loadDataGraphOptions() {
  const libraryId = activeLibraryId.value;
  if (!libraryId) {
    dataGraphOptions.value = [];
    return;
  }
  try {
    const graphs = await apiClient.listDataGraphs();
    const options = await Promise.all(
      graphs
        .filter((graph) => (graph.isPartOf ?? []).includes(libraryId))
        .map(async (graph) => {
          const versions = await apiClient.listDataGraphVersions(graph.id);
          // Every version, not just the current one: a test names a *version*
          // so that it keeps meaning the same thing as the graph moves on.
          return versions.map((version) => {
            // Carried with the option rather than fetched when the disclosure
            // opens: the list request already returned the content, and a
            // second round trip to show what we are holding is one the reader
            // waits through for nothing.
            dataGraphContent.value.set(version.id, {
              text: version.contentString ?? '',
              format: version.contentFormat ?? null,
              meta: [version.contentFormat, `v${version.version}`]
                .filter(Boolean)
                .join(' · '),
            });
            return {
              versionId: version.id,
              label: `${graph.name} (v${version.version})`,
            };
          });
        }),
    );
    dataGraphOptions.value = options.flat();
  } catch {
    dataGraphOptions.value = [];
  }
}

async function loadTest(id: string) {
  hydratingRecord.value = true;
  try {
    const { data } = await apiClient.getTest(id);
    testName.value = data.name;
    testDescription.value = data.description ?? '';
    testCreatedAt.value = (data as { dateCreated?: string | null }).dateCreated ?? null;
    subject.value = data.subject;
    subjectKind.value = data.subjectKind as SubjectKind;
    testLibraryId.value = (data as { isPartOf?: string[] }).isPartOf?.[0] ?? null;

    const versions = await testsStore.loadVersions(id);
    testVersions.value = versions;
    const current = versions.find((version) => version.id === data.currentVersion) ?? versions.at(-1);
    currentVersionId.value = data.currentVersion ?? current?.id ?? null;
    if (!current) return;
    currentVersionNumber.value = current.version;
    // The editor is loaded from the current version, draft or not: a draft is
    // measured against it, and the Details version list highlights it.
    loadedVersionId.value = current.id;
    applyEditorBody(bodyOfVersion(current));
    selectedCaseIndex.value = 0;
    savedBody.value = JSON.stringify(editorBody());

    /*
     * A draft wins over the saved version, because it is the newer of the
     * two — the whole point of keeping it is that a reload does not lose it.
     * The saved payload stays in `savedBody` so Discard has somewhere
     * to go back to.
     */
    const draft = openDraft.value?.body;
    if (draft && typeof draft === 'object') applyEditorBody(draft as TestDraftBody);
  } finally {
    // Cleared after the refs settle, so hydration never lands as an edit.
    await Promise.resolve();
    hydratingRecord.value = false;
  }
}

/**
 * The subject's versions, so "Pinned" has something to name.
 *
 * Loaded per subject rather than up front: a library has far more versions than
 * any one test needs, and the only ones that can be pinned are this subject's.
 */
async function loadSubjectVersions() {
  const id = subject.value;
  if (!id) {
    subjectVersionOptions.value = [];
    return;
  }
  try {
    // An ETL job's versions come from its own store rather than the generated
    // client: `/etl-jobs` has no contract surface yet, which is the reason
    // `useEtlJobsStore` uses plain fetch as well.
    const versions = subjectKind.value === 'etlJob'
      ? await etlJobsStore.loadEtlJobVersions(id)
      : subjectKind.value === 'ruleSet'
        ? await apiClient.listRuleSetVersions(id)
        : subjectKind.value === 'query'
          ? await apiClient.listQueryVersions(id)
          : await apiClient.listQueryGroupVersions(id);
    subjectVersionOptions.value = versions
      .map((version: { id: string; version: number }) => ({ id: version.id, version: version.version }))
      .sort((a, b) => a.version - b.version);
  } catch {
    // Pinning is an option, not a requirement: without the list the toggle is
    // simply unavailable and the test runs against the current version.
    subjectVersionOptions.value = [];
  }
}

/**
 * The subject's own text, for the preview beside it.
 *
 * A query's is its query string; a rule set's is the merged SRL document,
 * which already carries its DATA blocks — they are part of the inline syntax,
 * so nothing here has to assemble them. A query group has no single text: its
 * shape is the canvas, and a thumbnail of a graph is not a preview of it, so
 * that kind gets a link rather than a disclosure.
 *
 * Reads the *pinned* version when the test pins one. Previewing the current
 * text of a subject the test does not run would be worse than showing nothing:
 * it would look like an explanation and be a different document.
 */
async function loadSubjectPreview() {
  const id = subject.value;
  subjectPreview.value = null;
  subjectTuplesEnabled.value = null;
  if (!id) return;

  const pinned = subjectVersion.value
    ? subjectVersionOptions.value.find(option => option.id === subjectVersion.value)
    : null;
  const versionLabel = pinned ? `v${pinned.version}` : 'current';

  try {
    if (subjectKind.value === 'query') {
      const versions = await apiClient.listQueryVersions(id);
      const version = pinned
        ? versions.find((candidate: { id: string }) => candidate.id === pinned.id)
        : versions.at(-1);
      if (!version?.queryString) return;
      subjectPreview.value = { text: version.queryString, meta: versionLabel };
      return;
    }
    if (subjectKind.value === 'etlJob') {
      // The SQL is the job's document: it is what a fixture has to line up
      // with, so it is the one thing worth reading beside the test.
      const versions = await etlJobsStore.loadEtlJobVersions(id);
      const version = pinned
        ? versions.find((candidate: { id: string }) => candidate.id === pinned.id)
        : versions.at(-1);
      if (!version?.sql) return;
      subjectPreview.value = { text: version.sql, meta: versionLabel };
      return;
    }
    if (subjectKind.value === 'ruleSet') {
      const exported = await apiClient.exportRuleSetSrl(id, { version: pinned?.version ?? null });
      subjectTuplesEnabled.value = exported.tuplesEnabled === true;
      subjectPreview.value = {
        text: exported.srl,
        meta: [versionLabel, `${exported.ruleCount} rules`, exported.dataBlockCount ? `${exported.dataBlockCount} data blocks` : '']
          .filter(Boolean)
          .join(' · '),
      };
    }
  } catch {
    // A preview is a convenience. Failing to fetch it must not make the test
    // look broken, so the peek is simply absent.
    subjectPreview.value = null;
    // Back to "not known", never to false: hiding the seeds box because a
    // request failed would silently drop input the test may already carry.
    subjectTuplesEnabled.value = null;
  }
}

/**
 * The rows an argument set would supply, for the preview beside it.
 *
 * The export is what the runner actually splices into the query, so this shows
 * the values the test will run with rather than the set's editing shape.
 */
async function loadArgumentSetPreview(versionId: string | null) {
  if (!versionId || argumentSetContent.value.has(versionId)) return;
  try {
    /*
     * The version the case pins, not the set's current one.
     *
     * This used to export `set.setId`, which the route answered from the set's
     * *current* version — so editing the set made the preview disagree with
     * what the test actually ran. It also meant a case pinning a version older
     * than current showed no preview at all, because the options list only ever
     * holds current versions and the lookup came up empty.
     */
    const payload = await apiClient.exportArgumentSet(versionId);
    const rows = payload.arguments ?? [];
    argumentSetContent.value.set(versionId, {
      text: JSON.stringify(payload, null, 2),
      meta: `${rows.length} argument${rows.length === 1 ? '' : 's'}`,
    });
    // A Map mutated in place is not a reactive change; the reassignment is what
    // makes the preview appear.
    argumentSetContent.value = new Map(argumentSetContent.value);
  } catch {
    // As above: no preview rather than an error where an input should be.
  }
}

/** Argument sets that target this subject — the query/group input slot. */
/**
 * Whether the chosen argument set already supplies the group's graphs.
 *
 * A count, not a list of ports: a set carries graphs in order and the group
 * routes them, so there is no port name on the set to compare against. Only a
 * group's set can supply any — a query declares no graph parameter, so its
 * per-case fixture graph has nothing to stand down for and its select stays.
 */
const argumentSetFillsGraph = computed(() => {
  if (subjectKind.value !== 'queryGroup') return false;
  const chosen = argumentSetVersion.value;
  if (!chosen) return false;
  return (argumentSetGraphCount.value[chosen] ?? 0) > 0;
});

async function loadArgumentSetOptions() {
  const id = subject.value;
  if (!id || subjectKind.value === 'ruleSet') {
    argumentSetOptions.value = [];
    return;
  }
  try {
    const sets = await apiClient.listArgumentSets(
      id,
      subjectKind.value === 'query' ? 'query' : 'queryGroup',
    );
    // `currentVersionId` is the version a run names; `currentVersion` on this
    // shape is the expanded object, not an id.
    argumentSetOptions.value = sets.flatMap(set =>
      set.currentVersionId ? [{ id: set.currentVersionId, setId: set.id, label: set.name }] : [],
    );
    // How many graphs each set carries, so a case's graph select can stand
    // down where the set already answers them.
    const counts: Record<string, number> = {};
    for (const set of sets) {
      const versionId = set.currentVersionId;
      if (!versionId) continue;
      counts[versionId] = (set.currentVersion?.graphBindings ?? []).length;
    }
    argumentSetGraphCount.value = counts;
  } catch {
    argumentSetOptions.value = [];
  }
}

onMounted(async () => {
  /*
   * Deliberately outside the group below, and deliberately not awaited: ETL is
   * an optional feature — a deployment without DuckDB serves nothing here — so
   * a slow or failing `/etl-jobs` must not hold up the test being opened. It
   * fills the subject list a moment later, which is the only thing it feeds.
   */
  void etlJobsStore.loadEtlJobs().catch(() => []);
  await Promise.all([
    queriesStore.loadQueries(),
    queryGroupsStore.loadQueryGroups(),
    ruleSetsStore.fetchRuleSets(),
    backendsStore.loadBackends(),
    loadDataGraphOptions(),
    // The copy-tags box names the subject's tags, and a name needs the
    // library's vocabulary. Loaded here rather than by the box so it does not
    // pop in a beat after the subject is chosen.
    tagsStore.ensureLoaded(activeLibraryId.value),
  ]);
  if (props.testId) await loadTest(props.testId);
});

watch(
  () => props.testId,
  async (next) => {
    // A pending autosave belongs to the test that was open, not the one being
    // opened; letting it fire would write the old body under the new id.
    cancelDraftSave();
    testId.value = next ?? null;
    testLibraryId.value = null;
    testDescription.value = '';
    testCreatedAt.value = null;
    testVersions.value = [];
    currentVersionId.value = null;
    loadedVersionId.value = null;
    savedBody.value = '';
    /*
     * The body too, and before the load rather than after it: this screen swaps
     * records in place, and `loadTest` returns early for a test with no version
     * to read — which used to leave the previous test's cases and expectation
     * on screen under the new test's name.
     */
    applyEditorBody({ expectationKind: 'graph', subjectVersion: null, backend: null, cases: [] });
    selectedCaseIndex.value = 0;
    // The verdict follows the id — the watcher on `testId` clears the
    // could-not-run flag, and the store answers for whichever test this now is.
    if (next) await loadTest(next);
  },
);

watch(activeLibraryId, (id) => {
  void tagsStore.ensureLoaded(id);
  void loadDataGraphOptions();
});

watch([subject, subjectKind], async () => {
  // Versions first: the subject preview reads the pinned one from that list, so
  // fetching them concurrently would preview the current text on the first
  // load of a pinned test.
  await loadSubjectVersions();
  await Promise.all([loadArgumentSetOptions(), loadSubjectPreview()]);
});

// A pin changes which document the test judges, so it changes what the preview
// beside it must show.
watch(subjectVersion, () => {
  void loadSubjectPreview();
});

watch([argumentSetVersion, argumentSetOptions], () => {
  void loadArgumentSetPreview(argumentSetVersion.value);
}, { immediate: true });

onBeforeUnmount(() => {
  if (!draftSaveHandle) return;
  cancelDraftSave();
  // Closing the tab mid-debounce should not lose the edit that was queued.
  if (!isScratch.value && testId.value && !matchesSaved()) persistDraft();
});
</script>

<style scoped>
.test-work-area {
  position: relative;
  display: flex;
  height: 100%;
  background: var(--surface-raised);
}

/*
 * The test as an editable object, and the inspector beside it. The run used to
 * be the right-hand column; it is the Runs tab's screen now, so this column has
 * the width the fields always wanted.
 */
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

/*
 * The run fills the pane the editor otherwise fills. It sizes itself to its
 * container, so it needs to be the flex child that gets the leftover height
 * rather than one asking for all of it.
 */
.left-panel > :deep(.run-detail) {
  flex: 1;
  min-height: 0;
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

/*
 * Vertical scrolling only, stated on both axes.
 *
 * `overflow-y: auto` alone computes `overflow-x` to `auto` as well, so
 * anything sticking out to the right — a tooltip bubble, a dropdown a pixel
 * wider than its field — made the column draggable sideways, and anything that
 * called `scrollIntoView` inside it then dragged it, cutting the section
 * labels off the left. `clip` rather than `hidden`: it stops the scrolling
 * without making this a scroll container on that axis.
 */
.editor-column {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  padding: var(--space-5);
  overflow-x: clip;
  overflow-y: auto;
}

.block {
  margin-bottom: var(--space-6);
}

.block-grow {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: var(--grid-5);
}

.block-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.block-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

/* The segmented control itself is `shared/SegmentedToggle`. */

/*
 * The row a toggle sits on when it heads a section rather than trailing a
 * header: the subject kind, and the query's choice of store.
 */
.kind-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.preview {
  margin-top: var(--space-3);
}

.save-problems {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0 0 var(--space-5);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  background: var(--warning-surface);
  color: var(--warning-ink);
  font-size: var(--text-label);
  list-style: none;
}

/*
 * Cases as tabs rather than a table: only one case is being edited at a time,
 * and a table of six rows each with four inputs is a grid — which is what
 * leaving the backend axis out was meant to avoid.
 */
.case-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.case-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.case-tab.on {
  background: var(--segment-selected);
  color: var(--segment-selected-ink);
  font-weight: var(--weight-semibold);
}

.case-remove {
  margin-left: var(--space-2);
  opacity: 0.6;
}

.case-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.case-dot-pass {
  /* The state role, not the ink one — this is a fill, not text. */
  background: var(--state-valid);
}

.case-dot-fail {
  background: var(--state-invalid);
}

.ghost-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.control {
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
}

.control-auto {
  width: auto;
}

.control:disabled {
  color: var(--ink-disabled);
}

/* The editor itself carries the border and the surface; this only sizes it. */
.expected-editor {
  flex: 1;
  width: 100%;
}

.muted {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

</style>
