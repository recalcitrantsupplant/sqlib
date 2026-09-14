import { describe, expect, it } from 'vitest';
import {
  TupleRowError,
  bindingsToTupleRows,
  parseTupleRows,
  readProloguePrefixes,
  tupleRowsToTable,
} from '@/lib/srlTupleRows';

/**
 * The one place a rule set's named tuples and a saved tuple set are allowed to
 * meet. Both spellings say the same thing — positional terms — and the whole
 * risk is that the mapping quietly says something else.
 */
describe('parseTupleRows', () => {
  it('reads positional terms, ignoring comments and blank lines', () => {
    expect(parseTupleRows('# seeds\n\nTUPLE(:reach, :a, :b)\nTUPLE(:reach, :b, :c) .\n')).toEqual([
      [':reach', ':a', ':b'],
      [':reach', ':b', ':c'],
    ]);
  });

  it('does not split on a comma inside a literal', () => {
    expect(parseTupleRows('TUPLE(:label, "Smith, John")')).toEqual([[':label', '"Smith, John"']]);
  });
});

describe('tupleRowsToTable', () => {
  const prefixes = readProloguePrefixes('PREFIX ex: <http://example.org/>\nPREFIX : <http://x/>');

  it('expands prefixed names and names the columns positionally', () => {
    const table = tupleRowsToTable('TUPLE(:reach, ex:a, 3)', prefixes);
    expect(table.columns).toEqual(['p1', 'p2', 'p3']);
    expect(table.tsv).toBe(
      '?p1\t?p2\t?p3\n<http://x/reach>\t<http://example.org/a>\t3',
    );
  });

  it('leaves a short row unbound rather than padding it with an empty string', () => {
    const table = tupleRowsToTable('TUPLE(:a, :b)\nTUPLE(:c)', prefixes);
    expect(table.tsv.split('\n').at(-1)).toBe('<http://x/c>\t');
  });

  it('refuses a prefix the document never declared, rather than guessing one', () => {
    expect(() => tupleRowsToTable('TUPLE(nope:a)', prefixes)).toThrow(TupleRowError);
  });

  it('refuses a blank node, which has no identity outside its own document', () => {
    expect(() => tupleRowsToTable('TUPLE(:a, _:b)', prefixes)).toThrow(/blank node/i);
  });
});

describe('bindingsToTupleRows', () => {
  it('writes a saved set back as SRL, in the version’s own column order', () => {
    const rows = bindingsToTupleRows(['p1', 'p2'], [
      { p1: { type: 'uri', value: 'http://x/reach' }, p2: { type: 'literal', value: 'a' } },
    ]);
    expect(rows).toBe('TUPLE(<http://x/reach>, "a")');
  });

  it('drops an unbound trailing position rather than inventing a term for it', () => {
    const rows = bindingsToTupleRows(['p1', 'p2'], [{ p1: { type: 'uri', value: 'http://x/a' } }]);
    expect(rows).toBe('TUPLE(<http://x/a>)');
  });
});
