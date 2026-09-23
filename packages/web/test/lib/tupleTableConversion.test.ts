/**
 * The two conversions, and the one question each of them asks.
 *
 * Going to an argument table the question is "which variable does this column
 * fill?", because the query side matches by name and a tuple set's labels are
 * only a guess at one. Going the other way it is "should a fixed lead column go
 * in front?", because a rule-set table may lead with a ground term.
 *
 * Neither direction is a link: these produce values, and nothing here returns a
 * reference to what it was copied from.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultMapping,
  mappedVariables,
  toArgumentRows,
  toTupleDocument,
  toTupleTable,
} from '@/lib/tupleTableConversion';
import type { ArgumentRow, SparqlBinding } from '@/types/argument-sets';

const uri = (value: string) => ({ type: 'uri' as const, value });

describe('tuple set → argument table', () => {
  it('pre-fills from the labels and marks the guess unverified', () => {
    const mapping = defaultMapping(['city', 'population']);
    expect(mapping.map((column) => column.variable)).toEqual(['city', 'population']);
    expect(mapping.every((column) => column.unverified)).toBe(true);
  });

  it('strips the leading fixed column when asked', () => {
    const mapping = defaultMapping(['fixed', 'x', 'y'], true);
    expect(mapping[0].stripped).toBe(true);
    expect(mappedVariables(mapping)).toEqual(['x', 'y']);
  });

  it('keys the rows by the variables, not by the labels', () => {
    const rows: SparqlBinding[] = [{ city: uri('http://ex/perth'), population: uri('http://ex/2m') }];
    const mapping = defaultMapping(['city', 'population']);
    mapping[1].variable = 'pop';

    expect(toArgumentRows(rows, mapping)).toEqual([
      { values: { city: uri('http://ex/perth'), pop: uri('http://ex/2m') } },
    ]);
  });

  it('leaves a missing cell as a blank, which is how this editor spells UNDEF', () => {
    const mapping = defaultMapping(['city', 'population']);
    expect(toArgumentRows([{ city: uri('http://ex/perth') }], mapping)).toEqual([
      { values: { city: uri('http://ex/perth'), population: { type: 'uri', value: '' } } },
    ]);
  });

  it('drops a column that fills nothing rather than naming a cell after a label', () => {
    const mapping = defaultMapping(['fixed', 'x'], true);
    const rows: SparqlBinding[] = [{ fixed: uri('http://ex/seed'), x: uri('http://ex/a') }];
    expect(toArgumentRows(rows, mapping)).toEqual([{ values: { x: uri('http://ex/a') } }]);
  });
});

describe('argument table → tuple set', () => {
  const rows: ArgumentRow[] = [
    { values: { x: uri('http://ex/a'), y: uri('http://ex/b') } },
  ];

  it('keeps the names — as labels', () => {
    expect(toTupleTable(['x', 'y'], rows)).toEqual({
      columns: ['x', 'y'],
      rows: [{ x: uri('http://ex/a'), y: uri('http://ex/b') }],
    });
  });

  it('prepends a fixed IRI for a declaration leading with a ground term', () => {
    const table = toTupleTable(['x', 'y'], rows, { prependIri: 'http://ex/seed' });
    expect(table.columns).toEqual(['fixed', 'x', 'y']);
    expect(table.rows[0].fixed).toEqual(uri('http://ex/seed'));
  });

  it('leaves a blank cell out rather than writing an empty IRI as data', () => {
    const table = toTupleTable(['x', 'y'], [{ values: { x: uri('http://ex/a'), y: uri('') } }]);
    expect(Object.keys(table.rows[0])).toEqual(['x']);
  });

  it('writes a document the tuple set reader can read back', () => {
    const document = JSON.parse(toTupleDocument(toTupleTable(['x'], rows)));
    expect(document.head.vars).toEqual(['x']);
    expect(document.results.bindings).toEqual([{ x: uri('http://ex/a') }]);
  });
});
