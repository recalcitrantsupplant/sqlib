import { describe, expect, it } from 'vitest';
import { assignArgumentSets } from '../src/query-template.js';
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
  results: { bindings: [{ [name]: literal(value) }] },
});

describe('assignArgumentSets', () => {
  it('keeps an order that already matches', () => {
    const sets = [set('term', 'a'), set('facetField', 'b')];
    expect(assignArgumentSets([['term'], ['facetField']], sets)).toEqual({ slots: sets, unmatched: [] });
  });

  it('reorders sets that arrived under a different order', () => {
    const [facet, term] = [set('facetField', 'b'), set('term', 'a')];
    expect(assignArgumentSets([['term'], ['facetField']], [facet, term]).slots).toEqual([term, facet]);
  });

  it('matches on the set of variables, not the order within one head', () => {
    const pair = {
      head: { vars: ['b', 'a'] },
      results: { bindings: [{ a: literal('1'), b: literal('2') }] },
    };
    expect(assignArgumentSets([['a', 'b']], [pair]).slots).toEqual([pair]);
  });

  it('leaves two slots of the same signature in the order they came', () => {
    // Nothing distinguishes them, so position is the only signal there is.
    const first = { head: { vars: ['x'] }, results: { bindings: [{ x: literal('1') }] } };
    const second = { head: { vars: ['x'] }, results: { bindings: [{ x: literal('2') }] } };
    expect(assignArgumentSets([['x'], ['x']], [first, second]).slots).toEqual([first, second]);
  });

  it('leaves a slot nobody names empty, and returns the set that fits nothing', () => {
    const other = set('other', 'b');
    expect(assignArgumentSets([['term'], ['facetField']], [set('term', 'a'), other])).toEqual({
      slots: [set('term', 'a'), undefined],
      unmatched: [other],
    });
  });

  it('treats an omitted slot as unassigned rather than an error', () => {
    expect(assignArgumentSets([['term'], ['facetField']], [set('facetField', 'a')])).toEqual({
      slots: [undefined, set('facetField', 'a')],
      unmatched: [],
    });
  });

  it('never assigns a set with no head, rather than guessing which slot it fills', () => {
    const headless = { results: { bindings: [] } } as never;
    expect(assignArgumentSets([['term']], [headless])).toEqual({ slots: [undefined], unmatched: [headless] });
  });
});

describe('substitution with out-of-order arguments', () => {
  it('fills each slot from the set that names it', async () => {
    const lib = fromBundle(await bundleOf({ facets: TWO_SLOT() }));
    const text = lib.query('facets').text({
      arguments: [
        { head: { vars: ['facetField'] }, results: { bindings: [{ facetField: literal('type') }] } },
        { head: { vars: ['term'] }, results: { bindings: [{ term: literal('wool') }] } },
      ],
    });
    expect(text).toContain('VALUES ?term { "wool" }');
    expect(text).toContain('VALUES ?facetField { "type" }');
  });

  it('runs a slot the payload leaves out without its filter', async () => {
    const lib = fromBundle(await bundleOf({ facets: TWO_SLOT() }));
    const text = lib.query('facets').text({
      arguments: [{ head: { vars: ['facetField'] }, results: { bindings: [{ facetField: literal('type') }] } }],
    });
    expect(text).not.toContain('?term {');
    expect(text).toContain('VALUES ?facetField { "type" }');
  });

  it('refuses an argument that fits no slot, naming what the query declares', async () => {
    const lib = fromBundle(await bundleOf({ facets: TWO_SLOT() }));
    expect(() =>
      lib.query('facets').text({
        arguments: [
          { head: { vars: ['term'] }, results: { bindings: [{ term: literal('wool') }] } },
          { head: { vars: ['nope'] }, results: { bindings: [{ nope: iri('http://x/') }] } },
        ],
      }),
    ).toThrow(/Argument \[nope\] matches no VALUES parameter left to fill\. The query declares \[term\], \[facetField\]/);
  });
});
