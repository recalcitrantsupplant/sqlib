/**
 * The argument set record page: composing parameters with no callable to
 * detect them from.
 *
 * That is what separates this editor from the two it is otherwise a twin of. A
 * tuple set is one table you type or import; an argument set is a bundle of
 * parameters that normally comes from a callable's signature, and on this
 * screen there is no callable — so the parameters are added by hand, and a set
 * composed here declares its own.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ArgumentSetWorkArea from '@/components/ArgumentSetWorkArea.vue';

const store = vi.hoisted(() => ({
  argumentSets: [] as Array<Record<string, unknown>>,
  loadArgumentSets: vi.fn(),
  versionsFor: vi.fn(() => ({ value: [] })),
  loadVersions: vi.fn(),
  getArgumentSet: vi.fn(),
  createArgumentSet: vi.fn(),
  createVersion: vi.fn(),
  deleteArgumentSet: vi.fn(),
}));
const api = vi.hoisted(() => ({
  listQueries: vi.fn(),
  getQueryVersion: vi.fn(),
  listDataGraphs: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ error: [] as string[], success: [] as string[] }));

vi.mock('@/composables/useArgumentSetsStore', () => ({
  useArgumentSetsStore: () => ({
    argumentSets: { get value() { return store.argumentSets; } },
    loading: { value: false },
    error: { value: null },
    ...store,
  }),
}));
vi.mock('@/composables/useDataGraphsStore', () => ({
  useDataGraphsStore: () => ({ dataGraphs: { value: [] }, loadDataGraphs: vi.fn() }),
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
  return mount(ArgumentSetWorkArea, {
    props: { argumentSetId: null, scratchId: 'urn:ui-temp:argument-set:1' },
  });
}

async function addTable(area: ReturnType<typeof mountArea>, variables: string) {
  await area.get('[data-testid="argument-set-new-table-variables"]').setValue(variables);
  await area.get('[data-testid="argument-set-add-table"]').trigger('submit');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  toasts.error.length = 0;
  toasts.success.length = 0;
  store.argumentSets = [];
  store.loadVersions.mockResolvedValue([]);
  api.listQueries.mockResolvedValue([]);
  api.listDataGraphs.mockResolvedValue([]);
});

describe('ArgumentSetWorkArea — composing parameters', () => {
  it('opens empty, saying so for each kind rather than showing nothing', async () => {
    const area = mountArea();
    await flushPromises();

    expect(area.find('[data-testid="argument-set-no-tables"]').exists()).toBe(true);
    expect(area.find('[data-testid="argument-set-no-graphs"]').exists()).toBe(true);
    expect(area.find('[data-testid="argument-set-no-scalars"]').exists()).toBe(true);
  });

  it('adds a table from a variable list', async () => {
    const area = mountArea();
    await addTable(area, 'city');

    expect(area.find('[data-testid="argument-set-no-tables"]').exists()).toBe(false);
  });

  it('accepts several variables for one clause, however they are separated', async () => {
    const area = mountArea();
    await addTable(area, '?postcode, state');

    expect(area.find('[data-testid="argument-set-no-tables"]').exists()).toBe(false);
  });

  /*
   * A table is matched to a clause by the variables it binds, so two tables
   * over the same variables would be two answers to one question — and the
   * second would silently never be used.
   */
  it('refuses a second table over the same variables', async () => {
    const area = mountArea();
    await addTable(area, 'city');
    await addTable(area, 'city');

    expect(toasts.error.join(' ')).toMatch(/already has a table over those variables/);
  });

  /* Order is not identity: ?b ?a fills a clause declaring ?a ?b. */
  it('treats a reordered variable list as the same table', async () => {
    const area = mountArea();
    await addTable(area, 'postcode state');
    await addTable(area, 'state postcode');

    expect(toasts.error.join(' ')).toMatch(/already has a table/);
  });

  /*
   * A typo in a variable name used to be permanent: the names are typed here,
   * and a table could be neither renamed nor removed — while the names are
   * exactly what matches the table to a clause.
   */
  it('renames a table\'s variables, keeping each column\'s values', async () => {
    const area = mountArea();
    await addTable(area, 'cittyyy');

    await area.get('[data-testid="argument-add-row"]').trigger('click');
    await flushPromises();
    await area.get('[data-testid="argument-value"]').setValue('ex:Sydney');
    await flushPromises();

    await area.get('[data-testid="argument-clause-rename-open"]').trigger('click');
    await area.get('[data-testid="argument-clause-rename-input"]').setValue('city');
    await area.get('[data-testid="argument-clause-rename"]').trigger('submit');
    await flushPromises();

    expect(area.get('[data-testid="argument-clause"]').text()).toContain('?city');
    expect((area.get('[data-testid="argument-value"]').element as HTMLInputElement).value)
      .toBe('ex:Sydney');
  });

  it('refuses a rename onto another table\'s variables', async () => {
    const area = mountArea();
    await addTable(area, 'city');
    await addTable(area, 'state');

    await area.findAll('[data-testid="argument-clause-rename-open"]')[1].trigger('click');
    await area.get('[data-testid="argument-clause-rename-input"]').setValue('city');
    await area.get('[data-testid="argument-clause-rename"]').trigger('submit');
    await flushPromises();

    expect(toasts.error.join(' ')).toMatch(/already has a table over those variables/);
    expect(area.findAll('[data-testid="argument-clause"]')).toHaveLength(2);
  });

  it('removes a table', async () => {
    const area = mountArea();
    await addTable(area, 'city');

    await area.get('[data-testid="argument-clause-remove"]').trigger('click');
    await flushPromises();

    expect(area.find('[data-testid="argument-set-no-tables"]').exists()).toBe(true);
  });

  it('adds and removes a number', async () => {
    const area = mountArea();
    await area.get('[data-testid="argument-set-add-scalar"]').trigger('click');
    await flushPromises();
    expect(area.findAll('[data-testid="argument-set-scalar-binding"]')).toHaveLength(1);

    await area.get('[data-testid="argument-set-scalar-binding"] .ghost-button').trigger('click');
    await flushPromises();
    expect(area.find('[data-testid="argument-set-no-scalars"]').exists()).toBe(true);
  });

  it('adds a graph, which is a query group\'s and not a query\'s', async () => {
    const area = mountArea();
    await area.get('[data-testid="argument-set-add-graph"]').trigger('click');
    await flushPromises();

    expect(area.findAll('[data-testid="argument-set-graph-binding"]')).toHaveLength(1);
  });

  /*
   * No port field: a set carries payload and the group it runs against says
   * which of its inputs each graph fills. This screen has no group in scope —
   * that is the point of a set having a screen of its own — so a port box here
   * could only be filled from memory.
   */
  it('asks for no port, and numbers the graphs by the slot they fill', async () => {
    const area = mountArea();
    await area.get('[data-testid="argument-set-add-graph"]').trigger('click');
    await area.get('[data-testid="argument-set-add-graph"]').trigger('click');
    await flushPromises();

    expect(area.findAll('input[placeholder="source data"]')).toHaveLength(0);
    expect(area.findAll('[data-testid="argument-set-graph-slot"]').map(node => node.text()))
      .toEqual(['1', '2']);
  });

  it('reorders the graphs, because order is what the group routes by', async () => {
    const area = mountArea();
    await area.get('[data-testid="argument-set-add-graph"]').trigger('click');
    await area.get('[data-testid="argument-set-add-graph"]').trigger('click');
    await flushPromises();

    const selects = area.findAll('[data-testid="argument-set-graph-select"]');
    await selects[1].setValue('');
    // The first row cannot move up and the last cannot move down: the ends of
    // the list are the ends of the group's declared inputs.
    expect((area.findAll('[data-testid="argument-set-graph-up"]')[0].element as HTMLButtonElement).disabled).toBe(true);
    expect((area.findAll('[data-testid="argument-set-graph-down"]')[1].element as HTMLButtonElement).disabled).toBe(true);

    await area.findAll('[data-testid="argument-set-graph-down"]')[0].trigger('click');
    await flushPromises();

    expect(area.findAll('[data-testid="argument-set-graph-slot"]')).toHaveLength(2);
  });
});

describe('ArgumentSetWorkArea — saving', () => {
  it('saves a set that fills only numbers, with no tables at all', async () => {
    store.createArgumentSet.mockResolvedValue({
      id: 'urn:sqlib:argument-set:1', name: 'Paging', libraryId: 'urn:sqlib:library:lib1',
      currentVersionId: 'urn:sqlib:argument-set-version:1',
    });
    const area = mountArea();
    await area.get('[data-testid="argument-set-add-scalar"]').trigger('click');
    await area.get('[data-testid="details-name"]').setValue('Paging');
    await flushPromises();

    await area.vm.save();
    await flushPromises();

    expect(store.createArgumentSet).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'urn:sqlib:library:lib1',
      tupleBindings: [],
    }));
  });

  /*
   * A set composed on the rail has no callable, so it records no provenance —
   * `scope` and `targetId` are what a set made on a query's screen carries, not
   * a requirement of being one.
   */
  it('sends no provenance for a set composed here', async () => {
    store.createArgumentSet.mockResolvedValue({
      id: 'urn:sqlib:argument-set:1', name: 'Cities', libraryId: 'urn:sqlib:library:lib1',
    });
    const area = mountArea();
    await addTable(area, 'city');
    await area.get('[data-testid="details-name"]').setValue('Cities');
    await flushPromises();

    await area.vm.save();
    await flushPromises();

    expect(store.createArgumentSet).toHaveBeenCalledWith(expect.objectContaining({
      scope: null,
      targetId: null,
    }));
  });

  it('will not save a set with a name but nothing in it', async () => {
    const area = mountArea();
    await area.get('[data-testid="details-name"]').setValue('Empty');
    await flushPromises();

    await area.vm.save();
    await flushPromises();

    expect(store.createArgumentSet).not.toHaveBeenCalled();
  });
});

describe('ArgumentSetWorkArea — the Fits list', () => {
  /**
   * The switcher turned around: one set judged against many callables, rather
   * than one callable against many sets. A query's signature lives on its
   * version, and the chain from input tuple to member to variable name is
   * walked from the one expanded response rather than paid for as more
   * requests.
   */
  function queryVersion(variableNames: string[]) {
    return {
      data: {
        inputs: variableNames.map((name, index) => ({ id: `urn:var:${index}`, variableName: name })),
        tupleMembers: variableNames.map((_, index) => ({
          id: `urn:member:${index}`, position: index, variable: `urn:var:${index}`,
        })),
        inputTuples: [{ id: 'urn:tuple:1', memberEntries: variableNames.map((_, i) => `urn:member:${i}`) }],
        limitParameters: [],
        offsetParameters: [],
      },
    };
  }

  it('judges a query whose clause the set fills as a fit', async () => {
    api.listQueries.mockResolvedValue([
      { id: 'urn:sqlib:query:1', name: 'Cities', isPartOf: ['urn:sqlib:library:lib1'], currentVersionNumber: 1 },
    ]);
    api.getQueryVersion.mockResolvedValue(queryVersion(['city']));
    store.getArgumentSet.mockResolvedValue({
      id: 'urn:sqlib:argument-set:1', name: 'Cities', libraryId: 'urn:sqlib:library:lib1',
      scope: null, targetId: null, tupleBindings: [{ tupleSignature: 'city', variables: ['city'], rows: [] }],
      scalarBindings: [], graphBindings: [], dateCreated: '', dateModified: '',
    });

    const area = mount(ArgumentSetWorkArea, { props: { argumentSetId: 'urn:sqlib:argument-set:1' } });
    await flushPromises();

    const rows = area.findAll('[data-testid="argument-set-fits"] li');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('Cities');
    expect(rows[0].text()).toContain('fits');
  });

  it('leaves out a query in another library', async () => {
    api.listQueries.mockResolvedValue([
      { id: 'urn:sqlib:query:2', name: 'Elsewhere', isPartOf: ['urn:sqlib:library:other'], currentVersionNumber: 1 },
    ]);
    store.getArgumentSet.mockResolvedValue({
      id: 'urn:sqlib:argument-set:1', name: 'Cities', libraryId: 'urn:sqlib:library:lib1',
      scope: null, targetId: null, tupleBindings: [], scalarBindings: [], graphBindings: [],
      dateCreated: '', dateModified: '',
    });

    const area = mount(ArgumentSetWorkArea, { props: { argumentSetId: 'urn:sqlib:argument-set:1' } });
    await flushPromises();

    expect(area.find('[data-testid="argument-set-fits"]').exists()).toBe(false);
  });

  /* A listing this screen cannot read is an empty Fits list, not a broken page. */
  it('still renders when the listing fails', async () => {
    api.listQueries.mockRejectedValue(new Error('nope'));
    store.getArgumentSet.mockResolvedValue({
      id: 'urn:sqlib:argument-set:1', name: 'Cities', libraryId: 'urn:sqlib:library:lib1',
      scope: null, targetId: null, tupleBindings: [], scalarBindings: [], graphBindings: [],
      dateCreated: '', dateModified: '',
    });

    const area = mount(ArgumentSetWorkArea, { props: { argumentSetId: 'urn:sqlib:argument-set:1' } });
    await flushPromises();

    expect(area.find('[data-testid="argument-set-no-tables"]').exists()).toBe(true);
  });
});
