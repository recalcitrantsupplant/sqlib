/**
 * Rows typed into a clause, taken out as a tuple set.
 *
 * The mirror of the picker, and the two things that make it the design's
 * conversion rather than a link: the names are *kept* and the warning says so,
 * and the dialog asks the mirror question — prepend a fixed IRI, for a
 * declaration that leads with a ground term.
 *
 * `copiedFrom` is recorded so "used by" can be answered loosely. It is not a
 * pin: nothing follows it, and editing either side afterwards leaves the other
 * exactly as it was.
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
  createTupleSet: vi.fn(),
  createVersion: vi.fn(),
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

const PARIS = { values: { city: { type: 'literal' as const, value: 'Paris' } } };

function render(binding: Partial<ArgumentTupleBinding> = {}, props: Record<string, unknown> = {}) {
  return mount(TupleBindingEditor, {
    props: {
      variables: ['city'],
      modelValue: { tupleSignature: 'city', variables: ['city'], rows: [PARIS], ...binding },
      ...props,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.tupleSets = [];
  store.loadTupleSets.mockResolvedValue(undefined);
  store.loadCurrentVersions.mockResolvedValue([]);
  store.resolveReferences.mockResolvedValue(undefined);
  store.createTupleSet.mockResolvedValue({ id: 'urn:sqlib:tupleSet:new', name: 'Cities' });
  store.createVersion.mockResolvedValue({ id: 'urn:sqlib:tupleSetVersion:new', version: 1 });
});

describe('argument table → tuple set', () => {
  it('is offered only once there are rows to take', async () => {
    expect(render({ rows: [] }).find('[data-testid="tuple-set-export-open"]').exists()).toBe(false);
    expect(render().find('[data-testid="tuple-set-export-open"]').exists()).toBe(true);
  });

  it('warns honestly: the names are kept, and never read', async () => {
    const editor = render();
    await editor.get('[data-testid="tuple-set-export-open"]').trigger('click');

    const text = editor.get('[data-testid="tuple-set-export"]').text();
    expect(text).toContain('arity and position');
    expect(text).toContain('kept on the tuple set so you can read it');
    expect(text).not.toContain('drop your names');
  });

  it('writes the rows with the variable names as labels, and records where they came from', async () => {
    const editor = render({}, { copiedFrom: 'urn:sqlib:argument-set:orders' });
    await editor.get('[data-testid="tuple-set-export-open"]').trigger('click');
    await editor.get('[data-testid="tuple-set-export-name"]').setValue('Cities');
    await editor.get('[data-testid="tuple-set-export-confirm"]').trigger('click');
    await flushPromises();

    expect(store.createTupleSet).toHaveBeenCalledWith({
      name: 'Cities',
      isPartOf: ['urn:sqlib:library:lib1'],
      copiedFrom: 'urn:sqlib:argument-set:orders',
    });
    const [, version] = store.createVersion.mock.calls[0];
    const document = JSON.parse(version.contentString);
    expect(document.head.vars).toEqual(['city']);
    expect(document.results.bindings).toEqual([{ city: { type: 'literal', value: 'Paris' } }]);

    expect(editor.emitted('exported-tuple-set')![0]).toEqual([
      { id: 'urn:sqlib:tupleSet:new', name: 'Cities' },
    ]);
  });

  it('prepends a fixed IRI for a declaration leading with a ground term', async () => {
    const editor = render();
    await editor.get('[data-testid="tuple-set-export-open"]').trigger('click');
    await editor.get('[data-testid="tuple-set-export-name"]').setValue('Seeded');
    await editor.get('[data-testid="tuple-set-export-lead"]').setValue('http://ex/seed');
    await editor.get('[data-testid="tuple-set-export-confirm"]').trigger('click');
    await flushPromises();

    const [, version] = store.createVersion.mock.calls[0];
    const document = JSON.parse(version.contentString);
    expect(document.head.vars).toEqual(['fixed', 'city']);
    expect(document.results.bindings[0].fixed).toEqual({ type: 'uri', value: 'http://ex/seed' });
  });

  it('reports a failed save rather than closing as though it worked', async () => {
    store.createTupleSet.mockRejectedValue(new Error('backend unreachable'));
    const editor = render();
    await editor.get('[data-testid="tuple-set-export-open"]').trigger('click');
    await editor.get('[data-testid="tuple-set-export-name"]').setValue('Cities');
    await editor.get('[data-testid="tuple-set-export-confirm"]').trigger('click');
    await flushPromises();

    expect(editor.get('[data-testid="tuple-set-export-error"]').text()).toContain('backend unreachable');
    expect(editor.emitted('exported-tuple-set')).toBeUndefined();
  });
});
