import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import MemorySourcesEditor from '@/components/backends/MemorySourcesEditor.vue';

const api = vi.hoisted(() => ({
  listDataGraphs: vi.fn(),
  listDataGraphVersions: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

function version(id: string, graphId: string, contentFormat: string) {
  return { id, isPartOf: graphId, version: 1, contentString: 'x', contentFormat };
}

async function mountEditor(sources: unknown[]) {
  const wrapper = mount(MemorySourcesEditor, {
    props: { sources } as never,
    global: { stubs: { SearchSelect: true } },
  });
  await flushPromises();
  return wrapper;
}

describe('MemorySourcesEditor graph IRI field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listDataGraphs.mockResolvedValue([
      { id: 'g:turtle', name: 'Turtle data', currentVersion: 'v:turtle', isPartOf: ['l'] },
      { id: 'g:quads', name: 'Quad data', currentVersion: 'v:quads', isPartOf: ['l'] },
    ]);
    api.listDataGraphVersions.mockImplementation(async (graphId: string) =>
      graphId === 'g:quads'
        ? [version('v:quads', 'g:quads', 'application/n-quads')]
        : [version('v:turtle', 'g:turtle', 'text/turtle')],
    );
  });

  it('shows the field for triples', async () => {
    const wrapper = await mountEditor([{ dataGraphId: 'g:turtle' }]);

    expect(wrapper.find('[data-testid="source-named-graph"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="source-named-graph-reveal"]').exists()).toBe(false);
  });

  it('folds the field for quads until asked for, then warns once an IRI is typed', async () => {
    const wrapper = await mountEditor([{ dataGraphId: 'g:quads' }]);

    expect(wrapper.find('[data-testid="source-named-graph"]').exists()).toBe(false);
    await wrapper.find('[data-testid="source-named-graph-reveal"]').trigger('click');

    const input = wrapper.find('[data-testid="source-named-graph"]');
    expect(input.exists()).toBe(true);
    expect(wrapper.find('[data-testid="source-named-graph-warning"]').exists()).toBe(false);

    await input.setValue('http://example.org/g');
    expect(wrapper.find('[data-testid="source-named-graph-warning"]').text()).toContain('graphs the data names are replaced');
  });

  it('shows a saved IRI on quads with the warning', async () => {
    const wrapper = await mountEditor([{ dataGraphId: 'g:quads', namedGraph: 'http://example.org/g' }]);

    expect(wrapper.find('[data-testid="source-named-graph"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="source-named-graph-warning"]').exists()).toBe(true);
  });
});
