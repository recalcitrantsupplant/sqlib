/**
 * Which kinds of subject the Tests screen offers.
 *
 * A kind whose feature this build withholds has nothing to point at: the
 * chooser under it would be empty, and the API refuses a test that names one.
 * ETL is the case that showed it — `etl` defaults off, and the row offered ETL
 * jobs regardless.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TestWorkArea from '@/components/TestWorkArea.vue';
import { FEATURE_FOR_SUBJECT_KIND, SUBJECT_KINDS } from '@sparql-query-lib/types';

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

/** Set per test: what this build has, which is what the subject row may offer. */
const flags = { ruleTuples: true } as Record<string, boolean>;
(globalThis as Record<string, unknown>).__NUXT_TEST_CONFIG__ = {
  public: { apiBaseUrl: 'http://api.test', get featureFlags() { return { ...flags }; } },
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


beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(flags)) delete flags[key];
  flags.ruleTuples = true;
});

function mountArea() {
  return mount(TestWorkArea, { props: { testId: null, scratchId: 'urn:ui-temp:1' } });
}

function kindsOffered(area: ReturnType<typeof mountArea>): string[] {
  return SUBJECT_KINDS.filter((kind) => area.find(`[data-testid="test-kind-${kind}"]`).exists());
}

describe('the subject kinds a build offers', () => {
  it('states a feature for every kind, so a new one cannot arrive ungated', () => {
    expect(Object.keys(FEATURE_FOR_SUBJECT_KIND).sort()).toEqual([...SUBJECT_KINDS].sort());
  });

  it('withholds ETL jobs unless the build has ETL', () => {
    flags.etl = false;
    expect(kindsOffered(mountArea())).not.toContain('etlJob');

    flags.etl = true;
    expect(kindsOffered(mountArea())).toContain('etlJob');
  });

  it('withholds each of the others on its own flag', () => {
    flags.etl = true;
    flags.queryGroups = false;
    flags.queries = false;

    const offered = kindsOffered(mountArea());
    expect(offered).toEqual(['ruleSet', 'etlJob']);
  });

  /*
   * The default kind is a rule set, which a build without the rules suite
   * cannot point at: a new test would open on a kind with no subjects and no
   * way back to one that has them.
   */
  it('opens a new test on a kind this build has', () => {
    flags.rulesSuite = false;
    flags.etl = false;

    const area = mountArea();
    expect(kindsOffered(area)).toEqual(['query', 'queryGroup']);
    expect(area.get('[data-testid="test-kind-query"]').attributes('aria-pressed')).toBe('true');
  });
});
