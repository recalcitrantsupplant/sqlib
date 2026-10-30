import { describe, it, expect } from 'vitest';
import {
  isSelectResults,
  negotiateSelectResultsFormat,
  renderSelectResults,
  toCsv,
  toTsv,
  toXml,
  type SelectResults,
} from '../../src/lib/sparqlResultsFormats.js';

const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

/** One row of each kind of term, and a row with an unbound variable. */
const results: SelectResults = {
  head: { vars: ['s', 'label', 'n'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/a' },
        label: { type: 'literal', value: 'Perth', 'xml:lang': 'en' },
        n: { type: 'literal', value: '42', datatype: XSD_INTEGER },
      },
      {
        s: { type: 'bnode', value: 'b0' },
        label: { type: 'literal', value: 'say "hi",\nthen\tgo' },
      },
    ],
  },
};

describe('negotiateSelectResultsFormat', () => {
  it.each([
    ['text/csv', 'text/csv'],
    ['text/tab-separated-values', 'text/tab-separated-values'],
    ['application/sparql-results+xml', 'application/sparql-results+xml'],
    ['application/sparql-results+json', 'application/sparql-results+json'],
    ['application/json', 'application/sparql-results+json'],
    ['text/tsv', 'text/tab-separated-values'],
    ['TEXT/CSV; charset=utf-8', 'text/csv'],
  ])('reads %s as %s', (header, expected) => {
    expect(negotiateSelectResultsFormat(header)).toBe(expected);
  });

  it('takes the highest q, then the order written', () => {
    expect(negotiateSelectResultsFormat('text/csv;q=0.5, application/sparql-results+xml')).toBe('application/sparql-results+xml');
    expect(negotiateSelectResultsFormat('text/tab-separated-values, text/csv')).toBe('text/tab-separated-values');
  });

  it('skips a type refused with q=0', () => {
    expect(negotiateSelectResultsFormat('text/csv;q=0, text/tab-separated-values;q=0.1')).toBe('text/tab-separated-values');
  });

  it.each([undefined, null, '', '*/*', 'text/html, */*;q=0.8', 'text/turtle'])(
    'leaves the default in place for %s',
    header => {
      expect(negotiateSelectResultsFormat(header)).toBeUndefined();
    },
  );
});

describe('isSelectResults', () => {
  it('accepts SPARQL JSON results and rejects anything else', () => {
    expect(isSelectResults(results)).toBe(true);
    expect(isSelectResults('<a> <b> <c> .')).toBe(false);
    expect(isSelectResults(true)).toBe(false);
    expect(isSelectResults({ head: {}, boolean: true })).toBe(false);
    expect(isSelectResults(null)).toBe(false);
  });
});

describe('toCsv', () => {
  it('writes plain values, quotes where needed, and leaves unbound cells empty', () => {
    expect(toCsv(results)).toBe(
      's,label,n\r\n'
      + 'http://example.org/a,Perth,42\r\n'
      + '_:b0,"say ""hi"",\nthen\tgo",\r\n',
    );
  });

  it('writes only the header for no rows', () => {
    expect(toCsv({ head: { vars: ['x', 'y'] }, results: { bindings: [] } })).toBe('x,y\r\n');
  });
});

describe('toTsv', () => {
  it('writes each term in Turtle syntax under ?var headers', () => {
    expect(toTsv(results)).toBe(
      '?s\t?label\t?n\n'
      + `<http://example.org/a>\t"Perth"@en\t"42"^^<${XSD_INTEGER}>\n`
      + '_:b0\t"say \\"hi\\",\\nthen\\tgo"\t\n',
    );
  });
});

describe('toXml', () => {
  it('writes the SPARQL Query Results XML format', () => {
    const xml = toXml(results);
    expect(xml).toContain('<sparql xmlns="http://www.w3.org/2005/sparql-results#">');
    expect(xml).toContain('<variable name="s"/>');
    expect(xml).toContain('<binding name="s"><uri>http://example.org/a</uri></binding>');
    expect(xml).toContain('<binding name="label"><literal xml:lang="en">Perth</literal></binding>');
    expect(xml).toContain(`<binding name="n"><literal datatype="${XSD_INTEGER}">42</literal></binding>`);
    expect(xml).toContain('<binding name="s"><bnode>b0</bnode></binding>');
    expect(xml).toContain('<literal>say &quot;hi&quot;,\nthen\tgo</literal>');
    // The unbound ?n in the second row is left out, not written empty.
    expect(xml.match(/<binding name="n">/g)).toHaveLength(1);
  });

  it('escapes markup in values', () => {
    const xml = toXml({
      head: { vars: ['v'] },
      results: { bindings: [{ v: { type: 'literal', value: '<a & b>' } }] },
    });
    expect(xml).toContain('<literal>&lt;a &amp; b&gt;</literal>');
  });
});

describe('renderSelectResults', () => {
  it('returns JSON results unchanged', () => {
    expect(renderSelectResults(results, 'application/sparql-results+json')).toBe(results);
  });
});
