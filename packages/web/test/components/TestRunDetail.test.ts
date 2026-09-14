/**
 * One test's run, as the main pane.
 *
 * These assertions used to live in `TestWorkArea.test.ts`, over the right-hand
 * column that screen carried. The column moved — a verdict is read on the Runs
 * tab now — and so did the checks: what is pinned here is the verdict, the case
 * list and the diff, which is what the run is read for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TestRunDetail from '@/components/tests/TestRunDetail.vue';

const TEST_ID = 'urn:sqlib:test:t1';
const VERSION_ID = 'urn:sqlib:test-version:v1';

const store = vi.hoisted(() => ({
  tests: { value: [{ id: 'urn:sqlib:test:t1', name: 'Reach is transitive' }] },
  loadVersions: vi.fn(),
}));

vi.mock('@/composables/useTestsStore', () => ({ useTestsStore: () => store }));
// The Result and Expected panes are CodePeeks over CodeMirror; what these specs
// are about is the text they are given.
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    template: '<textarea :value="modelValue"></textarea>',
  },
}));

function failingRun() {
  return {
    testId: TEST_ID,
    testVersionId: VERSION_ID,
    passed: false,
    message: 'Graphs are not isomorphic: 1 missing, 1 unexpected',
    expectationKind: 'graph',
    hermetic: true,
    durationMs: 310,
    subjectVersionId: null,
    ranAt: '2026-08-14T00:00:00.000Z',
    cases: [{
      caseId: 'urn:sqlib:test-case:c1',
      name: 'Case 1',
      position: 0,
      passed: false,
      message: 'Graphs are not isomorphic: 1 missing, 1 unexpected',
      // The diff belongs to the case that produced it, not to the run.
      detail: {
        missing: ['<http://ex/a> <http://ex/p> <http://ex/z> .'],
        unexpected: ['<http://ex/a> <http://ex/p> <http://ex/b> .'],
        matched: 8,
      },
      result: '<http://ex/a> <http://ex/p> <http://ex/b> .',
      durationMs: 310,
    }],
    passedCount: 0,
    failedCount: 1,
  };
}

function mountDetail(run: Record<string, unknown> | null) {
  return mount(TestRunDetail, {
    props: { testId: TEST_ID, run: run as never },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.loadVersions.mockResolvedValue([]);
});

describe('TestRunDetail', () => {
  it('shows the difference as one marked list, not two', async () => {
    const area = mountDetail(failingRun());
    await flushPromises();

    const lines = area.findAll('.diff-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].text()).toContain('-');
    expect(lines[0].text()).toContain('http://ex/z');
    expect(lines[1].text()).toContain('+');
    // The matched count is what makes "1 missing" legible.
    expect(area.get('[data-testid="test-diff-footer"]').text())
      .toBe('8 matched · 1 expected only · 1 actual only');
  });

  it('reports a verdict with how it ran and how long it took', async () => {
    const area = mountDetail({
      testId: TEST_ID, testVersionId: VERSION_ID, passed: true, message: '',
      expectationKind: 'graph', hermetic: true, durationMs: 310, subjectVersionId: null,
      ranAt: '2026-08-14T00:00:00.000Z',
      cases: [{ caseId: 'c1', name: 'Case 1', position: 0, passed: true, message: '', durationMs: 310 }],
      passedCount: 1,
      failedCount: 0,
    });
    await flushPromises();

    const verdict = area.get('[data-testid="test-verdict"]');
    expect(verdict.text()).toContain('Passed');
    expect(verdict.text()).toContain('hermetic · 310ms');
    expect(verdict.classes()).toContain('verdict-pass');
  });

  it('lists the cases when there is more than one, and shows the selected one’s diff', async () => {
    const area = mountDetail({
      testId: TEST_ID, testVersionId: VERSION_ID, passed: false, message: 'second: Graphs are not isomorphic',
      expectationKind: 'graph', hermetic: true, durationMs: 12, subjectVersionId: null,
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
    await flushPromises();

    expect(area.findAll('[data-testid^="test-case-result-"]')).toHaveLength(2);
    expect(area.get('[data-testid="test-verdict"]').text()).toContain('1/2 passed');

    // The first case passed, so there is nothing to diff until the failing row
    // is picked.
    expect(area.findAll('.diff-line')).toHaveLength(0);
    await area.get('[data-testid="test-case-result-1"]').trigger('click');
    expect(area.findAll('.diff-line')).toHaveLength(1);
  });

  it('recaps the expectation from the version that ran, not from the editor', async () => {
    // A test edited since the run is a different test; the run judged what the
    // version it names holds.
    store.loadVersions.mockResolvedValue([
      {
        id: VERSION_ID,
        version: 1,
        expectationKind: 'graph',
        cases: [{ id: 'c1', expected: '<http://ex/a> <http://ex/p> <http://ex/z> .', expectedFormat: 'text/turtle' }],
      },
    ]);

    const area = mountDetail(failingRun());
    await flushPromises();

    expect(store.loadVersions).toHaveBeenCalledWith(TEST_ID);
    expect(area.find('[data-testid="test-expected-recap"]').exists()).toBe(true);
  });

  it('says so when this test carries no verdict from the run', async () => {
    const area = mountDetail(null);
    await flushPromises();

    expect(area.find('[data-testid="test-verdict"]').exists()).toBe(false);
    expect(area.text()).toContain('Not run in this run');
  });

  it('asks the page to run it again, or to open its configuration', async () => {
    const area = mountDetail(failingRun());
    await flushPromises();

    await area.get('[data-testid="test-run-detail-rerun"]').trigger('click');
    await area.get('[data-testid="test-run-detail-configure"]').trigger('click');

    expect(area.emitted('rerun')).toHaveLength(1);
    expect(area.emitted('open-config')).toHaveLength(1);
  });
});
