import { describe, expect, it } from 'vitest';
import { alignArgumentSets } from '../src/query-template.js';
import { fromBundle, iri, literal } from '../src/library.js';
import { bundleOf, template } from './helpers.js';

/**
 * Argument sets name their slots; the order they arrive in is an accident.
 *
 * A saved argument set keeps the order its rows were written in, which need not
 * be the order the query declares its slots. Read positionally, a payload that
 * matches the query exactly is rejected as a "Variable mismatch" — which is what
 * happened to a real two-slot facet query whose stored set listed ?facetField
 * before ?term.
 */
const TWO_SLOT = () =>
  template(
    'SELECT ?f WHERE { «VALUES ?term { UNDEF }» «VALUES ?facetField { UNDEF }» ?s :p ?f }',
  );

const set = (name: string, value: string) => ({
  head: { vars: [name] },
  arguments: { bindings: [{ [name]: literal(value) }] },
});

describe('alignArgumentSets', () => {
  it('keeps an order that already matches', () => {
    const sets = [set('term', 'a'), set('facetField', 'b')];
    expect(alignArgumentSets([['term'], ['facetField']], sets)).toEqual(sets);
  });

  it('reorders sets that arrived under a different order', () => {
    const [facet, term] = [set('facetField', 'b'), set('term', 'a')];
    expect(alignArgumentSets([['term'], ['facetField']], [facet, term])).toEqual([term, facet]);
  });

  it('matches on the set of variables, not the order within one head', () => {
    const pair = {
      head: { vars: ['b', 'a'] },
      arguments: { bindings: [{ a: literal('1'), b: literal('2') }] },
    };
    expect(alignArgumentSets([['a', 'b']], [pair])).toEqual([pair]);
  });

  it('leaves two slots of the same signature in the order they came', () => {
    // Nothing distinguishes them, so position is the only signal there is.
    const first = { head: { vars: ['x'] }, arguments: { bindings: [{ x: literal('1') }] } };
    const second = { head: { vars: ['x'] }, arguments: { bindings: [{ x: literal('2') }] } };
    expect(alignArgumentSets([['x'], ['x']], [first, second])).toEqual([first, second]);
  });

  it('refuses when a slot has no set that names it', () => {
    expect(alignArgumentSets([['term'], ['facetField']], [set('term', 'a'), set('other', 'b')]))
      .toBeNull();
  });

  it('refuses when the counts differ, leaving the arity error to the caller', () => {
    expect(alignArgumentSets([['term'], ['facetField']], [set('term', 'a')])).toBeNull();
  });

  it('refuses a set with no head rather than guessing which slot it fills', () => {
    expect(alignArgumentSets([['term']], [{ arguments: { bindings: [] } } as never])).toBeNull();
  });
});

describe('substitution with out-of-order arguments', () => {
  it('fills each slot from the set that names it', async () => {
    const lib = fromBundle(await bundleOf({ facets: TWO_SLOT() }));
    const text = lib.query('facets').text({
      arguments: [
        { head: { vars: ['facetField'] }, arguments: { bindings: [{ facetField: literal('type') }] } },
        { head: { vars: ['term'] }, arguments: { bindings: [{ term: literal('wool') }] } },
      ],
    });
    expect(text).toContain('VALUES ?term { "wool" }');
    expect(text).toContain('VALUES ?facetField { "type" }');
  });

  it('still reports a genuine mismatch against the slot it belongs to', async () => {
    const lib = fromBundle(await bundleOf({ facets: TWO_SLOT() }));
    expect(() =>
      lib.query('facets').text({
        arguments: [
          { head: { vars: ['term'] }, arguments: { bindings: [{ term: literal('wool') }] } },
          { head: { vars: ['nope'] }, arguments: { bindings: [{ nope: iri('http://x/') }] } },
        ],
      }),
    ).toThrow(/Variable mismatch/);
  });
});
