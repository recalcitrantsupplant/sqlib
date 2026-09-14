/**
 * The Runs tab and the Results pane, over one built summary.
 *
 * Both read a `TestRunSummary` and nothing else, so the fixture here is the
 * same object the adapter produces — which is the point of the type: these
 * screens do not know that a run currently lives in this browser.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import TestRunsPanel from '@/components/tests/TestRunsPanel.vue';
import TestRunResults from '@/components/tests/TestRunResults.vue';
import { buildTestRunSummary, type TestRunScope } from '@/lib/testRunSummary';
import type { TestRunResult } from '@/composables/useApiClient';

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const scope: TestRunScope = {
  kind: 'tag',
  label: 'tag: conformance',
  tagIds: ['tag:conformance'],
  match: 'any',
  testIds: ['t1', 't2', 't3'],
  answeredIds: ['t1', 't2'],
  startedAt: '2026-08-31T10:00:00.000Z',
  finishedAt: '2026-08-31T10:00:48.000Z',
  wallMs: 48_000,
  cancelled: false,
};

const results: Record<string, TestRunResult> = {
  t1: {
    testId: 't1',
    testVersionId: 't1/v/1',
    passed: true,
    message: '',
    expectationKind: 'bindings',
    hermetic: false,
    durationMs: 120,
    subjectVersionId: null,
    ranAt: scope.startedAt,
    cases: [
      { caseId: 'c1', name: 'ascii terms', position: 0, passed: true, message: '', detail: null, durationMs: 60 },
      { caseId: 'c2', name: 'unicode terms', position: 1, passed: true, message: '', detail: null, durationMs: 60 },
    ],
    passedCount: 2,
    failedCount: 0,
  },
  t2: {
    testId: 't2',
    testVersionId: 't2/v/1',
    passed: false,
    message: 'one row short',
    expectationKind: 'bindings',
    hermetic: false,
    durationMs: 312,
    subjectVersionId: null,
    ranAt: scope.startedAt,
    cases: [
      {
        caseId: 'c3',
        name: 'unicode terms',
        position: 0,
        passed: false,
        message: 'expected 12 · actual 11',
        detail: { missing: ['<work/12> a <Work> .'], unexpected: [], matched: 11 },
        durationMs: 312,
      },
    ],
    passedCount: 0,
    failedCount: 1,
  },
};

const summary = buildTestRunSummary({
  scope,
  tests: [
    { id: 't1', name: 'title match returns the seeded works', tags: ['tag:queries'], currentVersion: 't1/v/1' },
    { id: 't2', name: 'unicode titles round-trip', tags: ['tag:queries'], currentVersion: 't2/v/1' },
    { id: 't3', name: 'spatial filter', tags: ['tag:w3c'], currentVersion: 't3/v/1' },
  ],
  results,
  tags: { 'tag:queries': { name: 'Queries', color: null }, 'tag:w3c': { name: 'W3C eval suite', color: null } },
  backends: { t1: { id: 'b1', name: 'Fuseki' }, t2: { id: 'b1', name: 'Fuseki' } },
});

describe('TestRunsPanel', () => {
  it('lists the run and nothing else, grouped, with the case tallies under it', () => {
    wrapper = mount(TestRunsPanel, { props: { summary } });

    expect(wrapper.findAll('[data-testid="test-run-row"]')).toHaveLength(3);
    expect(wrapper.get('[data-testid="test-run-scope"]').text()).toContain('tag: conformance');
    // 2 pass + 1 fail + 1 excluded across 4 cases, said in the footer.
    expect(wrapper.text()).toContain('4 cases across 3 tests');
    // The row for the test that never ran is still listed, as excluded.
    expect(wrapper.text()).toContain('spatial filter');
  });

  it('offers no run when nothing has run, and points at the Tests tab instead', async () => {
    wrapper = mount(TestRunsPanel, { props: { summary: null } });

    expect(wrapper.find('[data-testid="test-runs-empty"]').exists()).toBe(true);
    await wrapper.get('[data-testid="test-runs-empty"] button').trigger('click');
    expect(wrapper.emitted('update:tab')?.[0]).toEqual(['tests']);
  });
});

describe('TestRunResults', () => {
  it('tiles the run, breaks it down twice, and lists the failing cases', () => {
    wrapper = mount(TestRunResults, { props: { summary, results } });

    expect(wrapper.get('[data-testid="test-run-tile-cases"]').text()).toContain('4');
    expect(wrapper.get('[data-testid="test-run-tile-failed"]').text()).toContain('1');
    expect(wrapper.findAll('[data-testid="test-run-by-group-row"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-testid="test-run-by-backend-row"]')).toHaveLength(2);
    // Failed is the default view, so the excluded test is not among the rows.
    expect(wrapper.findAll('[data-testid="test-run-failure-row"]')).toHaveLength(1);
  });

  it('fills the drill-in from the row that was selected', async () => {
    wrapper = mount(TestRunResults, { props: { summary, results } });

    expect(wrapper.find('[data-testid="test-case-detail"]').exists()).toBe(false);
    await wrapper.get('[data-testid="test-run-failure-row"]').trigger('click');

    const detail = wrapper.get('[data-testid="test-case-detail"]');
    expect(detail.text()).toContain('unicode titles round-trip');
    expect(detail.text()).toContain('1 missing, 0 unexpected');
    expect(wrapper.get('[data-testid="test-case-detail-diff"]').text()).toContain('<work/12>');
  });

  it('leaves the bar unfilled for what has not answered yet', () => {
    /*
     * The bug this guards: with only what had answered in the denominator, a
     * run in flight drew `2/2` — a full green bar — from its first verdict to
     * its last, whatever it was still working through.
     */
    const running = buildTestRunSummary({
      scope: { ...scope, answeredIds: ['t1'], finishedAt: null },
      running: true,
      tests: [
        { id: 't1', name: 'title match returns the seeded works', tags: ['tag:queries'], currentVersion: 't1/v/1' },
        { id: 't2', name: 'unicode titles round-trip', tags: ['tag:queries'], currentVersion: 't2/v/1' },
        { id: 't3', name: 'spatial filter', tags: ['tag:queries'], currentVersion: 't3/v/1' },
      ],
      results,
      tags: { 'tag:queries': { name: 'Queries', color: null } },
    });
    wrapper = mount(TestRunResults, { props: { summary: running, results } });

    const row = wrapper.get('[data-testid="test-run-by-group-row"]');
    // Two cases of four: the two the answered test expanded to, against itself
    // plus one apiece for the two tests still to come.
    expect(row.text()).toContain('2/4');
    expect(row.attributes('title')).toContain('2 still to run');
    expect(row.get('.bar-pending').attributes('style')).toContain('flex-grow: 2');
  });

  it('narrows the failures to one group when a breakdown row is picked', async () => {
    wrapper = mount(TestRunResults, { props: { summary, results } });

    const w3c = wrapper.findAll('[data-testid="test-run-by-group-row"]')
      .find((row) => row.text().includes('W3C'));
    await w3c!.trigger('click');

    // The only failing case is in Queries, so W3C's filter empties the list.
    expect(wrapper.findAll('[data-testid="test-run-failure-row"]')).toHaveLength(0);
  });
});
