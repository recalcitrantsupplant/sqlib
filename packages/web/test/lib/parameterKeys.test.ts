import { describe, it, expect } from 'vitest';
import {
  tableParameterKey,
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
  it('a limit and an offset of the same name are different parameters', () => {
    expect(scalarParameterKey('limit', 'pageSize')).not.toBe(scalarParameterKey('offset', 'pageSize'));
  });
});

describe('parameterKeysOf', () => {
  it('reads every kind a version fills', () => {
    const keys = parameterKeysOf({
      tupleBindings: [{ variables: ['city'] }, { head: { vars: ['?postcode', '?state'] } }],
      scalarBindings: [{ parameterKind: 'limit', parameterName: 'pageSize' }],
    });

    expect(keys).toEqual(new Set([
      tableParameterKey(['city']),
      tableParameterKey(['postcode', 'state']),
      scalarParameterKey('limit', 'pageSize'),
    ]));
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

  it('names a number', () => {
    expect(describeParameterKey(scalarParameterKey('offset', 'start'))).toBe("OFFSET parameter 'start'");
  });
});
