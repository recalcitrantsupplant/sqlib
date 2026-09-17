import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { MaybeRefOrGetter } from 'vue';
import SubjectTestsPanel from '@/components/tests/SubjectTestsPanel.vue';
import type { TestRunResult } from '@/composables/useApiClient';

const RULE_SET = 'urn:sqlib:ruleset:rs1';

/*
 * Plain state rather than refs: `vi.hoisted` runs before the `vue` import is
 * initialised, so `ref` is not callable there. Every test sets its state before
 * mounting, so nothing needs to react to a later change.
 */
const store = vi.hoisted(() => ({
  tests: [] as Array<Record<string, unknown>>,
  lastRunByTest: {} as Record<string, unknown>,
  runningTestIds: [] as string[],
  loadTests: vi.fn(),
  runTest: vi.fn(),
  runTests: vi.fn(),
}));

/*
 * `testsForSubject` is a real `computed` over `toValue`, not a getter object:
 * the panel hands it the prop and renders what it returns, so a stand-in that
 * was not a ref would neither unwrap in the template nor follow a subject that
 * changes. It mirrors the store's own one line — which is the point of the
 * store having it.
 */
vi.mock('@/composables/useTestsStore', async () => {
  const { computed, toValue } = await import('vue');
  return {
    useTestsStore: () => ({
      tests: { get value() { return store.tests; } },
      lastRunByTest: { get value() { return store.lastRunByTest; } },
      runningTestIds: { get value() { return store.runningTestIds; } },
      testsForSubject: (subject: MaybeRefOrGetter<string>) =>
        computed(() => store.tests.filter((test) => test.subject === toValue(subject))),
      loadTests: store.loadTests,
      runTest: store.runTest,
      runTests: store.runTests,
    }),
  };
});

function verdict(overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    testId: 't1',
    testVersionId: 'tv1',
    passed: true,
    message: '',
    expectationKind: 'graph',
    hermetic: true,
    durationMs: 3,
    subjectVersionId: null,
    ranAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function mountPanel() {
  return mount(SubjectTestsPanel, {
    props: { subjectId: RULE_SET, subjectNoun: 'rule set' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.tests = [];
  store.lastRunByTest = {};
  store.runningTestIds = [];
  store.runTest.mockResolvedValue(verdict());
  store.runTests.mockResolvedValue([]);
});

describe('SubjectTestsPanel', () => {
  it('lists only the tests pointing at this subject', async () => {
    store.tests = [
      { id: 't1', name: 'Reaches b', subject: RULE_SET },
      { id: 't2', name: 'Some query test', subject: 'urn:sqlib:query:q1' },
    ];

    const panel = mountPanel();
    await flushPromises();

    const rows = panel.findAll('[data-testid="subject-test-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('Reaches b');
  });

  /*
   * The tab is mounted once per screen and its subject changes underneath it —
   * open a query, then open another. The panel hands the store a getter rather
   * than the id it was mounted with precisely so this holds; a helper closed
   * over a snapshot would still be listing the first query's tests.
   *
   * It passes on the inline filter this replaced, and says so rather than
   * implying a bite: the panel's behaviour is unchanged, and that is the claim
   * — this pins it while the rule moves into the store, where the two specs
   * that do bite are (`test/composables/useTestsStore.subject.test.ts`).
   */
  it('follows a subject that changes under it', async () => {
    store.tests = [
      { id: 't1', name: 'Reaches b', subject: RULE_SET },
      { id: 't2', name: 'Some query test', subject: 'urn:sqlib:query:q1' },
    ];

    const panel = mountPanel();
    await flushPromises();
    expect(panel.get('[data-testid="subject-test-row"]').text()).toContain('Reaches b');

    await panel.setProps({ subjectId: 'urn:sqlib:query:q1', subjectNoun: 'query' });

    const rows = panel.findAll('[data-testid="subject-test-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('Some query test');
  });

  it('says so when nothing tests this subject', async () => {
    const panel = mountPanel();
    await flushPromises();
    expect(panel.text()).toContain('No tests yet');
    expect(panel.text()).toContain('rule set');
  });

  it('shows a running test as running rather than as not run', async () => {
    store.tests = [{ id: 't1', name: 'A', subject: RULE_SET }];
    store.runningTestIds = ['t1'];

    const panel = mountPanel();
    await flushPromises();

    const chip = panel.get('[data-testid="subject-test-verdict"]');
    expect(chip.text()).toBe('running');
    expect(chip.classes()).toContain('status-badge--running');
  });

  it('distinguishes "not run" from "failed"', async () => {
    store.tests = [
      { id: 't1', name: 'Ran and passed', subject: RULE_SET },
      { id: 't2', name: 'Ran and failed', subject: RULE_SET },
      { id: 't3', name: 'Never run', subject: RULE_SET },
    ];
    store.lastRunByTest = {
      t1: verdict({ testId: 't1', passed: true }),
      t2: verdict({ testId: 't2', passed: false, message: 'Graphs are not isomorphic' }),
    };

    const panel = mountPanel();
    await flushPromises();

    const chips = panel.findAll('[data-testid="subject-test-verdict"]');
    expect(chips.map((chip) => chip.text())).toEqual(['passed', 'failed', 'not run']);
    /*
     * Asserted as the shared StatusBadge vocabulary rather than local classes:
     * an unknown verdict is `idle`, a failure is `invalid`, and they must not
     * collapse — colouring "not run" like a failure teaches people to ignore
     * red. Reading the shared modifier also means this test notices if the
     * panel stops using the design system.
     */
    expect(chips[2].classes()).toContain('status-badge--neutral');
    expect(chips[1].classes()).toContain('status-badge--danger');
    expect(chips[0].classes()).toContain('status-badge--success');
  });

  it('summarises only the tests that actually ran', async () => {
    store.tests = [
      { id: 't1', name: 'A', subject: RULE_SET },
      { id: 't2', name: 'B', subject: RULE_SET },
      { id: 't3', name: 'C', subject: RULE_SET },
    ];
    store.lastRunByTest = {
      t1: verdict({ testId: 't1', passed: true }),
      t2: verdict({ testId: 't2', passed: false }),
    };

    const panel = mountPanel();
    await flushPromises();
    expect(panel.get('[data-testid="subject-tests-summary"]').text()).toBe('1/2 passing');
  });

  it('runs one test, and runs them all', async () => {
    store.tests = [
      { id: 't1', name: 'A', subject: RULE_SET },
      { id: 't2', name: 'B', subject: RULE_SET },
    ];

    const panel = mountPanel();
    await flushPromises();

    await panel.findAll('[data-testid="subject-test-run"]')[0].trigger('click');
    expect(store.runTest).toHaveBeenCalledWith('t1');

    await panel.get('[data-testid="subject-tests-run-all"]').trigger('click');
    expect(store.runTests).toHaveBeenCalledWith(['t1', 't2']);
  });

  /**
   * The row acts on the list, so with no list there is nothing for it to act
   * on: it used to draw a disabled Run all above "No tests yet".
   */
  it('draws the run row only when there are tests to run', async () => {
    const empty = mountPanel();
    await flushPromises();
    expect(empty.find('[data-testid="subject-tests-run-all"]').exists()).toBe(false);
    expect(empty.get('[data-testid="subject-tests-empty"]').exists()).toBe(true);

    store.tests = [{ id: 't1', name: 'A', subject: RULE_SET }];
    const listed = mountPanel();
    await flushPromises();
    expect(listed.get('[data-testid="subject-tests-run-all"]').attributes('disabled')).toBeUndefined();
  });

  it('opens a test rather than navigating on its own', async () => {
    store.tests = [{ id: 't1', name: 'A', subject: RULE_SET }];

    const panel = mountPanel();
    await flushPromises();
    await panel.get('[data-testid="subject-test-row"] button').trigger('click');

    expect(panel.emitted('open')?.[0]).toEqual(['t1']);
  });

  it('does not refetch a list it already has', async () => {
    store.tests = [{ id: 't1', name: 'A', subject: RULE_SET }];
    mountPanel();
    await flushPromises();
    expect(store.loadTests).not.toHaveBeenCalled();

    store.tests = [];
    mountPanel();
    await flushPromises();
    expect(store.loadTests).toHaveBeenCalledTimes(1);
  });
});
