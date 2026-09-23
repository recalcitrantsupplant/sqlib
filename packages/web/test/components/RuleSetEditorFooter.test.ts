import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RuleSetEditorFooter from '@/components/rules/RuleSetEditorFooter.vue';

const base = {
  validationState: 'valid' as const,
  ruleCount: 2,
  dataBlockCount: 0,
};

describe('RuleSetEditorFooter strata chip', () => {
  it('counts strata when the rules stratify', () => {
    const wrapper = mount(RuleSetEditorFooter, { props: { ...base, strataCount: 2, stratified: true } });
    expect(wrapper.get('[data-testid="strata-chip"]').text()).toMatch(/2 strata/);
  });

  it('says the rules do not stratify rather than counting strata that do not exist', () => {
    const wrapper = mount(RuleSetEditorFooter, { props: { ...base, strataCount: 0, stratified: false } });
    const chip = wrapper.get('[data-testid="strata-chip"]');
    expect(chip.text()).toMatch(/does not stratify/);
    expect(chip.text()).not.toMatch(/strat(a|um)\b/);
  });
});
