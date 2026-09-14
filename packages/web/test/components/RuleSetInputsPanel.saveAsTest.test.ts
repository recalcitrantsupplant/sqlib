/**
 * `Save as test` on the rules Inputs tab, against the flag that holds tests.
 *
 * The third door into the tests feature, beside the Tests tab and the run bar's
 * `create test`. It is the odd one of the three because it already had a
 * refusal mechanism — `testDisabledReason` greys it and says why — and a
 * switched-off feature is not that kind of refusal: there is nothing to explain
 * and nothing to fix, so the button is absent, which is what the rail section
 * above it already does.
 *
 * The reason lane is pinned alongside so the two cannot be confused: an unsaved
 * rule set still gets a disabled button carrying its reason.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import RuleSetInputsPanel from '@/components/rules/RuleSetInputsPanel.vue';

const panel = (props: Record<string, unknown> = {}) => mount(RuleSetInputsPanel, {
  shallow: true,
  props: {
    tupleSetOptions: [],
    dataGraphOptions: [],
    savedTuplePreview: '',
    savedDataPreview: '',
    ...props,
  },
});

describe('RuleSetInputsPanel save-as-test', () => {
  it('offers the door by default', () => {
    expect(panel().find('[data-testid="save-as-test"]').exists()).toBe(true);
  });

  it('takes the door away where the build has no tests', () => {
    expect(panel({ testsEnabled: false }).find('[data-testid="save-as-test"]').exists()).toBe(false);
  });

  it('keeps the door, disabled with its reason, where the refusal is about this rule set', () => {
    const button = panel({ testDisabledReason: 'Save this rule set first.' })
      .find('[data-testid="save-as-test"]');
    expect(button.exists()).toBe(true);
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toBe('Save this rule set first.');
  });
});
