import { describe, it, expect } from 'vitest';
import {
  booleanValue,
  countTriples,
  describeValue,
  formatBytes,
  graphValue,
  mapColumns,
  rowsValue,
  toSlotArgument,
  type RowsValue,
} from '@/lib/notebookValues';

const SOURCE = { name: 'out1', cellId: 'c1', durationMs: 12 };

function rows(columns: string[], bindings: Array<Record<string, unknown>>): RowsValue {
  const body = JSON.stringify({ head: { vars: columns }, results: { bindings } });
  return rowsValue(SOURCE, { head: { vars: columns }, results: { bindings } }, body);
}

describe('stats', () => {
  it('reads rows in rows, columns and bytes', () => {
    const value = rows(['a', 'b'], [{ a: { value: '1' } }, { a: { value: '2' } }]);
    expect(describeValue(value)).toMatch(/^2 rows · 2 cols · \d+ B$/);
  });

  it('takes columns from the head, so an all-unbound column still counts', () => {
    const value = rows(['bound', 'never'], [{ bound: { value: '1' } }]);
    expect(value.columns).toEqual(['bound', 'never']);
  });

  it('counts a graph in triples', () => {
    const turtle = '<urn:a> <urn:p> <urn:b> .\n<urn:a> <urn:p> <urn:c> .\n';
    const value = graphValue(SOURCE, turtle, 'application/n-triples');
    expect(value.tripleCount).toBe(2);
    expect(describeValue(value)).toMatch(/^2 triples · \d+ B$/);
  });

  it('counts Turtle in triples rather than in lines', () => {
    const turtle = '<urn:a> <urn:p> <urn:b> ;\n  <urn:q> <urn:c> ;\n  <urn:r> <urn:d> .\n';
    expect(countTriples(turtle, 'text/turtle')).toBe(3);
  });

  it('falls back to counting statement lines when a document will not parse', () => {
    expect(countTriples('this is not RDF at all', 'text/turtle')).toBe(1);
  });

  it('describes a boolean as its answer', () => {
    expect(describeValue(booleanValue(SOURCE, true))).toBe('true');
  });

  it('scales byte sizes into the units the chip reads in', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(88_000)).toBe('88 KB');
    expect(formatBytes(2_100_000)).toBe('2.1 MB');
  });
});

describe('column mapping', () => {
  it('pairs by name where the names match', () => {
    expect(mapColumns(['asset', 'label'], ['asset'])).toEqual([{ source: 'asset', target: 'asset' }]);
  });

  it('falls back to position where they do not', () => {
    expect(mapColumns(['s', 'o'], ['subject', 'object'])).toEqual([
      { source: 's', target: 'subject' },
      { source: 'o', target: 'object' },
    ]);
  });

  it('never sends one column to two targets', () => {
    const mappings = mapColumns(['asset', 'other'], ['asset', 'label']);
    expect(mappings).toEqual([
      { source: 'asset', target: 'asset' },
      { source: 'other', target: 'label' },
    ]);
  });

  it('leaves a target with no partner unfilled rather than guessing', () => {
    expect(mapColumns(['only'], ['first', 'second'])).toEqual([{ source: 'only', target: 'first' }]);
  });
});

describe('piping rows into a slot', () => {
  it('renames the columns to the target query variables', () => {
    const value = rows(['s'], [{ s: { type: 'uri', value: 'urn:a' } }]);
    expect(toSlotArgument(value, ['subject'])).toEqual({
      head: { vars: ['subject'] },
      arguments: { bindings: [{ subject: { type: 'uri', value: 'urn:a' } }] },
    });
  });

  it('leaves an unbound term out, which is how SPARQL JSON spells UNDEF', () => {
    const value = rows(['a', 'b'], [{ a: { type: 'uri', value: 'urn:a' } }]);
    const argument = toSlotArgument(value, ['a', 'b']);
    expect(argument.arguments.bindings[0]).toEqual({ a: { type: 'uri', value: 'urn:a' } });
  });
});
