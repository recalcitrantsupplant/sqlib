import { describe, it, expect } from 'vitest';
import {
  parseTupleContent,
  readStoredTupleContent,
  looksLikeResultsTsv,
  suggestColumnTypes,
  applyColumnTypes,
  TupleContentError,
} from '../../src/lib/tupleContent.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('parseTupleContent — untyped sources', () => {
  it('reads CSV as plain string literals', () => {
    const parsed = parseTupleContent('city,pop\nPerth,2100000\nHobart,250000\n', 'csv');

    expect(parsed.columns).toEqual(['city', 'pop']);
    expect(parsed.rowCount).toBe(2);
    // 2100000 stays a string: a CSV does not say it is a number, and guessing
    // is an import-time enhancement the user opts into.
    expect(parsed.document.results.bindings[0]).toEqual({
      city: { type: 'literal', value: 'Perth' },
      pop: { type: 'literal', value: '2100000' },
    });
  });

  it('honours RFC 4180 quoting, including embedded delimiters and quotes', () => {
    const parsed = parseTupleContent('name,note\n"Perth, WA","say ""hi"""\n', 'csv');

    expect(parsed.document.results.bindings[0]).toEqual({
      name: { type: 'literal', value: 'Perth, WA' },
      note: { type: 'literal', value: 'say "hi"' },
    });
  });

  it('reads plain TSV the same way', () => {
    const parsed = parseTupleContent('city\tpop\nPerth\t2100000\n', 'tsv');
    expect(parsed.document.results.bindings[0].pop).toEqual({
      type: 'literal',
      value: '2100000',
    });
  });

  it('treats an empty cell as UNDEF — an absent key, not an empty literal', () => {
    const parsed = parseTupleContent('city,pop\nPerth,\n', 'csv');
    expect(parsed.document.results.bindings[0]).toEqual({
      city: { type: 'literal', value: 'Perth' },
    });
    expect('pop' in parsed.document.results.bindings[0]).toBe(false);
  });

  it('strips a leading ? from header names', () => {
    expect(parseTupleContent('?city\nPerth\n', 'csv').columns).toEqual(['city']);
  });

  it('rejects a ragged row rather than padding it', () => {
    expect(() => parseTupleContent('a,b\n1\n', 'csv')).toThrow(TupleContentError);
  });

  it('keeps an interior blank line so it is reported, not silently dropped', () => {
    // Dropping it would also shift every later line number in error messages.
    expect(() => parseTupleContent('a,b\n1,2\n\n3,4\n', 'csv')).toThrow(/Line 3 has 1 cells/);
  });

  it('rejects duplicate and empty column names', () => {
    expect(() => parseTupleContent('a,a\n1,2\n', 'csv')).toThrow(/repeats the column/);
    expect(() => parseTupleContent('a,\n1,2\n', 'csv')).toThrow(/unnamed column/);
  });
});

describe('parseTupleContent — SPARQL Results TSV', () => {
  it('reads full term syntax', () => {
    const text = [
      '?s\t?label\t?n\t?lang',
      '<http://ex/a>\t"plain"\t"7"^^<http://www.w3.org/2001/XMLSchema#integer>\t"bonjour"@fr',
    ].join('\n');
    const parsed = parseTupleContent(text, 'sparql-results-tsv');

    expect(parsed.document.results.bindings[0]).toEqual({
      s: { type: 'uri', value: 'http://ex/a' },
      label: { type: 'literal', value: 'plain' },
      n: { type: 'literal', value: '7', datatype: `${XSD}integer` },
      lang: { type: 'literal', value: 'bonjour', 'xml:lang': 'fr' },
    });
  });

  it('reads numeric and boolean shorthands', () => {
    const parsed = parseTupleContent('?i\t?d\t?b\n42\t1.5\ttrue', 'sparql-results-tsv');
    expect(parsed.document.results.bindings[0]).toEqual({
      i: { type: 'literal', value: '42', datatype: `${XSD}integer` },
      d: { type: 'literal', value: '1.5', datatype: `${XSD}decimal` },
      b: { type: 'literal', value: 'true', datatype: `${XSD}boolean` },
    });
  });

  it('drops an explicit xsd:string, which is a plain literal in RDF 1.1', () => {
    const parsed = parseTupleContent(
      `?s\n"x"^^<${XSD}string>`,
      'sparql-results-tsv',
    );
    expect(parsed.document.results.bindings[0].s).toEqual({ type: 'literal', value: 'x' });
  });

  it('errors on a cell it cannot read as a term, rather than falling back to a string', () => {
    // The whole point of choosing this format over plain TSV is that it declares
    // types; a silent degradation would make a typo look like data.
    expect(() => parseTupleContent('?s\nnot a term', 'sparql-results-tsv')).toThrow(
      /Cannot read "not a term"/,
    );
  });

  it('names the column and line in the error', () => {
    expect(() => parseTupleContent('?a\t?b\n<http://ex/x>\toops', 'sparql-results-tsv')).toThrow(
      /column "b" on line 2/,
    );
  });

  it('rejects blank nodes', () => {
    expect(() => parseTupleContent('?s\n_:b1', 'sparql-results-tsv')).toThrow(/Blank node/);
  });

  it('keeps an all-UNDEF row, which is a line of nothing but tabs', () => {
    // A legitimate row: every cell UNDEF. Filtering whitespace-only lines lost
    // it and under-reported rowCount.
    const parsed = parseTupleContent('?a\t?b\n<http://ex/x>\t1\n\t\n', 'sparql-results-tsv');
    expect(parsed.rowCount).toBe(2);
    expect(parsed.document.results.bindings[1]).toEqual({});
  });

  it('reports the true source line after a blank one', () => {
    expect(() => parseTupleContent('?a\n<http://ex/x>\n\noops\n', 'sparql-results-tsv')).toThrow(
      /on line 4/,
    );
  });

  it('unescapes a quoted literal', () => {
    const parsed = parseTupleContent('?s\n"a\\tb"', 'sparql-results-tsv');
    expect(parsed.document.results.bindings[0].s.value).toBe('a\tb');
  });
});

describe('parseTupleContent — SPARQL Results JSON', () => {
  const doc = JSON.stringify({
    head: { vars: ['city'] },
    results: { bindings: [{ city: { type: 'literal', value: 'Perth' } }] },
  });

  it('validates and keeps the document', () => {
    const parsed = parseTupleContent(doc, 'sparql-results-json');
    expect(parsed.columns).toEqual(['city']);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.document.results.bindings[0].city.value).toBe('Perth');
  });

  it('accepts a query result verbatim, dropping members a tuple set has no use for', () => {
    const withExtras = JSON.stringify({
      head: { vars: ['city'], link: [] },
      results: { bindings: [{ city: { type: 'literal', value: 'Perth' } }] },
      boolean: true,
    });
    const parsed = parseTupleContent(withExtras, 'query-results');
    expect(JSON.parse(parsed.contentString)).toEqual({
      head: { vars: ['city'] },
      results: { bindings: [{ city: { type: 'literal', value: 'Perth' } }] },
    });
  });

  it('rejects blank nodes', () => {
    const bnode = JSON.stringify({
      head: { vars: ['s'] },
      results: { bindings: [{ s: { type: 'bnode', value: 'b1' } }] },
    });
    expect(() => parseTupleContent(bnode, 'sparql-results-json')).toThrow(/Blank node/);
  });

  it('rejects a binding for a variable absent from head.vars', () => {
    const stray = JSON.stringify({
      head: { vars: ['a'] },
      results: { bindings: [{ b: { type: 'literal', value: 'x' } }] },
    });
    expect(() => parseTupleContent(stray, 'sparql-results-json')).toThrow(/not in head\.vars/);
  });

  it('rejects malformed JSON and missing members with a usable message', () => {
    expect(() => parseTupleContent('{', 'sparql-results-json')).toThrow(/not valid JSON/);
    expect(() => parseTupleContent('{}', 'sparql-results-json')).toThrow(/head\.vars/);
    expect(() => parseTupleContent('{"head":{"vars":["a"]}}', 'sparql-results-json')).toThrow(
      /results\.bindings/,
    );
  });
});

describe('round trip', () => {
  it('reads back what it stored, whatever the source format was', () => {
    // The invariant that makes a pinned version reproducible: interpretation
    // happens once, at import.
    const parsed = parseTupleContent('?s\t?n\n<http://ex/a>\t42', 'sparql-results-tsv');
    expect(readStoredTupleContent(parsed.contentString)).toEqual(parsed.document);
  });

  it('reports byteSize of the stored string, not the source', () => {
    const parsed = parseTupleContent('city\nPerth\n', 'csv');
    expect(parsed.byteSize).toBe(Buffer.byteLength(parsed.contentString, 'utf8'));
  });
});

describe('suggestColumnTypes', () => {
  it('proposes xsd:integer when every value in a plain column is an integer', () => {
    const parsed = parseTupleContent('city,pop\nPerth,2100000\nHobart,250000\n', 'csv');
    expect(suggestColumnTypes(parsed.document)).toEqual([{ column: 'pop', suggested: 'xsd:integer' }]);
  });

  it('proposes xsd:date for ISO date strings', () => {
    const parsed = parseTupleContent('event,when\nLaunch,2026-08-22\nReview,2026-09-01\n', 'csv');
    expect(suggestColumnTypes(parsed.document)).toEqual([{ column: 'when', suggested: 'xsd:date' }]);
  });

  it('proposes uri for absolute-URI-shaped strings', () => {
    const parsed = parseTupleContent(
      'label,homepage\nPerth,http://example.org/perth\nHobart,http://example.org/hobart\n',
      'csv',
    );
    expect(suggestColumnTypes(parsed.document)).toEqual([{ column: 'homepage', suggested: 'uri' }]);
  });

  it('makes no suggestion when the column already carries a type', () => {
    // sparql-results-tsv already read this column as typed terms; auto-suggest
    // is only for columns still holding plain strings.
    const parsed = parseTupleContent('?n\n42\n7', 'sparql-results-tsv');
    expect(suggestColumnTypes(parsed.document)).toEqual([]);
  });

  it('makes no suggestion when one value in the column does not fit', () => {
    const parsed = parseTupleContent('n\n42\nnot-a-number\n', 'csv');
    expect(suggestColumnTypes(parsed.document)).toEqual([]);
  });

  it('makes no suggestion for a column that is entirely UNDEF', () => {
    const parsed = parseTupleContent('a,b\n1,\n2,\n', 'csv');
    const suggestions = suggestColumnTypes(parsed.document);
    expect(suggestions.find(s => s.column === 'b')).toBeUndefined();
  });

  it('leaves an ordinary string column unsuggested', () => {
    const parsed = parseTupleContent('city\nPerth\nHobart\n', 'csv');
    expect(suggestColumnTypes(parsed.document)).toEqual([]);
  });
});

describe('applyColumnTypes', () => {
  it('promotes accepted columns and leaves the rest as plain strings', () => {
    const parsed = parseTupleContent('city,pop\nPerth,2100000\n', 'csv');
    const typed = applyColumnTypes(parsed, { pop: 'xsd:integer' });

    expect(typed.document.results.bindings[0]).toEqual({
      city: { type: 'literal', value: 'Perth' },
      pop: { type: 'literal', value: '2100000', datatype: `${XSD}integer` },
    });
    // columns and rowCount are unchanged — only the terms' shape moved.
    expect(typed.columns).toEqual(parsed.columns);
    expect(typed.rowCount).toBe(parsed.rowCount);
    expect(typed.byteSize).toBe(Buffer.byteLength(typed.contentString, 'utf8'));
  });

  it('promotes a column to uri', () => {
    const parsed = parseTupleContent('homepage\nhttp://example.org/perth\n', 'csv');
    const typed = applyColumnTypes(parsed, { homepage: 'uri' });
    expect(typed.document.results.bindings[0].homepage).toEqual({
      type: 'uri',
      value: 'http://example.org/perth',
    });
  });

  it('leaves an UNDEF cell as UNDEF rather than inventing a value', () => {
    // The interior blank line is a genuine UNDEF row; a trailing one would be
    // dropped rather than parsed, so a further row follows it.
    const parsed = parseTupleContent('n\n42\n\n7\n', 'csv');
    const typed = applyColumnTypes(parsed, { n: 'xsd:integer' });
    expect('n' in typed.document.results.bindings[1]).toBe(false);
  });

  it('returns the input unchanged when nothing was accepted', () => {
    const parsed = parseTupleContent('city\nPerth\n', 'csv');
    expect(applyColumnTypes(parsed, {})).toBe(parsed);
  });

  it('rejects a column that is not part of this content', () => {
    const parsed = parseTupleContent('city\nPerth\n', 'csv');
    expect(() => applyColumnTypes(parsed, { pop: 'xsd:integer' })).toThrow(/not one of this content's columns/);
  });

  it('re-validates rather than trusting the accepted type, naming the row', () => {
    const parsed = parseTupleContent('n\n42\nnot-a-number\n', 'csv');
    expect(() => applyColumnTypes(parsed, { n: 'xsd:integer' })).toThrow(
      /"not-a-number" in column "n", row 2/,
    );
  });

  it('refuses to apply a suggestion on top of a column that is already typed', () => {
    const parsed = parseTupleContent('?s\n<http://ex/a>', 'sparql-results-tsv');
    expect(() => applyColumnTypes(parsed, { s: 'xsd:integer' })).toThrow(/already carries a type/);
  });
});

describe('looksLikeResultsTsv', () => {
  it('recognises an all-?var header, and nothing else', () => {
    expect(looksLikeResultsTsv('?a\t?b\n<http://ex/x>\t1')).toBe(true);
    expect(looksLikeResultsTsv('a\tb\n1\t2')).toBe(false);
    // Mixed headers are not results-TSV; only a full match pre-selects it.
    expect(looksLikeResultsTsv('?a\tb\n1\t2')).toBe(false);
    expect(looksLikeResultsTsv('')).toBe(false);
  });
});
