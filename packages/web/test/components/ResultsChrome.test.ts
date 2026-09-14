/**
 * The chrome around a response: one action bar, one footer.
 *
 * The panel's tab strip is tabs and nothing else. What you can do to the
 * response — pick a view, filter it, download it, pop it out — is on a bar that
 * exists only where the response does, and what the run *was* — how many rows,
 * when, from what, how long — is stated as pills underneath, paging included.
 * These tests hold both halves of that in place, for the query panel (which ETL
 * and query groups share) and for the rule set panel.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key in mockLocalStorage) delete mockLocalStorage[key];
  }),
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const PORTAL_STUB = {
  global: { stubs: { DropdownMenuPortal: { template: '<div><slot /></div>' } } },
};

const bindings = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    s: { type: 'uri', value: `http://example.org/s${index}` },
    o: { type: 'literal', value: `value ${index}` },
  }));

const results = (count = 3) => ({
  head: { vars: ['s', 'o'] },
  results: { bindings: bindings(count) },
});

describe('query results chrome', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  const load = async () => {
    const { default: QueryResultsViewer } = await import('@/components/QueryResultsViewer.vue');
    return QueryResultsViewer;
  };

  it('states the run as pills: rows, when it ran, what from, how long', async () => {
    const QueryResultsViewer = await load();
    const wrapper = mount(QueryResultsViewer, {
      props: {
        results: results(),
        contentType: 'application/sparql-results+json',
        executedAt: new Date().toISOString(),
        timing: { breakdown: { clientTotalMs: 27 } },
      },
      ...PORTAL_STUB,
    });
    await nextTick();

    const footer = wrapper.get('[data-testid="results-footer"]');
    expect(footer.get('[data-testid="results-rows-pill"]').text()).toContain('3 rows');
    expect(footer.text()).toContain('application/sparql-results+json');
    expect(footer.get('[data-testid="results-duration"]').text()).toBe('27 ms');
    wrapper.unmount();
  });

  it('pages from the row-count pill rather than from a band of its own', async () => {
    const QueryResultsViewer = await load();
    const wrapper = mount(QueryResultsViewer, {
      props: { results: results(60), contentType: 'application/sparql-results+json' },
      ...PORTAL_STUB,
    });
    await nextTick();

    // 60 rows at the default 25 per page: three pages, none of them a toolbar.
    expect(wrapper.findAll('tbody tr')).toHaveLength(25);

    await wrapper.get('[data-testid="results-rows-pill"]').trigger('click');
    await tick();
    await wrapper.get('[data-testid="results-page-size-100"]').trigger('click');
    await nextTick();

    expect(wrapper.findAll('tbody tr')).toHaveLength(60);
    wrapper.unmount();
    await tick();
  });

  it('filters from the action bar, which is the only filter row there is', async () => {
    const QueryResultsViewer = await load();
    const wrapper = mount(QueryResultsViewer, {
      props: { results: results(3), contentType: 'application/sparql-results+json' },
      ...PORTAL_STUB,
    });
    await nextTick();

    expect(wrapper.findAll('[data-testid="results-filter"]')).toHaveLength(1);
    await wrapper.get('[data-testid="results-filter"] input, [data-testid="results-filter"]').setValue('value 1');
    await nextTick();

    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.get('[data-testid="results-rows-pill"]').text()).toContain('1 row');
    wrapper.unmount();
  });

  it('carries download and pop-out, and asks the panel to pop out', async () => {
    const QueryResultsViewer = await load();
    const wrapper = mount(QueryResultsViewer, {
      props: {
        results: results(),
        contentType: 'application/sparql-results+json',
        canExpand: true,
      },
      ...PORTAL_STUB,
    });
    await nextTick();

    // The download names the serialisation it hands over.
    expect(wrapper.get('[data-testid="results-download"]').text()).toContain('SPARQL JSON');

    await wrapper.get('[data-testid="results-expand"]').trigger('click');
    expect(wrapper.emitted('expand')).toHaveLength(1);
    wrapper.unmount();
  });

  it('withholds pop-out from a panel that has nowhere to pop out to', async () => {
    const QueryResultsViewer = await load();
    const wrapper = mount(QueryResultsViewer, {
      props: { results: results(), contentType: 'application/sparql-results+json' },
      ...PORTAL_STUB,
    });
    await nextTick();

    expect(wrapper.find('[data-testid="results-expand"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('rule set results chrome', () => {
  const GRAPH = '<http://example.org/a> <http://example.org/reaches> <http://example.org/b> .';

  const runResults = {
    status: 'converged',
    iterations: [
      {
        index: 1,
        signature: 'a1',
        tripleCount: 1,
        tupleCount: 0,
        delta: 1,
        rules: [
          {
            ruleVersionId: 'urn:sqlib:ruleset:abc:rule-1',
            programSource: 'normalized',
            durationMs: 88,
            triplesInserted: 1,
            triplesDeleted: 0,
            insertedQuads: [GRAPH],
            deletedQuads: [],
            timedOut: false,
          },
        ],
      },
    ],
    dataBlocks: [],
    finalGraphContent: GRAPH,
    finalGraphContentType: 'application/n-triples',
  };

  const mountRules = async (props: Record<string, unknown> = {}) => {
    const { default: RuleSetExecutionResults } = await import(
      '@/components/RuleSetExecutionResults.vue'
    );
    return mount(RuleSetExecutionResults, {
      props: { results: runResults, ...props },
      ...PORTAL_STUB,
    });
  };

  it('promotes the inference graph to a peer view, out of the summary', async () => {
    const wrapper = await mountRules();
    await nextTick();

    // Summary is not carrying the graph any more…
    expect(wrapper.find('[data-testid="results-graph-filter"]').exists()).toBe(false);

    await wrapper.get('[data-testid="results-mode-graph"]').trigger('click');
    await nextTick();
    await nextTick();

    // …the Graph view is, with the same bar the query panel has.
    expect(wrapper.find('[data-testid="results-graph-filter"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('http://example.org/reaches');
    // One level of view switching, not two: the nested Table / Raw pair went
    // with the promotion.
    expect(wrapper.find('.minimal-tabs').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers Graph only when the run actually inferred one', async () => {
    const wrapper = await mountRules({
      results: { ...runResults, finalGraphContent: undefined, finalGraphContentType: undefined },
    });
    await nextTick();

    expect(
      wrapper.get('[data-testid="results-mode-graph"]').attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });

  it('states the run in the footer, duration summed over the rules', async () => {
    const wrapper = await mountRules({ executedAt: new Date().toISOString() });
    await nextTick();

    expect(wrapper.get('[data-testid="results-duration"]').text()).toBe('88 ms');
    wrapper.unmount();
  });

  it('carries one download, scoped to the inference graph, and its own pop-out', async () => {
    const wrapper = await mountRules();
    await nextTick();

    expect(wrapper.get('[data-testid="results-download"]').text()).toContain('Inference graph');

    await wrapper.get('[data-testid="results-expand"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.focus-overlay').exists()).toBe(true);
    wrapper.unmount();
  });
});
