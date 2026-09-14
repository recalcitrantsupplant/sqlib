import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import PrefixConversionButtons from '@/components/shared/PrefixConversionButtons.vue';
import { usePrefixManager } from '@/composables/usePrefixManager';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const QUERY_WITH_IRI = 'SELECT * WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?o }';
const SPARQL = 'application/sparql-query';

describe('PrefixConversionButtons', () => {
  beforeEach(() => {
    // The manager is a module-level singleton, so each test starts from the
    // shipped defaults rather than from whatever the last one added.
    usePrefixManager().resetToDefaults();
  });

  it('emits the shortened document', async () => {
    const wrapper = mount(PrefixConversionButtons, { props: { code: QUERY_WITH_IRI, contentType: SPARQL } });

    await wrapper.get('[data-testid="prefix-fold-button"]').trigger('click');

    const emitted = wrapper.emitted('update:code');
    expect(emitted).toHaveLength(1);
    expect(emitted![0]![0]).toContain('foaf:name');
  });

  it('emits the expanded document', async () => {
    const wrapper = mount(PrefixConversionButtons, {
      props: { code: 'SELECT * WHERE { ?s foaf:name ?o }', contentType: SPARQL },
    });

    await wrapper.get('[data-testid="iri-unfold-button"]').trigger('click');

    const emitted = wrapper.emitted('update:code');
    expect(emitted).toHaveLength(1);
    expect(emitted![0]![0]).toContain('<http://xmlns.com/foaf/0.1/name>');
  });

  it('stays quiet when a press changes nothing, rather than marking the document dirty', async () => {
    const wrapper = mount(PrefixConversionButtons, {
      props: { code: 'SELECT * WHERE { ?s ?p ?o }', contentType: SPARQL },
    });

    await wrapper.get('[data-testid="prefix-fold-button"]').trigger('click');
    await wrapper.get('[data-testid="iri-unfold-button"]').trigger('click');

    expect(wrapper.emitted('update:code')).toBeUndefined();
  });

  it('offers both directions at once, whatever the document holds', () => {
    const wrapper = mount(PrefixConversionButtons, { props: { code: QUERY_WITH_IRI, contentType: SPARQL } });

    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.attributes('disabled') === undefined)).toBe(true);
  });

  it('disables both on an empty document', () => {
    const wrapper = mount(PrefixConversionButtons, { props: { code: '   ', contentType: SPARQL } });

    expect(wrapper.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });

  it('is absent for a language with no grammar of its own', () => {
    // SRL is highlighted with the SPARQL grammar, which is close enough to
    // colour and not close enough to rewrite. Absent, not disabled.
    const wrapper = mount(PrefixConversionButtons, {
      props: { code: 'RULE { ?x :b ?k } WHERE { SET ( ?k := 1 ) }', contentType: 'application/srl' },
    });

    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('is absent for the line-based formats, which have no prefixes', () => {
    const wrapper = mount(PrefixConversionButtons, {
      props: { code: '<http://a/b> <http://a/c> <http://a/d> .', contentType: 'application/n-triples' },
    });

    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('works on Turtle as well as SPARQL', async () => {
    const wrapper = mount(PrefixConversionButtons, {
      props: {
        code: '@prefix foaf: <http://xmlns.com/foaf/0.1/> .\nfoaf:a foaf:knows foaf:b .',
        contentType: 'text/turtle',
      },
    });

    await wrapper.get('[data-testid="iri-unfold-button"]').trigger('click');
    expect(wrapper.emitted('update:code')![0]![0]).toContain('<http://xmlns.com/foaf/0.1/a>');
  });
});
