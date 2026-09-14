/**
 * The tuple set record page: importing rows, and stating what they are.
 *
 * The behaviour worth pinning is the one that separates this editor from the
 * data-graph editor it is otherwise a twin of — the source format is an
 * explicit claim about what the bytes mean, not a guess, because plain TSV and
 * SPARQL Results TSV share an extension and disagree about every cell.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TupleSetWorkArea from '@/components/TupleSetWorkArea.vue';

const store = vi.hoisted(() => ({
  tupleSets: [] as Array<Record<string, unknown>>,
  loadTupleSets: vi.fn(),
  loadVersions: vi.fn(),
  loadCurrentVersions: vi.fn(),
  getTupleSet: vi.fn(),
  createTupleSet: vi.fn(),
  updateTupleSet: vi.fn(),
  createVersion: vi.fn(),
  deleteTupleSet: vi.fn(),
}));
const api = vi.hoisted(() => ({ detectTupleFormat: vi.fn(), previewTupleContent: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: [] as string[], success: [] as string[] }));

vi.mock('@/composables/useTupleSetsStore', () => ({
  useTupleSetsStore: () => ({
    tupleSets: { get value() { return store.tupleSets; } },
    loading: { value: false },
    error: { value: null },
    ...store,
  }),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'urn:sqlib:library:lib1' } }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({
    isScratch: { value: true },
    hydrating: { value: false },
    savedAt: { value: null },
    flush: vi.fn(),
  }),
}));
vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn((m: string) => { toasts.success.push(String(m)); }),
    error: vi.fn((m: string) => { toasts.error.push(String(m)); }),
  },
}));

function mountArea() {
  return mount(TupleSetWorkArea, {
    props: { tupleSetId: null, scratchId: 'urn:ui-temp:1' },
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

/**
 * A new tuple set opens in the builder, so anything about importing has to say
 * so first. One click, and it is the same click a user makes.
 */
async function toImport(area: ReturnType<typeof mountArea>) {
  await area.get('[data-testid="tuple-set-mode-import"]').trigger('click');
  await flushPromises();
}

async function choose(area: ReturnType<typeof mountArea>, chosen: File) {
  if (!area.find('[data-testid="tuple-set-file"]').exists()) await toImport(area);
  const input = area.get('[data-testid="tuple-set-file"]');
  Object.defineProperty(input.element, 'files', { value: [chosen], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  toasts.error.length = 0;
  toasts.success.length = 0;
  store.tupleSets = [];
  store.loadVersions.mockResolvedValue([]);
  api.detectTupleFormat.mockResolvedValue('csv');
  api.previewTupleContent.mockResolvedValue({
    contentString: '{"head":{"vars":["city"]},"results":{"bindings":[]}}',
    tupleColumns: ['city'],
    rowCount: 0,
    byteSize: 48,
  });
});

describe('TupleSetWorkArea — import', () => {
  it('reads a CSV file into the editor and names the set from it', async () => {
    const area = mountArea();
    await choose(area, file('capitals.csv', 'city,population\nParis,2161000'));

    expect((area.get('[data-testid="tuple-set-content"]').element as HTMLTextAreaElement).value)
      .toContain('Paris');
    expect((area.get('[data-testid="details-name"]').element as HTMLInputElement).value)
      .toBe('capitals');
  });

  it('picks the source format from the extension', async () => {
    const area = mountArea();
    await choose(area, file('rows.tsv', 'city\tpopulation\nParis\t2161000'));

    expect((area.get('[data-testid="tuple-set-source-format"]').element as HTMLSelectElement).value)
      .toBe('tsv');
  });

  it('starts a .tsv at plain TSV rather than the typed dialect', async () => {
    // Being wrong this way is visible in the preview; being wrong the other way
    // fails the import outright. The sniffer offers the correction.
    const area = mountArea();
    await choose(area, file('rows.tsv', '?city\t?population\n<http://example.org/Paris>\t2161000'));

    expect((area.get('[data-testid="tuple-set-source-format"]').element as HTMLSelectElement).value)
      .toBe('tsv');
  });

  it('refuses a file over the size cap before reading it', async () => {
    const area = mountArea();
    const reader = vi.fn();
    await choose(area, {
      name: 'huge.csv',
      size: 5_000_000,
      text: reader,
    } as unknown as File);

    expect(reader).not.toHaveBeenCalled();
    expect(area.get('[data-testid="tuple-set-error"]').text()).toContain('the limit is');
  });

  it('does not rename a set the author has already titled', async () => {
    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('European capitals');
    await choose(area, file('capitals.csv', 'city\nParis'));

    expect((area.get('[data-testid="details-name"]').element as HTMLInputElement).value)
      .toBe('European capitals');
  });
});

describe('TupleSetWorkArea — the format is a claim, not a guess', () => {
  it('offers the sniffed format rather than applying it', async () => {
    api.detectTupleFormat.mockResolvedValue('sparql-results-tsv');
    const area = mountArea();
    await choose(area, file('rows.tsv', '?city\n<http://example.org/Paris>'));

    // The choice stands until the author takes the offer — silently re-typing a
    // dataset is exactly what the explicit choice exists to prevent.
    expect((area.get('[data-testid="tuple-set-source-format"]').element as HTMLSelectElement).value)
      .toBe('tsv');
    expect(area.get('[data-testid="tuple-set-format-nudge"]').text())
      .toContain('TSV (SPARQL results)');
  });

  it('takes the offer when the author accepts it', async () => {
    api.detectTupleFormat.mockResolvedValue('sparql-results-tsv');
    const area = mountArea();
    await choose(area, file('rows.tsv', '?city\n<http://example.org/Paris>'));

    await area.get('[data-testid="tuple-set-format-nudge"] button').trigger('click');

    expect((area.get('[data-testid="tuple-set-source-format"]').element as HTMLSelectElement).value)
      .toBe('sparql-results-tsv');
    expect(area.find('[data-testid="tuple-set-format-nudge"]').exists()).toBe(false);
  });

  it('drops a standing nudge once the author states a format themselves', async () => {
    api.detectTupleFormat.mockResolvedValue('sparql-results-tsv');
    const area = mountArea();
    await choose(area, file('rows.tsv', '?city\n<http://example.org/Paris>'));
    expect(area.find('[data-testid="tuple-set-format-nudge"]').exists()).toBe(true);

    await area.get('[data-testid="tuple-set-source-format"]').setValue('csv');

    expect(area.find('[data-testid="tuple-set-format-nudge"]').exists()).toBe(false);
  });

  it('says nothing when the sniffer agrees with the choice', async () => {
    api.detectTupleFormat.mockResolvedValue('csv');
    const area = mountArea();
    await choose(area, file('rows.csv', 'city\nParis'));

    expect(area.find('[data-testid="tuple-set-format-nudge"]').exists()).toBe(false);
  });

  it('costs a nudge and not an import when the sniffer fails', async () => {
    api.detectTupleFormat.mockRejectedValue(new Error('offline'));
    const area = mountArea();
    await choose(area, file('rows.csv', 'city\nParis'));

    expect(area.find('[data-testid="tuple-set-format-nudge"]').exists()).toBe(false);
    expect((area.get('[data-testid="tuple-set-content"]').element as HTMLTextAreaElement).value)
      .toContain('Paris');
  });
});

describe('TupleSetWorkArea — save', () => {
  it('states the source format alongside the content', async () => {
    store.createTupleSet.mockResolvedValue({ id: 'urn:sqlib:tupleSet:1', name: 'capitals' });
    store.createVersion.mockResolvedValue({
      id: 'urn:sqlib:tupleSetVersion:1',
      version: 1,
      rowCount: 1,
      tupleColumns: ['city'],
    });

    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('capitals');
    await choose(area, file('capitals.csv', 'city\nParis'));

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    expect(store.createVersion).toHaveBeenCalledWith(
      'urn:sqlib:tupleSet:1',
      expect.objectContaining({ sourceFormat: 'csv', contentString: 'city\nParis' }),
    );
  });

  it('shows a parse error beside the editor, where the text is', async () => {
    store.createTupleSet.mockResolvedValue({ id: 'urn:sqlib:tupleSet:1', name: 'capitals' });
    store.createVersion.mockRejectedValue(
      new Error('Cannot read "oops" in column "city" on line 2 as an RDF term.'),
    );

    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('capitals');
    await choose(area, file('capitals.csv', 'city\noops'));

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    expect(area.get('[data-testid="tuple-set-error"]').text()).toContain('on line 2');
  });
});

/*
 * Issue #208: scan a column at import, propose a type, let the author accept
 * or reject per column, persist the outcome. `refreshPreview` is called
 * directly rather than through the debounced textarea watcher, which real
 * timers in these tests would otherwise have to wait out.
 */
describe('TupleSetWorkArea — column-type suggestions', () => {
  function vmOf(area: ReturnType<typeof mountArea>) {
    return area.vm as unknown as { refreshPreview: () => Promise<void>; save: () => Promise<void> };
  }

  it('shows a proposal for a column that is still plain strings, unchecked until accepted', async () => {
    api.previewTupleContent.mockResolvedValue({
      contentString: '{"head":{"vars":["city","pop"]},"results":{"bindings":[{"city":{"type":"literal","value":"Perth"},"pop":{"type":"literal","value":"2100000"}}]}}',
      tupleColumns: ['city', 'pop'],
      rowCount: 1,
      byteSize: 100,
      columnTypeSuggestions: [{ column: 'pop', suggested: 'xsd:integer' }],
    });

    const area = mountArea();
    await toImport(area);
    await area.get('[data-testid="tuple-set-content"]').setValue('city,pop\nPerth,2100000');
    await vmOf(area).refreshPreview();
    await flushPromises();

    const checkbox = area.get('[data-testid="tuple-set-type-suggestion-pop"]');
    expect((checkbox.element as HTMLInputElement).checked).toBe(false);
    expect(area.get('[data-testid="tuple-set-type-suggestions"]').text()).toContain('a whole number');
  });

  it('applies an accepted suggestion to the preview and to what gets saved', async () => {
    // The component always previews as-is first (to learn the current
    // suggestions), then again with any accepted types — so the mock has to
    // answer both shapes of call, not just count them.
    api.previewTupleContent.mockImplementation(async (_text: string, _format: string, columnTypes?: Record<string, string>) => ({
      contentString: columnTypes?.pop
        ? '{"head":{"vars":["pop"]},"results":{"bindings":[{"pop":{"type":"literal","value":"2100000","datatype":"http://www.w3.org/2001/XMLSchema#integer"}}]}}'
        : '{"head":{"vars":["pop"]},"results":{"bindings":[{"pop":{"type":"literal","value":"2100000"}}]}}',
      tupleColumns: ['pop'],
      rowCount: 1,
      byteSize: 90,
      columnTypeSuggestions: [{ column: 'pop', suggested: 'xsd:integer' }],
    }));
    store.createTupleSet.mockResolvedValue({ id: 'urn:sqlib:tupleSet:1', name: 'pop' });
    store.createVersion.mockResolvedValue({
      id: 'urn:sqlib:tupleSetVersion:1',
      version: 1,
      rowCount: 1,
      tupleColumns: ['pop'],
    });

    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('pop');
    await toImport(area);
    await area.get('[data-testid="tuple-set-content"]').setValue('pop\n2100000');
    await vmOf(area).refreshPreview();
    await flushPromises();

    // Accepting it re-previews immediately, feeding the acceptance back to
    // the same server parser rather than a second one in the browser.
    await area.get('[data-testid="tuple-set-type-suggestion-pop"]').trigger('change');
    await flushPromises();

    expect(api.previewTupleContent).toHaveBeenLastCalledWith('pop\n2100000', 'csv', { pop: 'xsd:integer' });
    // `cellAnnotation` trims a datatype IRI to its local name.
    expect(area.get('[data-testid="tuple-set-preview"]').text()).toContain('integer');

    await vmOf(area).save();
    await flushPromises();

    expect(store.createVersion).toHaveBeenCalledWith(
      'urn:sqlib:tupleSet:1',
      expect.objectContaining({ columnTypes: { pop: 'xsd:integer' } }),
    );
  });

  it('drops an acceptance the content no longer backs, rather than failing the preview', async () => {
    api.previewTupleContent.mockResolvedValue({
      contentString: '{"head":{"vars":["n"]},"results":{"bindings":[{"n":{"type":"literal","value":"42"}}]}}',
      tupleColumns: ['n'],
      rowCount: 1,
      byteSize: 70,
      columnTypeSuggestions: [{ column: 'n', suggested: 'xsd:integer' }],
    });

    const area = mountArea();
    await toImport(area);
    await area.get('[data-testid="tuple-set-content"]').setValue('n\n42');
    await vmOf(area).refreshPreview();
    await flushPromises();
    await area.get('[data-testid="tuple-set-type-suggestion-n"]').trigger('change');
    await flushPromises();

    // An edit makes the column no longer fit the accepted type.
    api.previewTupleContent.mockResolvedValue({
      contentString: '{"head":{"vars":["n"]},"results":{"bindings":[{"n":{"type":"literal","value":"nope"}}]}}',
      tupleColumns: ['n'],
      rowCount: 1,
      byteSize: 70,
      columnTypeSuggestions: [],
    });
    await area.get('[data-testid="tuple-set-content"]').setValue('n\nnope');
    await vmOf(area).refreshPreview();
    await flushPromises();

    // The stale acceptance was dropped before it could be forced onto content
    // it no longer fits — no parse error, and the suggestion is gone too.
    expect(area.find('[data-testid="tuple-set-type-suggestions"]').exists()).toBe(false);
    expect(area.find('[data-testid="tuple-set-import-error"]').exists()).toBe(false);
  });
});

describe('TupleSetWorkArea — build and import', () => {
  it('opens a new set in the builder, not in a wall of JSON', () => {
    const area = mountArea();
    expect(area.find('[data-testid="builder-empty"]').exists()).toBe(true);
    expect(area.find('[data-testid="tuple-set-content"]').exists()).toBe(false);
  });

  it('saves what the builder produced as SPARQL Results JSON', async () => {
    store.createTupleSet.mockResolvedValue({ id: 'urn:sqlib:tupleSet:1', name: 'capitals' });
    store.createVersion.mockResolvedValue({ id: 'v1', version: 1, rowCount: 1, tupleColumns: ['city'] });

    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('capitals');
    await area.get('[data-testid="builder-add-column"]').trigger('click');
    await area.get('[data-testid="builder-column-name"]').setValue('city');
    await area.get('[data-testid="builder-add-row"]').trigger('click');

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    // The builder emits the stored form directly, so no source format is being
    // claimed on its behalf.
    expect(store.createVersion).toHaveBeenCalledWith(
      'urn:sqlib:tupleSet:1',
      expect.objectContaining({ sourceFormat: 'sparql-results-json' }),
    );
  });

  it('drops a blank cell rather than binding the empty literal', async () => {
    store.createTupleSet.mockResolvedValue({ id: 'urn:sqlib:tupleSet:1', name: 'capitals' });
    store.createVersion.mockResolvedValue({ id: 'v1', version: 1, rowCount: 1, tupleColumns: ['city'] });

    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('capitals');
    await area.get('[data-testid="builder-add-column"]').trigger('click');
    await area.get('[data-testid="builder-column-name"]').setValue('city');
    await area.get('[data-testid="builder-add-row"]').trigger('click');

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    const body = store.createVersion.mock.calls[0][1] as { contentString: string };
    const document = JSON.parse(body.contentString);
    expect(document.head.vars).toEqual(['city']);
    // The row exists; the unfilled cell is simply absent, which is UNDEF.
    expect(document.results.bindings).toEqual([{}]);
  });

  it('will not save a grid whose column has no name', async () => {
    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('capitals');
    await area.get('[data-testid="builder-add-column"]').trigger('click');
    await area.get('[data-testid="builder-column-name"]').setValue('');
    await flushPromises();

    expect(area.get('[data-testid="tuple-set-builder-invalid"]').exists()).toBe(true);
  });

  it('converts pasted content into the grid through the server parser', async () => {
    api.previewTupleContent.mockResolvedValue({
      contentString: '{"head":{"vars":["city"]},"results":{"bindings":[{"city":{"type":"literal","value":"Paris"}}]}}',
      tupleColumns: ['city'],
      rowCount: 1,
      byteSize: 84,
    });

    const area = mountArea();
    await toImport(area);
    await area.get('[data-testid="tuple-set-content"]').setValue('city\nParis');
    await area.get('[data-testid="tuple-set-mode-build"]').trigger('click');
    await flushPromises();

    // The browser never parses the CSV itself — a second parser is the drift
    // normalising on import exists to prevent.
    expect(api.previewTupleContent).toHaveBeenCalledWith('city\nParis', 'csv', {});
    expect((area.get('[data-testid="builder-column-name"]').element as HTMLInputElement).value)
      .toBe('city');
  });

  it('stays in import when the conversion fails, rather than emptying the grid', async () => {
    api.previewTupleContent.mockRejectedValue(new Error('Line 2 has 3 cells, expected 2'));

    const area = mountArea();
    await toImport(area);
    await area.get('[data-testid="tuple-set-content"]').setValue('a,b\n1,2,3');
    await area.get('[data-testid="tuple-set-mode-build"]').trigger('click');
    await flushPromises();

    expect(area.find('[data-testid="tuple-set-content"]').exists()).toBe(true);
    expect(area.get('[data-testid="tuple-set-import-error"]').text()).toContain('expected 2');
  });

  it('goes back to import without a round trip — the builder already wrote SRJ', async () => {
    const area = mountArea();
    await area.get('[data-testid="builder-add-column"]').trigger('click');
    api.previewTupleContent.mockClear();

    await area.get('[data-testid="tuple-set-mode-import"]').trigger('click');
    await flushPromises();

    expect(area.find('[data-testid="tuple-set-content"]').exists()).toBe(true);
    const document = JSON.parse(
      (area.get('[data-testid="tuple-set-content"]').element as HTMLTextAreaElement).value,
    );
    expect(document.head.vars).toEqual(['column1']);
  });
});
