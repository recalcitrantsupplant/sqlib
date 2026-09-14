import { describe, it, expect } from 'vitest';
import {
  tableParameterKey,
  graphParameterKey,
  scalarParameterKey,
  describeParameterKey,
  parameterKeysOf,
} from '@sparql-query-lib/types';

describe('tableParameterKey', () => {
  /*
   * The bug this key exists to close. `ArgumentSetService` keyed its runtime
   * map on the stored variable order while `/execute` validated against a
   * sorted signature, so a set written `?b ?a` for a clause declaring `?a ?b`
   * validated and then missed the lookup — its rows were dropped and the run
   * went ahead unfiltered. `alignArgumentSets` in the runtime sorts, so sorted
   * is the answer the deepest layer already gives.
   */
  it('does not depend on the order the variables were written in', () => {
    expect(tableParameterKey(['b', 'a'])).toBe(tableParameterKey(['a', 'b']));
  });

  it('ignores a leading question mark, so both spellings meet', () => {
    expect(tableParameterKey(['?city'])).toBe(tableParameterKey(['city']));
  });

  it('separates clauses of different arity', () => {
    expect(tableParameterKey(['a'])).not.toBe(tableParameterKey(['a', 'b']));
  });

  it('collapses a repeated variable, which VALUES cannot declare twice', () => {
    expect(tableParameterKey(['a', 'a'])).toBe(tableParameterKey(['a']));
  });
});

describe('key kinds do not collide', () => {
  it('a table and a graph in the same-numbered slot are different parameters', () => {
    expect(tableParameterKey(['0'])).not.toBe(graphParameterKey(0));
  });

  it('a limit and an offset of the same name are different parameters', () => {
    expect(scalarParameterKey('limit', 'pageSize')).not.toBe(scalarParameterKey('offset', 'pageSize'));
  });

  /*
   * Graphs are keyed by slot: an argument set carries them in order and the
   * group routes them, so there is no name to key on. The previous spelling
   * keyed by port name and gave every unnamed graph the same key, which meant
   * two positional graphs looked like one parameter to the completion check on
   * `/execute`.
   */
  it('gives each graph slot its own key', () => {
    expect(graphParameterKey(0)).not.toBe(graphParameterKey(1));
    expect(graphParameterKey(1)).toBe(graphParameterKey(1));
  });
});

describe('parameterKeysOf', () => {
  it('reads every kind a version fills', () => {
    const keys = parameterKeysOf({
      tupleBindings: [{ variables: ['city'] }, { head: { vars: ['?postcode', '?state'] } }],
      scalarBindings: [{ parameterKind: 'limit', parameterName: 'pageSize' }],
      graphBindings: [{ position: 0 }],
    });

    expect(keys).toEqual(new Set([
      tableParameterKey(['city']),
      tableParameterKey(['postcode', 'state']),
      scalarParameterKey('limit', 'pageSize'),
      graphParameterKey(0),
    ]));
  });

  it('keys graphs by where they sit when position is left unset', () => {
    const keys = parameterKeysOf({ graphBindings: [{}, {}] });
    expect(keys).toEqual(new Set([graphParameterKey(0), graphParameterKey(1)]));
  });

  it('is empty for a version that fills nothing', () => {
    expect(parameterKeysOf({}).size).toBe(0);
  });

  it('skips a scalar binding with no name rather than minting a bare key', () => {
    expect(parameterKeysOf({ scalarBindings: [{ parameterKind: 'limit' }] }).size).toBe(0);
  });
});

describe('describeParameterKey', () => {
  it('names a clause the way the query writes it', () => {
    expect(describeParameterKey(tableParameterKey(['b', 'a']))).toBe('the VALUES clause (?a ?b)');
  });

  it('names a graph slot and a number', () => {
    expect(describeParameterKey(graphParameterKey(0))).toBe('data graph input 1');
    expect(describeParameterKey(scalarParameterKey('offset', 'start'))).toBe("OFFSET parameter 'start'");
  });
});
