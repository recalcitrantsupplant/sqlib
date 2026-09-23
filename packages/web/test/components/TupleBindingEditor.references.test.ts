/**
 * The clause editor with both kinds of source in it (issue #209 items 1 and 2).
 *
 * A clause is filled by rows typed here and by tuple sets linked to it, and the
 * editor has to keep the two apart in the model as well as on screen: attaching
 * a set must not disturb the rows beside it, and unlinking one must not take
 * rows with it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TupleBindingEditor from '@/components/query-work-area/TupleBindingEditor.vue';
import type { ArgumentTupleBinding } from '@/types/argument-sets';

const store = vi.hoisted(() => ({
  tupleSets: [] as Array<Record<string, unknown>>,
  loadTupleSets: vi.fn(),
  loadCurrentVersions: vi.fn(),
  resolveReferences: vi.fn(),
  tupleSetById: vi.fn(),
  tupleSetVersionById: vi.fn(),
  currentVersionIdOf: vi.fn(),
}));

vi.mock('@/composables/useTupleSetsStore', () => ({
  useTupleSetsStore: () => ({
    tupleSets: { get value() { return store.tupleSets; } },
    loading: { value: false },
    error: { value: null },
    ...store,
  }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'urn:sqlib:library:lib1' } }),
}));

const CITIES = 'urn:sqlib:tupleSet:cities';
const CITIES_V1 = 'urn:sqlib:tupleSetVersion:cities-1';

const PARIS = { values: { city: { type: 'literal' as const, value: 'Paris' } } };

function candidate() {
  return {
    set: { id: CITIES, name: 'Cities', isPartOf: ['urn:sqlib:library:lib1'] },
    version: {
      id: CITIES_V1,
      version: 1,
      tupleColumns: ['city'],
      rowCount: 1,
      contentString: JSON.stringify({
        head: { vars: ['city'] },
        results: { bindings: [{ city: { type: 'literal', value: 'Lyon' } }] },
      }),
    },
  };
}

function render(binding: Partial<ArgumentTupleBinding> = {}) {
  return mount(TupleBindingEditor, {
    props: {
      variables: ['city'],
      modelValue: { tupleSignature: 'city', variables: ['city'], rows: [], ...binding },
    },
  });
}

function lastModel(editor: ReturnType<typeof render>): ArgumentTupleBinding {
  const emitted = editor.emitted('update:modelValue')!;
  return emitted[emitted.length - 1][0] as ArgumentTupleBinding;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.tupleSets = [];
  store.loadTupleSets.mockResolvedValue(undefined);
  store.loadCurrentVersions.mockResolvedValue([candidate()]);
  store.resolveReferences.mockResolvedValue(undefined);
  store.tupleSetById.mockReturnValue({ id: CITIES, name: 'Cities', currentVersion: CITIES_V1 });
  store.tupleSetVersionById.mockImplementation((id: string) =>
    (id === CITIES_V1
      ? { set: { id: CITIES, name: 'Cities', currentVersion: CITIES_V1 }, version: candidate().version }
      : null));
  store.currentVersionIdOf.mockReturnValue(CITIES_V1);
});

describe('attaching a tuple set from the picker', () => {
  it('records a floating reference and leaves the typed rows alone', async () => {
    const editor = render({ rows: [PARIS] });
    await editor.get('[data-testid="tuple-set-picker-open"]').trigger('click');
    await flushPromises();
    await editor.get('[data-testid="tuple-set-picker-attach"]').trigger('click');

    const model = lastModel(editor);
    expect(model.tupleSetRefs).toEqual([{ tupleSetId: CITIES }]);
    expect(model.rows).toEqual([PARIS]);
  });

  /*
   * Copying is still the right answer for "take these rows and edit them", and
   * it must stay a copy — no reference, or the rows would arrive twice.
   */
  it('adds no reference when the rows are copied instead', async () => {
    const editor = render();
    await editor.get('[data-testid="tuple-set-picker-open"]').trigger('click');
    await flushPromises();
    // Copy opens the conversion — which variable each column fills — and hands
    // the rows over on confirm.
    await editor.get('[data-testid="tuple-set-picker-copy"]').trigger('click');
    await editor.get('[data-testid="tuple-set-conversion-confirm"]').trigger('click');

    const model = lastModel(editor);
    expect(model.rows).toHaveLength(1);
    expect(model.tupleSetRefs ?? []).toEqual([]);
  });
});

describe('a clause showing both kinds of source', () => {
  it('draws linked sets apart from the rows typed into the clause', async () => {
    const editor = render({ rows: [PARIS], tupleSetRefs: [{ tupleSetId: CITIES }] });
    await flushPromises();

    expect(editor.find('[data-testid="tuple-set-references"]').exists()).toBe(true);
    expect(editor.findAll('[data-testid="tuple-set-reference"]')).toHaveLength(1);
    expect(editor.findAll('.row-block')).toHaveLength(1);
  });

  it('counts the linked sets in the header beside the stored rows', async () => {
    const editor = render({ rows: [PARIS], tupleSetRefs: [{ tupleSetId: CITIES }] });
    await flushPromises();
    expect(editor.get('.clause-count').text()).toBe('1 row · 1 linked set');
  });

  /*
   * "No values: this input is left open" would be a lie about a clause a linked
   * set is filling — and the two states run differently.
   */
  it('does not call a clause empty when a linked set is filling it', async () => {
    const editor = render({ tupleSetRefs: [{ tupleSetId: CITIES }] });
    await flushPromises();
    expect(editor.get('[data-testid="tuple-clause-empty"]').text()).toContain('filled by the linked set alone');
  });

  it('still says a clause with neither is left open', async () => {
    const editor = render();
    await flushPromises();
    expect(editor.get('[data-testid="tuple-clause-empty"]').text()).toContain('will not filter results');
  });

  it('reads a binding straight off the server, which knows only pinned versions', async () => {
    const editor = render({ tupleSetVersions: [CITIES_V1] });
    await flushPromises();
    expect(editor.get('[data-testid="tuple-set-reference"]').text()).toContain('pinned to v1');
  });

  it('unlinks a set without touching the rows', async () => {
    const editor = render({ rows: [PARIS], tupleSetRefs: [{ tupleSetId: CITIES }] });
    await flushPromises();
    await editor.get('[data-testid="tuple-set-reference-remove"]').trigger('click');

    const model = lastModel(editor);
    expect(model.tupleSetRefs).toEqual([]);
    expect(model.rows).toEqual([PARIS]);
  });
});
