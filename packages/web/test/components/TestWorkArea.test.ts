import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import TestWorkArea from '@/components/TestWorkArea.vue';

const api = vi.hoisted(() => ({
  listDataGraphs: vi.fn(),
  listDataGraphVersions: vi.fn(),
  listRuleSetVersions: vi.fn(),
  listQueryVersions: vi.fn(),
  listQueryGroupVersions: vi.fn(),
  listArgumentSets: vi.fn(),
  exportRuleSetSrl: vi.fn(),
  exportArgumentSet: vi.fn(),
  getTest: vi.fn(),
  // A saved test's name and description are written back on save; before
  // Details owned them the rename went nowhere.
  updateTest: vi.fn(),
  // The Tags field loads the library's vocabulary for its picker.
  listTags: vi.fn(),
}));
const store = vi.hoisted(() => {
  /*
   * The real store keeps one verdict per test and the screen reads it there —
   * a run started from the Runs tab writes the same map — so the stand-in has
   * to do the same or the panel it feeds is testing nothing.
   */
  const lastRunByTest = { value: {} as Record<string, unknown> };
  return {
    tests: { value: [] as Array<{ id: string; tags?: string[] | null }> },
    lastRunByTest,
    runTest: vi.fn(async (testId: string) => {
      const result = (store.runTest as unknown as { nextResult?: unknown }).nextResult;
      if (result) lastRunByTest.value = { ...lastRunByTest.value, [testId]: result };
      return result;
    }),
    createTest: vi.fn(),
    createVersion: vi.fn(),
    deleteTest: vi.fn(),
    loadVersions: vi.fn(),
    loadTests: vi.fn(),
  };
});

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useTestsStore', () => ({ useTestsStore: () => store }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'urn:sqlib:library:lib1' } }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({ isScratch: { value: true }, hydrating: { value: false }, savedAt: { value: null }, flush: vi.fn() }),
}));
vi.mock('@/composables/useQueriesStore', () => ({
  useQueriesStore: () => ({
    queries: { value: [{ id: 'urn:sqlib:query:q1', name: 'Reaches', isPartOf: ['urn:sqlib:library:lib1'] }] },
    loadQueries: vi.fn(),
  }),
}));
vi.mock('@/composables/useQueryGroupsStore', () => ({
  useQueryGroupsStore: () => ({
    queryGroups: { value: [{ id: 'urn:sqlib:query-group:g1', name: 'Fan out', isPartOf: 'urn:sqlib:library:lib1' }] },
    loadQueryGroups: vi.fn(),
  }),
}));
vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({ ruleSets: { value: [{ id: 'urn:sqlib:ruleset:rs1', name: 'Reach', isPartOf: ['urn:sqlib:library:lib1'] }] }, fetchRuleSets: vi.fn() }),
}));
// ETL is an optional feature and this screen only lists its jobs as possible
// subjects; the real store would reach the network for a list every spec here
// leaves empty.
vi.mock('@/composables/useEtlJobsStore', () => ({
  useEtlJobsStore: () => ({
    etlJobs: { value: [] },
    loadEtlJobs: vi.fn().mockResolvedValue([]),
    loadEtlJobVersions: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends: { value: [{ id: 'urn:sqlib:backend:b1', name: 'Live' }] }, loadBackends: vi.fn() }),
}));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/*
 * These specs exercise the SRL rule-tuples extension, which a default build
 * withholds (`ruleTuples` defaults off). Declaring it on here keeps them
 * testing the extension rather than the gate; `ruleTuplesGate.test.ts` covers
 * what the same surfaces do with it off.
 */
(globalThis as Record<string, unknown>).__NUXT_TEST_CONFIG__ = {
  public: { apiBaseUrl: 'http://api.test', featureFlags: { ruleTuples: true } },
};

// The expectation and named-tuples boxes are CodeMirror instances; what these
// specs are about is the text they hold, so a textarea stands in for each.
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
  },
}));

/** Stub the next run: the store's mock records it exactly as the real one does. */
function setNextRun(result: Record<string, unknown>) {
  (store.runTest as unknown as { nextResult?: unknown }).nextResult = result;
}


function mountArea() {
  return mount(TestWorkArea, { props: { testId: null, scratchId: 'urn:ui-temp:1' } });
}

/** The subject chooser is a combobox now: open it, then click the named row. */
/** Open one of the screen's fuzzy choosers and click the row with this label. */
async function choose(area: ReturnType<typeof mountArea>, testId: string, label: string) {
  await area.get(`[data-testid="${testId}"]`).trigger('click');
  await nextTick();
  const option = area
    .findAll(`[data-testid="${testId}-option"]`)
    .find((candidate) => candidate.text() === label);
  if (!option) throw new Error(`no "${testId}" option labelled "${label}"`);
  await option.trigger('click');
}

async function chooseSubject(area: ReturnType<typeof mountArea>, label: string) {
  await choose(area, 'test-subject', label);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listDataGraphs.mockResolvedValue([]);
  api.listDataGraphVersions.mockResolvedValue([]);
  api.listRuleSetVersions.mockResolvedValue([{ id: 'urn:v1', version: 1 }, { id: 'urn:v2', version: 2 }]);
  api.listArgumentSets.mockResolvedValue([]);
  api.exportRuleSetSrl.mockResolvedValue({ srl: 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }', ruleCount: 1, dataBlockCount: 0, tupleSeeds: '', tuplesEnabled: false, warnings: [] });
  api.exportArgumentSet.mockResolvedValue({ arguments: [], limits: [], offsets: [] });
  api.listQueryVersions.mockResolvedValue([{ id: 'urn:qv1', version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' }]);
  store.loadVersions.mockResolvedValue([]);
  api.listTags.mockResolvedValue([]);
});

describe('TestWorkArea', () => {
  it('files a test with tags, and has no Group field to file it twice', async () => {
    // `Test.group` is gone: the free-text label folded the list on an axis the
    // tag control silently replaced whenever it was on, and a persisted setting
    // decided which of the two a reader saw.
    const area = mountArea();
    await flushPromises();

    expect(area.find('[data-testid="test-group"]').exists()).toBe(false);
    expect(area.find('[data-testid="entity-tags-field"]').exists()).toBe(true);

    // Scratch has no entity to tag yet, so the trigger says so rather than
    // writing a tag onto an id that does not exist.
    expect(area.get('[data-testid="entity-tags-add"]').attributes('disabled')).toBeDefined();
  });

  it('creates a test without a group in the payload', async () => {
    store.createTest.mockResolvedValue({ id: 'urn:sqlib:test:t1', name: 'Reaches' });
    store.createVersion.mockResolvedValue({ id: 'urn:sqlib:test-version:v1', version: 1 });

    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="details-name"]').setValue('Reaches');
    await chooseSubject(area, 'Reach');
    await flushPromises();
    // Smoke asserts nothing, which is the cheapest savable test to write.
    await area.get('[data-testid="test-expectation-kind"]').setValue('smoke');
    await flushPromises();
    await area.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(store.createTest).toHaveBeenCalledTimes(1);
    expect(store.createTest.mock.calls[0][0]).not.toHaveProperty('group');
  });

  it('edits the name and description in Details, and nowhere else', async () => {
    // One editor of each field. The name used to sit in the Subject block,
    // where a saved test's rename was dropped on save entirely.
    const area = mountArea();
    await flushPromises();

    expect(area.findAll('[data-testid="details-name"]')).toHaveLength(1);
    expect(area.find('[data-testid="details-description"]').exists()).toBe(true);
    // Tags come with them: they are on the stable test, not on a version.
    expect(area.find('[data-testid="entity-tags-field"]').exists()).toBe(true);
  });

  it('offers the run call in the Code tab, in both readings of it', async () => {
    // An export *is* a run under an Accept header — the library keeps no run to
    // fetch afterwards — so both are the same endpoint.
    const area = mountArea();
    await flushPromises();

    const panel = area.get('[data-testid="code-snippet-panel"]');
    expect(panel.text()).toContain('/tests/');
    expect(area.find('[data-testid="code-variant-run"]').exists()).toBe(true);
    expect(area.find('[data-testid="code-variant-report"]').exists()).toBe(true);
    // A scratch test has no id for the call to name, and says so.
    expect(area.find('[data-testid="code-unavailable"]').exists()).toBe(true);
  });

  it('explains itself in tooltips rather than standing prose', async () => {
    // The mock's rule: the page states values; what a field means lives behind
    // the `i`. Standing explanation under every heading reads as caveats.
    const area = mountArea();
    await flushPromises();
    expect(area.findAll('.info-hint').length).toBeGreaterThanOrEqual(4);
  });

  it('derives hermetic vs integration from whether a backend is named', async () => {
    const area = mountArea();
    await flushPromises();

    // A rule set runs in-process, so it is hermetic and has no backend to name.
    const badge = area.get('[data-testid="test-hermetic"]');
    expect(badge.text()).toContain('Hermetic');
    expect(badge.classes()).toContain('status-badge--success');

    await area.get('[data-testid="test-kind-query"]').trigger('click');
    await flushPromises();
    // Still hermetic: a query defaults to the data graph store.
    expect(area.get('[data-testid="test-hermetic"]').text()).toContain('Hermetic');

    await area.get('[data-testid="test-store-backend"]').trigger('click');
    await flushPromises();
    expect(area.get('[data-testid="test-hermetic"]').text()).toBe('Integration');
  });

  it('calls a query group integration, because its nodes name their own backends', async () => {
    const area = mountArea();
    await flushPromises();

    await area.get('[data-testid="test-kind-queryGroup"]').trigger('click');
    await flushPromises();

    // The test names no backend and cannot: saying "hermetic" on that basis
    // would record a claim of reproducibility in every report the run emits.
    expect(area.get('[data-testid="test-hermetic"]').text()).toBe('Integration');
  });

  it('pins to the subject’s newest version, and back to current', async () => {
    const area = mountArea();
    await chooseSubject(area, 'Reach');
    await flushPromises();

    // Current by default: the test follows the subject as it is edited.
    expect(area.find('[data-testid="test-subject-version"]').exists()).toBe(false);

    await area.get('[data-testid="test-subject-pinned"]').trigger('click');
    await flushPromises();
    expect((area.get('[data-testid="test-subject-version"]').element as HTMLSelectElement).value)
      .toBe('urn:v2');

    await area.get('[data-testid="test-subject-current"]').trigger('click');
    await flushPromises();
    expect(area.find('[data-testid="test-subject-version"]').exists()).toBe(false);
  });

  it('shows only the input slots that apply to the subject kind, and hides the rest', async () => {
    // Absent rather than disabled: a greyed "Argument set" on a rule-set test
    // reads as something broken, where the truth is that a rule set has no
    // such thing.
    const area = mountArea();
    await flushPromises();

    // A rule set: a data graph and tuple seeds, no argument set, no backend,
    // and no store toggle because there is no choice to make.
    expect(area.find('[data-testid="test-data-graph"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-tuple-seeds"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-argument-set"]').exists()).toBe(false);
    expect(area.find('[data-testid="test-backend"]').exists()).toBe(false);
    expect(area.find('[data-testid="test-store-backend"]').exists()).toBe(false);

    await area.get('[data-testid="test-kind-query"]').trigger('click');
    await flushPromises();
    expect(area.find('[data-testid="test-argument-set"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-tuple-seeds"]').exists()).toBe(false);
    // Both stores are offered, one at a time.
    expect(area.find('[data-testid="test-store-backend"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-data-graph"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-backend"]').exists()).toBe(false);

    await area.get('[data-testid="test-kind-queryGroup"]').trigger('click');
    await flushPromises();
    // A query group takes its input through its start node, which declares two
    // independent kinds: tuples (an argument set) and data graphs. Both slots
    // show, and no store toggle — the group names its stores per node, so the
    // graph here is data going in rather than a store to choose between.
    expect(area.find('[data-testid="test-argument-set"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-data-graph"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-backend"]').exists()).toBe(false);
    expect(area.find('[data-testid="test-store-backend"]').exists()).toBe(false);
  });

  it('swaps the query store rather than holding both', async () => {
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-kind-query"]').trigger('click');
    await flushPromises();

    await area.get('[data-testid="test-store-backend"]').trigger('click');
    await flushPromises();
    expect(area.find('[data-testid="test-backend"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-data-graph"]').exists()).toBe(false);

    await area.get('[data-testid="test-store-dataGraph"]').trigger('click');
    await flushPromises();
    expect(area.find('[data-testid="test-data-graph"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-backend"]').exists()).toBe(false);
  });

  it('locks the subject kind once the test is saved', async () => {
    // The server refuses to repoint a saved test's subject: every reference to
    // a test means the thing it tests.
    const area = mountArea();
    await flushPromises();
    // Scratch, so it is still open.
    expect(area.get('[data-testid="test-kind-query"]').attributes('disabled')).toBeUndefined();
  });

  it('previews the subject rather than only naming it', async () => {
    const area = mountArea();
    await chooseSubject(area, 'Reach');
    await flushPromises();

    // A rule set's SRL document, which already carries its DATA blocks. Open
    // on the page rather than behind a click: the peek shows the first lines
    // that say something, and the header says which version they came from.
    const preview = area.get('[data-testid="test-subject-preview"]');
    expect((preview.get('textarea').element as HTMLTextAreaElement).value).toContain(':reaches');
    expect(preview.text()).toContain('1 rules');
  });

  it('hides the named-tuples box when the rule set does not use tuples', async () => {
    const area = mountArea();
    await chooseSubject(area, 'Reach');
    await flushPromises();

    // `tuplesEnabled` is false on the mocked export, so this rule set has no
    // tuple store for seeds to go into. Absent rather than disabled, and with
    // nothing standing in its place.
    expect(area.find('[data-testid="test-tuple-seeds"]').exists()).toBe(false);
  });

  it('offers named tuples when the rule set does use them', async () => {
    api.exportRuleSetSrl.mockResolvedValue({
      srl: 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }',
      ruleCount: 1,
      dataBlockCount: 0,
      tupleSeeds: '',
      tuplesEnabled: true,
      warnings: [],
    });
    const area = mountArea();
    await chooseSubject(area, 'Reach');
    await flushPromises();

    expect(area.find('[data-testid="test-tuple-seeds"]').exists()).toBe(true);
  });

  it('says why saving is blocked instead of leaving a dead button', async () => {
    const area = mountArea();
    // Kind first: changing it clears the subject, because the list of things
    // that could be the subject changed underneath.
    await area.get('[data-testid="test-kind-query"]').trigger('click');
    await chooseSubject(area, 'Reaches');
    await flushPromises();

    // A query with neither store named has nowhere to run, and the page says
    // so in the server's own words.
    const problems = area.get('[data-testid="test-save-problems"]');
    expect(problems.text()).toMatch(/nowhere to run/);
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeDefined();
  });

  /*
   * Opening a saved test read the record, set its subject, and only then read
   * the versions — so for the length of that second request the subject sat
   * over the blank placeholder case and the page flashed "Every case needs an
   * expected result." about a case nobody wrote.
   */
  it('never flashes save problems while a saved test is still loading', async () => {
    api.getTest.mockResolvedValue({
      data: {
        id: 'urn:sqlib:test:t1',
        name: 'Reaches',
        subject: 'urn:sqlib:ruleset:rs1',
        subjectKind: 'ruleSet',
        currentVersion: 'urn:sqlib:test-version:v1',
        isPartOf: ['urn:sqlib:library:lib1'],
      },
    });
    let resolveVersions!: (versions: unknown[]) => void;
    store.loadVersions.mockReturnValue(new Promise((resolve) => { resolveVersions = resolve; }));

    const area = mount(TestWorkArea, { props: { testId: 'urn:sqlib:test:t1', scratchId: null } });
    await flushPromises();
    expect(area.find('[data-testid="test-save-problems"]').exists()).toBe(false);

    resolveVersions([{
      id: 'urn:sqlib:test-version:v1',
      version: 1,
      expectationKind: 'graph',
      subjectVersion: null,
      backend: null,
      cases: [{ name: null, expected: '<http://example/a> <http://example/reaches> <http://example/b> .', expectedFormat: 'text/turtle', ordered: null }],
    }]);
    await flushPromises();
    expect(area.find('[data-testid="test-save-problems"]').exists()).toBe(false);
  });

});

/*
 * Parametrised tests. A test always has at least one case, so the single-case
 * shape is the same editor with one tab — which is what these check does not
 * change when a second appears.
 */
describe('TestWorkArea — cases', () => {
  it('starts with one case and hides the per-case chrome that only N cases need', async () => {
    const area = mountArea();
    await flushPromises();

    expect(area.findAll('.case-tab')).toHaveLength(1);
    // Naming and removing are meaningless with one case, and the case name
    // field is what makes the tab strip readable once there are several.
    expect(area.find('[data-testid="test-case-name"]').exists()).toBe(false);
    expect(area.find('[data-testid="test-case-remove-0"]').exists()).toBe(false);
  });

  it('adds a case seeded from the one in view, and switches to it', async () => {
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-expected"] textarea').setValue('<http://ex/a> <http://ex/p> <http://ex/b> .');

    await area.get('[data-testid="test-add-case"]').trigger('click');
    await flushPromises();

    expect(area.findAll('.case-tab')).toHaveLength(2);
    // Seeded, not empty: a second case usually varies one input, and retyping
    // the rest is how one parametrised test becomes two unrelated ones.
    expect((area.get('[data-testid="test-expected"] textarea').element as HTMLTextAreaElement).value)
      .toBe('<http://ex/a> <http://ex/p> <http://ex/b> .');
    expect(area.get('[data-testid="test-case-tab-1"]').classes()).toContain('on');
  });

  it('edits the selected case, not all of them', async () => {
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-expected"] textarea').setValue('first');
    await area.get('[data-testid="test-add-case"]').trigger('click');
    await flushPromises();
    await area.get('[data-testid="test-expected"] textarea').setValue('second');

    await area.get('[data-testid="test-case-tab-0"]').trigger('click');
    await flushPromises();
    expect((area.get('[data-testid="test-expected"] textarea').element as HTMLTextAreaElement).value).toBe('first');
  });

  it('never removes the last case, because a test with none runs nothing', async () => {
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-add-case"]').trigger('click');
    await flushPromises();

    await area.get('[data-testid="test-case-remove-1"]').trigger('click');
    await flushPromises();
    expect(area.findAll('.case-tab')).toHaveLength(1);
    expect(area.find('[data-testid="test-case-remove-0"]').exists()).toBe(false);
  });

  it('sends one case per row, with the inputs that apply to the subject kind', async () => {
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-expected"] textarea').setValue('first');
    await area.get('[data-testid="test-add-case"]').trigger('click');
    await flushPromises();
    await area.get('[data-testid="test-expected"] textarea').setValue('second');

    const body = (area.vm as unknown as { versionBody: () => { cases: Array<Record<string, unknown>> } })
      .versionBody();
    expect(body.cases).toHaveLength(2);
    expect(body.cases.map(c => c.expected)).toEqual(['first', 'second']);
    // A rule set has no argument set; sending one would store a value nothing
    // reads and the UI cannot show.
    expect(body.cases[0].argumentSetVersion).toBeNull();
  });

  it('lands on the first failing case, so the inputs on screen are the ones that failed', async () => {
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-add-case"]').trigger('click');
    await flushPromises();
    (area.vm as unknown as { testId: string | null }).testId = 'urn:sqlib:test:t1';
    setNextRun({
      testId: 'urn:sqlib:test:t1',
      testVersionId: 'v',
      passed: false,
      message: 'second: Graphs are not isomorphic',
      expectationKind: 'graph',
      hermetic: true,
      durationMs: 12,
      subjectVersionId: null,
      ranAt: '2026-08-14T00:00:00.000Z',
      cases: [
        { caseId: 'c1', name: 'first', position: 0, passed: true, message: '', durationMs: 6 },
        {
          caseId: 'c2',
          name: 'second',
          position: 1,
          passed: false,
          message: 'Graphs are not isomorphic',
          detail: { missing: ['<http://ex/a> <http://ex/p> <http://ex/z> .'], unexpected: [], matched: 0 },
          durationMs: 6,
        },
      ],
      passedCount: 1,
      failedCount: 1,
    });

    await (area.vm as unknown as { run: () => Promise<void> }).run();
    await flushPromises();

    // Hunting for the failing row is the work this saves. The verdict and the
    // diff are the Runs tab's screen — see `TestRunDetail`.
    expect(area.get('[data-testid="test-case-tab-1"]').classes()).toContain('on');
  });

  /*
   * The Runs tab's screen is this one with its main pane swapped, so the
   * inspector beside it does not go anywhere: picking a row used to replace
   * the whole screen, which took Details and Code with it.
   */
  it('shows the run in the main pane and keeps the inspector beside it', async () => {
    api.getTest.mockResolvedValue({
      data: {
        id: 'urn:sqlib:test:t1',
        name: 'Reaches',
        description: '',
        subject: 'urn:sqlib:ruleset:rs1',
        subjectKind: 'ruleSet',
        currentVersion: null,
        isPartOf: ['urn:sqlib:library:lib1'],
      },
    });
    store.lastRunByTest.value = {
      'urn:sqlib:test:t1': {
        testId: 'urn:sqlib:test:t1',
        passed: false,
        message: 'Graphs are not isomorphic',
        expectationKind: 'graph',
        testVersionId: null,
        subjectVersionId: null,
        ranAt: '2026-08-14T00:00:00.000Z',
        cases: [{ caseId: 'c1', name: 'first', position: 0, passed: false, message: 'Graphs are not isomorphic', durationMs: 6 }],
        passedCount: 0,
        failedCount: 1,
      },
    };

    const area = mount(TestWorkArea, { props: { testId: 'urn:sqlib:test:t1', scratchId: null, runView: true } });
    await flushPromises();

    // The middle is the verdict, not the editor.
    expect(area.find('[data-testid="test-run-detail"]').exists()).toBe(true);
    expect(area.find('[data-testid="test-subject"]').exists()).toBe(false);
    // And the tabs are still there, on the tab they were on.
    expect(area.find('[data-testid="test-inspector"]').exists()).toBe(true);

    // Configure is the Tests tab for the same row: the page owns which tab is
    // showing, so this screen asks rather than switching itself.
    await area.get('[data-testid="test-run-detail-configure"]').trigger('click');
    expect(area.emitted('open-config')).toHaveLength(1);
  });
});

/**
 * A group's argument set may carry the graphs itself.
 *
 * A count rather than a port name: a set carries graphs in order and the group
 * routes them, so there is nothing named here to compare against. When the
 * chosen set carries any, the case's select is absent rather than present and
 * inert — a case graph is appended after the set's, so offering it would
 * invite a run with one graph more than the group declares inputs for.
 */
describe('TestWorkArea — a graph the argument set already supplies', () => {
  const SET_VERSION = 'urn:sqlib:argument-set-version:v1';

  function setCarryingGraphs(count: number) {
    return [{
      id: 'urn:sqlib:argument-set:s1',
      name: 'With source',
      currentVersionId: SET_VERSION,
      currentVersion: { graphBindings: Array.from({ length: count }, (_, position) => ({ position })) },
    }];
  }

  it('hides the case graph select when the set carries a graph', async () => {
    api.listArgumentSets.mockResolvedValue(setCarryingGraphs(1));
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-kind-queryGroup"]').trigger('click');
    await chooseSubject(area, 'Fan out');
    await flushPromises();

    await choose(area, 'test-argument-set', 'With source');
    await flushPromises();

    expect(area.find('[data-testid="test-data-graph"]').exists()).toBe(false);
    expect(area.find('[data-testid="test-graph-from-argument-set"]').exists()).toBe(true);
  });

  it('keeps the select when the chosen set carries no graph', async () => {
    api.listArgumentSets.mockResolvedValue([{
      id: 'urn:sqlib:argument-set:s2',
      name: 'Tables only',
      currentVersionId: SET_VERSION,
      currentVersion: { graphBindings: [] },
    }]);
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-kind-queryGroup"]').trigger('click');
    await chooseSubject(area, 'Fan out');
    await flushPromises();

    await choose(area, 'test-argument-set', 'Tables only');
    await flushPromises();

    expect(area.find('[data-testid="test-data-graph"]').exists()).toBe(true);
  });

  /* A query declares no graph parameter, so its fixture graph never collides. */
  it('leaves a query case\'s graph select alone', async () => {
    api.listArgumentSets.mockResolvedValue(setCarryingGraphs(1));
    const area = mountArea();
    await flushPromises();
    await area.get('[data-testid="test-kind-query"]').trigger('click');
    await chooseSubject(area, 'Reaches');
    await flushPromises();

    await choose(area, 'test-argument-set', 'With source');
    await flushPromises();

    expect(area.find('[data-testid="test-data-graph"]').exists()).toBe(true);
  });
});
