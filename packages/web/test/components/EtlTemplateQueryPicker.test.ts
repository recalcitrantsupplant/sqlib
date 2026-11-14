/**
 * The SPARQL Template panel's query picker: a saved query and version, whose
 * text becomes the template.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { QueryTypeIri } from '@sparql-query-lib/types';

const LIBRARY = 'urn:sqlib:library:lib1';
const TEMPLATE_V1 = 'CONSTRUCT { ?s a ?t } WHERE { VALUES ?s { UNDEF } }';
const TEMPLATE_V2 = 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?s ?p ?o) { (UNDEF UNDEF UNDEF) } }';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
const store = vi.hoisted(() => ({
  queries: null as unknown as ReturnType<typeof ref>,
  loadQueries: vi.fn(),
  loadQueryVersions: vi.fn(),
  fetchQueryVersion: vi.fn(),
}));

vi.mock('vue-sonner', () => ({ toast }));
vi.mock('@/composables/useQueriesStore', () => ({ useQueriesStore: () => store }));

const CONSTRUCT = QueryTypeIri.construct;
const SELECT = QueryTypeIri.select;

const SelectStub = {
  name: 'Select',
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template: '<div data-testid="version-select" :data-disabled="disabled ? \'true\' : \'false\'"><slot /></div>',
};

const SearchSelectStub = {
  name: 'SearchSelect',
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template: '<div data-testid="search-select"><span v-for="o in options" :key="o.value">{{ o.label }}</span></div>',
};

async function mountPicker() {
  const Picker = (await import('@/components/etl/TemplateQueryPicker.vue')).default;
  const wrapper = mount(Picker, {
    props: { libraryId: LIBRARY },
    global: { stubs: { SearchSelect: SearchSelectStub, Select: SelectStub, SelectContent: true, SelectTrigger: true, SelectValue: true, SelectItem: true } },
  });
  await wrapper.trigger('focusin');
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.queries = ref([
    { id: 'urn:sqlib:query:q1', name: 'Typed things', isPartOf: LIBRARY, currentVersion: 'urn:sqlib:query-version:v2' },
    { id: 'urn:sqlib:query:q2', name: 'Elsewhere', isPartOf: 'urn:sqlib:library:other', currentVersion: 'urn:x' },
    { id: 'urn:sqlib:query:q3', name: 'Plain select', isPartOf: LIBRARY, currentVersion: 'urn:sqlib:query-version:s1' },
  ]);
  store.loadQueries.mockResolvedValue(undefined);
  store.loadQueryVersions.mockImplementation(async (queryId: string) =>
    queryId === 'urn:sqlib:query:q3'
      ? [{ id: 'urn:sqlib:query-version:s1', version: 1, queryType: SELECT }]
      : [
          { id: 'urn:sqlib:query-version:v1', version: 1, queryType: CONSTRUCT },
          { id: 'urn:sqlib:query-version:v2', version: 2, queryType: CONSTRUCT },
          { id: 'urn:sqlib:query-version:v3', version: 3, queryType: SELECT },
        ]);
  store.fetchQueryVersion.mockImplementation(async (_id: string, version: number) =>
    version === 2
      ? { queryVersion: { queryString: TEMPLATE_V2, queryType: CONSTRUCT } }
      : { queryVersion: { queryString: TEMPLATE_V1, queryType: CONSTRUCT } });
});

describe('TemplateQueryPicker', () => {
  it('lists the queries of the library only, on first use', async () => {
    const wrapper = await mountPicker();
    expect(store.loadQueries).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Typed things');
    expect(wrapper.text()).not.toContain('Elsewhere');
  });

  it('offers CONSTRUCT queries only', async () => {
    const wrapper = await mountPicker();
    expect(wrapper.text()).not.toContain('Plain select');
  });

  it('shows the version picker, disabled, before a query is chosen', async () => {
    const wrapper = await mountPicker();
    expect(wrapper.get('[data-testid="version-select"]').attributes('data-disabled')).toBe('true');
  });

  it('uses the current version when a query is chosen, and another version when one is picked', async () => {
    const wrapper = await mountPicker();
    wrapper.findComponent(SearchSelectStub).vm.$emit('update:modelValue', 'urn:sqlib:query:q1');
    await flushPromises();
    expect(wrapper.emitted('use')?.[0]).toEqual([TEMPLATE_V2]);

    const versionSelect = wrapper.findComponent(SelectStub);
    expect(versionSelect.props('modelValue')).toBe('2');
    expect(versionSelect.props('disabled')).toBe(false);
    versionSelect.vm.$emit('update:modelValue', '1');
    await flushPromises();
    expect(wrapper.emitted('use')?.[1]).toEqual([TEMPLATE_V1]);
  });

  it('refuses a SELECT query and leaves the template alone', async () => {
    store.fetchQueryVersion.mockResolvedValue({ queryVersion: { queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: SELECT } });
    const wrapper = await mountPicker();
    wrapper.findComponent(SearchSelectStub).vm.$emit('update:modelValue', 'urn:sqlib:query:q1');
    await flushPromises();
    expect(wrapper.emitted('use')).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/CONSTRUCT/));
  });
});
