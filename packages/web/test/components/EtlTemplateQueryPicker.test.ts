/**
 * The SPARQL Template panel's query picker: a saved query, then Latest or a
 * version. It emits the link to store and the text that link resolves to now.
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

async function mountPicker(modelValue: string | null = null) {
  const Picker = (await import('@/components/etl/TemplateQueryPicker.vue')).default;
  const wrapper = mount(Picker, {
    props: { libraryId: LIBRARY, modelValue },
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

  it('links a chosen query as Latest, and pins a version when one is picked', async () => {
    const wrapper = await mountPicker();
    wrapper.findComponent(SearchSelectStub).vm.$emit('update:modelValue', 'urn:sqlib:query:q1');
    await flushPromises();
    expect(wrapper.emitted('use')?.[0]).toEqual([{ reference: 'urn:sqlib:query:q1', text: TEMPLATE_V2 }]);

    const versionSelect = wrapper.findComponent(SelectStub);
    expect(versionSelect.props('modelValue')).toBe('latest');
    expect(versionSelect.props('disabled')).toBe(false);
    versionSelect.vm.$emit('update:modelValue', '1');
    await flushPromises();
    expect(wrapper.emitted('use')?.[1]).toEqual([{ reference: 'urn:sqlib:query-version:v1', text: TEMPLATE_V1 }]);
  });

  it('shows a stored link: a query as Latest, a version as its number', async () => {
    const latest = await mountPicker('urn:sqlib:query:q1');
    expect(latest.findComponent(SearchSelectStub).props('modelValue')).toBe('urn:sqlib:query:q1');
    expect(latest.findComponent(SelectStub).props('modelValue')).toBe('latest');

    const pinned = await mountPicker('urn:sqlib:query-version:v1');
    expect(pinned.findComponent(SearchSelectStub).props('modelValue')).toBe('urn:sqlib:query:q1');
    expect(pinned.findComponent(SelectStub).props('modelValue')).toBe('1');
    expect(pinned.emitted('use')).toBeUndefined();
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
