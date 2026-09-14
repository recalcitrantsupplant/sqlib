<script setup lang="ts">
/**
 * The benchmark screens — Plan and Runs.
 *
 * The argument axis names sets rather than versions — see the twin note on
 * `promotedArgumentSetId` in `QueryWorkArea.vue` (issue #246).
 *
 * The save bar over three columns. The first is the plan itself: axes above a
 * divider, settings below it, and the expansion arithmetic pinned to the
 * bottom. The second edits whatever the plan selected. The third is the
 * inspector every record page carries — Details, Code, and the piece with no
 * precedent elsewhere in the app: an argument set's values on the Plan tab, one
 * request's timings on the Runs tab, as one tab relabelled by the mode.
 *
 * Plan and Runs are two modes of one screen, not two destinations, which is why
 * the tabs sit at the top of the plan column rather than over the whole page —
 * and why the save bar spans both.
 *
 * ## What is wired, and what the API cannot answer yet
 *
 * The object model in the design is Benchmark → Case[] with per-backend
 * implementations, plus library-scoped argument sets, load profiles and a
 * policy block. What the API stores is an experiment, versions carrying
 * `subjectSpecs`, and observations per request. The mapping is in
 * `lib/benchmarkPlan.ts`.
 *
 * Consequences visible on screen, all of them labelled where they appear:
 *
 * - a **case** is a pointer to a library query version; its intent and its
 *   per-store implementations have nowhere to be saved, so they are shown
 *   disabled rather than typed into and lost;
 * - **load profiles** are one per version, so that axis holds exactly one item
 *   and says that a second would promote it to an axis;
 * - **equivalence** has no result hash behind it, so nothing claims two stores
 *   answered the same question;
 * - a request's **phase breakdown** is the two phases the runner times, not the
 *   five the design draws.
 *
 * The statistic is the one policy item that needed no storage: p50/p95/p99 is a
 * way of reading captured data, so it is computed from the run's requests.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import type { BenchmarkExperimentVersion } from '@sparql-query-lib/contracts';
import { useBenchmarksStore } from '@/composables/useBenchmarksStore';
import { useBenchmarkExecution } from '@/composables/useBenchmarkExecution';
import { useBackendsStore } from '@/composables/useBackendsStore';
import { useQueriesStore } from '@/composables/useQueriesStore';
import { useQueryGroupsStore } from '@/composables/useQueryGroupsStore';
import { useRuleSetsStore } from '@/composables/useRuleSetsStore';
import { useTupleSetsStore } from '@/composables/useTupleSetsStore';
import { useDataGraphsStore } from '@/composables/useDataGraphsStore';
import { useFeatureFlags } from '@/composables/useFeatureFlags';
import { useApiClient } from '@/composables/useApiClient';
import { useCallableDrafts, UNASSIGNED_LIBRARY_ID } from '@/composables/useCallableDrafts';
import { useScratchRecord } from '@/composables/useScratchRecord';
import BenchmarkPlanSidebar from '@/components/benchmarks/BenchmarkPlanSidebar.vue';
import BenchmarkCaseEditor from '@/components/benchmarks/BenchmarkCaseEditor.vue';
import BenchmarkPlanDetail from '@/components/benchmarks/BenchmarkPlanDetail.vue';
import BenchmarkArgumentSetPanel from '@/components/benchmarks/BenchmarkArgumentSetPanel.vue';
import BenchmarkRunView from '@/components/benchmarks/BenchmarkRunView.vue';
import RunBar from '@/components/shared/RunBar.vue';
import type { RunBarPick } from '@/lib/runBar';
import BenchmarkRequestDetail from '@/components/benchmarks/BenchmarkRequestDetail.vue';
import SaveBar from '@/components/shared/SaveBar.vue';
import InspectorPanel, { type InspectorTab } from '@/components/shared/InspectorPanel.vue';
import EntityDetailsPanel from '@/components/shared/EntityDetailsPanel.vue';
import CodeSnippetPanel from '@/components/shared/CodeSnippetPanel.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import type { SnippetRequest } from '@/lib/codeSnippets';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import type { ArgumentSetDetail } from '@/types/argument-sets';
import { seriesLookup } from '@/lib/seriesPalette';
import type {
  AxisGroupView,
  AxisKey,
  GraphCostRow,
  SettingItemView,
  SettingKey,
  SupportRow,
} from '@/lib/benchmarkViews';
import {
  NO_ARGUMENTS_IRI,
  NOT_APPLICABLE_BACKEND_IRI,
  completeCases,
  emptyPlan,
  estimateDurationMs,
  expandPlan,
  factorCount,
  formatDuration,
  passCountsOf,
  passProfile,
  percentile,
  planFromVersion,
  planToSubjectSpecs,
  runStatistics,
  toPassIndex,
  toRequestRows,
  toTimelineLanes,
  type BenchmarkPlan,
  type PlanCase,
  type PlanSettings,
  type RawIterationObservation,
  type RawObservation,
  type RequestRow,
  type SubjectKind,
} from '@/lib/benchmarkPlan';

const props = defineProps<{
  experimentId?: string | null;
  scratchId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'scratch-saved', payload: { id: string; name: string }): void;
}>();

const store = useBenchmarksStore();
const executionStore = useBenchmarkExecution();
const backendsStore = useBackendsStore();
const queriesStore = useQueriesStore();
const queryGroupsStore = useQueryGroupsStore();
const ruleSetsStore = useRuleSetsStore();
const tupleSetsStore = useTupleSetsStore();
const dataGraphsStore = useDataGraphsStore();
const apiClient = useApiClient();
const draftsStore = useCallableDrafts();
const { isEnabled: isFeatureEnabled } = useFeatureFlags();

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const tab = ref<'plan' | 'runs'>('plan');
const selectedKind = ref<AxisKey | 'setting'>('cases');
const selectedId = ref<string | null>(null);

const experimentName = ref('');
const experimentDescription = ref('');
const experimentStatus = ref('Active');
const plan = ref<BenchmarkPlan>(emptyPlan());

const versions = ref<BenchmarkExperimentVersion[]>([]);
const selectedVersionNumber = ref<number | null>(null);
const isSaving = ref(false);
/** What the record points at — the server repoints it on every version. */
const currentVersionId = ref<string | null>(null);
const experimentCreatedAt = ref<string | null>(null);
/** When the browser-local draft was last written, for the Details draft row. */
const locallySavedAt = ref<string | null>(null);

/** version IRI → what it is, so a plan and a run can both name their subjects. */
interface SubjectEntry {
  subjectId: string;
  subjectType: SubjectKind;
  name: string;
  versionNumber: number;
  queryString: string | null;
}
const subjectIndex = ref<Record<string, SubjectEntry>>({});
const versionsBySubject = ref<Record<string, { id: string; version: number; immutable?: boolean }[]>>({});
const argumentSetsBySubject = ref<Record<string, { id: string; name: string }[]>>({});
const argumentSetDetails = ref<Record<string, ArgumentSetDetail>>({});
const argumentSetLoading = ref(false);

const selectedRunId = ref<string | null>(null);
const observations = ref<RawObservation[]>([]);
const iterationObservations = ref<RawIterationObservation[]>([]);
const observationsLoading = ref(false);
const selectedRequestKey = ref<string | null>(null);

const isScratch = computed(() => Boolean(props.scratchId));
const isLoading = computed(() => store.loading.value);

/* ------------------------------------------------------------------ *
 * Scratch persistence
 * ------------------------------------------------------------------ */

interface BenchScratchBody {
  status?: string;
  plan?: BenchmarkPlan;
}

useScratchRecord({
  scratchId: () => props.scratchId ?? null,
  missingMessage: 'That scratch benchmark is not in this browser',
  track: [experimentName, experimentDescription, experimentStatus, plan],
  hydrate: (record) => {
    const body = (record.body ?? {}) as BenchScratchBody;
    experimentName.value = record.name;
    experimentDescription.value = record.description ?? '';
    experimentStatus.value = body.status ?? 'Active';
    plan.value = body.plan ? { ...emptyPlan(), ...body.plan } : emptyPlan();
    // One empty case, so a new benchmark opens on something to fill in rather
    // than an empty panel and an Add button to find first.
    if (plan.value.cases.length === 0) addCase();
    else selectFirstCase();
  },
  collect: (record) => ({
    name: experimentName.value || record.name,
    description: experimentDescription.value || null,
    body: { status: experimentStatus.value, plan: plan.value },
  }),
});

/* ------------------------------------------------------------------ *
 * Draft persistence
 *
 * Unsaved edits to a *saved* experiment, kept in the browser so that
 * closing the tab is not the same as discarding them. The scratch record above
 * covers a benchmark that has never been saved; this covers every one that
 * has, and until it existed editing a saved benchmark and navigating away
 * lost the work with no warning (design doc §7a).
 *
 * The shape is `TestWorkArea.vue`'s, which is the smallest form of the query
 * editor's draft path — see the design doc §7b for why that is the one to copy.
 * ------------------------------------------------------------------ */

interface BenchDraftBody {
  name?: string;
  description?: string;
  status?: string;
  plan?: BenchmarkPlan;
}

/** Set while a version is being read, so hydration never lands as an edit. */
const hydratingRecord = ref(false);
/** The editor payload of the version on screen, to compare edits against. */
const savedBody = ref('');
let draftSaveHandle: ReturnType<typeof setTimeout> | null = null;

/** What the editor holds now, in the shape a draft records it. */
function editorBody(): BenchDraftBody {
  return {
    name: experimentName.value,
    description: experimentDescription.value,
    status: experimentStatus.value,
    plan: plan.value,
  };
}

function applyEditorBody(body: BenchDraftBody) {
  experimentName.value = body.name ?? '';
  experimentDescription.value = body.description ?? '';
  experimentStatus.value = body.status ?? 'Active';
  plan.value = body.plan ? { ...emptyPlan(), ...body.plan } : emptyPlan();
}

/**
 * A draft records edits to what the benchmark saves *now*.
 *
 * Benchmarks are the one drafting section with a version picker, so unlike the
 * other work areas they can be showing something a draft was not based on.
 * Layering a draft over a historical version would misattribute the edits to
 * it, so while one is on screen the editor drafts nothing.
 */
const isViewingCurrentVersion = computed(() =>
  selectedVersionNumber.value != null
  && selectedVersionNumber.value === (versions.value[0]?.version ?? null));

const openDraft = computed(() => {
  void draftsStore.allDrafts.value;
  return props.experimentId ? draftsStore.draftFor(props.experimentId) : null;
});

const editCount = computed(() => (isScratch.value ? 0 : openDraft.value?.edits ?? 0));

/** Typing back to what is saved is an undo, not an edit. */
const matchesSaved = () => JSON.stringify(editorBody()) === savedBody.value;

function persistDraft() {
  const id = props.experimentId;
  if (!id || isScratch.value) return;
  const existing = draftsStore.draftFor(id);
  draftsStore.save({
    id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
    // Experiments are account-level rather than library-scoped (sections.ts),
    // so there is no owning library for the record to carry.
    libraryId: UNASSIGNED_LIBRARY_ID,
    type: 'query',
    kind: 'draft',
    section: 'bench',
    name: experimentName.value,
    description: experimentDescription.value || null,
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
  const id = props.experimentId;
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
  [experimentName, experimentDescription, experimentStatus, plan],
  () => {
    if (isScratch.value || hydratingRecord.value || !props.experimentId) return;
    if (!isViewingCurrentVersion.value) return;
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
  applyEditorBody(JSON.parse(savedBody.value || '{}') as BenchDraftBody);
  ensureSelection();
  void Promise.resolve().then(() => { hydratingRecord.value = false; });
  toast.success('Draft discarded');
}

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

const backendOptions = computed(() =>
  (backendsStore.backends.value ?? []).filter((item) => item && item.id));
const queryOptions = computed(() =>
  (queriesStore.queries.value ?? []).filter((item) => item && item.id).map((q) => ({ id: q.id, name: q.name })));
const queryGroupOptions = computed(() =>
  (queryGroupsStore.queryGroups.value ?? []).filter((item) => item && item.id).map((g) => ({ id: g.id, name: g.name })));

/*
 * The rule-set trio, behind the same flags the rest of the app gates them on.
 * A benchmark screen with the rules suite off offers no rule-set case and no
 * graph axis, which is exactly what a plan it could not run should look like.
 */
const rulesEnabled = computed(() => isFeatureEnabled('rulesSuite'));
const tupleSetsEnabled = computed(() => isFeatureEnabled('tupleSets'));

const ruleSetOptions = computed(() => (rulesEnabled.value
  ? (ruleSetsStore.ruleSets.value ?? []).filter((item) => item && item.id).map((r) => ({ id: r.id, name: r.name }))
  : []));
const tupleSetOptions = computed(() => (tupleSetsEnabled.value
  ? (tupleSetsStore.tupleSets.value ?? []).filter((item) => item && item.id).map((t) => ({ id: t.id, name: t.name }))
  : []));
const dataGraphOptions = computed(() => (rulesEnabled.value
  ? (dataGraphsStore.dataGraphs.value ?? []).filter((item) => item && item.id).map((g) => ({ id: g.id, name: g.name }))
  : []));

const backendName = (id: string) => {
  // A rule set and a query group have no store to name, and the runner records
  // the sentinel rather than leaving the column empty. Printing the raw IRI in
  // a run's backend column would read as a backend nobody can find.
  if (id === NOT_APPLICABLE_BACKEND_IRI) return 'In-process';
  return backendOptions.value.find((backend) => backend.id === id)?.name ?? id;
};

/**
 * A library object's name, or the tail of its IRI.
 *
 * Both axes name free-standing entities rather than something scoped to a case,
 * so an id the library no longer lists — deleted, or belonging to a library this
 * account cannot see — still has to draw as something that distinguishes it from
 * its neighbour. The same fallback `argumentSetName` takes.
 */
function nameFrom(options: { id: string; name: string }[], id: string): string {
  return options.find((option) => option.id === id)?.name
    ?? id.split(/[:/#]/).filter(Boolean).pop()
    ?? id;
}

const tupleSetName = (id: string) =>
  (id === NO_ARGUMENTS_IRI ? 'Stored seeds' : nameFrom(tupleSetOptions.value, id));
const dataGraphName = (id: string) => nameFrom(dataGraphOptions.value, id);

const colourFor = computed(() => seriesLookup(plan.value.backendIds));

async function loadReferenceData() {
  /*
   * Each list is loaded independently: the stores swallow their own failures
   * into an `error` ref, and a suite that is off throws from the api client
   * rather than returning empty. Neither should cost the screen the lists that
   * did load.
   */
  await Promise.all([
    backendsStore.loadBackends(),
    queriesStore.loadQueries(),
    queryGroupsStore.loadQueryGroups(),
    rulesEnabled.value ? ruleSetsStore.fetchRuleSets() : Promise.resolve(),
    rulesEnabled.value ? dataGraphsStore.loadDataGraphs() : Promise.resolve(),
    tupleSetsEnabled.value ? tupleSetsStore.loadTupleSets() : Promise.resolve(),
  ].map((task) => Promise.resolve(task).catch((error: unknown) => {
    console.error('[BenchmarkWorkArea] Failed to load reference data:', error);
  })));
}

/**
 * Learn what a version IRI points at.
 *
 * There is no lookup from a version to its parent — `/queries/:id/v` is the
 * only listing — so this walks the library until every IRI asked about is
 * accounted for, and stops as soon as they are. Everything it learns is cached,
 * so switching benchmarks over the same queries costs nothing.
 */
async function indexSubjects(versionIris: string[]) {
  const wanted = new Set(versionIris.filter((iri) => iri && !subjectIndex.value[iri]));
  if (wanted.size === 0) return;

  const sources: { id: string; name: string; type: SubjectKind }[] = [
    ...queryOptions.value.map((q) => ({ ...q, type: 'query' as const })),
    ...queryGroupOptions.value.map((g) => ({ ...g, type: 'queryGroup' as const })),
    ...ruleSetOptions.value.map((r) => ({ ...r, type: 'ruleSet' as const })),
  ];

  /*
   * A spec is supposed to name a version, but an entity IRI resolves too. Older
   * benchmarks were written that way and their runs still come back; naming the
   * query is better than showing the row as unassigned.
   */
  const index = { ...subjectIndex.value };
  for (const source of sources) {
    if (wanted.has(source.id)) {
      index[source.id] = {
        subjectId: source.id,
        subjectType: source.type,
        name: source.name,
        versionNumber: 0,
        queryString: null,
      };
      wanted.delete(source.id);
    }
  }
  subjectIndex.value = index;

  for (const source of sources) {
    if (wanted.size === 0) break;
    await loadSubjectVersions(source.id, source.type, source.name);
    for (const iri of [...wanted]) if (subjectIndex.value[iri]) wanted.delete(iri);
  }
}

/** Versions of one query, group or rule set, cached, and indexed by version IRI. */
async function loadSubjectVersions(subjectId: string, subjectType: SubjectKind, name: string) {
  if (versionsBySubject.value[subjectId]) return versionsBySubject.value[subjectId];
  /*
   * A rule set's versions come straight from the api client rather than through
   * `useRuleSetsStore`, which caches the list of rule sets but not the versions
   * under one. Failing to read them leaves the case's version picker empty
   * rather than taking the whole plan down with it.
   */
  const loaded = subjectType === 'ruleSet'
    ? await apiClient.listRuleSetVersions(subjectId).catch((error: unknown) => {
      console.error('[BenchmarkWorkArea] Failed to load rule set versions:', error);
      return [];
    })
    : subjectType === 'query'
      ? await queriesStore.loadQueryVersions(subjectId)
      : await queryGroupsStore.loadQueryGroupVersions(subjectId);

  const rows = (loaded ?? []).map((version: any) => ({
    id: version.id as string,
    version: version.version as number,
    immutable: version.immutable ?? undefined,
  }));
  versionsBySubject.value = { ...versionsBySubject.value, [subjectId]: rows };

  const index = { ...subjectIndex.value };
  for (const version of loaded ?? []) {
    index[(version as any).id] = {
      subjectId,
      subjectType,
      name,
      versionNumber: (version as any).version,
      queryString: (version as any).queryString ?? null,
    };
  }
  subjectIndex.value = index;
  return rows;
}

async function loadArgumentSetsFor(subjectId: string, subjectType: SubjectKind) {
  // A rule set takes tuple sets, not argument sets, and they are library-wide
  // rather than scoped to it — there is nothing to fetch per subject.
  if (subjectType === 'ruleSet') return;
  if (argumentSetsBySubject.value[subjectId]) return;
  try {
    const scope = subjectType === 'query' ? 'query' : 'queryGroup';
    const sets = await apiClient.listArgumentSets(subjectId, scope);
    argumentSetsBySubject.value = {
      ...argumentSetsBySubject.value,
      [subjectId]: sets.map((set: { id: string; name: string }) => ({ id: set.id, name: set.name })),
    };
  } catch (error: unknown) {
    console.error('[BenchmarkWorkArea] Failed to load argument sets:', error);
    argumentSetsBySubject.value = { ...argumentSetsBySubject.value, [subjectId]: [] };
  }
}

/** Every argument set any case in this plan can take, deduplicated. */
const argumentOptions = computed(() => {
  const seen = new Map<string, { id: string; name: string }>();
  for (const planCase of plan.value.cases) {
    if (!planCase.subjectId) continue;
    for (const set of argumentSetsBySubject.value[planCase.subjectId] ?? []) {
      if (!seen.has(set.id)) seen.set(set.id, set);
    }
  }
  return [...seen.values()];
});

/*
 * A set named by a run but not by any case in the current plan has no entry to
 * read a name from — the run pinned it and the plan has since moved on. Its
 * last IRI segment at least distinguishes one from another, which a shared
 * "Argument set" label would not.
 */
const argumentSetName = (id: string) => {
  if (id === NO_ARGUMENTS_IRI) return 'No arguments';
  return argumentOptions.value.find((set) => set.id === id)?.name
    ?? argumentSetDetails.value[id]?.name
    // A rule-set run records its tuple set in the same column, so the tabular
    // axis has two candidate name sources and this reads both before giving up.
    ?? tupleSetOptions.value.find((set) => set.id === id)?.name
    ?? id.split(/[:/#]/).filter(Boolean).pop()
    ?? id;
};

/* ------------------------------------------------------------------ *
 * Loading an experiment
 * ------------------------------------------------------------------ */

async function loadExperimentContext(experimentId: string, preferredVersion?: number | null) {
  hydratingRecord.value = true;
  try {
    await store.fetchExperiment(experimentId);
    const experiment = store.selectedExperiment.value;
    if (experiment) {
      experimentName.value = experiment.name;
      experimentDescription.value = experiment.description ?? '';
      experimentStatus.value = experiment.status ?? 'Active';
      currentVersionId.value = experiment.currentVersion ?? null;
      experimentCreatedAt.value = experiment.dateCreated ?? null;
    }

    const list = await store.listVersions(experimentId);
    versions.value = [...list].sort((a, b) => b.version - a.version);

    const versionNumber = preferredVersion ?? versions.value[0]?.version ?? null;
    selectedVersionNumber.value = versionNumber;
    if (versionNumber == null) {
      plan.value = emptyPlan();
      savedBody.value = JSON.stringify(editorBody());
      return;
    }

    await store.fetchVersion(experimentId, versionNumber);
    await hydratePlanFromVersion(store.selectedVersion.value);
    await store.loadRunsForVersion(experimentId, versionNumber);
    ensureSelection();
    savedBody.value = JSON.stringify(editorBody());

    /*
     * A draft wins over the saved version, because it is the newer of the
     * two — the whole point of keeping it is that a reload does not lose it.
     * The saved payload stays in `savedBody` so Discard has somewhere
     * to go back to.
     *
     * Only while the *current* version is on screen, though: a draft records
     * edits layered on what the benchmark saves now, so laying it over a
     * historical version being viewed would misattribute it to that version.
     */
    const isCurrent = versionNumber === (versions.value[0]?.version ?? null);
    const draft = isCurrent ? openDraft.value?.body : null;
    if (draft && typeof draft === 'object') {
      applyEditorBody(draft as BenchDraftBody);
      ensureSelection();
    }
  } finally {
    // Cleared after the refs settle, so hydration never lands as an edit.
    await Promise.resolve();
    hydratingRecord.value = false;
  }
}

async function hydratePlanFromVersion(version: BenchmarkExperimentVersion | null) {
  if (!version) {
    plan.value = emptyPlan();
    return;
  }
  await indexSubjects((version.subjectSpecs ?? []).map((spec) => spec.subject));
  plan.value = planFromVersion(version, (iri) => {
    const entry = subjectIndex.value[iri];
    if (!entry) return null;
    return {
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      subjectName: entry.name,
      versionNumber: entry.versionNumber,
    };
  });
  await Promise.all(plan.value.cases
    .filter((planCase) => planCase.subjectId)
    .map((planCase) => loadArgumentSetsFor(planCase.subjectId!, planCase.subjectType)));
}

onMounted(async () => {
  try {
    await Promise.all([store.loadExperiments(), loadReferenceData()]);
  } catch (error: unknown) {
    console.error('[BenchmarkWorkArea] Failed to load benchmark context:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to load benchmark experiments');
  }
});

watch(
  () => props.experimentId,
  async (id) => {
    if (!id || isScratch.value) return;
    try {
      await loadReferenceData();
      await loadExperimentContext(id);
    } catch (error: unknown) {
      console.error('[BenchmarkWorkArea] Failed to open experiment:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to open experiment');
    }
  },
  { immediate: true },
);

watch(selectedVersionNumber, async (next, previous) => {
  if (!props.experimentId || next == null || next === previous || previous == null) return;
  // Reading another version into the editor is not an edit to this one.
  hydratingRecord.value = true;
  try {
    await store.fetchVersion(props.experimentId, next);
    await hydratePlanFromVersion(store.selectedVersion.value);
    await store.loadRunsForVersion(props.experimentId, next);
    ensureSelection();
    clearRunSelection();
  } catch (error: unknown) {
    console.error('[BenchmarkWorkArea] Failed to switch version:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to load version');
  } finally {
    await Promise.resolve();
    hydratingRecord.value = false;
  }
});

/* ------------------------------------------------------------------ *
 * The plan column
 * ------------------------------------------------------------------ */

const expansion = computed(() => expandPlan(plan.value));

/** Mean cost per request on the most recent run — the only honest estimator. */
const meanRequestMs = computed(() => (requests.value.length > 0 ? requestStats.value.meanMs : null));

const estimateMs = computed(() => estimateDurationMs(expansion.value.requests, meanRequestMs.value));

/** True once any complete case is a rule set — what the rules axes hang on. */
const hasRuleSetCase = computed(() =>
  completeCases(plan.value).some((planCase) => planCase.subjectType === 'ruleSet'));

/** True when *every* complete case is a rule set, so the backend axis is dead. */
const onlyRuleSetCases = computed(() => {
  const cases = completeCases(plan.value);
  return cases.length > 0 && cases.every((planCase) => planCase.subjectType === 'ruleSet');
});

const groups = computed<AxisGroupView[]>(() => {
  const count = (label: string) => factorCount(expansion.value, label);
  const groupViews: AxisGroupView[] = [
    {
      key: 'cases',
      name: 'Cases',
      multiplier: `× ${count('cases')}`,
      addLabel: 'case',
      canAdd: true,
      items: plan.value.cases.map((planCase) => ({
        id: planCase.id,
        name: planCase.subjectName ?? 'Unassigned case',
        meta: planCase.versionNumber ? `v${planCase.versionNumber}` : 'no version',
      })),
    },
    {
      key: 'backends',
      name: 'Backends',
      multiplier: `× ${count('backends')}`,
      addLabel: 'backend',
      canAdd: true,
      /*
       * A rule set evaluates in-process, so its spec carries no backends at
       * all. The axis stays drawn — a plan may mix kinds, and then it
       * multiplies the query cases — but a plan made only of rule sets is told
       * the axis does nothing rather than left to wonder why its backends
       * never appear in a run.
       */
      hint: onlyRuleSetCases.value
        ? 'rule sets evaluate in-process — this axis multiplies query cases only'
        : plan.value.backendIds.length === 0
          ? 'none named — each case runs against its query’s default backend'
          : 'only backends attached to this library can be named',
      items: plan.value.backendIds.map((id) => ({
        id,
        name: backendName(id),
        dot: colourFor.value(id),
      })),
    },
    {
      key: 'argumentSets',
      name: 'Argument sets',
      multiplier: `× ${count('argument sets')}`,
      addLabel: 'set',
      canAdd: true,
      hint: plan.value.argumentSetIds.length === 0
        ? 'none named — each case runs once, unparameterised'
        : undefined,
      items: plan.value.argumentSetIds.map((id) => ({
        id,
        name: argumentSetName(id),
        meta: id === NO_ARGUMENTS_IRI ? 'none' : 'fixed',
      })),
    },
  ];

  /*
   * The two rule-set axes appear only when a rule-set case does, matching
   * `expandPlan` exactly: a plan of queries keeps the three axes it has always
   * had, and there is no empty "Data graphs" heading on a screen that could
   * never use one.
   */
  if (hasRuleSetCase.value) {
    groupViews.push({
      key: 'tupleSets',
      name: 'Tuple sets',
      multiplier: `× ${count('tuple sets')}`,
      addLabel: 'tuple set',
      canAdd: true,
      hint: plan.value.tupleSetIds.length === 0
        ? 'none named — each rule set runs the seeds its version stored'
        : undefined,
      items: plan.value.tupleSetIds.map((id) => ({
        id,
        name: tupleSetName(id),
        meta: id === NO_ARGUMENTS_IRI ? 'stored' : 'floating',
      })),
    });
    groupViews.push({
      key: 'dataGraphs',
      name: 'Data graphs',
      multiplier: `× ${count('data graphs')}`,
      addLabel: 'graph',
      canAdd: true,
      hint: plan.value.dataGraphIds.length === 0
        ? 'none named — each rule set runs against an empty base graph'
        : undefined,
      items: plan.value.dataGraphIds.map((id) => ({
        id,
        name: dataGraphName(id),
        meta: 'floating',
      })),
    });
  }

  groupViews.push({
    key: 'loadProfiles',
    name: 'Load profiles',
    multiplier: `× ${count('repeats')}`,
    addLabel: 'profile',
    canAdd: false,
    hint: 'one profile is a constant — a second would make load an axis, which the API cannot store yet',
    items: [{
      id: 'profile',
      name: `${plan.value.settings.warmupRuns ?? 0} warmup, ${plan.value.settings.repeats ?? 1}× ${plan.value.settings.executionStrategy || 'sequential'}`,
      meta: `${plan.value.settings.maxConcurrency ?? 1} client`,
    }],
  });

  return groupViews;
});

const settingItems = computed<SettingItemView[]>(() => {
  const settings = plan.value.settings;
  return [
    { key: 'statistic', name: 'Statistic', value: 'p50 · p95 · p99' },
    { key: 'equivalence', name: 'Equivalence', value: 'not checked' },
    {
      key: 'failure',
      name: 'Failure policy',
      value: settings.timeoutMs
        ? `${Math.round(settings.timeoutMs / 1000)}s, ${settings.retryCount ?? 0} retries`
        : `no timeout, ${settings.retryCount ?? 0} retries`,
    },
    {
      key: 'order',
      name: 'Execution order',
      value: `${settings.executionStrategy || 'sequential'}${settings.randomizeOrder ? ', random' : ''}`,
    },
  ];
});

function selectFirstCase() {
  selectedKind.value = 'cases';
  selectedId.value = plan.value.cases[0]?.id ?? null;
}

/**
 * Point the selection at something that exists, without moving it if it does.
 *
 * Hydrating a version arrives after the screen is already interactive — it
 * walks the library to name the subjects — and re-selecting the first case
 * unconditionally would take back a click made while it was still loading.
 * Case ids are positional and rebuilt on every hydration, so a selection from
 * the previous version fails the check and correctly moves.
 */
function ensureSelection() {
  if (selectedKind.value !== 'cases') return;
  if (plan.value.cases.some((planCase) => planCase.id === selectedId.value)) return;
  selectedId.value = plan.value.cases[0]?.id ?? null;
}

function selectItem(payload: { kind: AxisKey; id: string }) {
  selectedKind.value = payload.kind;
  selectedId.value = payload.id;
  if (payload.kind === 'argumentSets') void loadArgumentSetDetail(payload.id);
}

function selectSetting(key: SettingKey) {
  selectedKind.value = 'setting';
  selectedId.value = key;
}

function addCase() {
  const planCase: PlanCase = {
    id: `case-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    subjectType: 'query',
    subjectId: null,
    subjectName: null,
    versionId: null,
    versionNumber: null,
  };
  plan.value = { ...plan.value, cases: [...plan.value.cases, planCase] };
  selectedKind.value = 'cases';
  selectedId.value = planCase.id;
}

function handleAdd(axis: AxisKey) {
  if (axis === 'cases') {
    addCase();
    return;
  }
  // The other axes have no row to create — membership is picked from what the
  // library already holds, so + opens the picker rather than minting an item.
  selectedKind.value = axis;
  selectedId.value = null;
}

const selectedCase = computed(() =>
  plan.value.cases.find((planCase) => planCase.id === selectedId.value) ?? null);

const selectedCaseVersions = computed(() =>
  (selectedCase.value?.subjectId ? versionsBySubject.value[selectedCase.value.subjectId] : []) ?? []);

/**
 * The document a rule-set case will run, keyed by version IRI.
 *
 * A query version carries its text on the version listing, so `subjectIndex`
 * already holds it. A rule set does not — a version names rules and data blocks,
 * and the SRL is assembled by the export route — so it is fetched on demand for
 * the case being looked at and cached, the same shape the index has.
 */
const ruleSetDocuments = ref<Record<string, string>>({});
const ruleSetDocumentLoading = ref(false);

async function loadRuleSetDocument(subjectId: string, versionId: string) {
  const entry = subjectIndex.value[versionId];
  if (!entry || ruleSetDocuments.value[versionId]) return;
  ruleSetDocumentLoading.value = true;
  try {
    const exported = await apiClient.exportRuleSetSrl(subjectId, { version: entry.versionNumber });
    ruleSetDocuments.value = { ...ruleSetDocuments.value, [versionId]: exported.srl };
  } catch (error: unknown) {
    console.error('[BenchmarkWorkArea] Failed to load the rule set document:', error);
  } finally {
    ruleSetDocumentLoading.value = false;
  }
}

const selectedCaseQuery = computed(() => {
  const planCase = selectedCase.value;
  const versionId = planCase?.versionId;
  if (!versionId) return null;
  if (planCase?.subjectType === 'ruleSet') return ruleSetDocuments.value[versionId] ?? null;
  return subjectIndex.value[versionId]?.queryString ?? null;
});

watch(selectedCase, (planCase) => {
  if (planCase?.subjectType !== 'ruleSet' || !planCase.subjectId || !planCase.versionId) return;
  void loadRuleSetDocument(planCase.subjectId, planCase.versionId);
}, { immediate: true });

function patchCase(patch: Partial<PlanCase>) {
  if (!selectedCase.value) return;
  const id = selectedCase.value.id;
  plan.value = {
    ...plan.value,
    cases: plan.value.cases.map((planCase) => (planCase.id === id ? { ...planCase, ...patch } : planCase)),
  };
}

async function handleCaseSubjectType(value: SubjectKind) {
  patchCase({ subjectType: value, subjectId: null, subjectName: null, versionId: null, versionNumber: null });
}

function optionsForKind(kind: SubjectKind) {
  if (kind === 'query') return queryOptions.value;
  if (kind === 'queryGroup') return queryGroupOptions.value;
  return ruleSetOptions.value;
}

async function handleCaseSubject(value: string | null) {
  const planCase = selectedCase.value;
  if (!planCase) return;
  const options = optionsForKind(planCase.subjectType);
  const name = options.find((option) => option.id === value)?.name ?? null;
  patchCase({ subjectId: value, subjectName: name, versionId: null, versionNumber: null });
  if (!value) return;
  const rows = await loadSubjectVersions(value, planCase.subjectType, name ?? value);
  await loadArgumentSetsFor(value, planCase.subjectType);
  // Newest version by default: a case pins a version, and the one just written
  // is the one the author is thinking about.
  const newest = [...rows].sort((a, b) => b.version - a.version)[0];
  if (newest) patchCase({ versionId: newest.id, versionNumber: newest.version });
}

function handleCaseVersion(value: string | null) {
  const match = selectedCaseVersions.value.find((version) => version.id === value);
  patchCase({ versionId: value, versionNumber: match?.version ?? null });
}

function removeSelectedCase() {
  if (!selectedCase.value) return;
  const id = selectedCase.value.id;
  plan.value = { ...plan.value, cases: plan.value.cases.filter((planCase) => planCase.id !== id) };
  selectFirstCase();
}

function toggleBackend(id: string) {
  const on = plan.value.backendIds.includes(id);
  plan.value = {
    ...plan.value,
    backendIds: on
      ? plan.value.backendIds.filter((backendId) => backendId !== id)
      : [...plan.value.backendIds, id],
  };
}

function toggleArgument(id: string) {
  const on = plan.value.argumentSetIds.includes(id);
  plan.value = {
    ...plan.value,
    argumentSetIds: on
      ? plan.value.argumentSetIds.filter((setId) => setId !== id)
      : [...plan.value.argumentSetIds, id],
  };
  if (!on) void loadArgumentSetDetail(id);
}

/*
 * The two rule-set axes. Neither is scoped to a subject the way an argument set
 * is scoped to its query — a tuple set is a free-standing table and a data graph
 * free-standing content — so membership is a plain toggle with nothing to filter
 * it against, and `planToSubjectSpecs` writes them onto the rule-set cases only.
 */
function toggleTupleSet(id: string) {
  const on = plan.value.tupleSetIds.includes(id);
  plan.value = {
    ...plan.value,
    tupleSetIds: on
      ? plan.value.tupleSetIds.filter((setId) => setId !== id)
      : [...plan.value.tupleSetIds, id],
  };
}

function toggleDataGraph(id: string) {
  const on = plan.value.dataGraphIds.includes(id);
  plan.value = {
    ...plan.value,
    dataGraphIds: on
      ? plan.value.dataGraphIds.filter((graphId) => graphId !== id)
      : [...plan.value.dataGraphIds, id],
  };
}

function updateSettings(patch: Partial<PlanSettings>) {
  plan.value = { ...plan.value, settings: { ...plan.value.settings, ...patch } };
}

/* ------------------------------------------------------------------ *
 * The inspector's Arguments tab, on Plan
 * ------------------------------------------------------------------ */

/**
 * Which argument set the right panel shows.
 *
 * Selecting one on the axis shows that one; selecting a case shows the set the
 * case is bound to, because that is the pair the design puts side by side — a
 * case is unreadable without the values it will receive.
 */
const shownArgumentSetId = computed(() => {
  if (selectedKind.value === 'argumentSets' && selectedId.value) return selectedId.value;
  const forCase = selectedCase.value?.subjectId
    ? (argumentSetsBySubject.value[selectedCase.value.subjectId] ?? [])
      .find((set) => plan.value.argumentSetIds.includes(set.id))?.id
    : null;
  return forCase ?? plan.value.argumentSetIds[0] ?? null;
});

const shownArgumentSet = computed(() =>
  (shownArgumentSetId.value ? argumentSetDetails.value[shownArgumentSetId.value] ?? null : null));

const shownArgumentUsedBy = computed(() => {
  const id = shownArgumentSetId.value;
  if (!id) return [];
  if (id === NO_ARGUMENTS_IRI) return plan.value.cases.map(toUsedBy);
  return plan.value.cases
    .filter((planCase) => planCase.subjectId
      && (argumentSetsBySubject.value[planCase.subjectId] ?? []).some((set) => set.id === id))
    .map(toUsedBy);
});

function toUsedBy(planCase: PlanCase) {
  return { id: planCase.id, name: planCase.subjectName ?? 'Unassigned case' };
}

async function loadArgumentSetDetail(id: string) {
  if (id === NO_ARGUMENTS_IRI || argumentSetDetails.value[id]) return;
  argumentSetLoading.value = true;
  try {
    const result = await apiClient.getArgumentSet(id);
    argumentSetDetails.value = {
      ...argumentSetDetails.value,
      [id]: result.data as unknown as ArgumentSetDetail,
    };
  } catch (error: unknown) {
    console.error('[BenchmarkWorkArea] Failed to load argument set:', error);
  } finally {
    argumentSetLoading.value = false;
  }
}

watch(shownArgumentSetId, (id) => {
  if (id) void loadArgumentSetDetail(id);
}, { immediate: true });

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

const runList = computed(() => (store.runs.value ?? []).map((run) => {
  const started = run.startedAt ?? run.dateCreated ?? null;
  const ended = run.endedAt ?? null;
  const elapsed = started && ended ? Date.parse(ended) - Date.parse(started) : null;
  return {
    id: run.id,
    when: started ? new Date(started).toLocaleString() : 'Not started',
    duration: elapsed == null ? '—' : formatDuration(elapsed),
    note: `${run.runStatus} · ${run.tasksCompleted}/${run.tasksTotal} tasks`,
  };
}));

const selectedRun = computed(() =>
  (store.runs.value ?? []).find((run) => run.id === selectedRunId.value) ?? null);

const requests = computed<RequestRow[]>(() => toRequestRows(observations.value, {
  caseLabel: (iri) => subjectIndex.value[iri]?.name ?? 'Unknown case',
  backendLabel: (iri) => backendName(iri),
  argumentLabel: (iri) => argumentSetName(iri),
  dataGraphLabel: (iri) => dataGraphName(iri),
}));

const requestStats = computed(() => runStatistics(requests.value));
const lanes = computed(() => toTimelineLanes(requests.value));

/*
 * The passes of every rule-set request, keyed to the request that produced
 * them. Empty on a run of queries, which is what keeps the passes column, the
 * panel block and the graph table's pass count off a screen with nothing to
 * put in them.
 */
const passIndex = computed(() => toPassIndex(iterationObservations.value, requests.value));

const selectedRequest = computed(() =>
  requests.value.find((request) => request.key === selectedRequestKey.value) ?? null);

const selectedRequestPasses = computed(() => (selectedRequest.value
  ? passProfile(selectedRequest.value, requests.value, passIndex.value)
  : null));

/*
 * An observation's subject is the query-version IRI the request ran, so the
 * text it sent is whatever that version holds — which is already indexed.
 */
const selectedRequestQuery = computed(() => {
  const caseId = selectedRequest.value?.caseId;
  return caseId ? subjectIndex.value[caseId]?.queryString ?? null : null;
});

/**
 * p95 per backend for the selected case, from the run in view.
 *
 * The support matrix is where a store's number belongs, and it is only worth
 * printing next to a store's name if it is that store's number for that case.
 */
const support = computed<SupportRow[]>(() => {
  const planCase = selectedCase.value;
  return plan.value.backendIds.map((backendId) => {
    const matching = planCase?.versionId
      ? requests.value.filter((request) => request.backendId === backendId && request.caseId === planCase.versionId)
      : [];
    const durations = matching.filter((request) => request.ok && request.totalMs != null)
      .map((request) => request.totalMs!);
    return {
      backendId,
      name: backendName(backendId),
      dot: colourFor.value(backendId),
      p95Ms: percentile(durations, 95),
      samples: matching.length,
      failed: matching.filter((request) => !request.ok).length,
    };
  });
});

/**
 * p95 per data graph for the selected rule-set case, from the run in view.
 *
 * The support matrix's counterpart on the axis a rule set has: there is no
 * store to put a number beside, and the comparison the graph axis exists for is
 * the same rule set over a bigger graph.
 *
 * Rows come from the plan's graphs rather than from the run's, so a graph added
 * since the last run shows as never run instead of vanishing — the same
 * relationship `support` has to the backend axis. A rules case with no graph
 * named has no rows, and the editor keeps the prose it has today.
 */
const graphSupport = computed<GraphCostRow[]>(() => {
  const planCase = selectedCase.value;
  if (planCase?.subjectType !== 'ruleSet') return [];

  return plan.value.dataGraphIds.map((dataGraphId) => {
    const matching = planCase.versionId
      ? requests.value.filter((request) =>
        request.dataGraphId === dataGraphId && request.caseId === planCase.versionId)
      : [];
    const succeeded = matching.filter((request) => request.ok);
    const durations = succeeded.filter((request) => request.totalMs != null)
      .map((request) => request.totalMs!);
    const counts = [...new Set(succeeded.map((request) => request.rows).filter((rows) => rows != null))];
    // The same "one answer or a disagreement" reading as the triple count
    // above, on the number the graph axis is swept to find out.
    const passes = [...new Set(passCountsOf(succeeded, passIndex.value))];

    return {
      dataGraphId,
      name: dataGraphName(dataGraphId),
      p95Ms: percentile(durations, 95),
      samples: matching.length,
      failed: matching.filter((request) => !request.ok).length,
      triples: counts.length === 1 ? counts[0]! : null,
      triplesVary: counts.length > 1,
      passes: passes.length === 1 ? passes[0]! : null,
      passesVary: passes.length > 1,
    };
  });
});

function clearRunSelection() {
  selectedRunId.value = null;
  observations.value = [];
  iterationObservations.value = [];
  selectedRequestKey.value = null;
}

async function selectRun(id: string) {
  selectedRunId.value = id;
  selectedRequestKey.value = null;
  observationsLoading.value = true;
  try {
    const { observations: loaded, iterationObservations: passes } = await store.getRunObservations(id);
    observations.value = (loaded ?? []) as RawObservation[];
    iterationObservations.value = (passes ?? []) as RawIterationObservation[];
    await indexSubjects(observations.value
      .map((observation) => (observation.subject ?? observation.refSubject) as string)
      .filter(Boolean));
  } catch (error: unknown) {
    console.error('[BenchmarkWorkArea] Failed to load run observations:', error);
    observations.value = [];
    iterationObservations.value = [];
    toast.error(error instanceof Error ? error.message : 'Failed to load run observations');
  } finally {
    observationsLoading.value = false;
  }
}

/* The newest run is what you want after pressing Run, so it opens itself. */
watch(runList, (list) => {
  if (tab.value === 'runs' && !selectedRunId.value && list.length > 0) void selectRun(list[0].id);
});

watch(tab, (next) => {
  if (next === 'runs' && !selectedRunId.value && runList.value.length > 0) {
    void selectRun(runList.value[0].id);
  }
});

/* ------------------------------------------------------------------ *
 * Save and run
 * ------------------------------------------------------------------ */

const canSave = computed(() => {
  void draftsStore.allDrafts.value;
  if (!experimentName.value.trim() || completeCases(plan.value).length === 0) return false;
  // Saving a body identical to the current version would mint a version
  // that records no change. Scratch has nothing to be identical to.
  if (isScratch.value) return true;
  return isViewingCurrentVersion.value && !matchesSaved();
});

const saveTitle = computed(() => {
  if (!experimentName.value.trim()) return 'Name the benchmark before saving';
  if (completeCases(plan.value).length === 0) return 'Add a case with a query and a version';
  if (!isScratch.value && matchesSaved()) return 'No unsaved changes';
  return isScratch.value
    ? 'Save as an experiment with a first version'
    : `Save v${(versions.value[0]?.version ?? 0) + 1}`;
});

const saveLabel = computed(() =>
  (isScratch.value ? 'Save' : `Save v${(versions.value[0]?.version ?? 0) + 1}`));

function specsPayload() {
  return planToSubjectSpecs(plan.value, (subjectId) =>
    (argumentSetsBySubject.value[subjectId] ?? []).map((set) => set.id));
}

async function save() {
  if (isSaving.value || !canSave.value) return;
  isSaving.value = true;
  try {
    if (isScratch.value) await saveScratch();
    else await saveVersion();
  } finally {
    isSaving.value = false;
  }
}

/**
 * Save a scratch benchmark: create the experiment, then its first version.
 *
 * If the version call fails the experiment already exists, and the scratch
 * record is deliberately left in place — the user's configuration is never the
 * thing that gets lost, and they are told the experiment landed without one.
 */
async function saveScratch() {
  const name = experimentName.value.trim();
  const scratchRecordId = props.scratchId;

  let created;
  try {
    created = await store.createExperiment({
      name,
      description: experimentDescription.value.trim() || null,
      status: experimentStatus.value.trim() || null,
    });
  } catch (error: unknown) {
    console.error('[BenchmarkWorkArea] Failed to save experiment:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to save');
    return;
  }

  try {
    await store.createVersion(created.id, { subjectSpecs: specsPayload(), ...plan.value.settings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save';
    toast.error(`Created “${name}” but could not save its first version: ${message}`);
    return;
  }

  if (scratchRecordId) draftsStore.remove(scratchRecordId);
  toast.success(`Saved “${name}” as v1`);
  emit('scratch-saved', { id: created.id, name });
}

async function saveVersion() {
  if (!props.experimentId) return;
  try {
    // Name and description live on the experiment rather than on a version,
    // and Details is where they are edited now: a save has to carry them or a
    // rename would be lost the moment the page reloads.
    await store.updateExperiment(props.experimentId, {
      name: experimentName.value.trim(),
      description: experimentDescription.value.trim() || null,
    } as never);
    const created = await store.createVersion(props.experimentId, {
      subjectSpecs: specsPayload(),
      ...plan.value.settings,
    });
    await loadExperimentContext(props.experimentId, created.version);
    // The editor's body is now a saved version, so there are no
    // unsaved edits left to keep: the draft and its pill go together.
    savedBody.value = JSON.stringify(editorBody());
    cancelDraftSave();
    removeDraft();
    toast.success(`Saved v${created.version}`);
  } catch (error: unknown) {
    // The draft is left exactly as it was. A save that failed and took the
    // edits with it is the one outcome that loses work outright.
    console.error('[BenchmarkWorkArea] Failed to create version:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to save a new version');
  }
}

const canRun = computed(() => Boolean(props.experimentId && selectedVersionNumber.value != null));

/* ------------------------------------------------------------- inspector */

/* Details first: opening a benchmark, the question is what this is. */
const activeTab = ref('details');
const rightPanelCollapsed = ref(false);

/**
 * The third column's tabs.
 *
 * One "selection" tab rather than two, relabelled by the mode: on Plan it is
 * the argument set being looked at, on Runs it is the request. They are the
 * same slot — what the columns to the left have selected — and declaring two
 * would make the strip change length as the mode changes.
 */
const inspectorTabs = computed<InspectorTab[]>(() => [
  { id: 'details', label: 'Details' },
  { id: 'selection', label: tab.value === 'plan' ? 'Arguments' : 'Request' },
  { id: 'code', label: 'Code' },
]);

const detailsPanelRef = ref<InstanceType<typeof EntityDetailsPanel> | null>(null);

/** Save on an unnamed benchmark sends you to the one field that names it. */
function promptForNameInDetails() {
  activeTab.value = 'details';
  rightPanelCollapsed.value = false;
  void nextTick(() => detailsPanelRef.value?.focusName());
}

const currentVersionNumber = computed(() => versions.value[0]?.version ?? null);

/** The version on screen, as the row Details highlights. */
const selectedVersionId = computed(() =>
  versions.value.find((version) => version.version === selectedVersionNumber.value)?.id ?? null);

/**
 * The version rows, newest first.
 *
 * Where there is no comment to show — a benchmark version carries none — the
 * row says what the version *is*: how many cases it names and how many times it
 * repeats each, which is what distinguishes two plans.
 */
const versionOptions = computed(() =>
  versions.value.map((version) => ({
    value: version.id,
    label: String(version.version),
    /*
     * A summary, not a note: a benchmark version carries no comment field, so
     * the column that holds notes elsewhere describes the plan instead. There
     * is nothing to annotate here, and `canAnnotateVersions` stays off.
     */
    comment: null,
    summary: versionSummary(version),
    dateModified: version.dateModified ?? version.dateCreated ?? null,
  })),
);

function versionSummary(version: BenchmarkExperimentVersion) {
  const cases = version.subjectSpecs?.length ?? 0;
  const repeats = version.repeats ?? 1;
  const frozen = version.immutable ? ' · frozen' : '';
  return `${cases} ${cases === 1 ? 'case' : 'cases'} · ×${repeats}${frozen}`;
}

const detailsProps = computed(() => ({
  name: experimentName.value,
  description: experimentDescription.value,
  isScratch: isScratch.value,
  entityId: isScratch.value ? null : (props.experimentId || null),
  entityNoun: 'benchmark',
  // An experiment is account-level rather than library-scoped, and a tag's
  // library must equal the tagged entity's (tags doc §4.5), so there is no Tags
  // row to draw. It names no backend of its own either — the plan's backend
  // axis is the set it multiplies by — and nothing detects a signature here.
  showBackend: false,
  showSignature: false,
  versionOptions: versionOptions.value,
  selectedVersion: selectedVersionId.value,
  currentVersion: currentVersionId.value,
  // The server repoints `currentVersion` on every save and nothing on this
  // screen reads it, so there is no choice here to offer.
  canSetCurrentVersion: false,
  editCount: editCount.value,
  draftSavedAt: locallySavedAt.value,
  draftSelected: editCount.value > 0 && isViewingCurrentVersion.value && !matchesSaved(),
  createdAt: isScratch.value ? null : experimentCreatedAt.value,
  // Nothing deletes a benchmark yet — no route is wired on this screen — and a
  // footer button that does nothing is worse than none.
  canDelete: false,
}));

/** Read one of the saved versions into the plan — the version select, as a row. */
function selectVersionRow(versionId: string) {
  const version = versions.value.find((candidate) => candidate.id === versionId);
  if (!version || version.version === selectedVersionNumber.value) return;
  // The watcher on `selectedVersionNumber` does the loading; this only names
  // which version is being read.
  selectedVersionNumber.value = version.version;
}

/** Back to the unsaved edits, which are always layered on the newest version. */
function selectDraft() {
  const draft = openDraft.value?.body;
  if (!draft || typeof draft !== 'object') return;
  const newest = versions.value[0]?.version ?? null;
  if (newest !== null && newest !== selectedVersionNumber.value) {
    selectedVersionNumber.value = newest;
    return;
  }
  hydratingRecord.value = true;
  applyEditorBody(draft as BenchDraftBody);
  ensureSelection();
  void Promise.resolve().then(() => { hydratingRecord.value = false; });
}

async function copyExperimentId() {
  if (!props.experimentId) return;
  try {
    await navigator.clipboard.writeText(props.experimentId);
    toast.success('Benchmark ID copied');
  } catch {
    toast.error('Could not copy the ID');
  }
}

/* ------------------------------------------------------------------ code */

/*
 * `POST /benchmark-experiments/{id}/v/{n}/run` — what Run sends. The version is
 * in the path because a benchmark is a recipe you re-run: what a script wants
 * is the run of the version it was written against.
 */
const config = useRuntimeConfig();

const codeRequest = computed<SnippetRequest>(() => {
  const apiBaseUrl = String(config.public.apiBaseUrl).replace(/\/$/, '');
  const id = props.experimentId || '<benchmark-id>';
  const version = selectedVersionNumber.value ?? 1;
  return {
    method: 'POST',
    url: `${apiBaseUrl}/benchmark-experiments/${encodeURIComponent(id)}/v/${version}/run`,
  };
});

const codeUnavailable = computed(() => {
  if (!props.experimentId) {
    return 'This benchmark has not been saved yet — save it once to get an id and a v1, then the run goes to the call below.';
  }
  return selectedVersionNumber.value == null ? 'Save a version before running it.' : null;
});

/* ------------------------------------------------------------------ *
 * The run sentence (design 3b)
 * ------------------------------------------------------------------ */

/**
 * The axes, as a sentence.
 *
 * Each term is the count the run will multiply by, and pressing it selects that
 * axis in the plan column — which is the one place membership is edited. A
 * complete-cases count rather than a row count: a half-filled case names no
 * version and contributes no requests, and saying otherwise here would make the
 * estimate beside it a lie.
 */
const runInputs = computed<RunBarPick[]>(() => {
  const caseCount = completeCases(plan.value).length;
  const setCount = plan.value.argumentSetIds.length;
  const picks: RunBarPick[] = [{
    key: 'cases',
    value: `${caseCount} ${caseCount === 1 ? 'case' : 'cases'}`,
    empty: caseCount === 0,
    emptyLabel: 'no cases',
    icon: 'cases',
    title: 'The questions this benchmark asks — press to edit them',
  }];
  if (setCount > 0) {
    picks.push({
      key: 'argumentSets',
      value: `${setCount} argument ${setCount === 1 ? 'set' : 'sets'}`,
      icon: 'arguments',
      title: 'Every case runs once per argument set — press to edit them',
    });
  }
  // The rule-set axes, on the same terms: named only when they exist, because a
  // rules benchmark with neither runs the seeds its version stored against an
  // empty base graph, and "0 data graphs" would read as a mistake.
  const tupleCount = plan.value.tupleSetIds.length;
  if (tupleCount > 0) {
    picks.push({
      key: 'tupleSets',
      value: `${tupleCount} tuple ${tupleCount === 1 ? 'set' : 'sets'}`,
      icon: 'tuples',
      title: 'Every rule-set case runs once per tuple set — press to edit them',
    });
  }
  const graphCount = plan.value.dataGraphIds.length;
  if (graphCount > 0) {
    picks.push({
      key: 'dataGraphs',
      value: `${graphCount} data ${graphCount === 1 ? 'graph' : 'graphs'}`,
      icon: 'data',
      title: 'Every rule-set case runs once per data graph — press to edit them',
    });
  }
  return picks;
});

const runBackendPicks = computed<RunBarPick[]>(() => {
  const ids = plan.value.backendIds;
  // A plan made only of rule sets has no store to run against: the sentence
  // states that rather than offering an axis whose members would never be sent.
  if (onlyRuleSetCases.value) {
    return [{
      key: 'backends',
      value: 'an in-process store',
      icon: 'backends',
      inert: true,
      title: 'A rule set evaluates in-process against an ephemeral store seeded from its data graph',
    }];
  }
  return [{
    key: 'backends',
    value: ids.length === 1
      ? backendName(ids[0]!)
      : `${ids.length} backends`,
    empty: ids.length === 0,
    emptyLabel: 'each case’s default',
    icon: 'backends',
    title: ids.length === 0
      ? 'No backends named — each case runs against its query’s default backend. Press to name some.'
      : 'Every case runs once per backend — press to edit them',
  }];
});

const repeatsSummary = computed(() => {
  const repeats = plan.value.settings.repeats ?? 1;
  const warmups = plan.value.settings.warmupRuns ?? 0;
  return warmups > 0 ? `×${repeats} · ${warmups} warmup` : `×${repeats}`;
});

function selectAxisFromRunBar(key: string) {
  selectedKind.value = key as AxisKey;
  selectedId.value = null;
  tab.value = 'plan';
}

async function runBenchmark() {
  if (!props.experimentId || selectedVersionNumber.value == null) return;
  try {
    await executionStore.executeRun(props.experimentId, selectedVersionNumber.value);
    await store.loadRunsForVersion(props.experimentId, selectedVersionNumber.value);
    tab.value = 'runs';
    const newest = runList.value[0];
    if (newest) await selectRun(newest.id);
  } catch (error: unknown) {
    console.error('[BenchmarkWorkArea] Failed to execute benchmark:', error);
  }
}

const runSubtitle = computed(() => {
  const run = selectedRun.value;
  if (!run) return '';
  const started = run.startedAt ?? run.dateCreated;
  return started ? new Date(started).toLocaleString() : '';
});
</script>

<template>
  <div class="bench-work-area" data-testid="benchmark-work-area">
    <!--
      The same bar every other record page carries. It was a hand-rolled head
      inside the plan column before, which meant the Runs tab had no way to save
      at all and the name was edited in a place no other section edits it.
    -->
    <SaveBar
      :title="experimentName"
      noun="benchmark"
      :is-scratch="isScratch"
      :current-version-number="currentVersionNumber"
      :edit-count="editCount"
      :saving="isSaving"
      :can-save="canSave"
      :needs-name="!experimentName.trim()"
      :show-format="false"
      :show-diff="false"
      :show-more="false"
      @save="save"
      @needs-name="promptForNameInDetails"
      @discard="discardDraft"
    />

    <div class="bench-shell">
    <BenchmarkPlanSidebar
      :tab="tab"
      :groups="groups"
      :settings="settingItems"
      :expansion="expansion"
      :estimate-ms="estimateMs"
      :selected-kind="selectedKind"
      :selected-id="selectedId"
      :runs="runList"
      :selected-run-id="selectedRunId"
      @update:tab="(value) => (tab = value)"
      @select-item="selectItem"
      @select-setting="selectSetting"
      @add="handleAdd"
      @select-run="selectRun"
    />

    <main v-if="tab === 'plan'" class="bench-main">
      <!--
        The run, as one sentence (design 3b), reading the axes it will multiply.

        A benchmark is cases × backends × argument sets, so its "with" and
        "against" are sets rather than single choices — the sentence names the
        counts and pressing one selects that axis in the column beside it,
        which is where membership is actually edited. Nothing is chosen twice.
        No "create test / benchmark" pair either: this is the kept recipe.
      -->
      <RunBar
        :running="executionStore.isExecuting.value"
        :run-disabled="!canRun"
        :run-title="canRun ? 'Run this version now' : 'Save a version before running it'"
        :inputs="runInputs"
        :backend-picks="runBackendPicks"
        @run="runBenchmark"
        @pick="selectAxisFromRunBar"
      >
        <template #trailing>
          <button
            class="run-bar-settings"
            type="button"
            title="Repeats, warmups and execution strategy — the settings that never multiply"
            @click="selectSetting('order')"
          >
            {{ repeatsSummary }}
          </button>
        </template>
      </RunBar>

      <BenchmarkCaseEditor
        v-if="selectedKind === 'cases' && selectedCase"
        :plan-case="selectedCase"
        :editable="true"
        :subject-options="queryOptions"
        :group-options="queryGroupOptions"
        :rule-set-options="ruleSetOptions"
        :rule-sets-enabled="rulesEnabled"
        :version-options="selectedCaseVersions"
        :support="support"
        :graph-support="graphSupport"
        :query-string="selectedCaseQuery"
        :query-loading="selectedCase?.subjectType === 'ruleSet' && ruleSetDocumentLoading"
        @update:subjectType="handleCaseSubjectType"
        @update:subjectId="handleCaseSubject"
        @update:versionId="handleCaseVersion"
        @remove="removeSelectedCase"
      />

      <EmptyState
        v-else-if="selectedKind === 'cases'"
        title="No case selected"
        description="Add one on the Cases axis."
      />

      <BenchmarkPlanDetail
        v-else
        :kind="selectedKind"
        :setting-key="selectedKind === 'setting' ? (selectedId as SettingKey) : null"
        :editable="true"
        :backend-options="backendOptions.map((backend) => ({
          id: backend.id,
          name: backend.name,
          meta: backend.backendType,
          dot: colourFor(backend.id),
        }))"
        :selected-backend-ids="plan.backendIds"
        :argument-options="argumentOptions"
        :selected-argument-ids="plan.argumentSetIds"
        :tuple-set-options="tupleSetOptions"
        :selected-tuple-set-ids="plan.tupleSetIds"
        :data-graph-options="dataGraphOptions"
        :selected-data-graph-ids="plan.dataGraphIds"
        :settings="plan.settings"
        @toggle-backend="toggleBackend"
        @toggle-argument="toggleArgument"
        @toggle-tuple-set="toggleTupleSet"
        @toggle-data-graph="toggleDataGraph"
        @update-setting="updateSettings"
      />
    </main>

    <BenchmarkRunView
      v-else
      :title="selectedRun ? 'Run' : 'No run selected'"
      :subtitle="runSubtitle"
      :status-label="selectedRun?.runStatus ?? ''"
      :requests="requests"
      :stats="requestStats"
      :lanes="lanes"
      :passes="passIndex"
      :colour-for="colourFor"
      :selected-key="selectedRequestKey"
      :loading="observationsLoading"
      :can-rerun="canRun"
      @select-request="(request) => (selectedRequestKey = request.key)"
      @rerun="runBenchmark"
    />

    <!--
      The third column, as the inspector every other record page carries.

      Its own panel is still here — an argument set's values on Plan, one
      request's timings on Runs — but it is now a tab beside Details and Code
      rather than a column with no name on it. One tab, relabelled by which of
      the two modes is showing: they are the same slot, "what is selected".
    -->
    <div class="right-panel" :class="{ collapsed: rightPanelCollapsed }">
      <InspectorPanel
        v-model:active-tab="activeTab"
        v-model:collapsed="rightPanelCollapsed"
        :tabs="inspectorTabs"
        testid="benchmark-inspector"
      >
        <template #details>
          <EntityDetailsPanel
            ref="detailsPanelRef"
            v-bind="detailsProps"
            @update:name="experimentName = $event"
            @update:description="experimentDescription = $event"
            @select-version="selectVersionRow"
            @select-draft="selectDraft"
            @copy-id="copyExperimentId"
          />
        </template>

        <template #selection>
          <BenchmarkArgumentSetPanel
            v-if="tab === 'plan'"
            :argument-set="shownArgumentSet"
            :loading="argumentSetLoading"
            :used-by="shownArgumentUsedBy"
            :is-no-arguments="shownArgumentSetId === NO_ARGUMENTS_IRI"
          />
          <BenchmarkRequestDetail
            v-else
            :request="selectedRequest"
            :sent="selectedRequestQuery"
            :passes="selectedRequestPasses"
            :colour="colourFor(selectedRequest?.backendId)"
          />
        </template>

        <!--
          Running a version is one call, and the version is named in the path:
          a benchmark is a recipe you re-run, so what CI needs from this screen
          is the run of a *particular* version rather than of whatever is
          current.
        -->
        <template #code>
          <CodeSnippetPanel
            :request="codeRequest"
            :unavailable="codeUnavailable"
            arguments-hint="The plan is the version's own — cases, backends and argument sets are saved with it, so the call carries no body."
          />
        </template>
      </InspectorPanel>
    </div>
    </div>
  </div>
</template>

<style scoped>
.bench-work-area {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
}

.bench-shell {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
}

/*
 * The third column is the shared inspector now. It keeps the width the two
 * panels it replaced had; the panel draws its own left border.
 */
.right-panel {
  display: flex;
  flex: 0 0 320px;
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

.run-bar-settings {
  display: inline-flex;
  align-items: center;
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  white-space: nowrap;
  cursor: pointer;
}

.run-bar-settings:hover {
  border-color: var(--border-hover);
  background: var(--surface-subtle);
}


.bench-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: var(--surface);
}
</style>
