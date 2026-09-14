import { describe, it, expect } from 'vitest';
import {
  compareBindings,
  compareBoolean,
  compareGraphs,
  compareSmoke,
  isExpectationKind,
} from '../../src/lib/testComparators.js';

function bindings(rows: Array<Record<string, { type: string; value: string }>>, vars: string[] = ['s']) {
  return { head: { vars }, results: { bindings: rows } };
}

const uri = (value: string) => ({ type: 'uri', value });

describe('compareBindings', () => {
  it('ignores row order by default', () => {
    const actual = bindings([{ s: uri('http://ex/b') }, { s: uri('http://ex/a') }]);
    const expected = bindings([{ s: uri('http://ex/a') }, { s: uri('http://ex/b') }]);
    expect(compareBindings(actual, expected).passed).toBe(true);
  });

  it('honours order when the test says the query is ordered', () => {
    const actual = bindings([{ s: uri('http://ex/b') }, { s: uri('http://ex/a') }]);
    const expected = bindings([{ s: uri('http://ex/a') }, { s: uri('http://ex/b') }]);
    const result = compareBindings(actual, expected, { ordered: true });
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/Row 1 differs/);
  });

  it('compares multisets, so a duplicated row is not the same as one row', () => {
    const actual = bindings([{ s: uri('http://ex/a') }, { s: uri('http://ex/a') }]);
    const expected = bindings([{ s: uri('http://ex/a') }]);
    const result = compareBindings(actual, expected);
    expect(result.passed).toBe(false);
    expect(result.detail?.unexpected).toHaveLength(1);
  });

  it('does not care about key order within a row', () => {
    const actual = { head: { vars: ['a', 'b'] }, results: { bindings: [{ b: uri('http://ex/2'), a: uri('http://ex/1') }] } };
    const expected = { head: { vars: ['a', 'b'] }, results: { bindings: [{ a: uri('http://ex/1'), b: uri('http://ex/2') }] } };
    expect(compareBindings(actual, expected).passed).toBe(true);
  });

  it('distinguishes a plain literal from one with a language tag', () => {
    const actual = bindings([{ s: { type: 'literal', value: 'x' } as never }]);
    const expected = bindings([{ s: { type: 'literal', value: 'x', 'xml:lang': 'en' } as never }]);
    expect(compareBindings(actual, expected).passed).toBe(false);
  });

  it('treats an unbound variable as an absent key, not as a mismatch', () => {
    const actual = bindings([{ s: uri('http://ex/a') }]);
    const expected = bindings([{ s: uri('http://ex/a'), o: undefined as never }]);
    expect(compareBindings(actual, expected).passed).toBe(true);
  });

  it('reports both sides of a difference', () => {
    const actual = bindings([{ s: uri('http://ex/a') }, { s: uri('http://ex/c') }]);
    const expected = bindings([{ s: uri('http://ex/a') }, { s: uri('http://ex/b') }]);
    const result = compareBindings(actual, expected);
    expect(result.detail?.missing?.[0]).toContain('http://ex/b');
    expect(result.detail?.unexpected?.[0]).toContain('http://ex/c');
  });

  it('fails cleanly when the subject returned something else entirely', () => {
    expect(compareBindings('not results', bindings([])).passed).toBe(false);
    expect(compareBindings(bindings([]), 'not results').message).toMatch(/Expected result/);
  });
});

describe('compareBoolean', () => {
  it('accepts a bare boolean or an ASK results document on either side', () => {
    expect(compareBoolean(true, true).passed).toBe(true);
    expect(compareBoolean({ boolean: true }, true).passed).toBe(true);
    expect(compareBoolean(true, { boolean: true }).passed).toBe(true);
  });

  it('reports which way round the mismatch went', () => {
    expect(compareBoolean(false, true).message).toBe('Expected true, got false');
  });

  it('fails when the subject produced no boolean at all', () => {
    expect(compareBoolean({ results: { bindings: [] } }, true).message).toMatch(/did not return a boolean/);
  });
});

describe('compareGraphs', () => {
  it('ignores triple order', async () => {
    const a = '<http://ex/a> <http://ex/p> <http://ex/b> .\n<http://ex/b> <http://ex/p> <http://ex/c> .';
    const b = '<http://ex/b> <http://ex/p> <http://ex/c> .\n<http://ex/a> <http://ex/p> <http://ex/b> .';
    expect((await compareGraphs(a, b)).passed).toBe(true);
  });

  it('ignores blank node labels', async () => {
    // The point of canonicalising: a rule that mints blank nodes gets fresh
    // labels every run, and a label-sensitive test would fail on run two.
    const a = '_:x <http://ex/p> <http://ex/b> .';
    const b = '_:completelyDifferent <http://ex/p> <http://ex/b> .';
    expect((await compareGraphs(a, b)).passed).toBe(true);
  });

  it('does not confuse two distinct blank nodes with one shared one', async () => {
    const shared = '_:x <http://ex/p> <http://ex/b> .\n_:x <http://ex/q> <http://ex/c> .';
    const distinct = '_:x <http://ex/p> <http://ex/b> .\n_:y <http://ex/q> <http://ex/c> .';
    expect((await compareGraphs(shared, distinct)).passed).toBe(false);
  });

  it('treats two empty graphs as equal', async () => {
    expect((await compareGraphs('', '')).passed).toBe(true);
  });

  it('reports what is missing and what is extra', async () => {
    const actual = '<http://ex/a> <http://ex/p> <http://ex/b> .';
    const expected = '<http://ex/a> <http://ex/p> <http://ex/z> .';
    const result = await compareGraphs(actual, expected);
    expect(result.passed).toBe(false);
    expect(result.detail?.missing?.[0]).toContain('http://ex/z');
    expect(result.detail?.unexpected?.[0]).toContain('http://ex/b');
  });

  it('says which side failed to parse', async () => {
    expect((await compareGraphs('<http://ex/a> <http://ex/p> <http://ex/b> .', 'nonsense')).message)
      .toMatch(/Expected graph could not be parsed/);
    expect((await compareGraphs('nonsense', '<http://ex/a> <http://ex/p> <http://ex/b> .')).message)
      .toMatch(/Result graph could not be parsed/);
  });
});

describe('expectation kinds', () => {
  it('names exactly the four the entity model allows', () => {
    expect(['bindings', 'boolean', 'graph', 'smoke'].every(isExpectationKind)).toBe(true);
    expect(isExpectationKind('isomorphic')).toBe(false);
  });

  it('passes a smoke test that got as far as being compared', () => {
    expect(compareSmoke().passed).toBe(true);
  });
});

describe('the matched count', () => {
  /*
   * The count is what makes a difference legible: "1 missing" of 9 is a typo,
   * "1 missing" of 1 is a broken rule. The matched lines themselves are not
   * returned — that would put whole graphs in a run response to say nothing.
   */
  it('counts what both graphs had', async () => {
    const actual = '<http://ex/a> <http://ex/p> <http://ex/b> .\n<http://ex/a> <http://ex/p> <http://ex/c> .';
    const expected = '<http://ex/a> <http://ex/p> <http://ex/b> .\n<http://ex/a> <http://ex/p> <http://ex/z> .';
    const result = await compareGraphs(actual, expected);
    expect(result.detail).toMatchObject({ matched: 1 });
    expect(result.detail?.missing).toHaveLength(1);
    expect(result.detail?.unexpected).toHaveLength(1);
  });

  it('counts matched solutions too', () => {
    const rows = (values: string[]) => ({
      head: { vars: ['s'] },
      results: { bindings: values.map((value) => ({ s: { type: 'uri', value } })) },
    });
    const result = compareBindings(rows(['http://ex/a', 'http://ex/c']), rows(['http://ex/a', 'http://ex/b']));
    expect(result.detail?.matched).toBe(1);
  });
});
