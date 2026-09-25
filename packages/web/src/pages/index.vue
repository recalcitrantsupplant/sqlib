<template>
  <div class="app-layout">
    <AppNavRail
      :active-section="railSelection"
      @select="handleRailSelect"
      @create-library="showAddLibraryDialog"
      @home="goHome"
    />

    <!--
      Backends are account-level and have their own two facts (health and
      latency), so they get their own sidebar rather than a sixth row in the
      artifact list.
    -->
    <BackendListSidebar
      v-if="backendsSection"
      :backends="backends"
      :selected-id="backendDraft ? null : selectedBackendId"
      :draft="backendDraft"
      :draft-name="backendDraftName"
      :loading="backendsStore.loading.value"
      :error="backendsStore.error.value"
      @select="handleSelectBackend"
      @discard-draft="backendDraft = false"
      @create="startCreateBackend"
      @probe-all="backendProbes.probeAll"
    />

    <!--
      Every library section is a flat list with a Scratch cluster above a Saved
      one, per the nav doc. The tree survives only as the unscoped view — pick
      a section and it is gone.
    -->
    <EntityListSidebar
      v-else-if="flatSidebar"
      :key="flatSidebar.section"
      :section="flatSidebar.section"
      :saved="flatSidebar.saved"
      :scratch="flatSidebar.scratch"
      :selection="sidebarSelection"
      :section-label="flatSidebar.label"
      :item-noun="flatSidebar.noun"
      :item-noun-plural="flatSidebar.nounPlural"
      :supports-scratch="flatSidebar.supportsScratch"
      :supports-saved="flatSidebar.supportsSaved"
      :saved-kinds="flatSidebar.savedKinds"
      :tags="libraryTags"
      :supports-tags="flatSidebar.supportsTags"
      :supports-origin="flatSidebar.supportsOrigin"
      @select-saved="handleSelectSaved"
      @select-scratch="handleSelectScratch"
      @create-scratch="handleCreateFromSidebar"
      @discard-scratch="requestDiscardScratch"
    >
      <!--
        Run all, for the whole section and for one heading. Only Tests has
        something to run, so the slots are empty everywhere else rather than the
        sidebar growing a notion of running things.
      -->
      <template v-if="flatSidebar.section === 'tests'" #list-tabs>
        <TabStrip
          :model-value="testsTab"
          :tabs="testSidebarTabs"
          group-label="Tests and runs"
          @update:model-value="setTestsTab($event as 'tests' | 'runs')"
        />
      </template>
      <!--
        The Runs tab is the same sidebar at the scope of one run: it replaces
        the rows, and keeps the hinge and the width.
      -->
      <template v-if="testsRunsTabActive" #list-body>
        <TestRunsPanel
          :summary="testRunSummary"
          :selected-test-id="testRunResultsVisible ? null : selectedTestId"
          :results-selected="testRunResultsVisible"
          :running="testRunRunning"
          :running-ids="testsStore.runningTestIds.value"
          :busy="runningAll"
          :scope-tag-color="testRunScopeColor"
          @update:tab="setTestsTab"
          @select-test="openRunTest"
          @select-results="showRunResults"
          @rerun="rerunScope"
          @export="exportScope"
        />
      </template>
      <template v-if="flatSidebar.section === 'tests'" #section-actions="{ items }">
        <!--
          Run all is the whole list; the tag menu beside it is the subset worth
          running on its own. Two controls rather than one with a mode, because
          "everything" is the common case and must stay one click.
        -->
        <RunByTagMenu
          :tags="runnableTags(items)"
          :busy="runningAll"
          :disabled="runningAll"
          @run="runTaggedTests"
          @export="exportTaggedTests"
        />
        <button
          class="run-all-button"
          data-testid="tests-run-all"
          :disabled="runningAll || items.length === 0"
          :title="`Run all ${items.length} tests`"
          @click="runAllTests(items)"
        >
          <Play :size="12" />{{ runAllLabel }}
        </button>
      </template>
      <template v-if="flatSidebar.section === 'tests'" #group-actions="{ items, label, tagId }">
        <button
          class="run-group-button"
          :data-testid="`tests-run-group-${label}`"
          :disabled="runningAll"
          :title="`Run the ${items.length} tests in ${label}`"
          @click="tagId ? runTaggedTests([tagId]) : runGroupTests(items, label)"
        >
          <Play :size="11" />
        </button>
      </template>
    </EntityListSidebar>

    <main class="main-content">
      <!--
        The run itself. Which screen the pane shows is the sidebar's selection
        and nothing else: on the Runs tab a test row is that test's verdict and
        no row is the run's own summary, while the same row on the Tests tab is
        the test as an editable object. There is no tab strip in the pane,
        because the sidebar has already asked the question.

        A picked row is `TestWorkArea` in run mode rather than a screen of its
        own: only the main pane changes between the two tabs, and the
        inspector's Details and Code stay where they were.
      -->
      <TestRunResults
        v-if="testRunResultsVisible && testRunSummary"
        :summary="testRunSummary"
        :results="testsStore.lastRunByTest.value"
        :running="testRunRunning"
        :busy="runningAll"
        :storage-note="testRunStorageNote"
        :library-name="activeLibraryName"
        @rerun-failed="rerunFailed"
      />
      <BackendWorkArea
        v-else-if="backendsSection"
        :backend-id="backendDraft ? null : selectedBackendId"
        :draft="backendDraft"
        @created="handleBackendCreated"
        @discard-draft="backendDraft = false"
        @draft-name="backendDraftName = $event"
        @delete-request="handleDeleteBackendRequest"
        @open-usage="handleRailSelect"
      />
      <!--
        The pane follows the rail. A record belongs to the section that lists
        it, so opening a section used to leave the last record on screen: pick
        Groups with a query open and the query editor stayed, under a Groups
        sidebar reading "No groups yet". With nothing from this section open,
        the pane says what the section holds and where to read more.
      -->
      <div v-else-if="sectionOverview" class="content-placeholder" data-testid="section-overview">
        <EmptyState
          :title="`No ${sectionOverview.noun} open`"
          :description="sectionOverview.blurb"
        >
          <template #actions>
            <a
              class="section-docs-link"
              :href="sectionOverview.docsUrl"
              target="_blank"
              rel="noreferrer"
              data-testid="section-overview-docs"
            >{{ sectionOverview.docsLabel }}</a>
          </template>
        </EmptyState>
      </div>
      <QueryWorkArea
        v-else-if="queriesEnabled && (selectedItemType === 'query' || scratchSection === 'query')"
        :key="scratchSection === 'query' ? `scratch-${selectedScratchId}` : 'query'"
        :creation-request="creationRequest"
        :query-id="scratchSection === 'query' ? null : selectedQueryId"
        :scratch-id="scratchSection === 'query' ? selectedScratchId : null"
        :version-number="queryVersionNumber"
        :preselect-argument-set-id="preselectArgumentSetId"
        @creation-consumed="creationRequest = null"
        @query-created="handleQueryCreated"
        @query-load-failed="handleQueryLoadFailed"
        @scratch-saved="handleScratchSaved"
        @argument-set-saved="handleArgumentSetSavedElsewhere"
        @query-deleted="handleQueryDeleted"
        @update:version-number="handleQueryVersionUpdate"
        @open-entity="openCreatedEntity"
      />
      <QueryGroupWorkArea
        v-else-if="queryGroupsEnabled && (selectedItemType === 'queryGroup' || scratchSection === 'group')"
        :key="scratchSection === 'group' ? `scratch-${selectedScratchId}` : 'query-group'"
        :creation-request="queryGroupCreationRequest"
        :query-group-id="scratchSection === 'group' ? null : selectedQueryGroupId"
        :scratch-id="scratchSection === 'group' ? selectedScratchId : null"
        :version-number="queryGroupVersionNumber"
        @creation-consumed="queryGroupCreationRequest = null"
        @scratch-saved="handleQueryGroupScratchSaved"
        @argument-set-saved="handleArgumentSetSavedElsewhere"
        @update:version-number="handleQueryGroupVersionUpdate"
        @query-group-deleted="handleQueryGroupDeleted"
        @query-group-cloned="handleQueryGroupCloned"
        @query-group-moved="handleQueryGroupMoved"
        @open-entity="openCreatedEntity"
      />
      <RuleSetWorkArea
        v-else-if="rulesSuiteEnabled && (selectedItemType === 'ruleSet' || scratchSection === 'rule')"
        :key="scratchSection === 'rule' ? `scratch-${selectedScratchId}` : 'rule-set'"
        :rule-set-id="scratchSection === 'rule' ? null : selectedRuleSetId"
        :scratch-id="scratchSection === 'rule' ? selectedScratchId : null"
        @ruleset-deleted="handleRuleSetDeleted"
        @ruleset-load-failed="handleRuleSetLoadFailed"
        @scratch-saved="handleRuleSetSaved"
        @open-test="openTest"
        @open-entity="openInputEntity"
        @open-benchmark="(id) => openCreatedEntity({ type: 'benchmark', id })"
        @open-in-query="openSparqlAsScratchQuery"
      />
      <!--
        The folded-in playgrounds. Each is the same component it always was,
        told which unsaved item it is showing instead of keeping its own tab
        strip — a playground is not a place, it is an unsaved item, and the
        sidebar is where unsaved items live now (nav doc §1).

        Rules is no longer among them: a draft rule set is the rules work area
        with nothing saved yet, which is what every other section already
        does. `RulesPlayground` was a second implementation of one screen, and
        the two drifted — see the SRL document authoring plan §3.
      -->
      <EtlPlayground
        v-else-if="etlEnabled && (selectedItemType === 'etlJob' || scratchSection === 'etl')"
        :key="scratchSection === 'etl' ? `scratch-${selectedScratchId}` : 'etl-job'"
        :scratch-id="scratchSection === 'etl' ? selectedScratchId : null"
        :etl-job-id="scratchSection === 'etl' ? null : selectedEtlJobId"
        @scratch-saved="handleEtlScratchSaved"
        @open-entity="openCreatedEntity"
      />
      <BenchmarkWorkArea
        v-else-if="benchmarksEnabled && (selectedItemType === 'benchmark' || scratchSection === 'bench')"
        :key="scratchSection === 'bench' ? `scratch-${selectedScratchId}` : 'benchmark'"
        :experiment-id="scratchSection === 'bench' ? null : selectedBenchmarkId"
        :scratch-id="scratchSection === 'bench' ? selectedScratchId : null"
        @scratch-saved="handleBenchmarkSaved"
      />
      <DataGraphWorkArea
        v-else-if="dataGraphsEnabled && (selectedItemType === 'dataGraph' || scratchSection === 'dataGraph')"
        :key="scratchSection === 'dataGraph' ? `scratch-${selectedScratchId}` : 'data-graph'"
        :data-graph-id="scratchSection === 'dataGraph' ? null : selectedDataGraphId"
        :scratch-id="scratchSection === 'dataGraph' ? selectedScratchId : null"
        @scratch-saved="handleDataGraphSaved"
        @data-graph-deleted="handleDataGraphDeleted"
      />
      <TupleSetWorkArea
        v-else-if="tupleSetsEnabled && (selectedItemType === 'tupleSet' || scratchSection === 'tupleSet')"
        :key="scratchSection === 'tupleSet' ? `scratch-${selectedScratchId}` : 'tuple-set'"
        :tuple-set-id="scratchSection === 'tupleSet' ? null : selectedTupleSetId"
        :scratch-id="scratchSection === 'tupleSet' ? selectedScratchId : null"
        @scratch-saved="handleTupleSetSaved"
        @tuple-set-deleted="handleTupleSetDeleted"
      />
      <ArgumentSetWorkArea
        v-else-if="argumentSetsEnabled && (selectedItemType === 'argumentSet' || scratchSection === 'argumentSet')"
        :key="scratchSection === 'argumentSet' ? `scratch-${selectedScratchId}` : 'argument-set'"
        :argument-set-id="scratchSection === 'argumentSet' ? null : selectedArgumentSetId"
        :scratch-id="scratchSection === 'argumentSet' ? selectedScratchId : null"
        @scratch-saved="handleArgumentSetSaved"
        @argument-set-deleted="handleArgumentSetDeleted"
        @open-callable="openCallableWithArguments"
      />
      <TestWorkArea
        v-else-if="testsEnabled && (selectedItemType === 'test' || scratchSection === 'test')"
        :key="scratchSection === 'test' ? `scratch-${selectedScratchId}` : 'test'"
        :test-id="scratchSection === 'test' ? null : selectedTestId"
        :scratch-id="scratchSection === 'test' ? selectedScratchId : null"
        :run-view="testRunDetailVisible"
        :run-busy="testRunRunning || runningAll"
        @scratch-saved="handleTestSaved"
        @test-deleted="handleTestDeleted"
        @open-config="openTestConfig"
      />
      <div
        v-else-if="selectedItemType && !isItemFeatureEnabled(selectedItemType)"
        class="content-placeholder"
      >
        <p>{{ featureDisabledMessage }}</p>
      </div>
      <div
        v-else-if="rulesSuiteOnlyEnabled && !selectedItemType"
        class="content-placeholder rules-suite-overview"
      >
        <div class="overview-inner">
          <h2>SHACL Rules</h2>
          <div class="overview-sections">
            <section class="overview-section">
              <h3>Grammars & translation</h3>
              <ul>
                <li>This implementation uses a single rules dialect: the Shape Rules Language (SRL) from the current shacl12-rules draft, which includes negation (<code>NOT</code>) natively.
                The grammar is implemented as an extension of the <a href="https://github.com/comunica/traqula" target="_blank" rel="noreferrer">Traqula</a> SPARQL 1.2 parser, so SPARQL 1.2 / RDF-star support comes for free.
                  In addition, a rule to SPARQL converter is added, a ruleset stratifier, and well-formedness checks. Aggregation and the <code>FOR</code> clause are not supported.</li>
                <li>The SHACL rules draft spec is available here <a href="https://www.w3.org/TR/shacl12-rules/" target="_blank" rel="noreferrer">w3.org/TR/shacl12-rules</a>.</li>
                <li>The translator turns SRL rules and <code>DATA</code> blocks into SPARQL <code>INSERT</code> / <code>INSERT DATA</code>; raw SPARQL updates are also accepted as-is. If it parses, it can be saved and run.</li>
                <li>Invalid rules can be stored via “Save my sins” in the Save dropdown—kept on here to support negative-rule syntax tests that are expected to fail validation.</li>
              </ul>
            </section>
            <section class="overview-section">
              <h3>Stratifier</h3>
              <ul>
                <li>Classifies each rule as monotone or negation by walking the parsed body.</li>
                <li>Builds a dependency graph by matching rule heads to bodies; non-monotone edges force a stratum gap.</li>
                <li>Assigns strata iteratively and flags non-stratifiable cycles using a strongly-connected-components check.</li>
              </ul>
            </section>
            <section class="overview-section">
              <h3>Execution flow</h3>
              <ul>
                <li>Loads DataBlocks into an in-memory Oxigraph store.</li>
                <li>Normalises rules (when possible) to SPARQL updates, orders them by stratum, and runs them until no new triples are produced or a max-iteration guard trips (5 iterations).</li>
                <li>Per-rule execution captures deltas and samples to make debugging and provenance easier.</li>
              </ul>
            </section>
            <section class="overview-section">
              <h3>Blank nodes & convergence</h3>
              <ul>
                <li>A rule whose head mints a blank node (or whose body assigns with <code>SET</code>) has no fixpoint of its own —
                  every pass would mint a fresh node. Such rules are scheduled <code>SL.once</code>: they fire on the pass that activates
                  their stratum and never again, which is the draft spec's own evaluation loop. Nothing needs to be enabled for this.</li>
                <li>Test assertions compare graphs up to blank-node relabelling (RDFC-1.1 canonicalisation), so a rule that mints
                  blank nodes does not fail on labels.</li>
              </ul>
            </section>
            <section class="overview-section">
              <h3>Background</h3>
              <ul>
                <li>This implementation is an extension to a SPARQL Query Library which runs on Node.js and is intended to be deployed close to triplestores, as such,
                  the libraries/rules are shared and there is no browser based execution or storage.</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
      <!--
        Nothing selected, and no section picked: the splash. There is no ad-hoc
        editor here any more — an unsaved query is an item in the Queries list,
        not the screen you get when you have not chosen anything — and no
        artifact tree either, which was a second navigator beside the rail.
      -->
      <AppSplash
        v-else
        @select="handleRailSelect"
        @open-entity="handleSplashOpenEntity"
        @create-library="showAddLibraryDialog"
        @edit-library="handleEditLibraryRequest"
        @delete-library="handleDeleteLibraryRequest"
      />
    </main>

    <AddLibraryDialog
      v-model:open="libraryDialogOpen"
      :backends="backends"
      :library-id="editingLibraryId"
      :initial-data="editingLibraryData"
      @submit="handleLibrarySubmit"
    />

    <AlertDialog v-model:open="scratchDiscardOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard “{{ scratchDiscardTarget?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>
            It was never saved, so there is no version to go back to. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction class="delete-action" data-testid="confirm-discard-scratch" @click="confirmDiscardScratch">
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteConfirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Library?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{{ deleteTarget?.libraryName }}"? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="confirmDeleteLibrary" class="delete-action">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="backendDeleteConfirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Backend?</AlertDialogTitle>
          <AlertDialogDescription>
            <div>
              Are you sure you want to delete "{{ backendDeleteTarget?.backendName }}"?
            </div>
            <div v-if="backendDeleteLoading" style="margin-top: var(--space-5); font-style: italic;">
              Checking for references...
            </div>
            <div v-else-if="backendDeleteReferences && (backendDeleteReferences.libraries.length > 0 || backendDeleteReferences.queries.length > 0)" style="margin-top: var(--space-5);">
              <p style="font-weight: 600; margin-bottom: var(--space-4);">This backend is used as the default by:</p>
              <ul style="margin-left: var(--space-6); margin-bottom: var(--space-4);">
                <li v-for="library in backendDeleteReferences.libraries" :key="library.id">
                  Library: {{ library.name }}
                </li>
                <li v-for="query in backendDeleteReferences.queries" :key="query.id">
                  Query: {{ query.name }}
                </li>
              </ul>
              <p style="font-weight: 600;">Their defaultBackend will be set to None.</p>
            </div>
            <div v-else-if="backendDeleteReferences" style="margin-top: var(--space-4); font-style: italic;">
              No entities are using this backend as their default.
            </div>
            <div style="margin-top: var(--space-5);">
              This action cannot be undone.
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="confirmDeleteBackend" class="delete-action" :disabled="backendDeleteLoading">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from '#imports';
import { CircleCheck, ListChecks, Play } from '@lucide/vue';
import AppNavRail from '../components/AppNavRail.vue';
import AppSplash from '../components/AppSplash.vue';
import EntityListSidebar, { type SidebarSelection, type SidebarEntity } from '../components/EntityListSidebar.vue';
import BackendListSidebar from '../components/BackendListSidebar.vue';
import BackendWorkArea from '../components/BackendWorkArea.vue';
import QueryWorkArea from '../components/QueryWorkArea.vue';
import QueryGroupWorkArea from '../components/QueryGroupWorkArea.vue';
import RuleSetWorkArea from '../components/RuleSetWorkArea.vue';
import BenchmarkWorkArea from '../components/BenchmarkWorkArea.vue';
import TestWorkArea from '../components/TestWorkArea.vue';
import RunByTagMenu, { type RunByTagOption } from '../components/tests/RunByTagMenu.vue';
import TabStrip, { type Tab } from '../components/shared/TabStrip.vue';
import EmptyState from '../components/shared/EmptyState.vue';
import TestRunsPanel from '../components/tests/TestRunsPanel.vue';
import TestRunResults from '../components/tests/TestRunResults.vue';
import { useTestRunSummary } from '../composables/useTestRunSummary';
import { toast } from 'vue-sonner';
import { downloadTextFile } from '../lib/downloadFile';
import type { TestReportFormat } from '../lib/testReportFormats';
import DataGraphWorkArea from '../components/DataGraphWorkArea.vue';
import TupleSetWorkArea from '../components/TupleSetWorkArea.vue';
import ArgumentSetWorkArea from '../components/ArgumentSetWorkArea.vue';
import EtlPlayground from '../components/EtlPlayground.vue';
import AddLibraryDialog from '../components/AddLibraryDialog.vue';
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
import { useLibrariesStore } from '../composables/useLibrariesStore';
import { useBackendsStore } from '../composables/useBackendsStore';
import { isBrowserBackendId, useBrowserBackends } from '../composables/useBrowserBackends';
import { useBackendProbes } from '../composables/useBackendProbes';
import { useQueriesStore } from '../composables/useQueriesStore';
import { useEntityKinds, isInLibrary } from '../composables/useEntityKinds';
import { useFeatureFlags } from '../composables/useFeatureFlags';
import { useLibraryEvents } from '../composables/useLibraryEvents';
import type { Backend, Library } from '@sparql-query-lib/contracts';
import type { FeatureFlagKey } from '@sparql-query-lib/types';
import {
  isRailSection,
  isScreenSection,
  sectionForItemType,
  SCREEN_SECTION_PATHS,
  type RailSection,
} from '../lib/railSections';
import {
  SECTION_DEFINITIONS,
  isListSection,
  listSectionForDraftSection,
  type ListSection,
  type SectionItemType,
} from '../lib/sections';
import { conceptsDocUrl } from '../lib/docs';
import { useActiveLibrary } from '../composables/useActiveLibrary';
import { useTagsStore } from '../composables/useTagsStore';
import { isTaggableKind } from '../composables/useEntityTags';
import { useTestsStore } from '../composables/useTestsStore';
import { useApiClient, type TagMatchMode } from '../composables/useApiClient';
import { useCallableDrafts, type CallableDraft, type DraftSection } from '../composables/useCallableDrafts';
import { useScratchItems, migratePlaygroundTabs } from '../composables/useScratchItems';
import { decodeSharePayload, sharePayloadFromHash, type ScratchSharePayload } from '../lib/shareLink';

/** Old `?playground=` links, redirected to the section that absorbed each one. */
const PLAYGROUND_REDIRECTS: Record<string, RailSection> = {
  queries: 'queries',
  rules: 'rules',
  etl: 'etl',
};

interface QueryCreationRequest {
  id: number;
  libraryId: string;
  libraryName: string;
}

/**
 * What the main panel is showing.
 *
 * `scratch` is one type for all five sections rather than one per section:
 * the record itself says which section it belongs to, so a `?scratch=<id>`
 * link resolves its own destination and nothing has to be encoded twice.
 *
 * There are no playground types. A playground was never a kind of thing to
 * have selected — it was a screen you could reach with an unsaved body on it,
 * and that body is a scratch item now (nav doc §1).
 */
type ItemType = SectionItemType | 'scratch';

const librariesStore = useLibrariesStore();
const backendsStore = useBackendsStore();
const queriesStore = useQueriesStore();
const { entitiesOfKind, loadKind: loadEntityKind } = useEntityKinds();
const { isEnabled: isFeatureEnabled, labelFor } = useFeatureFlags();
const queriesEnabled = computed(() => isFeatureEnabled('queries'));
const queryGroupsEnabled = computed(() => isFeatureEnabled('queryGroups'));
const rulesSuiteEnabled = computed(() => isFeatureEnabled('rulesSuite'));
const benchmarksEnabled = computed(() => isFeatureEnabled('benchmarks'));
const testsEnabled = computed(() => isFeatureEnabled('tests'));
const dataGraphsEnabled = computed(() => isFeatureEnabled('dataGraphs'));
const tupleSetsEnabled = computed(() => isFeatureEnabled('tupleSets'));
const argumentSetsEnabled = computed(() => isFeatureEnabled('argumentSets'));
const etlEnabled = computed(() => isFeatureEnabled('etl'));
const backendsEnabled = computed(() => isFeatureEnabled('backends'));
/*
 * The three `playground*` flags no longer gate anything here. They gated
 * screens, and there are no playground screens left: each section's unsaved
 * items are scratch records in the section itself, gated by the section's own
 * flag. The flags stay in the contract for the API and for rollback.
 */
const rulesSuiteOnlyEnabled = computed(
  () => rulesSuiteEnabled.value && !queriesEnabled.value && !queryGroupsEnabled.value && !etlEnabled.value
);

const featureKeyByItemType: Record<SectionItemType, FeatureFlagKey> = {
  query: 'queries',
  queryGroup: 'queryGroups',
  ruleSet: 'rulesSuite',
  benchmark: 'benchmarks',
  etlJob: 'etl',
  test: 'tests',
  dataGraph: 'dataGraphs',
  tupleSet: 'tupleSets',
  argumentSet: 'argumentSets',
};

const isItemFeatureEnabled = (type: ItemType): boolean => {
  // A scratch item is gated by the section it belongs to, not by a flag of
  // its own: scratch replaces the playgrounds rather than adding to them.
  const key: FeatureFlagKey | null = type === 'scratch'
    ? featureForDraftSection(scratchSection.value)
    : (featureKeyByItemType[type] ?? null);
  return key ? isFeatureEnabled(key) : true;
};

// Router for URL management
const router = useRouter();
const route = useRoute();

const selectedItemType = ref<ItemType | null>(null);
const creationRequest = ref<QueryCreationRequest | null>(null);
const queryGroupCreationRequest = ref<QueryCreationRequest | null>(null);
const selectedQueryId = ref<string | null>(null);
const selectedQueryGroupId = ref<string | null>(null);
const selectedRuleId = ref<string | null>(null);
const selectedDataBlockId = ref<string | null>(null);
const selectedRuleSetId = ref<string | null>(null);
const selectedScratchId = ref<string | null>(null);
const selectedBenchmarkId = ref<string | null>(null);
const selectedEtlJobId = ref<string | null>(null);
const selectedTestId = ref<string | null>(null);
const selectedDataGraphId = ref<string | null>(null);
const selectedTupleSetId = ref<string | null>(null);
const selectedArgumentSetId = ref<string | null>(null);
const sidebarRefreshKey = ref(0);
const queryVersionNumber = ref<number | null>(null);
const queryGroupVersionNumber = ref<number | null>(null);

/**
 * Set when an old `?playground=queries` link arrives: that capability is now
 * the Queries section, so the link redirects there rather than 404-ing into a
 * screen that no longer exists.
 */
let activeSectionFromPlayground: RailSection | null = null;

// Initialise selection from URL synchronously so the correct work-area component
// mounts on the first render, avoiding a transient null → target transition that
// would mount two components in sequence and fire duplicate API calls.
const initSelectionFromRoute = () => {
  const queryId = route.query.query as string | undefined;
  const queryGroupId = route.query.queryGroup as string | undefined;
  const ruleId = route.query.rule as string | undefined;
  const dataBlockId = route.query.dataBlock as string | undefined;
  const RuleSetId = route.query.ruleSet as string | undefined;
  const benchmarkParam = route.query.benchmark as string | undefined;
  const etlJobId = route.query.etlJob as string | undefined;
  const testId = route.query.test as string | undefined;
  const dataGraphId = route.query.dataGraph as string | undefined;
  const tupleSetId = route.query.tupleSet as string | undefined;
  const argumentSetId = route.query.argumentSet as string | undefined;
  const playgroundTarget = route.query.playground as string | undefined;
  const scratchParam = route.query.scratch as string | undefined;
  const versionParam = route.query.version as string | undefined;

  if (versionParam) {
    const parsedVersion = parseInt(versionParam, 10);
    if (!Number.isNaN(parsedVersion) && parsedVersion > 0) {
      if (queryId) queryVersionNumber.value = parsedVersion;
      else if (queryGroupId) queryGroupVersionNumber.value = parsedVersion;
    }
  }

  if (scratchParam) {
    // A scratch link is browser-local by nature: it resolves only where the
    // record lives. Selection is set regardless so the sidebar can show it
    // missing rather than silently landing somewhere else.
    selectedItemType.value = 'scratch';
    selectedScratchId.value = scratchParam;
  } else if (queryId) {
    selectedItemType.value = 'query';
    if (queriesEnabled.value) {
      selectedQueryId.value = queryId;
      selectedQueryGroupId.value = null;
      selectedRuleId.value = null;
      selectedDataBlockId.value = null;
      selectedRuleSetId.value = null;
    }
  } else if (queryGroupId) {
    selectedItemType.value = 'queryGroup';
    if (queryGroupsEnabled.value) {
      selectedQueryGroupId.value = queryGroupId;
      selectedQueryId.value = null;
      selectedRuleId.value = null;
      selectedDataBlockId.value = null;
      selectedRuleSetId.value = null;
    }
  } else if (RuleSetId) {
    selectedItemType.value = 'ruleSet';
    if (rulesSuiteEnabled.value) {
      selectedQueryId.value = null;
      selectedQueryGroupId.value = null;
      selectedRuleId.value = null;
      selectedDataBlockId.value = null;
      selectedRuleSetId.value = RuleSetId;
    }
  } else if (benchmarkParam) {
    selectedItemType.value = 'benchmark';
    if (benchmarksEnabled.value) {
      selectedQueryId.value = null;
      selectedQueryGroupId.value = null;
      selectedRuleId.value = null;
      selectedDataBlockId.value = null;
      selectedRuleSetId.value = null;
      // `?benchmark=true` predates experiments being selectable at all and
      // still means "open the Bench screen"; anything else is an experiment id.
      selectedBenchmarkId.value = benchmarkParam === 'true' ? null : benchmarkParam;
    }
  } else if (etlJobId) {
    selectedItemType.value = 'etlJob';
    if (etlEnabled.value) {
      selectedEtlJobId.value = etlJobId;
    }
  } else if (testId) {
    selectedItemType.value = 'test';
    if (testsEnabled.value) {
      selectedTestId.value = testId;
    }
  } else if (dataGraphId) {
    selectedItemType.value = 'dataGraph';
    if (dataGraphsEnabled.value) {
      selectedDataGraphId.value = dataGraphId;
    }
  } else if (tupleSetId) {
    selectedItemType.value = 'tupleSet';
    if (tupleSetsEnabled.value) {
      selectedTupleSetId.value = tupleSetId;
    }
  } else if (argumentSetId) {
    selectedItemType.value = 'argumentSet';
    if (argumentSetsEnabled.value) {
      selectedArgumentSetId.value = argumentSetId;
    }
  } else if (playgroundTarget) {
    /*
     * The playgrounds are gone as destinations. Each was a screen you could
     * reach with an unsaved body on it, and an unsaved body is a scratch item
     * in its section now — so an old link redirects to that section, whose
     * own landing rule (most recent item, scratch first, else a new scratch
     * item) picks what to open once there.
     */
    activeSectionFromPlayground = PLAYGROUND_REDIRECTS[playgroundTarget] ?? null;
  }

  /*
   * Deliberately not taken from the plan: `/` does not default to a section.
   * The tree is still the unscoped view, and it is the only thing that reaches
   * libraries and backends. Revisit when the tree retires (plan phase 6d).
   */
};

initSelectionFromRoute();

/*
 * The nav rail's scope. Null means unscoped — the tree renders every section,
 * exactly as it did before the rail existed — and that is the state the app
 * loads in unless `?section=` says otherwise. Selecting an artifact lights up
 * the matching entry without imposing a scope, so the rail reads as "where you
 * are" even when nothing has been clicked in it.
 */
const activeSection = ref<RailSection | null>(
  isRailSection(route.query.section) ? route.query.section : activeSectionFromPlayground
);

// Kept apart from activeSection so the highlight never leaks into tree scoping.
const railHighlight = ref<RailSection | null>(null);
const railSelection = computed(() => activeSection.value ?? railHighlight.value);

/**
 * Back to the splash.
 *
 * A state reset rather than a route change: this page *is* `/`, and it reads
 * the URL once at setup — pushing `/` over `/?section=rules` would change the
 * address bar and leave the section open. Clearing the selection and the scope
 * is what the URL watcher then writes back.
 */
function goHome() {
  clearEntitySelection();
  selectedItemType.value = null;
  activeSection.value = null;
}

function handleRailSelect(section: RailSection) {
  if (isScreenSection(section)) {
    router.push({ path: SCREEN_SECTION_PATHS[section], query: activeLibraryId.value ? { library: activeLibraryId.value } : {} });
    return;
  }
  /*
   * Picking a section is navigating away from whatever record is open. Without
   * this the pane kept showing it — a query editor under a Groups sidebar
   * reading "No groups yet" — because the pane follows the selection and the
   * selection did not follow the rail.
   *
   * A link that names a record (`?scratch=`, `?test=`, …) does not come through
   * here, so it still opens its record whatever section the URL names beside
   * it: the record says which section it belongs to, and the rail highlight
   * follows it.
   */
  clearEntitySelection();
  selectedItemType.value = null;
  activeSection.value = activeSection.value === section ? null : section;
  /*
   * Land on something in the same tick as the click. Waiting for the section's
   * list fetch (the watch on `activeListSection`) painted a blank pane, then
   * the section's "nothing open" state, then the work area — three frames of
   * flicker for a record that was already in memory.
   */
  if (activeListSection.value) restoreSection(activeListSection.value);
}

/* ------------------------------------------------------------------ *
 * The flat sidebar, for every section that has one.
 *
 * Five sections, one code path. What each of them varies on is declared in
 * `lib/sections.ts`; everything below reads that table rather than branching
 * on the section name, because the five branches were the same six decisions
 * written out five times and they drifted apart the moment one changed.
 * ------------------------------------------------------------------ */

const { activeLibraryId, activeLibraryName, ensureLoaded: ensureLibrariesLoaded } = useActiveLibrary();

/*
 * The change feed. An external MCP client writing to this library refreshes the
 * query list and, crucially, the open query's concurrency token — a write that
 * bypassed this store leaves a stale etag, and the user's next save would fail
 * with a 412 they did nothing to earn.
 */
useLibraryEvents({ libraryId: activeLibraryId, openEntityId: selectedQueryId });

/*
 * The library's tags, fetched once per library and handed to whichever section
 * sidebar is on screen. They belong to the library rather than to a section —
 * one vocabulary, and the same colour for `Production` whether you are looking
 * at queries or rule sets — so they are loaded here rather than in each list.
 */
const tagsStore = useTagsStore();
const libraryTags = computed(() =>
  tagsStore.tags.value.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color ?? null })),
);
watch(activeLibraryId, (libraryId) => { void tagsStore.loadTags(libraryId); }, { immediate: true });

const draftsStore = useCallableDrafts();
const testsStore = useTestsStore();

/*
 * Running a whole list — the section's, or one heading's.
 *
 * Sequential rather than concurrent: a run can reach a live backend, and firing
 * two hundred at one endpoint is a load test nobody asked for. Each verdict
 * lands in the store as it arrives, so the rows tick over one at a time instead
 * of the list sitting still and then changing all at once.
 */
const runningAll = ref(false);
const runAllDone = ref(0);
const runAllTotal = ref(0);

const runAllLabel = computed(() =>
  runningAll.value ? `${runAllDone.value}/${runAllTotal.value}` : 'Run all',
);

/**
 * The tags the tests in view carry, with how many carry each.
 *
 * Built from the rows rather than from the library's tag list so the menu
 * never offers a tag that would run nothing here — a library's tags span every
 * section, and Queries' tags are not a test suite.
 */
function runnableTags(items: SidebarEntity[]): RunByTagOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return libraryTags.value
    .filter((tag) => counts.has(tag.id))
    .map((tag) => ({ ...tag, count: counts.get(tag.id) ?? 0 }));
}

/**
 * Run a tag's tests server-side — one request, whatever the tag holds.
 *
 * Deliberately not `runAllTests(rows carrying the tag)`: the rows are what this
 * client last loaded, and the question being asked is about the tag.
 */
async function runTaggedTests(tagIds: string[], match: TagMatchMode = 'any') {
  if (runningAll.value || tagIds.length === 0) return;
  const expected = testIdsCarrying(tagIds, match);
  runningAll.value = true;
  runAllDone.value = 0;
  // The count this client can see carrying the tags, so the button counts up
  // against a total rather than sitting at `0/0` until the server answers. The
  // server owns the selection, and the tally below corrects this if it differs.
  runAllTotal.value = expected.length;
  /*
   * The scope is opened with this client's guess at what the tags hold, so the
   * Runs tab has rows to show while the request is in flight, and closed with
   * what actually ran: the server owns the selection, and a tag that gained a
   * test since the list loaded still runs it.
   */
  beginTestRun({
    kind: 'tag',
    label: tagScopeLabel(tagIds, match),
    testIds: expected,
    tagIds,
    match,
  });
  try {
    const run = await testsStore.runTaggedTests(tagIds, match);
    runAllDone.value = run.results.length;
    runAllTotal.value = run.requested;
    // One round trip, so they all answer together — that is the trade the
    // single request makes.
    const answered = run.results.map((result) => result.testId);
    endTestRun({ testIds: answered, answeredIds: answered });
  } catch (error) {
    endTestRun({ cancelled: true });
    throw error;
  } finally {
    runningAll.value = false;
  }
}

/** `tag: conformance`, or `tags: a + b` when the run named more than one. */
function tagScopeLabel(tagIds: string[], match: TagMatchMode): string {
  const names = tagIds.map((id) => libraryTags.value.find((tag) => tag.id === id)?.name ?? 'tag');
  if (names.length === 1) return `tag: ${names[0]}`;
  return `tags: ${names.join(match === 'all' ? ' + ' : ' / ')}`;
}

/** The tests this client can see carrying the tags — the run's opening guess. */
function testIdsCarrying(tagIds: string[], match: TagMatchMode): string[] {
  return testsStore.tests.value
    .filter((test) => {
      const carried = test.tags ?? [];
      return match === 'all'
        ? tagIds.every((tag) => carried.includes(tag))
        : tagIds.some((tag) => carried.includes(tag));
    })
    .map((test) => test.id);
}

/**
 * The same tagged run, saved as a report instead of shown as verdicts.
 *
 * Runs server-side exactly as `runTaggedTests` does — an export *is* a run,
 * because the library keeps no run to fetch afterwards — but the rail is left
 * alone: the file holds this run's verdicts, and repainting the rows from a
 * download would make the two controls look like two kinds of Run.
 */
async function exportTaggedTests(
  tagIds: string[],
  match: TagMatchMode,
  format: TestReportFormat,
) {
  if (runningAll.value || tagIds.length === 0) return;
  runningAll.value = true;
  try {
    const report = await useApiClient().exportTaggedTestRun({
      tags: tagIds,
      match,
      accept: format.accept,
      filename: format.filename,
    });
    downloadTextFile(report.body, report.filename, report.contentType);
    toast.success(`Exported ${format.label}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not export the report');
  } finally {
    runningAll.value = false;
  }
}

async function runAllTests(items: SidebarEntity[]) {
  await runTestIds(items.map((item) => item.id), 'all', 'all tests');
}

/** One heading's tests, run as the group they are listed under. */
async function runGroupTests(items: SidebarEntity[], label: string) {
  await runTestIds(items.map((item) => item.id), 'group', `group: ${label}`);
}

/**
 * Run a known set of tests, one at a time, as one run.
 *
 * Sequential rather than concurrent: a run can reach a live backend, and firing
 * two hundred at one endpoint is a load test nobody asked for. Each verdict
 * lands in the store as it arrives, so the Runs tab fills in rather than
 * sitting still and then changing all at once.
 */
async function runTestIds(testIds: string[], kind: 'all' | 'group' | 'test', label: string) {
  if (runningAll.value || testIds.length === 0) return;
  runningAll.value = true;
  runAllDone.value = 0;
  runAllTotal.value = testIds.length;
  beginTestRun({ kind, label, testIds });
  try {
    for (const testId of testIds) {
      // One at a time through `runTests`, not `runTest`: the plural records a
      // test that *could not run* as a failed verdict rather than throwing, so
      // one broken subject cannot end the run. The tally is the point, and a
      // suite stops being a suite the moment one red test hides the rest.
      await testsStore.runTests([testId]);
      // One at a time, so the tab fills in as the run walks the list rather
      // than showing the previous run's verdicts until this one finishes.
      noteTestsAnswered([testId]);
      runAllDone.value += 1;
    }
    endTestRun({ testIds });
  } finally {
    // A run that threw part-way still answered for what it reached, and the
    // scope says so rather than claiming the whole set.
    if (runAllDone.value < testIds.length) endTestRun({ testIds, cancelled: true });
    runningAll.value = false;
  }
}

/**
 * `?argumentSet=` — how "Run with…" on an argument set's Fits list arrives.
 *
 * Read here because the page owns the route; the callable screens take it as a
 * prop rather than reaching for router state they otherwise have no use for.
 */
const preselectArgumentSetId = computed(() => {
  const requested = route.query.argumentSet;
  const value = Array.isArray(requested) ? requested[0] : requested;
  return typeof value === 'string' && value ? value : null;
});

/*
 * One scratch handle per section, built once. `useScratchItems` is a plain
 * factory over the shared store, so these are views of one list, not five.
 */
const scratchBySection: Record<DraftSection, ReturnType<typeof useScratchItems>> = {
  query: useScratchItems('query'),
  group: useScratchItems('group'),
  rule: useScratchItems('rule'),
  etl: useScratchItems('etl'),
  bench: useScratchItems('bench'),
  test: useScratchItems('test'),
  dataGraph: useScratchItems('dataGraph'),
  tupleSet: useScratchItems('tupleSet'),
  argumentSet: useScratchItems('argumentSet'),
  /*
   * Present so the map stays total, and unreachable from here: notebooks are a
   * screen of their own (`/notebook`) with their own list, the way Build is.
   */
  notebook: useScratchItems('notebook'),
};

/**
 * A share link for a scratch item (`#share=…`): take the copy it carries into
 * this browser as a scratch item of our own and open it.
 *
 * The address bar then shows *our* `?scratch=` id, not the link — that id is
 * this browser's, and Share makes a fresh link from the live body whenever one
 * is wanted (see lib/shareLink.ts for why the body is not kept in the URL).
 *
 * Opening the same link twice reopens the first copy rather than making a
 * second: a reload, or a link clicked again from a chat, is not a request for
 * a duplicate.
 */
async function importSharedFromHash(hash: string) {
  const encoded = sharePayloadFromHash(hash);
  if (!encoded) return;
  const payload = await decodeSharePayload(encoded);
  // The fragment is spent either way. Cleared before the selection changes so
  // the watcher's own replace, which keeps no hash, is the last word.
  await router.replace({ query: route.query, hash: '' });
  if (!payload) {
    toast.error('That share link is damaged or incomplete');
    return;
  }
  const record = findSharedCopy(payload) ?? createSharedCopy(payload);
  activeSection.value = listSectionForDraftSection(payload.section);
  handleSelectScratch(record.id);
}

const UNTITLED_SHARED = /^Untitled (query|rule set) \d+$/;

function findSharedCopy(payload: ScratchSharePayload): CallableDraft | undefined {
  const body = JSON.stringify(payload.body);
  const untitled = UNTITLED_SHARED.test(payload.name);
  return scratchBySection[payload.section].items().find((item) =>
    JSON.stringify(item.body) === body
    && (untitled ? UNTITLED_SHARED.test(item.name) : item.name === payload.name));
}

function createSharedCopy(payload: ScratchSharePayload): CallableDraft {
  const created = scratchBySection[payload.section].create(payload.body);
  // An "Untitled query 3" from someone else's browser keeps this browser's
  // next ordinal, so it cannot collide with a scratch item already here.
  draftsStore.save({
    ...created,
    name: UNTITLED_SHARED.test(payload.name) ? created.name : payload.name,
    description: payload.description,
    defaultBackend: payload.defaultBackend ?? created.defaultBackend,
  });
  return draftsStore.get(created.id) ?? created;
}

watch(() => route.hash, (hash) => { void importSharedFromHash(hash); }, { immediate: true });

/** The section whose sidebar is showing, or null when the tree is. */
const activeListSection = computed<ListSection | null>(() => {
  const section = activeSection.value;
  if (!section || !isListSection(section)) return null;
  return isFeatureEnabled(SECTION_DEFINITIONS[section].feature) ? section : null;
});

/** The section a scratch selection belongs to — the record's own answer. */
const scratchSection = computed<DraftSection | null>(() => {
  if (selectedItemType.value !== 'scratch') return null;
  const id = selectedScratchId.value;
  if (!id) return null;
  void draftsStore.allDrafts.value;
  const record = draftsStore.get(id);
  if (record) return record.section;
  /*
   * A link to a record this browser does not hold. Fall back to the section it
   * was opened in so the work area still mounts and can say the record is
   * missing — landing somewhere else without explanation is worse.
   */
  const section = activeListSection.value;
  return section ? SECTION_DEFINITIONS[section].draftSection : null;
});

/**
 * What the pane shows when the active section has nothing open.
 *
 * `null` where the pane already belongs to the section — a record of its kind
 * is open, or an unsaved one of its kind is — and where the rail is unscoped,
 * which is the state the app loads in.
 */
const sectionOverview = computed(() => {
  const section = activeListSection.value;
  if (!section) return null;
  // Something is open, and the pane is for what is open — including a record
  // from another section, which is what a `?scratch=` link across sections
  // opens deliberately.
  if (selectedItemType.value) return null;

  const definition = SECTION_DEFINITIONS[section];
  return {
    noun: definition.noun,
    blurb: definition.blurb,
    docsUrl: conceptsDocUrl(definition.docsAnchor),
    docsLabel: `What ${definition.nounPlural} are, in the documentation`,
  };
});

/*
 * Which rail entry lights up. Declared after `scratchSection` rather than
 * beside the other rail state because it reads it immediately, and a watcher
 * that reads a `const` declared below it is a temporal-dead-zone crash on the
 * server render, not a lint nit.
 */
watch(
  [selectedItemType, scratchSection],
  ([itemType, draftSection]) => {
    // A scratch item lights up the section it belongs to. It is an unsaved
    // item in that section, not a place of its own (nav doc §1).
    const derived = itemType === 'scratch'
      ? (draftSection ? listSectionForDraftSection(draftSection) : null)
      : sectionForItemType(itemType as string | null);
    if (derived) {
      railHighlight.value = derived;
    }
  },
  { immediate: true }
);

function featureForDraftSection(draftSection: DraftSection | null): FeatureFlagKey | null {
  if (!draftSection) return null;
  const section = listSectionForDraftSection(draftSection);
  return section ? SECTION_DEFINITIONS[section].feature : null;
}

/*
 * The two switches that used to sit here — which store holds a kind, and how to
 * load it — moved to `useEntityKinds`, because the splash counts the same nine
 * kinds and derives its activity log from them. `loadSectionKind` keeps the
 * one-argument call this file makes everywhere by closing over the active
 * library, which is the only scoping the listing needs.
 */
function loadKind(type: SectionItemType): Promise<unknown> {
  return loadEntityKind(type, { library: activeLibraryId.value });
}

/**
 * The Saved cluster's rows, in the order the section declares its kinds.
 *
 * Each row carries the kind it came from, because a section can list more than
 * one: in Rules, a rule and the data block under it are two rows that open two
 * different work areas, and the id alone does not say which.
 */
function savedFor(section: ListSection): SidebarEntity[] {
  const definition = SECTION_DEFINITIONS[section];
  const libraryId = activeLibraryId.value;
  if (definition.libraryScoped && !libraryId) return [];
  const rows: SidebarEntity[] = [];
  for (const kind of definition.savedKinds) {
    const matching = entitiesOfKind(kind.type)
      .filter((entity) => !definition.libraryScoped || isInLibrary(entity as never, libraryId!))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entity of matching) {
      // `tags` rides along on the entity the server sent; naming it here is
      // what keeps the row type honest about carrying them.
      rows.push({
        ...entity,
        kind: kind.type,
        tags: (entity as { tags?: string[] | null }).tags ?? [],
        origin: originFor(kind.type, entity as unknown as Record<string, unknown>),
        ...testRowExtras(kind.type, entity.id),
      });
    }
  }
  return rows;
}

/**
 * Where a row came from, for the Origin grouping.
 *
 * An argument set says so itself: `scope` records the kind of callable it was
 * made on, and a set composed on the rail has none. A data graph says so
 * through `mintedFrom`, the argument set it was born on — and a graph binding
 * exists only on a group's set (a query declares no graph parameter), so a
 * minted graph is *From groups* whether or not that set is loaded here.
 *
 * Provenance, not a fence: a set made on one query is legitimately what another
 * wants, which is why the switcher computes a fits verdict at all, and a graph
 * minted from a group is an ordinary graph the moment it exists.
 */
function originFor(kind: string, entity: Record<string, unknown>): SidebarEntity['origin'] {
  if (kind === 'argumentSet') {
    const scope = entity.scope;
    if (scope === 'query') return 'query';
    if (scope === 'queryGroup') return 'group';
    return 'composed';
  }
  if (kind === 'dataGraph') {
    return typeof entity.mintedFrom === 'string' && entity.mintedFrom ? 'group' : 'composed';
  }
  return 'composed';
}

/*
 * What a test row carries beyond name and id: its last verdict.
 *
 * The verdict is what makes Run all legible — two hundred rows ticking green
 * one at a time, rather than a list that sits still and then claims it is done.
 * Reading `lastRunByTest` here is what keeps that live.
 */
function testRowExtras(kind: string, id: string): Partial<SidebarEntity> {
  if (kind !== 'test') return {};
  const lastRun = testsStore.lastRunByTest.value[id];
  return { verdict: lastRun ? (lastRun.passed ? 'pass' : 'fail') : undefined };
}

// Reading the store's ref inside the computed keeps the cluster live: a
// keystroke in the editor re-sorts the list without anyone re-fetching.
function scratchFor(draftSection: DraftSection | null) {
  if (!draftSection) return [];
  void draftsStore.allDrafts.value;
  return scratchBySection[draftSection].items();
}

const flatSidebar = computed(() => {
  const section = activeListSection.value;
  if (!section) return null;
  const definition = SECTION_DEFINITIONS[section];
  return {
    section,
    label: definition.label,
    noun: definition.noun,
    nounPlural: definition.nounPlural,
    savedKinds: definition.savedKinds,
    supportsScratch: definition.draftSection !== null,
    supportsSaved: definition.savedKinds.length > 0,
    /*
     * Whether this section's rows can carry tags at all. Bench and ETL cannot:
     * a benchmark experiment has no `isPartOf` and an ETL job's is undeclared,
     * so neither has a library for the one tag invariant to judge against.
     */
    supportsTags: definition.savedKinds.every((kind) => isTaggableKind(kind.type)),
    /*
     * Origin is offered only where rows can differ in it. Everywhere else every
     * row would land in *Composed here*, and a control that can produce one
     * cluster is a control that does nothing — the same rule the tag control
     * follows for Bench and ETL.
     */
    supportsOrigin: section === 'dataGraphs' || section === 'argumentSets',
    /*
     * Other ways to start one. Only Rules has a second: a rule is a CONSTRUCT
     * with the head and body swapped round, so a library of them is a library
     * of rules nobody has converted yet.
     */
    newOptions: section === 'rules'
      ? [{ key: 'import-construct', label: 'Import from SPARQL…' }]
      : [],
    saved: savedFor(section),
    scratch: scratchFor(definition.draftSection),
  };
});

/** The id of whatever saved entity is selected, whichever kind it is. */
const savedSelectionId = computed(() => {
  switch (selectedItemType.value) {
    case 'query': return selectedQueryId.value;
    case 'queryGroup': return selectedQueryGroupId.value;
    case 'ruleSet': return selectedRuleSetId.value;
    case 'benchmark': return selectedBenchmarkId.value;
    case 'etlJob': return selectedEtlJobId.value;
    case 'test': return selectedTestId.value;
    case 'dataGraph': return selectedDataGraphId.value;
    case 'tupleSet': return selectedTupleSetId.value;
    case 'argumentSet': return selectedArgumentSetId.value;
    default: return null;
  }
});

const sidebarSelection = computed<SidebarSelection>(() => {
  if (selectedItemType.value === 'scratch' && selectedScratchId.value) {
    return { kind: 'scratch', id: selectedScratchId.value };
  }
  const id = savedSelectionId.value;
  return id ? { kind: 'saved', id } : { kind: 'none', id: null };
});

function clearEntitySelection() {
  selectedQueryId.value = null;
  selectedQueryGroupId.value = null;
  selectedRuleId.value = null;
  selectedDataBlockId.value = null;
  selectedRuleSetId.value = null;
  selectedBenchmarkId.value = null;
  selectedEtlJobId.value = null;
  selectedTestId.value = null;
  selectedDataGraphId.value = null;
  selectedTupleSetId.value = null;
  selectedArgumentSetId.value = null;
  selectedScratchId.value = null;
  creationRequest.value = null;
}

function handleSelectSaved(id: string, kind: string) {
  selectSavedItem(kind as SectionItemType, id);
}

/**
 * A row in the splash's activity log names an entity, so the click opens that
 * entity rather than the section it lives in — the log would be a list of
 * headings otherwise.
 *
 * The first saved kind is the right one: a section that lists several (Rules
 * once did) declares the one its own rows are first, and the log is built from
 * the same table.
 */
function handleSplashOpenEntity(payload: { section: ListSection; id: string }) {
  const kind = SECTION_DEFINITIONS[payload.section].savedKinds[0]?.type;
  if (!kind) return;
  activeSection.value = payload.section;
  selectSavedItem(kind, payload.id);
}

function selectSavedItem(kind: SectionItemType, id: string) {
  clearEntitySelection();
  selectedItemType.value = kind;
  switch (kind) {
    case 'query':
      selectedQueryId.value = id;
      queryVersionNumber.value = null;
      break;
    case 'queryGroup':
      selectedQueryGroupId.value = id;
      queryGroupVersionNumber.value = null;
      break;
    case 'ruleSet': selectedRuleSetId.value = id; break;
    // An empty id is the tree's Bench entry: open the screen, not an
    // experiment. The work area picks its own default from there.
    case 'benchmark': selectedBenchmarkId.value = id || null; break;
    case 'etlJob': selectedEtlJobId.value = id; break;
    case 'test': selectedTestId.value = id; break;
    case 'dataGraph': selectedDataGraphId.value = id; break;
    case 'tupleSet': selectedTupleSetId.value = id; break;
    case 'argumentSet': selectedArgumentSetId.value = id; break;
  }
}

function handleSelectScratch(id: string) {
  clearEntitySelection();
  selectedItemType.value = 'scratch';
  selectedScratchId.value = id;
  queryVersionNumber.value = null;
}

/**
 * `+ New`.
 *
 * No dialog, in any section: the whole point is that starting one costs a
 * click and nothing reaches the server until save (nav doc §1). Groups were
 * the last exception, and are not one any more — a canvas serializes into the
 * same browser-local record as everything else.
 *
 * A new record's body is null, and the work area fills in its own defaults on
 * hydration without writing them back. That keeps "has the user typed
 * anything?" honest, which is what decides whether `×` asks before discarding.
 */
function handleCreateFromSidebar() {
  const section = activeListSection.value;
  if (!section) return;
  const draftSection = SECTION_DEFINITIONS[section].draftSection;
  if (!draftSection) return;
  const created = scratchBySection[draftSection].create(draftSection === 'query' ? '' : null);
  handleSelectScratch(created.id);
}

/**
 * The handoff at the save moment: the item moves from Scratch to Saved and
 * stays selected, so the screen you are looking at is still the query you were
 * writing — only now it is a v1 in the library.
 */
/*
 * The deleted query is still the selection, so clear it before the list
 * reloads — otherwise the work area briefly asks the server for something that
 * is no longer there and shows its own load error.
 */
async function handleQueryDeleted(id: string) {
  if (selectedQueryId.value === id) {
    selectedItemType.value = null;
    selectedQueryId.value = null;
    queryVersionNumber.value = null;
  }
  await queriesStore.loadQueries();
  sidebarRefreshKey.value += 1;
}

/**
 * The handoff at the save moment, the same in every section: the item moves
 * from Scratch to Saved and stays selected, so the screen you are looking at is
 * still the thing you were writing — only now it is in the library.
 */
async function handleSaved(kind: SectionItemType, id: string) {
  await loadKind(kind);
  selectSavedItem(kind, id);
  sidebarRefreshKey.value += 1;
}

async function handleScratchSaved(payload: { id: string }) {
  await handleSaved('query', payload.id);
}

async function handleQueryGroupScratchSaved(payload: { id: string }) {
  await handleSaved('queryGroup', payload.id);
}

async function handleEtlScratchSaved(payload: { id: string }) {
  await handleSaved('etlJob', payload.id);
}

async function handleRuleSetSaved(payload: { id: string }) {
  await handleSaved('ruleSet', payload.id);
}

async function handleBenchmarkSaved(payload: { id: string }) {
  await handleSaved('benchmark', payload.id);
}

/**
 * "Open in Tuples" / "Open in Data" from a rule set's Inputs tab.
 *
 * The inputs are their own entities in their own rail sections, so pointing at
 * one is navigation — the same move opening a test from a Tests tab makes.
 */
function openInputEntity(payload: { type: 'tupleSet' | 'dataGraph'; id: string }) {
  activeSection.value = payload.type === 'tupleSet' ? 'tupleSets' : 'dataGraphs';
  selectSavedItem(payload.type, payload.id);
}

/**
 * "Open in Query" from a rule set's SPARQL tab.
 *
 * A compiled program is text, not an entity, so it lands where unsaved text
 * lands everywhere else in this app: a scratch query. Nothing is written to the
 * library until the author saves it.
 */
function openSparqlAsScratchQuery(sparql: string) {
  const created = scratchBySection.query.create(sparql);
  activeSection.value = 'queries';
  handleSelectScratch(created.id);
}

/**
 * Take the page to something a work area just created.
 *
 * "create test" and "create benchmark" on a run bar write a real object, and
 * leaving you on the screen you pressed it from would make you go and find it.
 * The section is derived from the kind rather than passed, so a work area names
 * what it made and nothing else.
 */
function openCreatedEntity(payload: { type: SectionItemType; id: string }) {
  const section = sectionForItemType(payload.type);
  if (section) activeSection.value = section;
  selectSavedItem(payload.type, payload.id);
}

/** Open a test from a subject's Tests tab: the Tests section, that test. */
function openTest(testId: string) {
  activeSection.value = 'tests';
  selectSavedItem('test', testId);
}

async function handleDataGraphSaved(payload: { id: string }) {
  await handleSaved('dataGraph', payload.id);
}

function handleDataGraphDeleted() {
  clearEntitySelection();
  selectedItemType.value = null;
}

async function handleTupleSetSaved(payload: { id: string }) {
  await handleSaved('tupleSet', payload.id);
}

function handleTupleSetDeleted() {
  clearEntitySelection();
  selectedItemType.value = null;
}

async function handleArgumentSetSaved(payload: { id: string }) {
  await handleSaved('argumentSet', payload.id);
}

/**
 * An argument set saved from a callable's screen: refresh the rail, stay put.
 *
 * `handleArgumentSetSaved` above also *selects* the set, which is right when
 * the save happened in the Argument sets section — you saved the thing you are
 * looking at. Here you saved a set while working on a query, and navigating to
 * it would take the query off the screen. What was missing was only the list
 * refresh: saved sets used to appear on switching to the section, because that
 * triggers a load, so this was "stale until you navigate" rather than "lost".
 */
async function handleArgumentSetSavedElsewhere() {
  await loadKind('argumentSet');
  sidebarRefreshKey.value += 1;
}

function handleArgumentSetDeleted() {
  clearEntitySelection();
  selectedItemType.value = null;
}

/** "Run with…" on an argument set's Fits list: open the callable, set chosen. */
function openCallableWithArguments(payload: { id: string; kind: 'query' | 'queryGroup'; argumentSetId: string | null }) {
  clearEntitySelection();
  selectedItemType.value = payload.kind;
  if (payload.kind === 'query') selectedQueryId.value = payload.id;
  else selectedQueryGroupId.value = payload.id;
  activeSection.value = payload.kind === 'query' ? 'queries' : 'queryGroups';
  if (payload.argumentSetId) {
    void router.replace({
      query: { ...route.query, [payload.kind === 'query' ? 'query' : 'queryGroup']: payload.id, argumentSet: payload.argumentSetId },
    });
  }
}

async function handleTestSaved(payload: { id: string }) {
  await handleSaved('test', payload.id);
}

function handleTestDeleted() {
  clearEntitySelection();
  selectedItemType.value = null;
}

const scratchDiscardTarget = ref<{ id: string; name: string } | null>(null);
const scratchDiscardOpen = ref(false);

function requestDiscardScratch(id: string) {
  const item = draftsStore.get(id);
  if (!item) return;
  // An empty untitled scratch item dies silently — a confirm for nothing is
  // just a click. Anything with a body gets asked about.
  if (!scratchBySection[item.section].needsDiscardConfirm(id)) {
    discardScratch(id);
    return;
  }
  scratchDiscardTarget.value = { id, name: item.name };
  scratchDiscardOpen.value = true;
}

function discardScratch(id: string) {
  const item = draftsStore.get(id);
  if (!item) return;
  scratchBySection[item.section].discard(id);
  if (selectedScratchId.value === id) {
    selectedScratchId.value = null;
    selectedItemType.value = null;
    const section = activeListSection.value;
    if (section) selectMostRecent(section);
  }
}

function confirmDiscardScratch() {
  const target = scratchDiscardTarget.value;
  scratchDiscardOpen.value = false;
  scratchDiscardTarget.value = null;
  if (target) discardScratch(target.id);
}

/**
 * Landing state for a section opened with nothing selected: the most recently
 * touched item, scratch first. An unsaved body is the thing most likely to be
 * what you came back for.
 */
function selectMostRecent(section: ListSection) {
  const definition = SECTION_DEFINITIONS[section];
  const scratch = scratchFor(definition.draftSection)[0];
  if (scratch) {
    handleSelectScratch(scratch.id);
    return;
  }
  const saved = savedFor(section)[0];
  if (saved) {
    selectSavedItem((saved.kind ?? definition.savedKinds[0]?.type) as SectionItemType, saved.id);
  }
}

/** Whether what is already selected is something this section's list holds. */
function selectionBelongsTo(section: ListSection): boolean {
  const definition = SECTION_DEFINITIONS[section];
  const type = selectedItemType.value;
  if (!type) return false;
  if (type === 'scratch') return scratchSection.value === definition.draftSection;
  return definition.savedKinds.some((kind) => kind.type === type);
}

/*
 * Where each section was last left, so coming back to it reopens that record
 * rather than whatever happens to be most recent.
 */
const lastSelectionBySection = new Map<ListSection, { type: SectionItemType | 'scratch'; id: string }>();

watch([activeListSection, selectedItemType, savedSelectionId, selectedScratchId], ([section]) => {
  if (!section || !selectionBelongsTo(section)) return;
  if (selectedItemType.value === 'scratch' && selectedScratchId.value) {
    lastSelectionBySection.set(section, { type: 'scratch', id: selectedScratchId.value });
  } else if (selectedItemType.value && selectedItemType.value !== 'scratch' && savedSelectionId.value) {
    lastSelectionBySection.set(section, { type: selectedItemType.value, id: savedSelectionId.value });
  }
});

/**
 * Open a section on the record it was left on, if that record still exists,
 * else on its most recent. Reads only what is already loaded, so on a first
 * visit it may select nothing — the fetch below then lands the section.
 */
function restoreSection(section: ListSection) {
  const last = lastSelectionBySection.get(section);
  if (last?.type === 'scratch') {
    if (scratchFor(SECTION_DEFINITIONS[section].draftSection).some((entry) => entry.id === last.id)) {
      handleSelectScratch(last.id);
      return;
    }
  } else if (last && savedFor(section).some((entry) => entry.id === last.id)) {
    selectSavedItem(last.type, last.id);
    return;
  }
  selectMostRecent(section);
}

/*
 * A section's own list has to be fetched by the section — the tree used to be
 * what did that, and four of the five no longer render it.
 */
watch(
  activeListSection,
  async (section) => {
    if (!section) return;
    migratePlaygroundTabs();
    const definition = SECTION_DEFINITIONS[section];
    await Promise.all([
      ensureLibrariesLoaded(),
      ...definition.savedKinds.map((kind) => loadKind(kind.type)),
    ]);
    if (selectionBelongsTo(section)) return;
    selectMostRecent(section);
    // Nothing to land on at all — an empty library and no unsaved work. Start
    // one, because an empty editor is a better first screen than an empty list.
    if (!selectedItemType.value && definition.draftSection) {
      handleCreateFromSidebar();
    }
  },
  { immediate: true }
);

const featureDisabledMessage = computed(() => {
  const type = selectedItemType.value;
  if (!type) {
    return null;
  }
  if (isItemFeatureEnabled(type)) {
    return null;
  }
  const featureKey = type === 'scratch'
    ? featureForDraftSection(scratchSection.value)
    : featureKeyByItemType[type];
  if (!featureKey) return null;
  return `${labelFor(featureKey)} feature is disabled. Update your environment flags to enable this section.`;
});

// Dialog state
const libraryDialogOpen = ref(false);
const editingLibraryId = ref<string | null>(null);
const editingLibraryData = ref<{ name: string; description: string | null; defaultBackend: string | null } | null>(null);
/*
 * Backends. The section owns a selection and at most one unsaved record: `+`
 * inserts a draft row rather than opening a dialog, so creation and editing are
 * the same screen (backends UI doc §Creation).
 */
const selectedBackendId = ref<string | null>(null);
const backendDraft = ref(false);
const backendDraftName = ref('');
const deleteConfirmOpen = ref(false);
const deleteTarget = ref<{ libraryId: string; libraryName: string } | null>(null);
const backendDeleteConfirmOpen = ref(false);
const backendDeleteTarget = ref<{ backendId: string; backendName: string } | null>(null);
const backendDeleteReferences = ref<{ libraries: Array<{ id: string; name: string }>; queries: Array<{ id: string; name: string }> } | null>(null);
const backendDeleteLoading = ref(false);
const backends = computed<Backend[]>(() => backendsStore.backends.value);

/* ------------------------------------------------------------------ *
 * Backends — a list and a record, not a tree branch and a dialog.
 * ------------------------------------------------------------------ */

const backendProbes = useBackendProbes();

/** True when the rail is scoped to Backends, which is the record page's home. */
const backendsSection = computed(() => activeSection.value === 'backends' && backendsEnabled.value);

watch(backendsSection, async (active) => {
  if (!active) return;
  await backendsStore.loadBackends();
  // Cached observations only. Probing six stores because someone opened the
  // section would make the dots cost a page load.
  await backendProbes.loadProbes();
  if (!selectedBackendId.value && !backendDraft.value) {
    selectedBackendId.value = backends.value[0]?.id ?? null;
  }
}, { immediate: true });

function handleSelectBackend(id: string) {
  backendDraft.value = false;
  selectedBackendId.value = id;
}

function startCreateBackend() {
  activeSection.value = 'backends';
  backendDraftName.value = '';
  backendDraft.value = true;
}

function handleBackendCreated(backend: Backend) {
  backendDraft.value = false;
  backendDraftName.value = '';
  selectedBackendId.value = backend.id;
  sidebarRefreshKey.value += 1;
}

const libraries = computed<Library[]>(() => librariesStore.libraries.value);
// Sync URL with selection state
watch([selectedItemType, selectedQueryId, selectedScratchId, selectedQueryGroupId, selectedRuleId, selectedDataBlockId, selectedRuleSetId, selectedBenchmarkId, selectedEtlJobId, selectedTestId, selectedDataGraphId, selectedTupleSetId, selectedArgumentSetId, activeSection], () => {
  const params: Record<string, string> = {};

  if (activeSection.value) {
    params.section = activeSection.value;
  }

  switch (selectedItemType.value) {
    case 'query':
      if (selectedQueryId.value) {
        params.query = selectedQueryId.value;
      }
      break;
    case 'scratch':
      if (selectedScratchId.value) {
        params.scratch = selectedScratchId.value;
      }
      break;
    case 'queryGroup':
      if (selectedQueryGroupId.value) {
        params.queryGroup = selectedQueryGroupId.value;
      }
      break;
    case 'ruleSet':
      if (selectedRuleSetId.value) {
        params.ruleSet = selectedRuleSetId.value;
      }
      break;
    case 'benchmark':
      // `true` when no experiment is open, so an old bookmark keeps its shape.
      params.benchmark = selectedBenchmarkId.value ?? 'true';
      break;
    case 'etlJob':
      if (selectedEtlJobId.value) {
        params.etlJob = selectedEtlJobId.value;
      }
      break;
    case 'test':
      if (selectedTestId.value) {
        params.test = selectedTestId.value;
      }
      break;
    case 'dataGraph':
      if (selectedDataGraphId.value) {
        params.dataGraph = selectedDataGraphId.value;
      }
      break;
    case 'tupleSet':
      if (selectedTupleSetId.value) {
        params.tupleSet = selectedTupleSetId.value;
      }
      break;
    case 'argumentSet':
      if (selectedArgumentSetId.value) {
        params.argumentSet = selectedArgumentSetId.value;
      }
      break;
    default:
      break;
  }

  // Add version to params if present
  if ((selectedItemType.value === 'query' && queryVersionNumber.value != null) ||
      (selectedItemType.value === 'queryGroup' && queryGroupVersionNumber.value != null)) {
    const versionNum = selectedItemType.value === 'query'
      ? queryVersionNumber.value
      : queryGroupVersionNumber.value;
    if (versionNum != null) {
      params.version = versionNum.toString();
    }
  }

  const currentQuery = route.query.query as string | undefined;
  const currentQueryGroup = route.query.queryGroup as string | undefined;
  const currentRule = route.query.rule as string | undefined;
  const currentDataBlock = route.query.dataBlock as string | undefined;
  const currentRuleSet = route.query.ruleSet as string | undefined;
  const currentBenchmark = route.query.benchmark as string | undefined;
  const currentVersion = route.query.version as string | undefined;
  const currentPlayground = route.query.playground as string | undefined;
  const currentScratch = route.query.scratch as string | undefined;
  const currentSection = route.query.section as string | undefined;
  /*
   * The four newest sections were written above but never compared here, so
   * switching between two saved data graphs (or tests, tuple sets, ETL jobs)
   * produced no `router.replace` and the URL kept the previous id — a reload or
   * a shared link then opened the wrong record. Adding `argumentSet` alongside
   * them rather than inheriting the same gap.
   */
  const currentTest = route.query.test as string | undefined;
  const currentDataGraph = route.query.dataGraph as string | undefined;
  const currentTupleSet = route.query.tupleSet as string | undefined;
  const currentEtlJob = route.query.etlJob as string | undefined;
  const currentArgumentSet = route.query.argumentSet as string | undefined;

  if (
    currentSection !== params.section ||
    currentScratch !== params.scratch ||
    currentQuery !== params.query ||
    currentQueryGroup !== params.queryGroup ||
    currentRule !== params.rule ||
    currentDataBlock !== params.dataBlock ||
    currentRuleSet !== params.ruleSet ||
    currentBenchmark !== params.benchmark ||
    currentVersion !== params.version ||
    currentPlayground !== params.playground ||
    currentTest !== params.test ||
    currentDataGraph !== params.dataGraph ||
    currentTupleSet !== params.tupleSet ||
    currentEtlJob !== params.etlJob ||
    currentArgumentSet !== params.argumentSet
  ) {
    router.replace({ query: params });
  }
});

// Load backends on mount
onMounted(async () => {
  if (backendsEnabled.value) {
    await backendsStore.loadBackends();
  }
});

function handleQueryCreated(payload: { id: string; name: string; libraryId: string; libraryName: string }) {
  if (!queriesEnabled.value) {
    console.warn('Queries feature disabled; ignoring query created event.');
    return;
  }
  selectedItemType.value = 'query';
  selectedQueryId.value = payload.id;
  selectedRuleId.value = null;
  selectedDataBlockId.value = null;
  sidebarRefreshKey.value += 1;

  // Update URL (watcher will handle this, but being explicit for clarity)
  router.replace({
    query: {
      query: payload.id,
      library: payload.libraryId,
    }
  });
}

function handleQueryVersionUpdate(version: number | null) {
  queryVersionNumber.value = version;
}

function handleQueryGroupVersionUpdate(version: number | null) {
  queryGroupVersionNumber.value = version;
}

function handleQueryLoadFailed() {
  selectedItemType.value = null;
  selectedQueryId.value = null;
  selectedRuleId.value = null;
  selectedDataBlockId.value = null;
  queryVersionNumber.value = null;
  // Clear URL params
  router.replace({ query: {} });
}

function handleRuleLoadFailed() {
  selectedItemType.value = null;
  selectedRuleId.value = null;
  router.replace({ query: {} });
}

function handleDataBlockLoadFailed() {
  selectedItemType.value = null;
  selectedDataBlockId.value = null;
  router.replace({ query: {} });
}

function handleQueryGroupDeleted() {
  selectedQueryGroupId.value = null;
  selectedItemType.value = null;
  sidebarRefreshKey.value += 1;
  router.replace({ query: {} });
}

// Open the copy so the user lands on what they just made.
function handleQueryGroupCloned(groupId: string, libraryId: string) {
  selectedQueryGroupId.value = groupId;
  selectedItemType.value = 'queryGroup';
  sidebarRefreshKey.value += 1;
  router.replace({ query: { queryGroup: groupId, library: libraryId } });
}

function handleQueryGroupMoved(groupId: string, libraryId: string) {
  sidebarRefreshKey.value += 1;
  router.replace({ query: { queryGroup: groupId, library: libraryId } });
}

function handleRuleDeleted() {
  selectedRuleId.value = null;
  selectedItemType.value = null;
  sidebarRefreshKey.value += 1;
  router.replace({ query: {} });
}

function handleDataBlockDeleted() {
  selectedDataBlockId.value = null;
  selectedItemType.value = null;
  sidebarRefreshKey.value += 1;
  router.replace({ query: {} });
}

function handleRuleSetDeleted() {
  selectedRuleSetId.value = null;
  selectedItemType.value = null;
  sidebarRefreshKey.value += 1;
  router.replace({ query: {} });
}

function handleRuleSetLoadFailed() {
  selectedItemType.value = null;
  selectedRuleSetId.value = null;
  router.replace({ query: {} });
}

// Dialog handlers
function showAddLibraryDialog() {
  editingLibraryId.value = null;
  editingLibraryData.value = null;
  libraryDialogOpen.value = true;
}

async function handleLibrarySubmit(data: { name: string; description: string | null; defaultBackend: string | null; libraryId?: string }) {
  try {
    if (data.libraryId) {
      // Update existing library
      await librariesStore.updateLibrary(data.libraryId, {
        name: data.name,
        description: data.description,
        defaultBackend: data.defaultBackend,
      });
    } else {
      // Create new library
      await librariesStore.createLibrary(data);
    }
    libraryDialogOpen.value = false;
    editingLibraryId.value = null;
    editingLibraryData.value = null;
    sidebarRefreshKey.value += 1;
  } catch (error) {
    console.error(`[index.vue] Failed to ${data.libraryId ? 'update' : 'create'} library:`, error);
    // Don't throw - let the dialog handle the error via the emit return
    // The dialog's isSubmitting will remain true, showing the user something went wrong
    // Instead, we should somehow notify the dialog - but emit is fire-and-forget
    // For now, just log the error and don't throw
  }
}

function handleDeleteLibraryRequest(payload: { libraryId: string; libraryName: string }) {
  deleteTarget.value = payload;
  deleteConfirmOpen.value = true;
}

function handleEditLibraryRequest(payload: { libraryId: string; libraryName: string }) {
  const library = libraries.value.find(lib => lib.id === payload.libraryId);
  if (library) {
    editingLibraryId.value = library.id;
    editingLibraryData.value = {
      name: library.name,
      description: library.description ?? null,
      defaultBackend: library.defaultBackend ?? null,
    };
    libraryDialogOpen.value = true;
  }
}

/**
 * Open a backend's record from the unscoped tree.
 *
 * The record lives on the Backends section, so getting there is two moves —
 * scope the rail, then select — and the tree has two controls that mean it: the
 * row and the pencil beside it. They go through one function because they are
 * one intention; the pencil opens no edit mode of its own, because the record
 * is the editor.
 */
function openBackendRecord(backendId: string) {
  activeSection.value = 'backends';
  handleSelectBackend(backendId);
}

function handleSelectBackendRequest(payload: { backendId: string; backendName: string }) {
  openBackendRecord(payload.backendId);
}

function handleEditBackendRequest(payload: { backendId: string; backendName: string }) {
  openBackendRecord(payload.backendId);
}

async function handleDeleteBackendRequest(payload: { backendId: string; backendName: string }) {
  backendDeleteTarget.value = payload;
  backendDeleteLoading.value = true;
  backendDeleteReferences.value = null;
  backendDeleteConfirmOpen.value = true;

  try {
    // Nothing server-side can reference a backend the server has never seen.
    if (isBrowserBackendId(payload.backendId)) {
      backendDeleteReferences.value = { libraries: [], queries: [] };
      return;
    }
    // Fetch references before showing the dialog
    const apiClient = useApiClient();
    const references = await apiClient.getBackendReferences(payload.backendId);
    backendDeleteReferences.value = references;
  } catch (error) {
    console.error('Failed to fetch backend references:', error);
    // Show dialog anyway, but without references
    backendDeleteReferences.value = { libraries: [], queries: [] };
  } finally {
    backendDeleteLoading.value = false;
  }
}

async function confirmDeleteBackend() {
  if (!backendDeleteTarget.value) return;

  try {
    const deletedId = backendDeleteTarget.value.backendId;
    // A browser backend has no server record to delete; removing it from this
    // browser's storage is the whole of it.
    if (isBrowserBackendId(deletedId)) {
      useBrowserBackends().remove(deletedId);
      await backendsStore.loadBackends();
    } else {
      await backendsStore.deleteBackend(deletedId);
    }
    backendProbes.forget(deletedId);
    if (selectedBackendId.value === deletedId) {
      selectedBackendId.value = backends.value[0]?.id ?? null;
    }
    backendDeleteConfirmOpen.value = false;
    sidebarRefreshKey.value += 1;
  } catch (error) {
    console.error('Failed to delete backend:', error);
    // Keep dialog open to show error
  } finally {
    backendDeleteTarget.value = null;
    backendDeleteReferences.value = null;
  }
}


/* ------------------------------------------------------------------ *
 * The Runs tab, and the run it is a tab of.
 *
 * Tests and Runs differ by *scope*, not by content: Tests holds every authored
 * test, always; Runs holds only the tests the last run covered. So running
 * anything switches the sidebar to Runs and the pane to Results — the user
 * asked for a run, and the run is what they get.
 *
 * None of the state here is the run itself. `useTestRunSummary` owns that, and
 * is the one place that knows a run currently lives in this browser rather than
 * in the library.
 * ------------------------------------------------------------------ */
const testsTab = ref<'tests' | 'runs'>('tests');

const {
  summary: testRunSummary,
  scope: testRunScopeState,
  running: testRunRunning,
  storageNote: testRunStorageNote,
  beginRun: beginTestRun,
  noteAnswered: noteTestsAnswered,
  endRun: endTestRun,
} = useTestRunSummary();

const testCount = computed(() => testsStore.tests.value.length);

const testSidebarTabs = computed<Tab[]>(() => [
  { value: 'tests', label: 'Tests', count: testCount.value, icon: CircleCheck, testId: 'tests-tab-tests' },
  {
    value: 'runs',
    label: 'Runs',
    count: testRunSummary.value?.tallies.tests ?? 0,
    icon: ListChecks,
    testId: 'tests-tab-runs',
  },
]);

const testsRunsTabActive = computed(() => activeListSection.value === 'tests' && testsTab.value === 'runs');
/*
 * The run's summary is what the pane shows while the Runs tab has no row
 * picked. Selecting a test opens that test — its verdict, its diff and its
 * result are the answer, and a summary of one test beside them would be the
 * same fact told twice.
 */
const testRunResultsVisible = computed(() =>
  testsRunsTabActive.value && testRunSummary.value !== null && !selectedTestId.value,
);

/**
 * One test's verdict, as the pane.
 *
 * The Runs tab asks "how did it go?", so a row picked there is the run of that
 * test — its verdict, its cases, its diff — rather than the editor. The editor
 * is the same row on the Tests tab, which asks "what does it do?". Two panes
 * over one selection: before this they shared one screen, and the run had a
 * third of it.
 *
 * It is the test screen with its main pane swapped, not a screen of its own:
 * the inspector beside it is the test's Details and Code either way, and
 * taking the tabs away with the editor was a strip that vanished and came
 * back on whichever tab it had last.
 */
const testRunDetailVisible = computed(() =>
  testsRunsTabActive.value && Boolean(selectedTestId.value),
);

/** Back to the test as an object — the Tests tab's screen for the same row. */
function openTestConfig() {
  testsTab.value = 'tests';
}

/** The tag colour behind the scope chip, when the scope is a tag. */
const testRunScopeColor = computed(() => {
  const scope = testRunScopeState.value;
  if (!scope || scope.kind !== 'tag' || scope.tagIds.length !== 1) return null;
  return libraryTags.value.find((tag) => tag.id === scope.tagIds[0])?.color ?? null;
});

function setTestsTab(tab: 'tests' | 'runs') {
  testsTab.value = tab;
}

/** A row in the Runs tab opens that test — the run's other screen. */
function openRunTest(testId: string) {
  selectedItemType.value = 'test';
  selectedTestId.value = testId;
  selectedScratchId.value = null;
}

/** Back to the run itself: no row picked, so the pane is the summary. */
function showRunResults() {
  selectedTestId.value = null;
  selectedItemType.value = null;
}

/*
 * Any run switches to the Runs tab, wherever it was started — a heading, the
 * tag menu, Run all, or the single-test screen's own Run button. Watching the
 * scope rather than wrapping each caller is what keeps that true of the next
 * caller too.
 *
 * A run of one test keeps that test selected, so the switch lands on its
 * verdict — the thing the button was pressed for — rather than on a summary of
 * one row. A run asked for from outside a test clears the selection and lands
 * on the run's own summary.
 */
watch(() => testRunScopeState.value?.startedAt, (startedAt) => {
  if (!startedAt) return;
  activeSection.value = 'tests';
  testsTab.value = 'runs';
  // A run asked for from outside a test lands on the run's summary; one started
  // on a test's own screen stays there, because that screen is the answer.
  if (testRunScopeState.value?.kind !== 'test') showRunResults();
});

/** Run the scope again, exactly as it was asked for the first time. */
async function rerunScope() {
  const scope = testRunScopeState.value;
  if (!scope || runningAll.value) return;
  if (scope.kind === 'tag') {
    // A tag run is re-asked of the server as a tag, not replayed as the list of
    // tests it happened to select last time.
    if (scope.tagIds.length) await runTaggedTests(scope.tagIds, scope.match);
    return;
  }
  await runTestIds(scope.testIds, scope.kind, scope.label);
}

/** The failures of this run, and nothing else — the shortest way back to green. */
async function rerunFailed() {
  const summary = testRunSummary.value;
  if (!summary || runningAll.value) return;
  const failed = summary.rows.filter((row) => row.status === 'fail').map((row) => row.id);
  if (failed.length === 0) return;
  await runTestIds(failed, 'group', `failed in ${summary.scope.label}`);
}

/**
 * Export the scope.
 *
 * Every scope exports, and each one asks the server the same question it was
 * run with: a tagged scope by tag, so the file describes the tag rather than
 * this client's idea of what carries it; a single test through its own run
 * route; and anything else — all tests, one heading, the failures of the last
 * run — by naming its tests, which is the only way the server can be asked for
 * a selection that no tag describes.
 *
 * Like every export here it is a run, not a download of the rail: the file
 * holds verdicts produced now, so a report can never disagree with itself
 * about what it covered.
 */
async function exportScope(format: TestReportFormat) {
  const scope = testRunScopeState.value;
  if (!scope || runningAll.value) return;
  if (scope.kind === 'tag' && scope.tagIds.length) {
    await exportTaggedTests(scope.tagIds, scope.match, format);
    return;
  }
  if (scope.testIds.length === 0) return;
  runningAll.value = true;
  try {
    const api = useApiClient();
    const report = scope.testIds.length === 1
      // One test has a route of its own, and it is the one the test's own
      // screen exports through — the same scope cannot produce two files.
      ? await api.exportTestRun(scope.testIds[0], { accept: format.accept, filename: format.filename })
      : await api.exportSelectedTestRun({
        tests: scope.testIds,
        accept: format.accept,
        filename: format.filename,
      });
    downloadTextFile(report.body, report.filename, report.contentType);
    toast.success(`Exported ${format.label}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not export the report');
  } finally {
    runningAll.value = false;
  }
}

async function confirmDeleteLibrary() {
  if (!deleteTarget.value) return;

  try {
    await librariesStore.deleteLibrary(deleteTarget.value.libraryId);
    deleteConfirmOpen.value = false;
    sidebarRefreshKey.value += 1;

    // Clear selection if deleted library was selected
    if (selectedItemType.value === 'query') {
      selectedItemType.value = null;
      selectedQueryId.value = null;
    } else if (selectedItemType.value === 'queryGroup') {
      selectedItemType.value = null;
    }
  } catch (error) {
    console.error('Failed to delete library:', error);
    // Keep dialog open to show error
  } finally {
    deleteTarget.value = null;
  }
}
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--surface);
}

.main-content {
  flex: 1;
  /*
   * Without this a flex item refuses to shrink below its content's intrinsic
   * width, so the work area's own fixed-width controls push the whole panel
   * off the left of the screen instead of the panel scrolling internally.
   */
  min-width: 0;
  overflow-y: auto;
  background: var(--surface);
}

/* The documentation link under a section overview's sentence. */
.section-docs-link {
  color: var(--action);
  font-size: var(--text-body);
  text-decoration: underline;
}

.content-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--space-8);
  text-align: center;
  color: var(--ink-muted);
}

.content-placeholder h2 {
  font-size: var(--text-display);
  font-weight: 600;
  margin: 0 0 var(--space-6) 0;
  color: var(--ink-secondary);
}

.content-placeholder p {
  font-size: var(--text-title);
  margin: var(--space-4) 0;
  max-width: 500px;
}

.rules-suite-overview {
  align-items: flex-start;
  justify-content: flex-start;
  text-align: left;
  color: var(--ink);
}

.rules-suite-overview .overview-inner {
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
}

.rules-suite-overview p {
  max-width: none;
}

.rules-suite-overview .overview-sections {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  width: 100%;
}

.rules-suite-overview .overview-section {
  background: linear-gradient(90deg, var(--surface-subtle) 0%, var(--surface) 100%);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-6) var(--space-7);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65), 0 6px 18px rgba(0, 0, 0, 0.03);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.rules-suite-overview .overview-section:hover {
  transform: translateY(-1px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65), 0 10px 24px rgba(0, 0, 0, 0.05);
}

.rules-suite-overview h3 {
  margin: 0 0 var(--space-3) 0;
  font-size: var(--text-heading);
  color: var(--ink);
}

.rules-suite-overview ul {
  margin: 0;
  padding-left: var(--space-6);
  color: var(--ink-secondary);
  display: grid;
  gap: 0.35rem;
  list-style: disc;
  list-style-position: outside;
}

.rules-suite-overview .overview-section a {
  color: var(--action-ink);
  text-decoration: none;
}

.rules-suite-overview .overview-section a:hover {
  text-decoration: underline;
}

.delete-action {
  background: var(--danger);
  color: var(--danger-fg);
}

.delete-action:hover {
  background: var(--danger-hover);
}

/*
 * Run all, in the section bar beside New, and its narrow twin on each group
 * heading. Both borrow the New button's weight so the bar keeps one voice.
 */
.run-all-button,
.run-group-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  cursor: pointer;
}

.run-all-button {
  padding: var(--space-1) var(--space-3);
}

.run-group-button {
  padding: var(--space-1) var(--space-2);
}

.run-all-button:hover:not(:disabled),
.run-group-button:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--border-strong);
}

.run-all-button:disabled,
.run-group-button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
