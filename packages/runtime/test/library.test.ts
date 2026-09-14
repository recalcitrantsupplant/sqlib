import { describe, expect, it, vi } from 'vitest';
import { QueryCallError, fromBundle, iri, literal } from '../src/library.js';
import type { Executor } from '../src/executor.js';
import { bundleOf, exportedQuery, template } from './helpers.js';

const PEOPLE = () =>
  template('SELECT ?name WHERE { «VALUES ?city { UNDEF }» ?p :livesIn ?city ; :name ?name }');

async function library(executor?: Executor) {
  return fromBundle(await bundleOf({ people: PEOPLE() }), { executor });
}

describe('substitution', () => {
  it('splices bound rows into the parameter slot', async () => {
    const lib = await library();
    expect(
      lib.query('people').text({
        arguments: [{ bindings: [{ city: iri('http://example.org/Perth') }] }],
      }),
    ).toBe(
      'SELECT ?name WHERE { VALUES ?city { <http://example.org/Perth> } ?p :livesIn ?city ; :name ?name }',
    );
  });

  it('accepts the full wire form a /execute payload already uses', async () => {
    const lib = await library();
    const text = lib.query('people').text({
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: iri('http://example.org/Perth') }] },
        },
      ],
    });
    expect(text).toContain('VALUES ?city { <http://example.org/Perth> }');
  });

  it('drops an unconstrained slot entirely when no rows are supplied', async () => {
    const lib = await library();
    expect(lib.query('people').text({ arguments: [{ bindings: [{}] }] })).toBe(
      'SELECT ?name WHERE {  ?p :livesIn ?city ; :name ?name }',
    );
  });

  it('keeps a zero-row block when asked to propagate emptiness', async () => {
    const lib = await library();
    expect(
      lib.query('people').text({ arguments: [{ bindings: [], whenEmpty: 'propagateEmpty' }] }),
    ).toContain('VALUES ?city { }');
  });

  it('refuses a required input that arrived empty', async () => {
    const lib = await library();
    expect(() =>
      lib.query('people').text({ arguments: [{ bindings: [], whenEmpty: 'require' }] }),
    ).toThrow(/Required input/);
  });

  it('reports an argument count that does not match the query', async () => {
    const lib = await library();
    expect(() => lib.query('people').text({ arguments: [] })).toThrow(/1 UNDEF VALUES clauses/);
  });

  it('reads a null cell as UNDEF, the way a grid sends a blank', async () => {
    const bundle = await bundleOf({
      pairs: template('SELECT * { «VALUES( ?city ?year ){ ( UNDEF UNDEF ) }» ?s ?p ?o }'),
    });
    const text = fromBundle(bundle)
      .query('pairs')
      .text({
        arguments: [
          {
            bindings: [
              { city: iri('http://example.org/Perth'), year: null },
              { city: null, year: literal('2026') },
            ],
          },
        ],
      });
    // A partially bound row is legal — the blank cell is simply UNDEF. Only a row
    // that binds *nothing* is a wildcard, and that one cannot be mixed with rows.
    expect(text).toContain(
      'VALUES( ?city ?year ){ ( <http://example.org/Perth> UNDEF ) ( UNDEF "2026" ) }',
    );
  });

  it('reads a whole null row as the blank row a grid round-trip produces', async () => {
    const lib = await library();
    // `bindings: [null]` is what JSON gives back for a grid's empty row, and it
    // means what `[{}]` means: every declared cell UNDEF, so the slot goes.
    expect(lib.query('people').text({ arguments: [{ bindings: [null] }] })).toBe(
      lib.query('people').text({ arguments: [{ bindings: [{}] }] }),
    );
  });

  it('refuses a whole null row mixed with bound rows, as it refuses an empty one', async () => {
    const lib = await library();
    expect(() =>
      lib
        .query('people')
        .text({ arguments: [{ bindings: [null, { city: iri('http://e/Perth') }] }] }),
    ).toThrow(/all-UNDEF row cannot be mixed/);
  });

  it('accepts a frozen row array, which the short form promises not to mutate', async () => {
    const lib = await library();
    const bindings = Object.freeze([Object.freeze({ city: iri('http://example.org/Perth') })]);
    expect(lib.query('people').text({ arguments: [{ bindings }] })).toContain(
      'VALUES ?city { <http://example.org/Perth> }',
    );
  });

  it('refuses a wildcard row mixed with bound rows', async () => {
    const lib = await library();
    expect(() =>
      lib
        .query('people')
        .text({ arguments: [{ bindings: [{ city: null }, { city: iri('http://e/Perth') }] }] }),
    ).toThrow(/all-UNDEF row cannot be mixed/);
  });
});

describe('term safety', () => {
  it('escapes a literal that tries to close its own production', async () => {
    const lib = await library();
    const hostile = 'x" } } INSERT DATA { <http://evil> <http://p> "pwned" } #';
    const text = lib.query('people').text({ arguments: [{ bindings: [{ city: literal(hostile) }] }] });
    expect(text).toContain('"x\\" } } INSERT DATA { <http://evil> <http://p> \\"pwned\\" } #"');
    expect(text).not.toContain('INSERT DATA { <http://evil> <http://p> "pwned" }');
  });

  it('rejects an IRI carrying a character that would end the IRIREF', async () => {
    const lib = await library();
    expect(() =>
      lib
        .query('people')
        .text({ arguments: [{ bindings: [{ city: iri('http://e/a> <http://e/b') }] }] }),
    ).toThrow(/forbids in an IRIREF/);
  });

  it('rejects a language tag outside the LANGTAG production', async () => {
    const lib = await library();
    expect(() =>
      lib
        .query('people')
        .text({ arguments: [{ bindings: [{ city: literal('x', { lang: 'en"@x' }) }] }] }),
    ).toThrow(/Invalid language tag/);
  });
});

describe('page parameters', () => {
  it('substitutes LIMIT and OFFSET placeholders', async () => {
    const bundle = await bundleOf({
      paged: await exportedQuery(
        template('SELECT ?s WHERE { «VALUES ?s { UNDEF }» ?s ?p ?o } LIMIT 0001 OFFSET 0002'),
      ),
    });
    const text = fromBundle(bundle)
      .query('paged')
      .text({ arguments: [{ bindings: [{}] }], limits: { 1: 20 }, offsets: { 2: 40 } });
    expect(text).toContain('LIMIT 20 OFFSET 40');
  });

  it('keeps slot spans exact when a placeholder precedes the slot', async () => {
    // The regression this guards: replacing `LIMIT 0001` with `LIMIT 5` shortens
    // the text, so a slot recorded after it would splice four characters early.
    const bundle = await bundleOf({
      paged: await exportedQuery(
        template('SELECT * { { SELECT ?s { ?s ?p ?o } LIMIT 0001 } «VALUES ?city { UNDEF }» }'),
      ),
    });
    const text = fromBundle(bundle)
      .query('paged')
      .text({
        arguments: [{ bindings: [{ city: iri('http://example.org/Perth') }] }],
        limits: { 1: 5 },
      });
    expect(text).toBe(
      'SELECT * { { SELECT ?s { ?s ?p ?o } LIMIT 5 } VALUES ?city { <http://example.org/Perth> } }',
    );
  });

  it('never rewrites a placeholder that arrived inside caller data', async () => {
    // Page substitution runs before argument binding precisely so that a literal
    // whose text reads `LIMIT 0001` is data, not syntax.
    const bundle = await bundleOf({
      paged: await exportedQuery(
        template('SELECT * { «VALUES ?label { UNDEF }» ?s ?p ?label } LIMIT 0001'),
      ),
    });
    const text = fromBundle(bundle)
      .query('paged')
      .text({ arguments: [{ bindings: [{ label: literal('LIMIT 0001') }] }], limits: { 1: 9 } });
    expect(text).toContain('"LIMIT 0001"');
    expect(text).toMatch(/LIMIT 9$/);
  });
});

describe('running queries', () => {
  it('hands the substituted text and the query type to the executor', async () => {
    const execute = vi.fn().mockResolvedValue({ head: { vars: ['name'] }, results: { bindings: [] } });
    const lib = await library({ execute });
    await lib.query('people').select({ arguments: [{ bindings: [{ city: iri('http://e/Perth') }] }] });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        queryType: 'SELECT',
        queryText: expect.stringContaining('VALUES ?city { <http://e/Perth> }'),
      }),
    );
  });

  it('refuses to read a SELECT as an ASK', async () => {
    const lib = await library({ execute: vi.fn() });
    await expect(lib.query('people').ask()).rejects.toThrow(QueryCallError);
  });

  it('explains itself when no executor was configured', async () => {
    const lib = await library();
    await expect(lib.query('people').run({ arguments: [{ bindings: [{}] }] })).rejects.toThrow(
      /No executor is configured/,
    );
  });

  it('names the available queries when asked for one that is absent', async () => {
    const lib = await library();
    expect(() => lib.query('nope')).toThrow(/Available: people/);
  });

  it('exposes the call signature without reading spans', async () => {
    const lib = await library();
    expect(lib.query('people').signature()).toEqual({
      inputs: [['city']],
      limitParameters: [],
      offsetParameters: [],
    });
  });
});
