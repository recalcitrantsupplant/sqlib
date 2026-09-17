import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import DataGraphWorkArea from '@/components/DataGraphWorkArea.vue';

const store = vi.hoisted(() => ({
  dataGraphs: [] as Array<Record<string, unknown>>,
  loadDataGraphs: vi.fn(),
  loadVersions: vi.fn(),
  getDataGraph: vi.fn(),
  createDataGraph: vi.fn(),
  updateDataGraph: vi.fn(),
  createVersion: vi.fn(),
  deleteDataGraph: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ error: [] as string[], success: [] as string[] }));

vi.mock('@/composables/useDataGraphsStore', () => ({
  useDataGraphsStore: () => ({
    ...store,
    // After the spread: the component reads these as refs, and the raw arrays
    // on `store` would shadow them.
    dataGraphs: { get value() { return store.dataGraphs; } },
    loading: { value: false },
    error: { value: null },
  }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'urn:sqlib:library:lib1' } }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({ isScratch: { value: true }, hydrating: { value: false }, savedAt: { value: null }, flush: vi.fn() }),
}));
const serverLimits = vi.hoisted(() => ({
  value: { dataGraphVersionBytes: 1_048_576, dataGraphLibraryBytes: 16_777_216 },
}));
vi.mock('@/composables/useServerLimits', async () => {
  const { ref } = await import('vue');
  const limits = ref(serverLimits.value);
  return {
    useServerLimits: () => {
      limits.value = serverLimits.value;
      return { limits, ensureLoaded: vi.fn().mockResolvedValue(undefined) };
    },
  };
});

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn((m: string) => { toasts.success.push(String(m)); }),
    error: vi.fn((m: string) => { toasts.error.push(String(m)); }),
  },
}));

/**
 * The RDF editor stands in for CodeMirror, as it does in the rules specs: the
 * component under test only cares that text goes in and comes back out.
 */
const RdfEditorStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
};

function mountArea() {
  return mount(DataGraphWorkArea, {
    props: { dataGraphId: null, scratchId: 'urn:ui-temp:1' },
    global: { stubs: { EditableRdfViewer: RdfEditorStub } },
  });
}

/** A File whose `text()` and `size` the component will read. */
function file(name: string, content: string, size?: number) {
  return {
    name,
    size: size ?? content.length,
    text: () => Promise.resolve(content),
  } as unknown as File;
}

async function choose(area: ReturnType<typeof mountArea>, chosen: File) {
  const input = area.get('[data-testid="data-graph-file"]');
  Object.defineProperty(input.element, 'files', { value: [chosen], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  toasts.error.length = 0;
  toasts.success.length = 0;
  store.dataGraphs = [];
  store.loadVersions.mockResolvedValue([]);
  serverLimits.value = { dataGraphVersionBytes: 1_048_576, dataGraphLibraryBytes: 16_777_216 };
});

describe('DataGraphWorkArea — upload', () => {
  it('reads a dropped Turtle file into the editor', async () => {
    const area = mountArea();
    await choose(area, file('family.ttl', '@prefix : <http://ex/> . :a :edge :b .'));

    expect((area.get('[data-testid="data-graph-content"]').element as HTMLTextAreaElement).value)
      .toContain(':a :edge :b');
  });

  it('picks the format from the extension, so it need not be restated', async () => {
    const area = mountArea();
    await choose(area, file('graph.nq', '<http://ex/a> <http://ex/p> <http://ex/b> <http://ex/g> .'));

    expect((area.get('[data-testid="data-graph-content-format"]').element as HTMLSelectElement).value)
      .toBe('application/n-quads');
  });

  it('names an unnamed graph after the file, and leaves a named one alone', async () => {
    const fresh = mountArea();
    await choose(fresh, file('family.ttl', ':a :b :c .'));
    expect((fresh.get('[data-testid="details-name"]').element as HTMLInputElement).value).toBe('family');

    const named = mountArea();
    await named.get('[data-testid="details-name"]').setValue('Deliberate name');
    await choose(named, file('family.ttl', ':a :b :c .'));
    expect((named.get('[data-testid="details-name"]').element as HTMLInputElement).value)
      .toBe('Deliberate name');
  });

  it('refuses an oversized file before reading it', async () => {
    const area = mountArea();
    const huge = file('huge.ttl', 'unused', 5_000_000);
    await choose(area, huge);

    // Not read: a 5 MB string built only to be rejected is a hung tab.
    expect((area.get('[data-testid="data-graph-content"]').element as HTMLTextAreaElement).value).toBe('');
    expect(area.get('[data-testid="data-graph-error"]').text()).toMatch(/limit is/);
  });

  /*
   * Both caps are environment variables on the API. The panel used to state a
   * figure of its own, so a deployment that raised the server's had a UI that
   * both said and enforced the old one.
   */
  it('states the server\'s caps, and accepts a file the raised one allows', async () => {
    serverLimits.value = { dataGraphVersionBytes: 10_485_760, dataGraphLibraryBytes: 104_857_600 };
    const area = mountArea();

    const note = area.get('[data-testid="data-graph-storage-note"]').text();
    expect(note).toContain('10.0 MB per version');
    expect(note).toContain('100.0 MB across the library');
    expect(note).toMatch(/stored on the server/);
    expect(note).toMatch(/attach it to a backend under Backends/);

    await choose(area, file('big.ttl', ':a :b :c .', 5_000_000));
    expect((area.get('[data-testid="data-graph-content"]').element as HTMLTextAreaElement).value)
      .toContain(':a :b :c');
  });

  it('reports a save rejection in the editor, not only as a toast', async () => {
    // A parse error is fixed in the text right there, so it belongs beside it.
    store.createDataGraph.mockResolvedValue({ id: 'urn:sqlib:data-graph:g1', name: 'X' });
    store.createVersion.mockRejectedValue(new Error('Invalid text/turtle content: bad syntax'));

    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('X');
    await area.get('[data-testid="data-graph-content"]').setValue('not turtle {{{');
    await flushPromises();

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    expect(area.get('[data-testid="data-graph-error"]').text()).toMatch(/Invalid text\/turtle/);
  });

  it('summarises what is in the editor before anything is saved', async () => {
    const area = mountArea();
    expect(area.get('[data-testid="data-graph-size"]').text()).toBe('empty');

    await area.get('[data-testid="data-graph-content"]').setValue(':a :b :c .\n:d :e :f .');
    await flushPromises();
    expect(area.get('[data-testid="data-graph-size"]').text()).toContain('2 lines');
  });
});
