import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DependencyReasons from '@/components/rules/DependencyReasons.vue';

const reason = (object: string) => ({
  body: { subject: '?a', predicate: '?b', object: '?c' },
  head: { subject: ':s', predicate: ':p', object },
  label: 'positive' as const,
});

/*
 * A body of all variables matches every triple a head writes. The first few
 * pairs say what kind of match it is; the rest fold away.
 */
describe('DependencyReasons', () => {
  it('shows a short list in full', () => {
    const wrapper = mount(DependencyReasons, { props: { reasons: [reason(':a'), reason(':b')] } });
    expect(wrapper.findAll('.reason')).toHaveLength(2);
    expect(wrapper.find('[data-testid="dependency-more-reasons"]').exists()).toBe(false);
  });

  it('folds everything past the third', () => {
    const wrapper = mount(DependencyReasons, {
      props: { reasons: ['a', 'b', 'c', 'd', 'e'].map((o) => reason(`:${o}`)) },
    });
    const more = wrapper.get('[data-testid="dependency-more-reasons"]');
    expect(more.get('summary').text()).toBe('2 more matching patterns');
    expect(more.attributes('open')).toBeUndefined();
    expect(wrapper.findAll('.reason')).toHaveLength(5);
  });
});
