import { describe, expect, it } from 'vitest';
import { mergeColumnMappings, toMappingRow, type EtlColumnMappingRow } from '@/lib/etlColumnMappings';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

describe('mergeColumnMappings', () => {
  const saved: EtlColumnMappingRow[] = [
    { columnName: 'subject', termType: 'uri' },
    { columnName: 'label', termType: 'literal', lang: 'en' },
  ];
  const inferred: EtlColumnMappingRow[] = [
    { columnName: 'subject', termType: 'uri' },
    { columnName: 'label', termType: 'literal', datatypeIri: `${XSD}string` },
    { columnName: 'value', termType: 'literal', datatypeIri: `${XSD}double` },
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
      { columnName: 'x', termType: 'literal', datatypeIri: `${XSD}string` },
    ]);
  });
});

describe('toMappingRow', () => {
  it('keeps only the fields a mapping has', () => {
    const stored = {
      columnName: 'id', targetVariable: 'id', termType: 'uri', iriTemplate: 'http://ex/{value}', nullPolicy: 'skipRow',
    } as unknown as EtlColumnMappingRow;
    expect(toMappingRow(stored)).toEqual({ columnName: 'id', termType: 'uri' });
  });
});
