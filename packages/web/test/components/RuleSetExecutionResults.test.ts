import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import RuleSetExecutionResults from '@/components/RuleSetExecutionResults.vue';

/**
 * What a run is reported as having done, and who did it.
 *
 * Two things this view has to get right: results are attributed to the rule the
 * *author* wrote (`RULE <iri>`), not to whichever entity id carried it through
 * execution; and named tuples are shown at all, since they never enter the
 * inference graph and would otherwise leave a tuple-driven rule set looking
 * like it did nothing.
 */

const TUPLE = 'TUPLE(<http://example.org/reach>, <http://example.org/a>, <http://example.org/b>)';

const results = (overrides: Record<string, unknown> = {}) => ({
  status: 'converged',
  iterations: [
    {
      index: 1,
      signature: 'a1',
      tripleCount: 1,
      tupleCount: 1,
      delta: 1,
      rules: [
        {
          ruleVersionId: 'urn:sqlib:ruleset:abc123:rule-1',
          ruleIri: 'http://example.org/materialise',
          programSource: 'normalized',
          durationMs: 0.5,
          triplesInserted: 1,
          triplesDeleted: 0,
          quadSamples: [],
          insertedQuads: ['<http://example.org/a> <http://example.org/reaches> <http://example.org/b> .'],
          deletedQuads: [],
          insertedTuples: [TUPLE],
          timedOut: false,
        },
      ],
    },
  ],
  dataBlocks: [],
  finalTuples: [TUPLE],
  ...overrides,
});

const mountResults = (overrides: Record<string, unknown> = {}) =>
  mount(RuleSetExecutionResults, { props: { results: results(overrides) } });

describe('RuleSetExecutionResults — attribution', () => {
  it('attributes a result to the IRI the SRL gave the rule', () => {
    const view = mountResults();
    const text = view.text();
    expect(text).toContain('materialise');
    // The entity id that carried the rule is not what the reader is shown.
    expect(text).not.toContain('urn:sqlib:ruleset:abc123:rule-1');
  });

  it('elides an unprefixable IRI rather than inventing a prefix for it', () => {
    const view = mountResults();
    // `…:materialise`, never `rs:materialise`: nothing on screen claims a
    // mapping that the prefix manager does not hold. The full IRI is the title.
    const rule = view.get('.triple-rule');
    expect(rule.text()).toBe('…:materialise');
    expect(rule.attributes('title')).toBe('http://example.org/materialise');
  });

  it('falls back to the rule version id when the rule is unnamed', () => {
    const view = mountResults({
      iterations: [
        {
          ...results().iterations[0],
          rules: [{ ...results().iterations[0].rules[0], ruleIri: undefined }],
        },
      ],
    });
    const rule = view.get('.triple-rule');
    expect(rule.attributes('title')).toBe('urn:sqlib:ruleset:abc123:rule-1');
    expect(rule.text()).toBe('…:rule-1');
  });
});

describe('RuleSetExecutionResults — named tuples', () => {
  it('shows the tuples a rule wrote and the workspace it left', () => {
    const view = mountResults();
    expect(view.findAll('.triple-row--tuple').length).toBeGreaterThan(0);
    expect(view.text()).toContain('Named Tuple Workspace');
  });

  it('hides them behind the checkbox, which is off-limits for a run without tuples', async () => {
    const view = mountResults();
    const toggle = view.get('[data-testid="results-tuples-toggle"]');
    expect(view.text()).toContain('Show Tuple Store Changes');
    expect((toggle.element as HTMLInputElement).checked).toBe(true);

    await toggle.setValue(false);
    expect(view.findAll('.triple-row--tuple')).toHaveLength(0);
    expect(view.text()).not.toContain('Named Tuple Workspace');

    const noTuples = mountResults({
      iterations: [
        {
          ...results().iterations[0],
          tupleCount: 0,
          rules: [{ ...results().iterations[0].rules[0], insertedTuples: [] }],
        },
      ],
      finalTuples: [],
    });
    expect(noTuples.find('[data-testid="results-tuples-toggle"]').exists()).toBe(false);
  });

  /*
   * With the extension off the document cannot say TUPLE(…) at all, so no run of
   * it has a tuple store to report — showing the control would offer a view of
   * something that cannot exist.
   */
  it('shows nothing about tuples when the rule set never opted into the extension', () => {
    const view = mount(RuleSetExecutionResults, {
      props: { results: results(), tuplesEnabled: false },
    });
    expect(view.find('[data-testid="results-tuples-toggle"]').exists()).toBe(false);
    expect(view.findAll('.triple-row--tuple')).toHaveLength(0);
    expect(view.text()).not.toContain('Named Tuple Workspace');
    expect(view.text()).not.toContain('Named Tuples changes');
  });
});

/** The per-rule table lives inside a collapsed iteration, so open it first. */
const openIteration = async (view: ReturnType<typeof mountResults>) => {
  await view.get('.iteration-trigger').trigger('click');
  await nextTick();
};

describe('RuleSetExecutionResults — the per-rule table', () => {
  /*
   * A rule only ever writes, so a delete column is a column of dashes and a `+`
   * is decoration on a number that can only go one way.
   */
  it('counts triples in one unsigned column, with no delete column at all', async () => {
    const view = mountResults();
    await openIteration(view);
    const headers = view.findAll('.rules-table thead th').map((th) => th.text());
    expect(headers).toEqual(['Rule', 'Triples', 'Tuples', 'Time']);

    const triples = view.get('.rules-table tbody .col-triples');
    expect(triples.text()).toBe('1');
  });

  it('names both halves of what the table covers when tuples are on screen', async () => {
    const view = mountResults();
    await openIteration(view);
    expect(view.text()).toContain('Evaluation Graph and Named Tuples changes');

    await view.get('[data-testid="results-tuples-toggle"]').setValue(false);
    expect(view.text()).toContain('Evaluation Graph Changes');
  });
});
