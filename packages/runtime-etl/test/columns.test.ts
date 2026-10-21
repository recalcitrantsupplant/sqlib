import { rowsToBindings, toArgumentSet, toLexicalForm, type ColumnDefinition } from '../src/index.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('rowsToBindings', () => {
  const columns: ColumnDefinition[] = [
    { columnName: 'id', targetVariable: 'customer', termType: 'uri', iriTemplate: 'http://ex/customer/{value}', nullPolicy: 'skipRow' },
    { columnName: 'name', targetVariable: 'name', termType: 'literal', lang: 'en', nullPolicy: 'undef' },
    { columnName: 'joined', targetVariable: 'joined', termType: 'literal', datatypeIri: `${XSD}dateTime`, nullPolicy: 'undef' },
  ];

  it('maps each column to the term its definition names', () => {
    expect(rowsToBindings([{ id: 'a b', name: 'Ann', joined: '2020-01-02 03:04:05' }], columns)).toEqual([{
      customer: { type: 'uri', value: 'http://ex/customer/a%20b' },
      name: { type: 'literal', value: 'Ann', 'xml:lang': 'en' },
      joined: { type: 'literal', value: '2020-01-02T03:04:05', datatype: `${XSD}dateTime` },
    }]);
  });

  it('drops a row whose skipRow column is null, and leaves an undef column unbound', () => {
    const bindings = rowsToBindings([{ id: null, name: 'gone' }, { id: 1, name: null }], columns);
    expect(bindings).toEqual([{ customer: { type: 'uri', value: 'http://ex/customer/1' } }]);
  });

  it('reports an IRI that would not be one, and keeps the rest of the row', () => {
    const warnings: string[] = [];
    const bare: ColumnDefinition[] = [
      { columnName: 'id', targetVariable: 's', termType: 'uri', nullPolicy: 'undef' },
      { columnName: 'name', targetVariable: 'name', termType: 'literal', nullPolicy: 'undef' },
    ];
    const bindings = rowsToBindings([{ id: 'no scheme', name: 'kept' }], bare, message => warnings.push(message));
    expect(bindings).toEqual([{ name: { type: 'literal', value: 'kept' } }]);
    expect(warnings).toEqual(['Invalid IRI generated, skipping binding']);
  });
});

describe('toLexicalForm', () => {
  it('rewrites a DuckDB timestamp only for an xsd:dateTime column', () => {
    expect(toLexicalForm('2020-01-02 03:04:05', `${XSD}dateTime`)).toBe('2020-01-02T03:04:05');
    expect(toLexicalForm('2020-01-02 03:04:05', `${XSD}string`)).toBe('2020-01-02 03:04:05');
  });
});

describe('toArgumentSet', () => {
  it('declares every mapped variable, bound or not', () => {
    const columns: ColumnDefinition[] = [
      { columnName: 'a', targetVariable: 'x', termType: 'literal', nullPolicy: 'undef' },
      { columnName: 'b', targetVariable: 'y', termType: 'literal', nullPolicy: 'undef' },
    ];
    expect(toArgumentSet([{ x: { type: 'literal', value: '1' } }], columns)).toEqual({
      head: { vars: ['x', 'y'] },
      results: { bindings: [{ x: { type: 'literal', value: '1' } }] },
    });
  });
});
