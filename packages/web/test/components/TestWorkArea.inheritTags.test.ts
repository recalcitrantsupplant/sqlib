/**
 * The copy-tags checkbox on a scratch test.
 *
 * What it controls is one field of the create body and nothing else: ticked,
 * `tags` is absent and the server copies the subject's; unticked, it is `[]`,
 * which is the only way to tell a seeding server "none". These specs are
 * written against that body rather than against a list of tag IRIs on purpose
 * — if the screen ever starts sending the tags it drew, the copy rule has two
 * implementations and the second one is the one that goes stale.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import TestWorkArea from '@/components/TestWorkArea.vue';

const LIBRARY = 'urn:sqlib:library:lib1';
const W3C = 'urn:sqlib:tag:w3c';
const NEGATION = 'urn:sqlib:tag:negation';
/** Carried by the rule set but absent from the library's vocabulary. */
const STALE = 'urn:sqlib:tag:stale';

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
  updateTest: vi.fn(),
  listTags: vi.fn(),
}));

const store = vi.hoisted(() => ({
  tests: { value: [] as Array<{ id: string; tags?: string[] | null }> },
  lastRunByTest: { value: {} as Record<string, unknown> },
  runTest: vi.fn(),
  createTest: vi.fn(),
  createVersion: vi.fn(),
  deleteTest: vi.fn(),
  loadVersions: vi.fn(),
  loadTests: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useTestsStore', () => ({ useTestsStore: () => store }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: LIBRARY } }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({ isScratch: { value: true }, hydrating: { value: false }, savedAt: { value: null }, flush: vi.fn() }),
}));
vi.mock('@/composables/useQueriesStore', () => ({
  useQueriesStore: () => ({
    queries: { value: [{ id: 'urn:sqlib:query:q1', name: 'Reaches', isPartOf: [LIBRARY], tags: [] }] },
    loadQueries: vi.fn(),
  }),
}));
vi.mock('@/composables/useQueryGroupsStore', () => ({
  useQueryGroupsStore: () => ({ queryGroups: { value: [] }, loadQueryGroups: vi.fn() }),
}));
vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({
    ruleSets: {
      value: [{ id: 'urn:sqlib:ruleset:rs1', name: 'Reach', isPartOf: [LIBRARY], tags: [W3C, NEGATION, STALE] }],
    },
    fetchRuleSets: vi.fn(),
  }),
}));
vi.mock('@/composables/useDataGraphsStore', () => ({
  useDataGraphsStore: () => ({ dataGraphs: { value: [] }, loadDataGraphs: vi.fn() }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends: { value: [{ id: 'urn:sqlib:backend:b1', name: 'Live' }] }, loadBackends: vi.fn() }),
}));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
  },
}));

function mountArea() {
  return mount(TestWorkArea, { props: { testId: null, scratchId: 'urn:ui-temp:1' } });
}

async function chooseSubject(area: ReturnType<typeof mountArea>, label: string) {
  await area.get('[data-testid="test-subject"]').trigger('click');
  await nextTick();
  const option = area
    .findAll('[data-testid="test-subject-option"]')
    .find((candidate) => candidate.text() === label);
  if (!option) throw new Error(`no subject option labelled "${label}"`);
  await option.trigger('click');
}

/** Fill in the cheapest savable test there is, and save it. */
async function saveSmokeTest(area: ReturnType<typeof mountArea>) {
  await area.get('[data-testid="details-name"]').setValue('Reaches');
  await chooseSubject(area, 'Reach');
  await flushPromises();
  await area.get('[data-testid="test-expectation-kind"]').setValue('smoke');
  await flushPromises();
  await area.get('[data-testid="save"]').trigger('click');
  await flushPromises();
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
  api.listTags.mockResolvedValue([
    { id: W3C, name: 'w3c', color: '#2f6feb', isPartOf: LIBRARY },
    { id: NEGATION, name: 'negation', color: '#15803d', isPartOf: LIBRARY },
  ]);
  store.loadVersions.mockResolvedValue([]);
  store.createTest.mockResolvedValue({ id: 'urn:sqlib:test:t1', name: 'Reaches' });
  store.createVersion.mockResolvedValue({ id: 'urn:sqlib:test-version:v1', version: 1 });
});

describe('TestWorkArea — copying the subject’s tags', () => {
  it('offers nothing until a subject with tags is chosen', async () => {
    const area = mountArea();
    await flushPromises();

    expect(area.find('[data-testid="inherit-tags-toggle"]').exists()).toBe(false);

    await chooseSubject(area, 'Reach');
    await flushPromises();

    expect(area.find('[data-testid="inherit-tags-toggle"]').exists()).toBe(true);
  });

  it('names the tags it will copy, and only the ones this library holds', async () => {
    const area = mountArea();
    await flushPromises();
    await chooseSubject(area, 'Reach');
    await flushPromises();

    const toggle = area.get('[data-testid="inherit-tags-toggle"]');
    expect(toggle.text()).toContain('Copy 2 tags from the rule set');
    expect(toggle.find(`[data-testid="inherit-tag-chip-${W3C}"]`).exists()).toBe(true);
    expect(toggle.find(`[data-testid="inherit-tag-chip-${NEGATION}"]`).exists()).toBe(true);
    // Not in the library's vocabulary, so not ours to copy — and the server
    // would drop it too.
    expect(toggle.find(`[data-testid="inherit-tag-chip-${STALE}"]`).exists()).toBe(false);
  });

  it('is on by default, and leaves tags out of the create body so the server copies', async () => {
    const area = mountArea();
    await flushPromises();
    await chooseSubject(area, 'Reach');
    await flushPromises();

    expect((area.get('[data-testid="inherit-tags-checkbox"]').element as HTMLInputElement).checked).toBe(true);

    await saveSmokeTest(area);

    expect(store.createTest).toHaveBeenCalledTimes(1);
    expect(store.createTest.mock.calls[0][0]).not.toHaveProperty('tags');
  });

  it('sends an empty array when unticked, which is how a caller says “none”', async () => {
    const area = mountArea();
    await flushPromises();
    await chooseSubject(area, 'Reach');
    await flushPromises();
    await area.get('[data-testid="inherit-tags-checkbox"]').setValue(false);
    await flushPromises();

    await saveSmokeTest(area);

    expect(store.createTest).toHaveBeenCalledTimes(1);
    expect(store.createTest.mock.calls[0][0]).toMatchObject({ tags: [] });
  });

  it('does not offer the copy for a subject that carries no tags', async () => {
    const area = mountArea();
    await flushPromises();
    // The untagged subject is a query, and the kind decides which list the
    // chooser is showing.
    await area.get('[data-testid="test-kind-query"]').trigger('click');
    await flushPromises();
    await chooseSubject(area, 'Reaches');
    await flushPromises();

    expect(area.find('[data-testid="inherit-tags-toggle"]').exists()).toBe(false);
  });
});
