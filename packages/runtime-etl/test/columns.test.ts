import {
  RetiredColumnFieldError,
  rowsToBindings,
  toArgumentSet,
  toColumnDefinitions,
  type ColumnDefinition,
} from '../src/index.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('rowsToBindings', () => {
  const columns: ColumnDefinition[] = [
    { columnName: 'customer', termType: 'uri' },
    { columnName: 'name', termType: 'literal', lang: 'en' },
    { columnName: 'joined', termType: 'literal', datatypeIri: `${XSD}dateTime` },
  ];

  it('binds each column to the variable of its name, with the value as it is', () => {
    expect(rowsToBindings([{ customer: 'http://ex/customer/a b', name: 'Ann', joined: '2020-01-02 03:04:05' }], columns)).toEqual([{
      customer: { type: 'uri', value: 'http://ex/customer/a b' },
      name: { type: 'literal', value: 'Ann', 'xml:lang': 'en' },
      joined: { type: 'literal', value: '2020-01-02 03:04:05', datatype: `${XSD}dateTime` },
    }]);
  });

  it('leaves a NULL column unbound and keeps the row', () => {
    const bindings = rowsToBindings([{ customer: null, name: 'kept' }, { customer: 'urn:x:1', name: null }], columns);
    expect(bindings).toEqual([
      { name: { type: 'literal', value: 'kept', 'xml:lang': 'en' } },
      { customer: { type: 'uri', value: 'urn:x:1' } },
    ]);
  });

  it('binds a value that is not an absolute IRI as it is', () => {
    expect(rowsToBindings([{ customer: 'no scheme' }], [{ columnName: 'customer', termType: 'uri' }])).toEqual([
      { customer: { type: 'uri', value: 'no scheme' } },
    ]);
  });

  it('refuses a mapping with a retired field', () => {
    const retired = [{ columnName: 'id', termType: 'uri', iriTemplate: 'http://ex/{value}' }] as unknown as ColumnDefinition[];
    expect(() => rowsToBindings([{ id: 1 }], retired)).toThrow(RetiredColumnFieldError);
  });
});

describe('toColumnDefinitions', () => {
  it('removes the stored fields that mean what every mapping now does', () => {
    expect(toColumnDefinitions([
      { columnName: 'name', targetVariable: 'name', termType: 'literal', nullPolicy: 'undef' },
    ])).toEqual([{ columnName: 'name', termType: 'literal' }]);
  });

  it('refuses an IRI template', () => {
    expect(() => toColumnDefinitions([
      { columnName: 'id', targetVariable: 'id', termType: 'uri', iriTemplate: 'http://ex/{value}', nullPolicy: 'undef' },
    ])).toThrow(/Column 'id' has an iriTemplate.*BIND\(IRI\(CONCAT/);
  });

  it('refuses nullPolicy skipRow', () => {
    expect(() => toColumnDefinitions([
      { columnName: 'id', termType: 'uri', nullPolicy: 'skipRow' },
    ])).toThrow(/Column 'id' has nullPolicy 'skipRow'.*IS NOT NULL/);
  });

  it('refuses a column that binds a variable of another name', () => {
    expect(() => toColumnDefinitions([
      { columnName: 'station_name', targetVariable: 'stationName', termType: 'literal' },
    ])).toThrow(/station_name AS stationName/);
  });
});

describe('toArgumentSet', () => {
  it('declares every mapped variable, bound or not', () => {
    const columns: ColumnDefinition[] = [
      { columnName: 'x', termType: 'literal' },
      { columnName: 'y', termType: 'literal' },
    ];
    expect(toArgumentSet([{ x: { type: 'literal', value: '1' } }], columns)).toEqual({
      head: { vars: ['x', 'y'] },
      results: { bindings: [{ x: { type: 'literal', value: '1' } }] },
    });
  });
});
