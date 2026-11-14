import { describe, expect, it } from 'vitest';
import { mergeColumnMappings, type EtlColumnMappingRow } from '@/lib/etlColumnMappings';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('mergeColumnMappings', () => {
  const saved: EtlColumnMappingRow[] = [
    { columnName: 'subject', targetVariable: 'site', termType: 'uri', nullPolicy: 'skipRow' },
    { columnName: 'label', targetVariable: 'label', termType: 'uri', iriTemplate: 'https://example.org/p/{value}', nullPolicy: 'skipRow' },
  ];
  const inferred: EtlColumnMappingRow[] = [
    { columnName: 'subject', targetVariable: 'subject', termType: 'uri', nullPolicy: 'undef' },
    { columnName: 'label', targetVariable: 'label', termType: 'literal', datatypeIri: `${XSD}string`, nullPolicy: 'undef' },
    { columnName: 'value', targetVariable: 'value', termType: 'literal', datatypeIri: `${XSD}double`, nullPolicy: 'undef' },
  ];

  it('keeps each saved row and adds the inferred row for a new column', () => {
    const schema = [{ columnName: 'subject' }, { columnName: 'label' }, { columnName: 'value' }];
    expect(mergeColumnMappings(saved, schema, inferred)).toEqual([saved[0], saved[1], inferred[2]]);
  });

  it('drops the row of a column that the SQL no longer returns', () => {
    expect(mergeColumnMappings(saved, [{ columnName: 'label' }], inferred)).toEqual([saved[1]]);
  });

  it('falls back to a string literal when nothing was inferred', () => {
    expect(mergeColumnMappings([], [{ columnName: 'x' }], [])).toEqual([
      { columnName: 'x', targetVariable: 'x', termType: 'literal', datatypeIri: `${XSD}string`, nullPolicy: 'undef' },
    ]);
  });
});
