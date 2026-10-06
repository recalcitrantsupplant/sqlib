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
      <!--
        The open record's work area, from one row per kind in
        `workspace/workAreas.ts`: which component, which prop takes the id,
        how the pane is keyed, and which of its events mean saved, deleted or
        could not be read. A scratch record opens in its section's work area.
      -->
      <component
        :is="workAreaPaneView.component"
        v-else-if="workAreaPaneView"
        :key="workAreaPaneView.key"
        v-bind="workAreaPaneView.props"
        v-on="workAreaPaneView.on"
      />
      <div
        v-else-if="selectedItemType && !isItemFeatureEnabled(selectedItemType)"
        class="content-placeholder"
      >
        <p>{{ featureDisabledMessage }}</p>
      </div>
      <RulesSuiteOverview v-else-if="rulesSuiteOnlyEnabled && !selectedItemType" />
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
import AppNavRail from '../AppNavRail.vue';
import AppSplash from '../AppSplash.vue';
import EntityListSidebar, { type SidebarSelection, type SidebarEntity } from '../EntityListSidebar.vue';
import BackendListSidebar from '../BackendListSidebar.vue';
import BackendWorkArea from '../BackendWorkArea.vue';
import RunByTagMenu, { type RunByTagOption } from '../tests/RunByTagMenu.vue';
import TabStrip, { type Tab } from '../shared/TabStrip.vue';
import EmptyState from '../shared/EmptyState.vue';
import RulesSuiteOverview from './RulesSuiteOverview.vue';
import TestRunsPanel from '../tests/TestRunsPanel.vue';
import TestRunResults from '../tests/TestRunResults.vue';
import { useTestRunSummary } from '../../composables/useTestRunSummary';
import { toast } from 'vue-sonner';
import { downloadTextFile } from '../../lib/downloadFile';
import type { TestReportFormat } from '../../lib/testReportFormats';
import { WORK_AREAS, kindForDraftSection, workAreaPane } from './workAreas';
import AddLibraryDialog from '../AddLibraryDialog.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { useLibrariesStore } from '../../composables/useLibrariesStore';
import { useBackendsStore } from '../../composables/useBackendsStore';
import { isBrowserBackendId, useBrowserBackends } from '../../composables/useBrowserBackends';
import { useBackendProbes } from '../../composables/useBackendProbes';
import { useQueriesStore } from '../../composables/useQueriesStore';
import { useEntityKinds, isInLibrary } from '../../composables/useEntityKinds';
import { useFeatureFlags } from '../../composables/useFeatureFlags';
import { useLibraryEvents } from '../../composables/useLibraryEvents';
import type { ChangedEntity } from '../../composables/useLibraryRefresh';
import type { Backend, Library } from '@sparql-query-lib/contracts';
import type { FeatureFlagKey } from '@sparql-query-lib/types';
import {
  isScreenSection,
  sectionForItemType,
  SCREEN_SECTION_PATHS,
  type RailSection,
} from '../../lib/railSections';
import {
  SECTION_DEFINITIONS,
  isListSection,
  listSectionForDraftSection,
  type ListSection,
  type SectionItemType,
} from '../../lib/sections';
import { conceptsDocUrl } from '../../lib/docs';
import {
  isRoutedSection,
  isScratchId,
  parseSectionRoute,
  sectionPath,
  type SectionRoute,
} from '../../lib/sectionRoutes';
import { useActiveLibrary } from '../../composables/useActiveLibrary';
import { owningLibrary } from '../../lib/owningLibrary';
import { useTagsStore } from '../../composables/useTagsStore';
import { isTaggableKind } from '../../composables/useEntityTags';
import { useTestsStore } from '../../composables/useTestsStore';
import { useApiClient, type TagMatchMode } from '../../composables/useApiClient';
import { useCallableDrafts, type DraftSection } from '../../composables/useCallableDrafts';
import { useScratchItems, migratePlaygroundTabs } from '../../composables/useScratchItems';

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

/*
 * Selection comes from the path: `/<section>/<record id>`, the id an entity IRI
 * or a scratch record's `urn:ui-temp:` id (`lib/sectionRoutes.ts`). Old
 * `/?section=…&query=…` links are redirected to it before this page sees them.
 *
 * Read synchronously at setup so the right work area mounts on the first render,
 * avoiding a transient null → target transition that would mount two components
 * in sequence and fire duplicate API calls. Later route changes — a command, the
 * back button, a link — are followed by the watcher beside the URL sync below.
 */
const initialRoute: SectionRoute = parseSectionRoute(route.params) ?? { section: null, id: null };

function versionFromQuery(): number | null {
  const parsed = Number.parseInt(String(route.query.version ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Open the record a path names, in the section it names. */
function selectRecordFromRoute(target: SectionRoute) {
  clearEntitySelection();
  selectedItemType.value = null;
  queryVersionNumber.value = null;
  queryGroupVersionNumber.value = null;
  const { section, id } = target;
  if (!section || !id || !isListSection(section)) return;
  if (isScratchId(id)) {
    // Browser-local by nature: it resolves only where the record lives. The
    // selection is set regardless so the work area can say it is missing
    // rather than the page silently landing somewhere else.
    selectedItemType.value = 'scratch';
    selectedScratchId.value = id;
    return;
  }
  const kind = SECTION_DEFINITIONS[section].savedKinds[0]?.type;
  if (!kind) return;
  selectSavedItem(kind, id);
  const version = versionFromQuery();
  if (kind === 'query') queryVersionNumber.value = version;
  else if (kind === 'queryGroup') queryGroupVersionNumber.value = version;
}

selectRecordFromRoute(initialRoute);

/*
 * The nav rail's scope. Null means unscoped — the tree renders every section,
 * exactly as it did before the rail existed — and that is the state the app
 * loads in at `/`; the path's first segment says otherwise. Selecting an
 * artifact lights up
 * the matching entry without imposing a scope, so the rail reads as "where you
 * are" even when nothing has been clicked in it.
 */
const activeSection = ref<RailSection | null>(initialRoute.section);

// Kept apart from activeSection so the highlight never leaks into tree scoping.
const railHighlight = ref<RailSection | null>(null);
const railSelection = computed(() => activeSection.value ?? railHighlight.value);

/**
 * Back to the splash.
 *
 * A state reset, which the URL watcher then writes back as `/`: the page holds
 * the selection, and the address follows it.
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

const {
  activeLibraryId,
  activeLibraryName,
  libraries: switchableLibraries,
  setActiveLibrary,
  ensureLoaded: ensureLibrariesLoaded,
} = useActiveLibrary();

/*
 * `?library=` is read only where the path names no record: `/rules?library=…`
 * is a link to that library's list. On `/rules/<id>` the record says which
 * library it is in (the watcher beside `savedSelectionId`), so a `?library=`
 * there could only repeat that or contradict it, and is ignored.
 */
if (!initialRoute.id && typeof route.query.library === 'string' && route.query.library) {
  setActiveLibrary(route.query.library);
}

/*
 * The change feed. An external MCP client writing to this library refreshes the
 * touched entity's list and, crucially, the open record's concurrency token —
 * a write that bypassed the store leaves a stale etag, and the user's next save
 * would fail with a 412 they did nothing to earn. The open record is named by
 * the feed's entity name, whichever section it belongs to.
 */
const openEntity = computed<ChangedEntity | null>(() => {
  const open: Partial<Record<ItemType, [string, string | null]>> = {
    query: ['query', selectedQueryId.value],
    queryGroup: ['queryGroup', selectedQueryGroupId.value],
    ruleSet: ['ruleSet', selectedRuleSetId.value],
    test: ['test', selectedTestId.value],
    dataGraph: ['dataGraph', selectedDataGraphId.value],
    argumentSet: ['argumentSet', selectedArgumentSetId.value],
    etlJob: ['etlJob', selectedEtlJobId.value],
    benchmark: ['benchmarkExperiment', selectedBenchmarkId.value],
  };
  const entry = selectedItemType.value ? open[selectedItemType.value] : undefined;
  return entry && entry[1] ? { entity: entry[0], id: entry[1] } : null;
});
useLibraryEvents({ libraryId: activeLibraryId, openEntity });

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
 * The set "Run with…" on an argument set's Fits list chose, for the callable it
 * opened. It travels in the URL as `?argumentSet=` beside that callable's path,
 * and applies only while that callable is the one open, so opening another
 * record never preselects a set chosen for something else.
 *
 * Held here because the page owns the route; the callable screens take it as a
 * prop rather than reaching for router state they otherwise have no use for.
 */
const preselectedArgumentSet = ref<{ setId: string; forId: string } | null>(
  typeof route.query.argumentSet === 'string' && route.query.argumentSet && initialRoute.id
    ? { setId: route.query.argumentSet, forId: initialRoute.id }
    : null,
);
const preselectArgumentSetId = computed(() => {
  const chosen = preselectedArgumentSet.value;
  return chosen && chosen.forId === savedSelectionId.value ? chosen.setId : null;
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
      .filter((entity) => !definition.libraryScoped || isInLibrary(entity, libraryId!))
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
 * made on, and a set composed on the rail has none. Everything else is composed
 * where it is listed.
 *
 * Provenance, not a fence: a set made on one query is legitimately what another
 * wants, which is why the switcher computes a fits verdict at all.
 */
function originFor(kind: string, entity: Record<string, unknown>): SidebarEntity['origin'] {
  if (kind === 'argumentSet') {
    const scope = entity.scope;
    if (scope === 'query') return 'query';
    if (scope === 'queryGroup') return 'group';
    return 'composed';
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

/**
 * The library the open saved record is in, from its own `isPartOf`.
 *
 * A link to a record names no library, and this browser's active library is
 * whatever it last had open — so without this a shared link opened the record
 * beside another library's list, and Save on it targeted that library.
 */
const selectedRecordLibrary = computed<string | null>(() => {
  const type = selectedItemType.value;
  const id = savedSelectionId.value;
  if (!type || type === 'scratch' || !id) return null;
  const entity = entitiesOfKind(type).find((candidate) => candidate.id === id);
  const known = new Set(switchableLibraries.value.map((library) => library.id));
  return owningLibrary(entity, {
    isLibrary: (ref) => known.has(ref),
    // A query can be in a library only through a group.
    entityById: (ref) => entitiesOfKind('queryGroup').find((group) => group.id === ref),
  });
});

/*
 * Opening a record points the active library at it. Watched on the record's
 * library alone, not on the active one, so switching library with a record
 * open is left alone rather than switched straight back.
 */
watch(selectedRecordLibrary, (libraryId) => {
  if (libraryId && libraryId !== activeLibraryId.value) setActiveLibrary(libraryId);
}, { immediate: true });

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
 * The handoff at the save moment, the same in every section: the item moves
 * from Scratch to Saved and stays selected, so the screen you are looking at is
 * still the thing you were writing — only now it is in the library.
 */
async function handleSaved(kind: SectionItemType, id: string) {
  await loadKind(kind);
  selectSavedItem(kind, id);
  sidebarRefreshKey.value += 1;
}

/** Nothing is open: the selection, and the version it was showing, are cleared. */
function closeRecord() {
  clearEntitySelection();
  selectedItemType.value = null;
  queryVersionNumber.value = null;
  queryGroupVersionNumber.value = null;
}

/**
 * A record was deleted, the same in every section. The deleted record is
 * still the selection, so it is closed before the list reloads — otherwise the
 * work area briefly asks the server for something that is no longer there and
 * shows its own load error.
 */
async function handleDeleted(kind: SectionItemType, id: string | null) {
  if (!id || savedSelectionId.value === id) closeRecord();
  await loadKind(kind);
  sidebarRefreshKey.value += 1;
}

/*
 * The main pane: the open record's work area, from `workspace/workAreas.ts`.
 * The three events every work area shares land on the handlers above; what
 * only one kind says is wired per kind here.
 */
const workAreaPaneView = computed(() => {
  const kind = selectedItemType.value === 'scratch'
    ? kindForDraftSection(scratchSection.value)
    : selectedItemType.value;
  if (!kind || !isFeatureEnabled(WORK_AREAS[kind].feature)) return null;
  const scratchId = selectedItemType.value === 'scratch' ? selectedScratchId.value : null;
  return workAreaPane(
    { kind, savedId: scratchId ? null : savedSelectionId.value, scratchId },
    {
      onSaved: (savedKind, id) => { void handleSaved(savedKind, id); },
      onDeleted: (deletedKind, id) => { void handleDeleted(deletedKind, id); },
      onLoadFailed: () => closeRecord(),
      extra: {
        query: {
          props: {
            creationRequest: creationRequest.value,
            versionNumber: queryVersionNumber.value,
            preselectArgumentSetId: preselectArgumentSetId.value,
          },
          on: {
            'creation-consumed': () => { creationRequest.value = null; },
            'query-created': handleQueryCreated,
            'argument-set-saved': handleArgumentSetSavedElsewhere,
            'update:version-number': (version: number | null) => { queryVersionNumber.value = version; },
            'open-entity': openCreatedEntity,
          },
        },
        queryGroup: {
          props: { creationRequest: queryGroupCreationRequest.value, versionNumber: queryGroupVersionNumber.value },
          on: {
            'creation-consumed': () => { queryGroupCreationRequest.value = null; },
            'argument-set-saved': handleArgumentSetSavedElsewhere,
            'update:version-number': (version: number | null) => { queryGroupVersionNumber.value = version; },
            'query-group-cloned': handleQueryGroupCloned,
            'query-group-moved': handleQueryGroupMoved,
            'open-entity': openCreatedEntity,
          },
        },
        ruleSet: {
          on: {
            'open-test': openTest,
            'open-entity': openInputEntity,
            'open-benchmark': (id: string) => openCreatedEntity({ type: 'benchmark', id }),
            'open-in-query': openSparqlAsScratchQuery,
          },
        },
        etlJob: { on: { 'open-entity': openCreatedEntity } },
        test: {
          props: { runView: testRunDetailVisible.value, runBusy: testRunRunning.value || runningAll.value },
          on: { 'open-config': openTestConfig },
        },
        argumentSet: { on: { 'open-callable': openCallableWithArguments } },
      },
    },
  );
});

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

/** "Run with…" on an argument set's Fits list: open the callable, set chosen. */
function openCallableWithArguments(payload: { id: string; kind: 'query' | 'queryGroup'; argumentSetId: string | null }) {
  clearEntitySelection();
  selectedItemType.value = payload.kind;
  if (payload.kind === 'query') selectedQueryId.value = payload.id;
  else selectedQueryGroupId.value = payload.id;
  activeSection.value = payload.kind === 'query' ? 'queries' : 'queryGroups';
  preselectedArgumentSet.value = payload.argumentSetId ? { setId: payload.argumentSetId, forId: payload.id } : null;
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
const selectedBackendId = ref<string | null>(initialRoute.section === 'backends' ? initialRoute.id : null);
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
/*
 * The URL follows the selection, and the selection follows the URL.
 *
 * `stateRoute` is what the page shows, as a route: the section (the rail's, or
 * the one the open record belongs to when the rail is unscoped) and the record
 * open in it. Writing it is one `sectionPath`; it used to be fourteen query
 * parameters compared one by one, and four of them were once left out.
 */
const stateRoute = computed<SectionRoute>(() => {
  const derived = selectedItemType.value === 'scratch'
    ? (scratchSection.value ? listSectionForDraftSection(scratchSection.value) : null)
    : sectionForItemType(selectedItemType.value);
  const candidate = activeSection.value ?? derived;
  const section = isRoutedSection(candidate) ? candidate : null;
  if (section === 'backends') {
    return { section, id: backendDraft.value ? null : selectedBackendId.value };
  }
  const id = selectedItemType.value === 'scratch' ? selectedScratchId.value : savedSelectionId.value;
  return { section, id: section ? id ?? null : null };
});

/** The version on screen, for a query or group showing one other than current. */
const stateVersion = computed<number | null>(() => {
  if (selectedItemType.value === 'query') return queryVersionNumber.value;
  if (selectedItemType.value === 'queryGroup') return queryGroupVersionNumber.value;
  return null;
});

function sameRoute(a: SectionRoute | undefined, b: SectionRoute): boolean {
  return Boolean(a) && a!.section === b.section && a!.id === b.id;
}

watch([stateRoute, stateVersion, preselectArgumentSetId, activeLibraryId], ([target, version, argumentSet, libraryId]) => {
  const query: Record<string, string> = {};
  // A record says its own library; a list names the one it shows.
  if (!target.id && target.section && target.section !== 'backends' && libraryId) query.library = libraryId;
  if (version != null) query.version = String(version);
  if (argumentSet) query.argumentSet = argumentSet;

  const current = parseSectionRoute(route.params);
  const currentQuery = Object.fromEntries(
    Object.entries(route.query).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
  if (sameRoute(current, target) && JSON.stringify(currentQuery) === JSON.stringify(query)) return;
  void router.replace({ path: sectionPath(target), query });
});

/*
 * And back: a route the page did not write — a command, the back button, a link
 * from another screen — is applied as a selection. The one the watcher above
 * just wrote matches the state already, and is left alone.
 */
watch(
  () => route.fullPath,
  () => {
    const target = parseSectionRoute(route.params);
    if (!target) return;
    if (sameRoute(target, stateRoute.value)) {
      const version = versionFromQuery();
      if (selectedItemType.value === 'query' && version !== queryVersionNumber.value) queryVersionNumber.value = version;
      if (selectedItemType.value === 'queryGroup' && version !== queryGroupVersionNumber.value) queryGroupVersionNumber.value = version;
      return;
    }
    activeSection.value = target.section;
    if (target.section === 'backends') {
      clearEntitySelection();
      selectedItemType.value = null;
      backendDraft.value = false;
      selectedBackendId.value = target.id ?? backends.value[0]?.id ?? null;
      return;
    }
    selectRecordFromRoute(target);
    // A section with nothing named opens on the record it was left on.
    if (!target.id && target.section && isListSection(target.section)) restoreSection(target.section);
  },
);

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
  sidebarRefreshKey.value += 1;
}

// Open the copy so the user lands on what they just made.
function handleQueryGroupCloned(groupId: string, libraryId: string) {
  selectedQueryGroupId.value = groupId;
  selectedItemType.value = 'queryGroup';
  sidebarRefreshKey.value += 1;
}

function handleQueryGroupMoved(groupId: string, libraryId: string) {
  sidebarRefreshKey.value += 1;
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
