/**
 * The results viewer's CSV parser, per RFC 4180 (#196).
 */
import { describe, expect, it } from 'vitest';
import { parseCsv, parseTsv, splitCsvRecords } from '../../src/lib/csv-tsv-table-converter';

describe('splitCsvRecords', () => {
  it('keeps commas, doubled quotes and line breaks inside a quoted field', () => {
    const csv = 'name,state\r\na,"{""area"": [[1, 2],\r\n[3, 4]]}"\r\nb,plain\r\n';
    expect(splitCsvRecords(csv)).toEqual([
      ['name', 'state'],
      ['a', '{"area": [[1, 2],\r\n[3, 4]]}'],
      ['b', 'plain'],
    ]);
  });

  it('accepts \\n and \\r record separators and leaves out blank lines', () => {
    expect(splitCsvRecords('x,y\n1,2\r3,4\n\n')).toEqual([['x', 'y'], ['1', '2'], ['3', '4']]);
  });

  it('keeps empty fields, including a trailing one', () => {
    expect(splitCsvRecords('a,b,c\n1,,\n')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });

  it('reads an empty quoted field as empty', () => {
    expect(splitCsvRecords('a,b\n"",x')).toEqual([['a', 'b'], ['', 'x']]);
  });
});

describe('parseCsv', () => {
  it('reads the CSV that POST /execute writes for a literal with commas and quotes', () => {
    const rows = parseCsv('name,state\r\na,"{""area"": [[1, 2], [3, 4]]}"\r\n');
    expect(rows).toEqual([
      {
        name: { value: 'a', type: 'literal' },
        state: { value: '{"area": [[1, 2], [3, 4]]}', type: 'literal' },
      },
    ]);
  });

  it('reads IRIs and blank nodes by prefix, and an empty field as unbound', () => {
    const rows = parseCsv('s,b,o\r\nhttp://example.org/a,_:b0,\r\n');
    expect(rows).toEqual([
      {
        s: { value: 'http://example.org/a', type: 'uri' },
        b: { value: '_:b0', type: 'bnode' },
        o: '',
      },
    ]);
  });

  it('reads a quoted value that looks like N-Triples as a plain literal', () => {
    const rows = parseCsv('v\r\n"""x""^^<http://example.org/t>"\r\n');
    expect(rows).toEqual([{ v: { value: '"x"^^<http://example.org/t>', type: 'literal' } }]);
  });

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseTsv', () => {
  it('still reads N-Triples terms', () => {
    const rows = parseTsv('?s\t?o\n<http://example.org/a>\t"1"^^<http://www.w3.org/2001/XMLSchema#integer>\n');
    expect(rows).toEqual([
      {
        '?s': { value: 'http://example.org/a', type: 'uri' },
        '?o': { value: '1', type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      },
    ]);
  });
});
