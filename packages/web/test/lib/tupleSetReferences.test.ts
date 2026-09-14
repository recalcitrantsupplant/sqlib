/**
 * The pin a save puts on a tuple set reference (issue #209, design §7.2).
 *
 * Two properties carry the whole feature and both are the kind that fail
 * silently. First, a save must resolve every floating reference: one dropped
 * from the body produces an argument set that runs happily and returns the
 * wrong rows. Second, a save must *not* move a pin that is already there — that
 * is what "saved = reproducible" means, and an automatic bump would make every
 * saved set track the library instead of recording it.
 */
import { describe, it, expect } from 'vitest';
import {
  isFloating,
  pinBindings,
  referenceKey,
  referencesOf,
  sameReference,
  withReference,
  withRepinnedReference,
  withoutReference,
} from '@/lib/tupleSetReferences';
import type { ArgumentTupleBinding } from '@/types/argument-sets';

const CITIES = 'urn:sqlib:tupleSet:cities';
const CITIES_V1 = 'urn:sqlib:tupleSetVersion:cities-1';
const CITIES_V2 = 'urn:sqlib:tupleSetVersion:cities-2';
const COUNTRIES = 'urn:sqlib:tupleSet:countries';
const COUNTRIES_V1 = 'urn:sqlib:tupleSetVersion:countries-1';

function binding(overrides: Partial<ArgumentTupleBinding> = {}): ArgumentTupleBinding {
  return { tupleSignature: 'city', variables: ['city'], rows: [], ...overrides };
}

const currentVersions: Record<string, string | null> = {
  [CITIES]: CITIES_V2,
  [COUNTRIES]: COUNTRIES_V1,
};
const currentVersionOf = (setId: string) => currentVersions[setId] ?? null;

describe('reading the references off a binding', () => {
  it('reads the wire field when the editor has not touched the binding', () => {
    expect(referencesOf(binding({ tupleSetVersions: [CITIES_V1] })))
      .toEqual([{ versionId: CITIES_V1 }]);
  });

  it('prefers the editor field, which is the one that knows the set', () => {
    const held = binding({
      tupleSetVersions: [CITIES_V1],
      tupleSetRefs: [{ tupleSetId: CITIES, versionId: CITIES_V1 }],
    });
    expect(referencesOf(held)).toEqual([{ tupleSetId: CITIES, versionId: CITIES_V1 }]);
  });

  it('reads an emptied list as empty rather than falling back to the wire', () => {
    // Removing the last reference has to survive the round trip: falling back
    // to `tupleSetVersions` here would resurrect what was just unlinked.
    expect(referencesOf(binding({ tupleSetVersions: [CITIES_V1], tupleSetRefs: [] }))).toEqual([]);
  });

  it('calls a reference with no version floating', () => {
    expect(isFloating({ tupleSetId: CITIES })).toBe(true);
    expect(isFloating({ tupleSetId: CITIES, versionId: CITIES_V1 })).toBe(false);
  });

  it('keys the two halves apart', () => {
    expect(referenceKey({ tupleSetId: CITIES })).not.toBe(referenceKey({ versionId: CITIES }));
    expect(sameReference({ tupleSetId: CITIES }, { tupleSetId: CITIES, versionId: null })).toBe(true);
    expect(sameReference({ tupleSetId: CITIES }, { tupleSetId: CITIES, versionId: CITIES_V1 }))
      .toBe(false);
  });
});

describe('adding and removing references', () => {
  it('adds one without disturbing the rows typed beside it', () => {
    const rows = [{ values: { city: { type: 'uri' as const, value: 'urn:paris' } } }];
    const next = withReference(binding({ rows }), { tupleSetId: CITIES });
    expect(next.tupleSetRefs).toEqual([{ tupleSetId: CITIES }]);
    expect(next.rows).toBe(rows);
  });

  it('refuses the same reference twice — duplicated rows, not a duplicated chip', () => {
    const once = withReference(binding(), { tupleSetId: CITIES });
    expect(withReference(once, { tupleSetId: CITIES })).toBe(once);
  });

  it('lets one set be linked floating and pinned at once, which are different sources', () => {
    const both = withReference(
      withReference(binding(), { tupleSetId: CITIES }),
      { tupleSetId: CITIES, versionId: CITIES_V1 },
    );
    expect(both.tupleSetRefs).toHaveLength(2);
  });

  it('removes only the reference named', () => {
    const held = binding({ tupleSetRefs: [{ tupleSetId: CITIES }, { tupleSetId: COUNTRIES }] });
    expect(withoutReference(held, { tupleSetId: CITIES }).tupleSetRefs)
      .toEqual([{ tupleSetId: COUNTRIES }]);
  });

  it('re-points a pin on request, and leaves the others alone', () => {
    const held = binding({
      tupleSetRefs: [
        { tupleSetId: CITIES, versionId: CITIES_V1 },
        { tupleSetId: COUNTRIES, versionId: COUNTRIES_V1 },
      ],
    });
    const next = withRepinnedReference(held, { tupleSetId: CITIES, versionId: CITIES_V1 }, CITIES_V2);
    expect(next.tupleSetRefs).toEqual([
      { tupleSetId: CITIES, versionId: CITIES_V2 },
      { tupleSetId: COUNTRIES, versionId: COUNTRIES_V1 },
    ]);
  });
});

describe('pinning for a save', () => {
  it('resolves a floating reference to the version current at save time', () => {
    const { bindings, unresolved } = pinBindings(
      [binding({ tupleSetRefs: [{ tupleSetId: CITIES }] })],
      currentVersionOf,
    );
    expect(bindings[0].tupleSetVersions).toEqual([CITIES_V2]);
    expect(unresolved).toEqual([]);
  });

  it('leaves an existing pin where it is, however far the set has moved', () => {
    const { bindings } = pinBindings(
      [binding({ tupleSetRefs: [{ tupleSetId: CITIES, versionId: CITIES_V1 }] })],
      currentVersionOf,
    );
    expect(bindings[0].tupleSetVersions).toEqual([CITIES_V1]);
  });

  it('reports a reference it cannot pin rather than dropping it from the save', () => {
    const { bindings, unresolved } = pinBindings(
      [binding({ tupleSetRefs: [{ tupleSetId: 'urn:sqlib:tupleSet:empty' }] })],
      currentVersionOf,
    );
    expect(unresolved).toEqual([{ tupleSetId: 'urn:sqlib:tupleSet:empty' }]);
    expect(bindings[0].tupleSetVersions).toBeUndefined();
  });

  it('collapses two references that resolve to one version', () => {
    const { bindings } = pinBindings(
      [binding({
        tupleSetRefs: [{ tupleSetId: CITIES }, { tupleSetId: CITIES, versionId: CITIES_V2 }],
      })],
      currentVersionOf,
    );
    expect(bindings[0].tupleSetVersions).toEqual([CITIES_V2]);
  });

  /**
   * `argumentTupleBindingSchema` is `additionalProperties: false`, so an
   * editor-only field on the body is a 400 rather than something the server
   * quietly ignores.
   */
  it('sends nothing the wire schema would refuse', () => {
    const { bindings } = pinBindings(
      [binding({ id: 'urn:sqlib:argumentTupleBinding:b1', tupleSetRefs: [{ tupleSetId: CITIES }] })],
      currentVersionOf,
    );
    expect(Object.keys(bindings[0]).sort())
      .toEqual(['id', 'rows', 'tupleSetVersions', 'tupleSignature', 'variables']);
  });

  it('omits the field entirely on a clause with no references', () => {
    const { bindings } = pinBindings([binding()], currentVersionOf);
    expect('tupleSetVersions' in bindings[0]).toBe(false);
  });

  it('carries a saved binding’s pins through a re-save untouched', () => {
    const { bindings } = pinBindings(
      [binding({ tupleSetVersions: [CITIES_V1, COUNTRIES_V1] })],
      currentVersionOf,
    );
    expect(bindings[0].tupleSetVersions).toEqual([CITIES_V1, COUNTRIES_V1]);
  });
});
