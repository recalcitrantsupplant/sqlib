/**
 * The SPARQL Template panel's query picker: a saved query and version, whose
 * text becomes the template.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

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
    global: { stubs: { SearchSelect: SearchSelectStub } },
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
  ]);
  store.loadQueries.mockResolvedValue(undefined);
  store.loadQueryVersions.mockResolvedValue([
    { id: 'urn:sqlib:query-version:v1', version: 1 },
    { id: 'urn:sqlib:query-version:v2', version: 2 },
  ]);
  store.fetchQueryVersion.mockImplementation(async (_id: string, version: number) =>
    version === 2
      ? { queryString: TEMPLATE_V2, queryType: 'CONSTRUCT' }
      : { queryString: TEMPLATE_V1, queryType: 'CONSTRUCT' });
});

describe('TemplateQueryPicker', () => {
  it('lists the queries of the library only, on first use', async () => {
    const wrapper = await mountPicker();
    expect(store.loadQueries).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Typed things');
    expect(wrapper.text()).not.toContain('Elsewhere');
  });

  it('uses the current version when a query is chosen, and another version when one is picked', async () => {
    const wrapper = await mountPicker();
    wrapper.findComponent(SearchSelectStub).vm.$emit('update:modelValue', 'urn:sqlib:query:q1');
    await flushPromises();
    expect(wrapper.emitted('use')?.[0]).toEqual([TEMPLATE_V2]);

    await wrapper.get('[data-testid="etl-template-query-version"]').setValue('1');
    await flushPromises();
    expect(wrapper.emitted('use')?.[1]).toEqual([TEMPLATE_V1]);
  });

  it('refuses a SELECT query and leaves the template alone', async () => {
    store.fetchQueryVersion.mockResolvedValue({ queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: 'SELECT' });
    const wrapper = await mountPicker();
    wrapper.findComponent(SearchSelectStub).vm.$emit('update:modelValue', 'urn:sqlib:query:q1');
    await flushPromises();
    expect(wrapper.emitted('use')).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/CONSTRUCT/));
  });
});
