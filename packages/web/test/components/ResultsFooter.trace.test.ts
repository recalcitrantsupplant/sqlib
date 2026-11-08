import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ResultsFooter from '@/components/shared/ResultsFooter.vue';

describe('ResultsFooter trace link', () => {
  it('links the run to its trace, in a new tab', () => {
    const wrapper = mount(ResultsFooter, { props: { durationMs: 220, traceUrl: 'https://t.example/abc' } });
    const link = wrapper.get('[data-testid="results-trace-link"]');
    expect(link.attributes('href')).toBe('https://t.example/abc');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toContain('noopener');
    expect(link.attributes('title')).toBe('Open trace');
  });

  it('shows no link without a trace URL', () => {
    const wrapper = mount(ResultsFooter, { props: { durationMs: 220 } });
    expect(wrapper.find('[data-testid="results-trace-link"]').exists()).toBe(false);
  });
});
