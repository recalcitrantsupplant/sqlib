/**
 * The datatype select that the ETL column mapping shares with the argument
 * editor. Choosing custom must keep the IRI field open while it is empty.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DatatypeSelect from '@/components/shared/DatatypeSelect.vue';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('DatatypeSelect', () => {
  it('keeps custom chosen while the IRI is empty, and emits the typed IRI', async () => {
    const wrapper = mount(DatatypeSelect, { props: { modelValue: `${XSD}string`, testId: 'dt' } });
    await wrapper.get('[data-testid="dt"]').setValue('__custom__');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([undefined]);

    // The parent writes back the empty datatype; custom must survive it.
    await wrapper.setProps({ modelValue: undefined });
    expect((wrapper.get('[data-testid="dt"]').element as HTMLSelectElement).value).toBe('__custom__');
    const iri = wrapper.get('[data-testid="dt-iri"]');

    await iri.setValue('http://example.org/dt/kelvin');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['http://example.org/dt/kelvin']);
  });

  it('opens on custom for a saved IRI outside the common list', () => {
    const wrapper = mount(DatatypeSelect, { props: { modelValue: 'http://example.org/dt/kelvin', testId: 'dt' } });
    expect((wrapper.get('[data-testid="dt"]').element as HTMLSelectElement).value).toBe('__custom__');
    expect((wrapper.get('[data-testid="dt-iri"]').element as HTMLInputElement).value).toBe('http://example.org/dt/kelvin');
  });

  it('shows a common datatype, and emits undefined for none', async () => {
    const wrapper = mount(DatatypeSelect, { props: { modelValue: `${XSD}double`, testId: 'dt' } });
    expect((wrapper.get('[data-testid="dt"]').element as HTMLSelectElement).value).toBe(`${XSD}double`);
    expect(wrapper.find('[data-testid="dt-iri"]').exists()).toBe(false);
    await wrapper.get('[data-testid="dt"]').setValue('');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([undefined]);
  });
});
