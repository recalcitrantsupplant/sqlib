/**
 * A rule set as a benchmark subject, in the editor (#247).
 *
 * The model landed first (#377): the runner expands a rule-set spec over
 * `dataGraphs × inputs × repeats`, and `benchmarkPlan.ts` round-trips both axes
 * so an API-authored rules benchmark is not rewritten on the next save. What it
 * could not do was *author* one — `BenchmarkWorkArea` had no rule-set case
 * picker and no graph axis, which is what these specs pin.
 *
 * The two invariants worth a test are the ones a screen gets wrong silently.
 * The axes appear only when a rule-set case does, so a benchmark of queries
 * keeps the three axes it has always had rather than growing two headings it
 * can never fill. And a save writes the graph axis back onto the rule-set spec
 * and nothing else onto it: the API refuses a rule-set spec carrying backends,
 * so a fan-out that widened would fail at save with a message about a field the
 * author never touched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed, nextTick } from 'vue';
import type { CallableDraft } from '@/composables/useCallableDrafts';
import { NO_ARGUMENTS_IRI, NOT_APPLICABLE_BACKEND_IRI } from '@/lib/benchmarkPlan';

const EXPERIMENT_ID = 'urn:sqlib:benchmark:e1';
const QUERY_ID = 'urn:sqlib:query:q1';
const QUERY_VERSION_ID = 'urn:sqlib:query-version:q1-v1';
const BACKEND_ID = 'urn:sqlib:backend:b1';
const RULE_SET_ID = 'urn:sqlib:rule-set:r1';
const RULE_SET_VERSION_ID = 'urn:sqlib:rule-set-version:r1-v1';
const TUPLE_SET_ID = 'urn:sqlib:tuple-set:t1';
const GRAPH_ID = 'urn:sqlib:data-graph:g1';
const OTHER_GRAPH_ID = 'urn:sqlib:data-graph:g2';

const QUERY_VERSION = {
  id: 'urn:sqlib:benchmark-version:v1',
  version: 1,
  immutable: true,
  subjectSpecs: [{ subject: QUERY_VERSION_ID, backends: [BACKEND_ID], inputs: [NO_ARGUMENTS_IRI] }],
  repeats: 1,
  executionStrategy: 'Sequential',
};

/** A rules benchmark as the API stores one: tuple sets on `inputs`, graphs of
 *  its own, and no backends at all. */
const RULE_SET_VERSION = {
  ...QUERY_VERSION,
  subjectSpecs: [{
    subject: RULE_SET_VERSION_ID,
    inputs: [TUPLE_SET_ID],
    dataGraphs: [GRAPH_ID],
  }],
};

const api = vi.hoisted(() => ({
  listArgumentSets: vi.fn(),
  getArgumentSet: vi.fn(),
  listRuleSetVersions: vi.fn(),
  exportRuleSetSrl: vi.fn(),
}));
const store = vi.hoisted(() => ({
  loading: { value: false },
  runs: { value: [] as unknown[] },
  selectedExperiment: { value: null as unknown },
  selectedVersion: { value: null as unknown },
  loadExperiments: vi.fn(),
  fetchExperiment: vi.fn(),
  listVersions: vi.fn(),
  fetchVersion: vi.fn(),
  loadRunsForVersion: vi.fn(),
  getRunObservations: vi.fn(),
  createExperiment: vi.fn(),
  updateExperiment: vi.fn(),
  createVersion: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useBenchmarksStore', () => ({ useBenchmarksStore: () => store }));
vi.mock('@/composables/useBenchmarkExecution', () => ({
  useBenchmarkExecution: () => ({ isExecuting: ref(false), executeRun: vi.fn() }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({
    isScratch: ref(false),
    hydrating: ref(false),
    savedAt: ref(null),
    flush: vi.fn(),
  }),
}));
vi.mock('@/composables/useQueriesStore', () => ({
  useQueriesStore: () => ({
    queries: { value: [{ id: QUERY_ID, name: 'Reachable pairs' }] },
    loadQueries: vi.fn(),
    loadQueryVersions: vi.fn().mockResolvedValue([
      { id: QUERY_VERSION_ID, version: 1, immutable: true, queryString: 'SELECT * WHERE { ?s ?p ?o }' },
    ]),
  }),
}));
vi.mock('@/composables/useQueryGroupsStore', () => ({
  useQueryGroupsStore: () => ({
    queryGroups: { value: [] },
    loadQueryGroups: vi.fn(),
    loadQueryGroupVersions: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({
    ruleSets: { value: [{ id: RULE_SET_ID, name: 'Reachability' }] },
    fetchRuleSets: vi.fn(),
  }),
}));
vi.mock('@/composables/useTupleSetsStore', () => ({
  useTupleSetsStore: () => ({
    tupleSets: { value: [{ id: TUPLE_SET_ID, name: 'Seeds' }] },
    loadTupleSets: vi.fn(),
  }),
}));
vi.mock('@/composables/useDataGraphsStore', () => ({
  useDataGraphsStore: () => ({
    dataGraphs: { value: [{ id: GRAPH_ID, name: 'Roads' }, { id: OTHER_GRAPH_ID, name: 'Rails' }] },
    loadDataGraphs: vi.fn(),
  }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({
    backends: { value: [{ id: BACKEND_ID, name: 'Live' }] },
    loadBackends: vi.fn(),
  }),
}));
vi.mock('@/composables/useCallableDrafts', () => ({
  useCallableDrafts: () => ({
    save: vi.fn(),
    remove: vi.fn(),
    draftFor: () => null,
    allDrafts: computed(() => [] as CallableDraft[]),
  }),
  UNASSIGNED_LIBRARY_ID: 'unassigned',
}));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

async function mountSaved() {
  const BenchmarkWorkArea = (await import('@/components/BenchmarkWorkArea.vue')).default;
  const area = mount(BenchmarkWorkArea, {
    props: { experimentId: EXPERIMENT_ID, scratchId: null },
  });
  await flushPromises();
  return area;
}

type Area = Awaited<ReturnType<typeof mountSaved>>;

interface BenchVm {
  plan: {
    cases: { id: string; subjectType: string; subjectId: string | null; versionId: string | null }[];
    backendIds: string[];
    tupleSetIds: string[];
    dataGraphIds: string[];
  };
  tab: 'plan' | 'runs';
  toggleDataGraph: (id: string) => void;
  selectItem: (payload: { kind: string; id: string }) => void;
  save: () => Promise<void>;
}
const vm = (area: Area) => area.vm as unknown as BenchVm;

/** The axis headings the plan column is drawing, in order. */
const axisNames = (area: Area) =>
  area.findAll('.axis-name').map((node) => node.text());

const useVersion = (version: unknown) => {
  store.selectedVersion.value = version;
  store.listVersions.mockResolvedValue([version]);
};

const RUN = {
  id: 'urn:sqlib:benchmark-run:run1',
  runStatus: 'Completed',
  tasksCompleted: 4,
  tasksTotal: 4,
  startedAt: '2026-09-07T02:00:00.000Z',
  endedAt: '2026-09-07T02:00:04.000Z',
  dateCreated: '2026-09-07T02:00:00.000Z',
};

/**
 * A rules run as the runner records one: two graphs, two repeats each, one
 * tuple set, and the in-process sentinel on every row.
 *
 * The two repeats over `Rails` disagree on `resultCount`, which is the reading
 * §4 of the design wants visible rather than averaged.
 */
const OBSERVATIONS = [
  {
    id: 'urn:sqlib:benchmark-observation:roads-1',
    subject: RULE_SET_VERSION_ID, backend: NOT_APPLICABLE_BACKEND_IRI, argumentSet: TUPLE_SET_ID,
    dataGraph: GRAPH_ID, dataGraphVersion: `${GRAPH_ID}:v1`, runIndex: 1,
    durationMs: 100, resultCount: 40, success: true, timestamp: '2026-09-07T02:00:00.000Z',
  },
  {
    id: 'urn:sqlib:benchmark-observation:roads-2',
    subject: RULE_SET_VERSION_ID, backend: NOT_APPLICABLE_BACKEND_IRI, argumentSet: TUPLE_SET_ID,
    dataGraph: GRAPH_ID, dataGraphVersion: `${GRAPH_ID}:v1`, runIndex: 2,
    durationMs: 120, resultCount: 40, success: true, timestamp: '2026-09-07T02:00:01.000Z',
  },
  {
    id: 'urn:sqlib:benchmark-observation:rails-1',
    subject: RULE_SET_VERSION_ID, backend: NOT_APPLICABLE_BACKEND_IRI, argumentSet: TUPLE_SET_ID,
    dataGraph: OTHER_GRAPH_ID, dataGraphVersion: `${OTHER_GRAPH_ID}:v1`, runIndex: 1,
    durationMs: 300, resultCount: 90, success: true, timestamp: '2026-09-07T02:00:02.000Z',
  },
  {
    id: 'urn:sqlib:benchmark-observation:rails-2',
    subject: RULE_SET_VERSION_ID, backend: NOT_APPLICABLE_BACKEND_IRI, argumentSet: TUPLE_SET_ID,
    dataGraph: OTHER_GRAPH_ID, dataGraphVersion: `${OTHER_GRAPH_ID}:v1`, runIndex: 2,
    durationMs: 320, resultCount: 91, success: true, timestamp: '2026-09-07T02:00:03.000Z',
  },
];

const passesFor = (observation: string, durations: number[]) =>
  durations.map((durationMs, i) => ({
    id: `${observation}:pass:${i + 1}`,
    subjectObservation: observation,
    runIndex: 1,
    iterationIndex: i + 1,
    stratum: 0,
    durationMs,
    // The last pass of a fixpoint loop is the one that derived nothing: it is
    // what proved there was nothing left to derive.
    resultCount: i === durations.length - 1 ? 0 : 20,
    tripleCount: 20 * (i + 1),
    tupleCount: null,
    rulesEvaluated: 2,
  }));

/**
 * The passes behind those four requests.
 *
 * Both repeats over `Roads` take three; the two over `Rails` take five and
 * four. A rule set needing a different number of passes each time over one
 * graph is §5's canary — the counterpart of the `resultCount` disagreement the
 * fixture already carries at the request level.
 */
const ITERATIONS = [
  ...passesFor('urn:sqlib:benchmark-observation:roads-1', [50, 30, 10]),
  ...passesFor('urn:sqlib:benchmark-observation:roads-2', [60, 35, 12]),
  ...passesFor('urn:sqlib:benchmark-observation:rails-1', [90, 80, 60, 40, 20]),
  ...passesFor('urn:sqlib:benchmark-observation:rails-2', [95, 85, 65, 45]),
];

const useRun = (observations: unknown[], iterationObservations: unknown[] = []) => {
  store.runs.value = [RUN];
  store.getRunObservations.mockResolvedValue({ observations, iterationObservations });
};

beforeEach(() => {
  vi.clearAllMocks();
  store.loading.value = false;
  store.runs.value = [];
  store.selectedExperiment.value = {
    id: EXPERIMENT_ID, name: 'Reachability', description: null, status: 'Active',
  };
  store.fetchExperiment.mockResolvedValue(undefined);
  store.fetchVersion.mockResolvedValue(undefined);
  store.loadRunsForVersion.mockResolvedValue(undefined);
  store.loadExperiments.mockResolvedValue(undefined);
  store.updateExperiment.mockResolvedValue(undefined);
  store.createVersion.mockResolvedValue({ version: 2 });
  api.listArgumentSets.mockResolvedValue([]);
  api.listRuleSetVersions.mockResolvedValue([
    { id: RULE_SET_VERSION_ID, version: 1, immutable: true },
  ]);
  api.exportRuleSetSrl.mockResolvedValue({ srl: 'RULE { ?s :q ?o } WHERE { ?s :p ?o }' });
  useVersion(QUERY_VERSION);
});

describe('BenchmarkWorkArea — rule-set subjects', () => {
  it('keeps the three query axes when no case is a rule set', async () => {
    const area = await mountSaved();
    expect(axisNames(area)).toEqual(['Cases', 'Backends', 'Argument sets', 'Load profiles']);
  });

  /*
   * The editor could not index a rule set before this landed, so a rules
   * benchmark read back as a query and its axis was invisible. Naming the
   * subject is what makes the two axes appear beside it.
   */
  it('indexes a rule-set subject and draws its two axes', async () => {
    useVersion(RULE_SET_VERSION);
    const area = await mountSaved();

    expect(vm(area).plan.cases[0]).toMatchObject({
      subjectType: 'ruleSet',
      subjectId: RULE_SET_ID,
      versionId: RULE_SET_VERSION_ID,
    });
    expect(axisNames(area)).toEqual([
      'Cases', 'Backends', 'Argument sets', 'Tuple sets', 'Data graphs', 'Load profiles',
    ]);
    expect(vm(area).plan.tupleSetIds).toEqual([TUPLE_SET_ID]);
    expect(vm(area).plan.dataGraphIds).toEqual([GRAPH_ID]);
  });

  it('names the axis members rather than printing their IRIs', async () => {
    useVersion(RULE_SET_VERSION);
    const area = await mountSaved();
    const items = area.findAll('.axis-item-name').map((node) => node.text());
    expect(items).toContain('Seeds');
    expect(items).toContain('Roads');
  });

  /*
   * The graph axis is the one worth having — sweeping one rule set across
   * graphs of growing size — so adding to it has to reach the spec. The
   * backends the plan still carries must not: the API refuses a rule-set spec
   * that names one.
   */
  it('writes an added data graph back onto the rule-set spec, and no backends', async () => {
    useVersion(RULE_SET_VERSION);
    const area = await mountSaved();

    vm(area).plan.backendIds = [BACKEND_ID];
    vm(area).toggleDataGraph(OTHER_GRAPH_ID);
    await flushPromises();
    await vm(area).save();

    const spec = store.createVersion.mock.calls[0][1].subjectSpecs[0];
    expect(spec.subject).toBe(RULE_SET_VERSION_ID);
    expect(spec.dataGraphs).toEqual([GRAPH_ID, OTHER_GRAPH_ID]);
    expect(spec.inputs).toEqual([TUPLE_SET_ID]);
    expect(spec.backends).toBeUndefined();
  });

  /*
   * A rule set evaluates in-process, so the case editor's support matrix — one
   * row per store — has nothing to say about it and says so instead of drawing
   * four rows of a comparison that will never be made.
   */
  it('replaces the support matrix with the reason there is none', async () => {
    useVersion(RULE_SET_VERSION);
    const area = await mountSaved();
    const editor = area.get('[data-testid="benchmark-case-editor"]');
    expect(editor.text()).toContain('no store axis');
    expect(editor.text()).toContain('evaluates in-process');
  });

  /*
   * A rules run's observations carry a graph where a query's carry a backend,
   * and every one of them records the same in-process sentinel — so a results
   * view that reads only the backend shows one lane, one column of "In-process"
   * and no sign of the axis the run actually varied.
   */
  it('names the graph each request ran over, and offers a filter over them', async () => {
    useVersion(RULE_SET_VERSION);
    useRun(OBSERVATIONS);
    const area = await mountSaved();

    vm(area).tab = 'runs';
    await flushPromises();

    const rows = area.findAll('[data-testid="benchmark-request-row"]');
    expect(rows).toHaveLength(4);
    expect(rows[0].text()).toContain('Roads');
    expect(rows[2].text()).toContain('Rails');
    // The IRI tail would distinguish the graphs too, and tell you nothing.
    expect(rows[0].text()).not.toContain(GRAPH_ID);

    // The graph filter is a fuzzy chooser now: its rows exist once it is open.
    await area.get('[data-testid="benchmark-graph-filter"]').trigger('click');
    await nextTick();
    const rowsText = area
      .findAll('[data-testid="benchmark-graph-filter-option"]')
      .map((option) => option.text())
      .join(' ');
    expect(rowsText).toContain('Roads');
    expect(rowsText).toContain('Rails');
  });

  /* A benchmark of queries has no graph axis and gains no column for one. */
  it('leaves the graph column off a run without one', async () => {
    useRun([{
      subject: QUERY_VERSION_ID, backend: BACKEND_ID, argumentSet: NO_ARGUMENTS_IRI,
      runIndex: 1, durationMs: 90, resultCount: 5, success: true,
      timestamp: '2026-09-07T02:00:00.000Z',
    }]);
    const area = await mountSaved();

    vm(area).tab = 'runs';
    await flushPromises();

    expect(area.find('[data-testid="benchmark-graph-filter"]').exists()).toBe(false);
    expect(area.get('[data-testid="benchmark-run-view"]').text()).toContain('one lane per backend');
  });

  /*
   * The support matrix's counterpart. A rule set has no store to put a number
   * beside, and the comparison its graph axis exists for — the same rule set
   * over a bigger graph — had nowhere to be read.
   */
  it('puts p95 and the inferred triple count beside each graph on the axis', async () => {
    useVersion(RULE_SET_VERSION);
    useRun(OBSERVATIONS);
    const area = await mountSaved();

    vm(area).toggleDataGraph(OTHER_GRAPH_ID);
    vm(area).tab = 'runs';
    await flushPromises();
    vm(area).tab = 'plan';
    await flushPromises();

    const costs = area.get('[data-testid="benchmark-graph-costs"]');
    const rows = costs.findAll('.support-row').map((node) => node.text());
    expect(rows[0]).toContain('Roads');
    // Nearest-rank p95 of one graph's two repeats, and the count they agree on.
    expect(rows[0]).toContain('120ms');
    expect(rows[0]).toContain('40 triples inferred');
    expect(rows[0]).toContain('2 runs');

    // Two repeats of one graph inferring different numbers of triples is the
    // canary the count is there for, and averaging it away would hide it.
    expect(rows[1]).toContain('Rails');
    expect(rows[1]).toContain('output size varies');
  });

  /*
   * The passes of the fixpoint loop (#393 recorded them, nothing drew them).
   *
   * A rules request is one run to fixpoint, so its observation cannot tell a
   * run that is slow in one pass from one that needs eleven of them — which is
   * the question a rules benchmark exists to answer.
   */
  describe('passes', () => {
    it('counts the passes of each request in the table', async () => {
      useVersion(RULE_SET_VERSION);
      useRun(OBSERVATIONS, ITERATIONS);
      const area = await mountSaved();

      vm(area).tab = 'runs';
      await flushPromises();

      const counts = area.findAll('[data-testid="benchmark-request-passes"]')
        .map((node) => node.text());
      expect(counts).toEqual(['3', '3', '5', '4']);
      expect(area.get('[data-testid="benchmark-run-view"]').text()).toContain('Passes');
    });

    /* A query never runs a loop, so the column claims nothing it cannot fill. */
    it('leaves the passes column off a run without any', async () => {
      useVersion(RULE_SET_VERSION);
      useRun(OBSERVATIONS);
      const area = await mountSaved();

      vm(area).tab = 'runs';
      await flushPromises();

      expect(area.find('[data-testid="benchmark-request-passes"]').exists()).toBe(false);
    });

    it('opens one request into where inside the loop its time went', async () => {
      useVersion(RULE_SET_VERSION);
      useRun(OBSERVATIONS, ITERATIONS);
      const area = await mountSaved();

      vm(area).tab = 'runs';
      await flushPromises();
      await area.findAll('[data-testid="benchmark-request-row"]')[0].trigger('click');
      await flushPromises();

      const passes = area.get('[data-testid="benchmark-request-passes-detail"]');
      expect(passes.text()).toContain('3 to fixpoint');
      // The slowest pass carries the marker the eye goes to first.
      expect(passes.findAll('.pass-row')[0].classes()).toContain('pass-slowest');
      // The delta, not the running total: what this pass derived.
      expect(passes.text()).toContain('+20');
      expect(passes.text()).toContain('+0');
    });

    /*
     * Reported, never averaged. Nine passes once and twelve another time is a
     * finding about the rule set; a mean of ten and a half describes neither.
     */
    it('says when repeats of one request disagree on their pass count', async () => {
      useVersion(RULE_SET_VERSION);
      useRun(OBSERVATIONS, ITERATIONS);
      const area = await mountSaved();

      vm(area).tab = 'runs';
      await flushPromises();
      await area.findAll('[data-testid="benchmark-request-row"]')[2].trigger('click');
      await flushPromises();

      const passes = area.get('[data-testid="benchmark-request-passes-detail"]');
      expect(passes.text()).toContain('5, 4');
      expect(passes.text()).toContain('not measuring the same thing twice');
    });

    /*
     * The comparison the graph axis exists for. The same rule set taking three
     * passes over one graph and five over another is what the timings alone
     * cannot say, and it belongs beside them.
     */
    it('reports the pass count per graph rather than across them', async () => {
      useVersion(RULE_SET_VERSION);
      useRun(OBSERVATIONS, ITERATIONS);
      const area = await mountSaved();

      vm(area).toggleDataGraph(OTHER_GRAPH_ID);
      vm(area).tab = 'runs';
      await flushPromises();
      vm(area).tab = 'plan';
      await flushPromises();

      const rows = area.get('[data-testid="benchmark-graph-costs"]')
        .findAll('.support-row').map((node) => node.text());
      expect(rows[0]).toContain('3 passes');
      expect(rows[1]).toContain('passes vary');
    });
  });

  /** The graph axis picker offers the library's graphs, checked where named. */
  it('offers the library data graphs on the graph axis', async () => {
    useVersion(RULE_SET_VERSION);
    const area = await mountSaved();

    vm(area).selectItem({ kind: 'dataGraphs', id: GRAPH_ID });
    await flushPromises();

    const detail = area.get('[data-testid="benchmark-plan-detail"]');
    expect(detail.text()).toContain('Data graphs');
    expect(detail.text()).toContain('Roads');
    expect(detail.text()).toContain('Rails');
  });
});
