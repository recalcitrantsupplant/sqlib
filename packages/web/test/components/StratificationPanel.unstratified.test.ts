import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StratificationPanel from '@/components/rules/StratificationPanel.vue';
import type { SrlStratificationCycle } from '@/composables/useApiClient';

/*
 * A document whose rules negate each other's output has no strata. Any layer
 * numbers would only be where the stratifier gave up, so the panel says what is
 * wrong instead: which rules, which dependencies, and how to break the cycle.
 */
const REASON_12_TO_3 = {
  body: { subject: '?x', predicate: ':p', object: '"abc"' },
  head: { subject: '?s', predicate: ':p', object: '"abc"' },
  label: 'negative' as const,
};
const REASON_3_TO_12 = {
  body: { subject: '?s', predicate: ':p', object: '"ABC"' },
  head: { subject: ':s', predicate: ':p', object: '"ABC"' },
  label: 'negative' as const,
};

const cycle: SrlStratificationCycle = {
  kind: 'negation',
  rules: ['rule-1', 'rule-2'],
  edges: [
    { from: 'rule-1', to: 'rule-2', label: 'negative', reasons: [REASON_3_TO_12] },
    { from: 'rule-2', to: 'rule-1', label: 'negative', reasons: [REASON_12_TO_3] },
  ],
};

const nodes = [
  { id: 'rule-1', label: ':p', stratum: null, monotonicity: 'negation' as const, line: 3, inCycle: true },
  { id: 'rule-2', label: ':p', stratum: null, monotonicity: 'negation' as const, line: 12, inCycle: true },
  { id: 'rule-3', label: ':q', stratum: null, monotonicity: 'monotone' as const, line: 21, inCycle: false },
];

function mountPanel() {
  return mount(StratificationPanel, {
    props: {
      nodes,
      edges: cycle.edges,
      issues: ['Non-stratifiable cycle involving: rule at L3, rule at L12'],
      cycles: [cycle],
      stratified: false,
      ruleCount: 3,
      strataCount: 0,
    },
    global: {
      stubs: { StratificationGraph: true, Codemirror: true },
    },
  });
}

describe('StratificationPanel, unstratified', () => {
  it('explains the cycle in one sentence, naming the rules by line', () => {
    const wrapper = mountPanel();
    expect(wrapper.get('[data-testid="stratification-cycle-sentence"]').text()).toBe(
      "L3 and L12 negate each other's output, so neither can be evaluated before the other.",
    );
  });

  it('lists each dependency on the cycle with the patterns that made it', () => {
    const wrapper = mountPanel();
    const edges = wrapper.findAll('[data-testid="stratification-cycle-edge"]');
    expect(edges).toHaveLength(2);
    expect(edges[0].text()).toContain('rule at L3');
    expect(edges[0].text()).toContain('negates the output of');
    expect(edges[0].text()).toContain('rule at L12');
    expect(edges[0].text()).toContain('NOT ?s :p "ABC"');
    expect(edges[0].text()).toContain(':s :p "ABC"');
  });

  it('links each rule on an edge to its line', async () => {
    const wrapper = mountPanel();
    const links = wrapper.findAll('[data-testid="stratification-cycle-edge"] .line-link');
    await links[1].trigger('click');
    expect(wrapper.emitted('go-to-line')?.[0]).toEqual([12]);
  });

  it('says how to break it, including NOT DATA', () => {
    const wrapper = mountPanel();
    const fix = wrapper.get('[data-testid="stratification-fix"]').text();
    expect(fix).toMatch(/NOT DATA/);
  });

  it('shows no strata, no evaluation order and no internal ids', () => {
    const wrapper = mountPanel();
    const text = wrapper.text();
    expect(text).not.toMatch(/Stratum \d/);
    expect(text).not.toMatch(/forces stratum/);
    expect(text).not.toMatch(/Evaluation order/i);
    expect(text).not.toMatch(/rule-\d/);
    expect(wrapper.get('.headline').text()).toBe('3 rules');
    expect(wrapper.find('[data-testid="stratification-verdict"]').exists()).toBe(true);
  });

  it('opens on a rule that is on the cycle and says so', () => {
    const wrapper = mountPanel();
    expect(wrapper.emitted('update:selectedId')?.[0]).toEqual(['rule-1']);
  });

  it('labels the cycle edges it hands the graph', () => {
    const wrapper = mountPanel();
    const graphEdges = wrapper.getComponent({ name: 'StratificationGraph' }).props('edges') as Array<{
      from: string;
      cycleLabel?: string;
    }>;
    expect(graphEdges.find((edge) => edge.from === 'rule-1')?.cycleLabel).toBe('NOT ?s :p "ABC" → :s :p "ABC"');
  });
});
