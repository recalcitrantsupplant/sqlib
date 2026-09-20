import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SaveBar from '@/components/shared/SaveBar.vue';
import { usePrefixManager } from '@/composables/usePrefixManager';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/*
 * The save bar is where Format lives for every work area, so it is where the
 * prefix conversions have to sit. The first version of this feature put them in
 * VersionToolbar's format slot instead, which renders only under
 * `chrome="full"` — and the query editor passes `chrome="minimal"`, so the
 * buttons were invisible in the one place people would look for them. These
 * tests exist so that cannot come back silently.
 */
const BASE = {
  title: 'A query',
  isScratch: false,
  canSave: true,
  showFormat: true,
  canFormat: true,
};

describe('SaveBar prefix conversions', () => {
  beforeEach(() => {
    usePrefixManager().resetToDefaults();
  });

  it('renders them beside Format when given a convertible body', () => {
    const wrapper = mount(SaveBar, {
      props: {
        ...BASE,
        code: 'SELECT * WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?o }',
        contentType: 'application/sparql-query',
      },
    });

    expect(wrapper.find('[data-testid="format-query"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="prefix-fold-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="iri-unfold-button"]').exists()).toBe(true);
  });

  it('emits the rewritten body for the section to take', async () => {
    const wrapper = mount(SaveBar, {
      props: {
        ...BASE,
        code: 'SELECT * WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?o }',
        contentType: 'application/sparql-query',
      },
    });

    await wrapper.get('[data-testid="prefix-fold-button"]').trigger('click');

    const emitted = wrapper.emitted('update:code');
    expect(emitted).toHaveLength(1);
    expect(emitted![0]![0]).toContain('foaf:name');
  });

  it('renders nothing for a section that passes no body', () => {
    const wrapper = mount(SaveBar, { props: BASE });

    expect(wrapper.find('[data-testid="format-query"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="prefix-fold-button"]').exists()).toBe(false);
  });

  it('renders nothing for a body whose language has no grammar', () => {
    // N-Triples: no prefixes to convert, so nothing to offer. SRL used to be
    // the case here and has its own grammar now — see `prefixGrammarFor`.
    const wrapper = mount(SaveBar, {
      props: { ...BASE, code: '<http://example.org/s> <http://example.org/p> "o" .', contentType: 'application/n-triples' },
    });

    expect(wrapper.find('[data-testid="prefix-fold-button"]').exists()).toBe(false);
  });
});
