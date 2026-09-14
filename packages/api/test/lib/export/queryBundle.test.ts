import { describe, expect, it } from 'vitest';
import { fromBundle, verifyBundleIntegrity, iri, literal } from '@sparql-query-lib/runtime';
import { SparqlQueryParser } from '../../../src/lib/parser.js';
import {
  buildExportBundle,
  QueryExportError,
  slugify,
} from '../../../src/lib/export/queryBundle.js';

const LIBRARY = { id: 'urn:sqlib:library:test', name: 'Test' };

const PEOPLE_BY_CITY = `
PREFIX ex: <http://example.org/>
SELECT ?name WHERE {
  VALUES (?city) { (UNDEF) }
  ?person ex:livesIn ?city ; ex:name ?name .
}`;

const PAGED = `
SELECT ?s WHERE {
  VALUES (?type) { (UNDEF) }
  ?s a ?type .
}
LIMIT 0001 OFFSET 0002`;

async function bundleOf(queries: Array<{ name: string; queryString: string }>) {
  return buildExportBundle({ library: LIBRARY, queries, generatedAt: '2026-08-25T00:00:00.000Z' });
}

describe('buildExportBundle', () => {
  it('compiles a parameterised query into a runnable bundle', async () => {
    const bundle = await bundleOf([{ name: 'People by city', queryString: PEOPLE_BY_CITY }]);

    expect(Object.keys(bundle.queries)).toEqual(['people-by-city']);
    const query = bundle.queries['people-by-city'];
    expect(query.queryType).toBe('SELECT');
    expect(query.inferredInputs).toEqual([['city']]);
    expect(query.template.slots).toHaveLength(1);
    await expect(verifyBundleIntegrity(bundle)).resolves.toBeUndefined();
  });

  it('records the page parameters the query declares', async () => {
    const bundle = await bundleOf([{ name: 'Paged', queryString: PAGED }]);
    expect(bundle.queries.paged.limitParameters).toEqual(['1']);
    expect(bundle.queries.paged.offsetParameters).toEqual(['2']);
  });

  describe('page parameters, which the generator would otherwise erase', () => {
    it('records where each placeholder landed in the compiled text', async () => {
      const bundle = await bundleOf([{ name: 'Paged', queryString: PAGED }]);
      const query = bundle.queries.paged;

      expect(query.pageParameters).toEqual([
        { name: '1', kind: 'limit', start: expect.any(Number), end: expect.any(Number) },
        { name: '2', kind: 'offset', start: expect.any(Number), end: expect.any(Number) },
      ]);
      for (const span of query.pageParameters!) {
        // The span must cover the placeholder as written, not the `LIMIT 1` the
        // generator would have produced from it.
        expect(query.template.text.slice(span.start, span.end)).toBe(
          `${span.kind === 'limit' ? 'LIMIT' : 'OFFSET'} 000${span.name}`,
        );
      }
    });

    it('locates every occurrence of a repeated parameter', async () => {
      const bundle = await bundleOf([
        {
          name: 'Twice',
          queryString: `
            SELECT * WHERE {
              { SELECT ?s WHERE { ?s ?p ?o } LIMIT 0001 }
              UNION
              { SELECT ?s WHERE { ?s ?q ?r } LIMIT 0001 }
            }`,
        },
      ]);
      expect(bundle.queries.twice.pageParameters).toHaveLength(2);
    });

    it('refuses to guess when a sentinel collides with a literal in the query', async () => {
      // The compile-time trick substitutes a large integer for the placeholder;
      // a query that already pages by that number would make the two
      // indistinguishable, so the export stops rather than mislocating it.
      await expect(
        bundleOf([
          {
            name: 'Collides',
            queryString: `
              SELECT * WHERE {
                { SELECT ?s WHERE { ?s ?p ?o } LIMIT 2000000000 }
                UNION
                { SELECT ?s WHERE { ?s ?q ?r } LIMIT 0001 }
              }`,
          },
        ]),
      ).rejects.toThrow(/could not be located unambiguously/);
    });

    it('leaves an unsupplied parameter as the API leaves it', async () => {
      const bundle = await bundleOf([{ name: 'Paged', queryString: PAGED }]);
      const text = fromBundle(JSON.parse(JSON.stringify(bundle)))
        .query('paged')
        .text({
          arguments: [
            { head: { vars: ['type'] }, arguments: { bindings: [{ type: iri('http://e/T') }] } },
          ],
          limits: { 1: 5 },
        });
      expect(text).toContain('LIMIT 5');
      expect(text).toContain('OFFSET 0002');
    });
  });

  it('carries a query with no parameters at all', async () => {
    const bundle = await bundleOf([
      { name: 'Everything', queryString: 'SELECT * WHERE { ?s ?p ?o }' },
    ]);
    expect(bundle.queries.everything.inferredInputs).toEqual([]);
    expect(bundle.queries.everything.template.slots).toEqual([]);
  });

  it.each([
    ['CONSTRUCT', 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', 'CONSTRUCT'],
    ['ASK', 'ASK { ?s ?p ?o }', 'ASK'],
    ['DESCRIBE', 'DESCRIBE <http://example.org/a>', 'DESCRIBE'],
  ])('exports a %s query', async (_label, queryString, expected) => {
    const bundle = await bundleOf([{ name: 'q', queryString }]);
    expect(bundle.queries.q.queryType).toBe(expected);
  });

  it('refuses an update, which a bundle has no authorization to run', async () => {
    await expect(
      bundleOf([
        { name: 'Wipe', queryString: 'DELETE WHERE { ?s ?p ?o }' },
      ]),
    ).rejects.toThrow(QueryExportError);
  });

  it('names the query that could not be parsed', async () => {
    await expect(bundleOf([{ name: 'Broken', queryString: 'SELECT ?s WHERE {' }])).rejects.toThrow(
      /Query 'Broken' could not be parsed/,
    );
  });

  it('keeps colliding names apart rather than overwriting one', async () => {
    const bundle = await bundleOf([
      { name: 'People by city', queryString: PEOPLE_BY_CITY },
      { name: 'people by CITY', queryString: PEOPLE_BY_CITY },
    ]);
    expect(Object.keys(bundle.queries).sort()).toEqual(['people-by-city', 'people-by-city-2']);
  });

  it('records provenance without letting it reach the runtime', async () => {
    const bundle = await buildExportBundle({
      library: LIBRARY,
      queries: [
        {
          name: 'People by city',
          queryString: PEOPLE_BY_CITY,
          sourceVersion: 'urn:sqlib:query-version:1',
          description: 'People living in a city',
        },
      ],
      tags: ['urn:sqlib:tag:public'],
    });
    expect(bundle.queries['people-by-city'].sourceVersion).toBe('urn:sqlib:query-version:1');
    expect(bundle.tags).toEqual(['urn:sqlib:tag:public']);
  });
});

describe('slugify', () => {
  it.each([
    ['People by city', 'people-by-city'],
    ['  Spaces   everywhere  ', 'spaces-everywhere'],
    ['Ünïcödé näme', 'unicode-name'],
    ['!!!', 'query'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

/**
 * The contract this whole path rests on: what the exported runtime produces is
 * what the server would have produced.
 *
 * Both sides call `applyTemplateArguments`, so this is not testing the
 * substitution twice — it is testing the *export pipeline*: that the template
 * written into the bundle is the template the parser compiled, that the spans
 * survived JSON, and that the signature the bundle advertises is the one the
 * query actually has.
 */
describe('exported bundles substitute exactly as the API does', () => {
  const parser = new SparqlQueryParser();

  const cases: Array<{
    label: string;
    queryString: string;
    argumentSets: Array<{ head: { vars: string[] }; arguments: { bindings: unknown[] } }>;
  }> = [
    {
      label: 'a single IRI argument',
      queryString: PEOPLE_BY_CITY,
      argumentSets: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: iri('http://example.org/Perth') }] },
        },
      ],
    },
    {
      label: 'multiple rows',
      queryString: PEOPLE_BY_CITY,
      argumentSets: [
        {
          head: { vars: ['city'] },
          arguments: {
            bindings: [
              { city: iri('http://example.org/Perth') },
              { city: iri('http://example.org/Darwin') },
            ],
          },
        },
      ],
    },
    {
      label: 'a hostile literal',
      queryString: PEOPLE_BY_CITY,
      argumentSets: [
        {
          head: { vars: ['city'] },
          arguments: {
            bindings: [{ city: literal('x" } } INSERT DATA { <http://evil> <http://p> "x" } #') }],
          },
        },
      ],
    },
    {
      label: 'a language-tagged literal',
      queryString: PEOPLE_BY_CITY,
      argumentSets: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: literal('Perth', { lang: 'en-AU' }) }] },
        },
      ],
    },
    {
      label: 'a datatyped literal',
      queryString: PEOPLE_BY_CITY,
      argumentSets: [
        {
          head: { vars: ['city'] },
          arguments: {
            bindings: [
              { city: literal('42', { datatype: 'http://www.w3.org/2001/XMLSchema#integer' }) },
            ],
          },
        },
      ],
    },
    {
      label: 'two slots',
      queryString: `
        SELECT * WHERE {
          VALUES (?a) { (UNDEF) }
          VALUES (?b ?c) { (UNDEF UNDEF) }
          ?a ?b ?c .
        }`,
      argumentSets: [
        { head: { vars: ['a'] }, arguments: { bindings: [{ a: iri('http://example.org/a') }] } },
        {
          head: { vars: ['b', 'c'] },
          arguments: {
            bindings: [{ b: iri('http://example.org/b'), c: literal('c') }, { b: null, c: literal('d') }],
          },
        },
      ],
    },
  ];

  it.each(cases)('$label', async ({ queryString, argumentSets }) => {
    const bundle = await bundleOf([{ name: 'q', queryString }]);
    // A real round trip through JSON: the bundle a browser gets is parsed text,
    // not the object we built.
    const roundTripped = JSON.parse(JSON.stringify(bundle));

    const fromRuntime = fromBundle(roundTripped).query('q').text({ arguments: argumentSets });
    const fromServer = parser.applyArguments(queryString, argumentSets as never);

    expect(fromRuntime).toBe(fromServer);
  });

  it('agrees on page parameters too', async () => {
    const bundle = await bundleOf([{ name: 'paged', queryString: PAGED }]);
    const argumentSets = [
      { head: { vars: ['type'] }, arguments: { bindings: [{ type: iri('http://example.org/T') }] } },
    ];

    const fromRuntime = fromBundle(JSON.parse(JSON.stringify(bundle)))
      .query('paged')
      .text({ arguments: argumentSets, limits: { 1: 25 }, offsets: { 2: 50 } });

    const fromServer = parser.applyArguments(
      parser.applyLimitOffsetParameters(PAGED, [{ name: '1', value: 25 }], [{ name: '2', value: 50 }]),
      argumentSets as never,
    );

    expect(fromRuntime).toBe(fromServer);
  });
});
