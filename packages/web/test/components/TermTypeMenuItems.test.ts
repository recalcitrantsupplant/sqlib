import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TermTypeMenuItems from '@/components/query-work-area/TermTypeMenuItems.vue';
import type { SparqlValue } from '@/types/argument-sets';

/**
 * The menu's items render inside a reka-ui menu at runtime. Mounting them bare
 * is deliberate: what is under test is the choices they offer and the term they
 * write, not the popover that holds them.
 */
function mountMenu(value: SparqlValue) {
  return mount(TermTypeMenuItems, {
    props: { value, variable: 'city' },
    global: {
      stubs: {
        DropdownMenuItem: { template: '<button @click="$emit(\'select\', $event)"><slot /></button>' },
        DropdownMenuLabel: { template: '<div><slot /></div>' },
        DropdownMenuSeparator: true,
      },
    },
  });
}

const last = (w: ReturnType<typeof mountMenu>) => w.emitted('update')?.at(-1)?.[0] as SparqlValue;

describe('TermTypeMenuItems', () => {
  it('offers the two node kinds and switches between them', async () => {
    const w = mountMenu({ type: 'uri', value: 'ex:Sydney' });
    const kinds = w.findAll('button');
    expect(kinds.map((button) => button.text())).toEqual(['IRI', 'Literal']);
    // An IRI carries no datatype, so its fields are not drawn at all.
    expect(w.find('[data-testid="term-datatype"]').exists()).toBe(false);

    await kinds[1].trigger('click');
    expect(last(w)).toEqual({ type: 'literal', value: 'ex:Sydney' });
  });

  it('drops a datatype and language when the term becomes an IRI', async () => {
    const w = mountMenu({ type: 'literal', value: '2000', datatype: 'http://www.w3.org/2001/XMLSchema#integer' });
    await w.findAll('button')[0].trigger('click');
    expect(last(w)).toEqual({ type: 'uri', value: '2000' });
  });

  it('offers none, the common datatypes, and a custom IRI', async () => {
    const w = mountMenu({ type: 'literal', value: 'x' });
    const options = w.find('[data-testid="term-datatype"]').findAll('option');
    expect(options[0].text()).toBe('none (xsd:string)');
    expect(options.at(-1)!.text()).toBe('custom IRI…');
    expect(options.map((option) => option.text())).toContain('xsd:integer');
  });

  it('shows the IRI field only once custom is chosen, and writes what is typed there', async () => {
    const w = mountMenu({ type: 'literal', value: 'x' });
    expect(w.find('[data-testid="term-datatype-iri"]').exists()).toBe(false);

    await w.find('[data-testid="term-datatype"]').setValue('__custom__');
    await w.setProps({ value: { type: 'literal', value: 'x' } });
    const field = w.find('[data-testid="term-datatype-iri"]');
    expect(field.exists()).toBe(true);

    await field.setValue('http://example.org/dt');
    expect(last(w)).toEqual({ type: 'literal', value: 'x', datatype: 'http://example.org/dt' });
  });

  it('recognises a datatype outside the common list as a custom one', () => {
    const w = mountMenu({ type: 'literal', value: 'x', datatype: 'http://example.org/dt' });
    expect((w.find('[data-testid="term-datatype"]').element as HTMLSelectElement).value).toBe('__custom__');
    expect((w.find('[data-testid="term-datatype-iri"]').element as HTMLInputElement).value).toBe(
      'http://example.org/dt',
    );
  });

  // RDF 1.1 §3.3: a literal has exactly one datatype. The two fields are two
  // spellings of one slot, so the menu locks whichever is not in play rather
  // than letting a term be written that cannot exist.
  it('locks the language field while a datatype stands', () => {
    const w = mountMenu({ type: 'literal', value: 'x', datatype: 'http://www.w3.org/2001/XMLSchema#string' });
    expect(w.find('[data-testid="term-language"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="term-datatype"]').attributes('disabled')).toBeUndefined();
  });

  it('locks the datatype select while a language tag stands, and calls it rdf:langString', () => {
    const w = mountMenu({ type: 'literal', value: 'x', 'xml:lang': 'en' });
    const select = w.find('[data-testid="term-datatype"]');
    expect(select.attributes('disabled')).toBeDefined();
    expect(select.text()).toBe('rdf:langString');
    expect(w.find('[data-testid="term-language"]').attributes('disabled')).toBeUndefined();
  });

  it('clears the datatype when a language tag is typed, as RDF requires', async () => {
    const w = mountMenu({ type: 'literal', value: 'x' });
    await w.find('[data-testid="term-language"]').setValue('en');
    expect(last(w)).toEqual({ type: 'literal', value: 'x', datatype: undefined, 'xml:lang': 'en' });
  });
});
