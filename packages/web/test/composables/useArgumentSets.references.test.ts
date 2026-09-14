/**
 * Tuple sets linked to a clause, through the composable that saves and runs
 * them (issue #209).
 *
 * The two halves of "pin on save, float on draft" are both invisible when
 * they go wrong, which is why they are tested here rather than left to the
 * editor:
 *
 * - **Running a draft** must include a linked set's rows. This path sends
 *   values, not ids — an unsaved query runs as text through `POST /sparql`,
 *   which knows no version ids — so a reference the browser never resolved is
 *   simply absent from the run, and the query returns *more* rows than the
 *   author constrained it to.
 * - **Saving** must write the version id the reference resolved to, and must
 *   never send the editor's own field: `argumentTupleBindingSchema` is
 *   `additionalProperties: false`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const api = vi.hoisted(() => ({
  listArgumentSets: vi.fn(),
  listLibraryArgumentSets: vi.fn(),
  listArgumentSetVersions: vi.fn(),
  createArgumentSet: vi.fn(),
  createArgumentSetVersion: vi.fn(),
  getArgumentSet: vi.fn(),
}));

const tupleSets = vi.hoisted(() => ({
  resolveReferences: vi.fn(),
  currentVersionIdOf: vi.fn(),
  tupleSetVersionById: vi.fn(),
  tupleSetById: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useTupleSetsStore', () => ({ useTupleSetsStore: () => tupleSets }));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { useArgumentSets } = await import('@/composables/useArgumentSets');

const QUERY = 'urn:sqlib:query:q1';
const LIBRARY = 'urn:sqlib:library:lib1';
const CITIES = 'urn:sqlib:tupleSet:cities';
const CITIES_V1 = 'urn:sqlib:tupleSetVersion:cities-1';
const CITIES_V2 = 'urn:sqlib:tupleSetVersion:cities-2';

function version(id: string, rows: Array<Record<string, { type: string; value: string }>>) {
  return {
    version: {
      id,
      contentString: JSON.stringify({ head: { vars: ['city'] }, results: { bindings: rows } }),
    },
  };
}

const PARIS = { city: { type: 'literal', value: 'Paris' } };
const LYON = { city: { type: 'literal', value: 'Lyon' } };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.listArgumentSets.mockResolvedValue([]);
  api.listLibraryArgumentSets.mockResolvedValue([]);
  api.listArgumentSetVersions.mockResolvedValue([]);
  api.createArgumentSet.mockResolvedValue({ data: { id: 'urn:sqlib:argument-set:new' } });
  api.createArgumentSetVersion.mockResolvedValue({ data: {} });
  api.getArgumentSet.mockRejectedValue(new Error('not needed'));
  tupleSets.resolveReferences.mockResolvedValue(undefined);
  tupleSets.currentVersionIdOf.mockImplementation((id: string) =>
    (id === CITIES ? CITIES_V2 : null));
  tupleSets.tupleSetVersionById.mockImplementation((id: string) => {
    if (id === CITIES_V2) return version(id, [PARIS, LYON]);
    if (id === CITIES_V1) return version(id, [PARIS]);
    return null;
  });
  tupleSets.tupleSetById.mockReturnValue(null);
});

function composableWithScratch(binding: Record<string, unknown>) {
  const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
  args.createScratch('Scratch');
  args.name.value = 'Cities';
  args.tupleBindings.value = [
    { tupleSignature: 'city', variables: ['city'], rows: [], ...binding },
  ];
  return args;
}

describe('running a draft that links a tuple set', () => {
  it('sends the linked set’s rows, resolved live', () => {
    const args = composableWithScratch({ tupleSetRefs: [{ tupleSetId: CITIES }] });

    const payload = args.visibleValuesPayload();
    expect(payload?.arguments?.[0].arguments.bindings).toEqual([PARIS, LYON]);
  });

  it('unions them with the rows typed into the same clause', () => {
    const typed = { values: { city: { type: 'literal' as const, value: 'Nice' } } };
    const args = composableWithScratch({
      rows: [typed],
      tupleSetRefs: [{ tupleSetId: CITIES }],
    });

    const bindings = args.visibleValuesPayload()?.arguments?.[0].arguments.bindings;
    expect(bindings).toEqual([typed.values, PARIS, LYON]);
  });

  /* Float on draft: the set's *current* version, not the one it had at attach. */
  it('follows the set while the reference floats', () => {
    const args = composableWithScratch({ tupleSetRefs: [{ tupleSetId: CITIES }] });
    expect(args.visibleValuesPayload()?.arguments?.[0].arguments.bindings).toHaveLength(2);

    tupleSets.currentVersionIdOf.mockReturnValue(CITIES_V1);
    expect(args.visibleValuesPayload()?.arguments?.[0].arguments.bindings).toEqual([PARIS]);
  });

  /* Pinned: the version named, whatever the set has moved on to. */
  it('reads the pinned version and ignores the set’s current one', () => {
    const args = composableWithScratch({
      tupleSetRefs: [{ tupleSetId: CITIES, versionId: CITIES_V1 }],
    });
    expect(args.visibleValuesPayload()?.arguments?.[0].arguments.bindings).toEqual([PARIS]);
  });

  /*
   * The server skips a version that has gone missing rather than failing the
   * execution; refusing to run an otherwise valid set is the worse answer, and
   * this path has to agree with it.
   */
  it('skips a reference the store cannot answer for rather than refusing to run', () => {
    const typed = { values: { city: { type: 'literal' as const, value: 'Nice' } } };
    const args = composableWithScratch({
      rows: [typed],
      tupleSetRefs: [{ versionId: 'urn:sqlib:tupleSetVersion:gone' }],
    });

    expect(args.visibleValuesPayload()?.arguments?.[0].arguments.bindings).toEqual([typed.values]);
  });

  /*
   * A row keyed only by columns this clause does not declare would arrive as
   * all-UNDEF, which matches everything instead of contributing nothing — the
   * exact inversion `rowsFromTupleSetVersions` guards against server-side.
   */
  it('drops a row that binds none of the clause’s variables', () => {
    tupleSets.tupleSetVersionById.mockReturnValue({
      version: {
        id: CITIES_V2,
        contentString: JSON.stringify({
          head: { vars: ['country'] },
          results: { bindings: [{ country: { type: 'literal', value: 'France' } }] },
        }),
      },
    });
    const args = composableWithScratch({ tupleSetRefs: [{ tupleSetId: CITIES }] });

    // Nothing left to send: an input with no rows is left open, not matched
    // against the empty set.
    expect(args.visibleValuesPayload()).toBeNull();
  });
});

describe('saving a set that links a tuple set', () => {
  it('pins a floating reference to the version current at save time', async () => {
    const args = composableWithScratch({ tupleSetRefs: [{ tupleSetId: CITIES }] });

    expect(await args.save()).toBe(true);
    const [, input] = api.createArgumentSet.mock.calls[0];
    expect(input.tupleBindings[0].tupleSetVersions).toEqual([CITIES_V2]);
  });

  it('sends no editor-only field, which the body schema would refuse', async () => {
    const args = composableWithScratch({ tupleSetRefs: [{ tupleSetId: CITIES }] });
    await args.save();

    const [, input] = api.createArgumentSet.mock.calls[0];
    expect(input.tupleBindings[0]).not.toHaveProperty('tupleSetRefs');
  });

  it('leaves a pin already set exactly where it is', async () => {
    const args = composableWithScratch({
      tupleSetRefs: [{ tupleSetId: CITIES, versionId: CITIES_V1 }],
    });
    await args.save();

    const [, input] = api.createArgumentSet.mock.calls[0];
    expect(input.tupleBindings[0].tupleSetVersions).toEqual([CITIES_V1]);
  });

  /*
   * Dropping the source would produce a set that saves, runs, and answers with
   * rows the author never asked for — the failure the whole reference model
   * exists to prevent.
   */
  it('refuses the save when a reference has no version to pin to', async () => {
    tupleSets.currentVersionIdOf.mockReturnValue(null);
    const args = composableWithScratch({ tupleSetRefs: [{ tupleSetId: CITIES }] });

    expect(await args.save()).toBe(false);
    expect(api.createArgumentSet).not.toHaveBeenCalled();
    expect(args.error.value).toContain('no saved version');
  });

  it('loads the library’s tuple sets before resolving, so the pin can be found', async () => {
    const args = composableWithScratch({ tupleSetRefs: [{ tupleSetId: CITIES }] });
    await args.save();

    expect(tupleSets.resolveReferences)
      .toHaveBeenCalledWith([{ tupleSetId: CITIES }], LIBRARY);
  });
});
