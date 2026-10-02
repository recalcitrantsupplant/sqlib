import { describe, it, expect } from 'vitest';
import { assertMutableEntity, ImmutableEntityError, isImmutableType } from '../../src/lib/immutability.js';

describe('immutability utilities', () => {
  it('reports immutable version types correctly', () => {
    expect(isImmutableType('QueryVersion')).toBe(true);
    expect(isImmutableType('RuleSetVersion')).toBe(true);
    expect(isImmutableType('Library')).toBe(false);
  });

  it('throws ImmutableEntityError when entity is marked immutable', () => {
    const entity = { $id: 'urn:qv:1', immutable: true };
    expect(() => assertMutableEntity('QueryVersion', entity)).toThrow(ImmutableEntityError);
  });

  it('leaves non-version types alone, whatever their flag says', () => {
    expect(() => assertMutableEntity('Library', { $id: 'urn:lib:1', immutable: true })).not.toThrow();
  });

  /*
   * Keyed on the type, not the stored flag: versions written before creation
   * set the flag, and every argument set and column mapping version, carried
   * none, and the guard used to let all of those be rewritten.
   */
  const FROZEN_BY_TYPE = [
    'QueryVersion', 'QueryGroupVersion', 'RuleVersion', 'DataBlockVersion', 'RuleSetVersion',
    'DataGraphVersion', 'TestVersion', 'TupleSetVersion', 'ArgumentSetVersion', 'EtlJobVersion',
    'EtlColumnMappingVersion', 'TestCase', 'TestCaseDataGraph',
  ];
  const FLAGS = [{ immutable: true }, { immutable: false }, {}];

  describe.each(FROZEN_BY_TYPE)('%s', (type) => {
    it.each(FLAGS)('refuses a content patch with flag %o', (flag) => {
      expect(() => assertMutableEntity(type, { $id: 'urn:v:1', ...flag }, { description: 'x' })).toThrow(ImmutableEntityError);
    });

    it.each(FLAGS)('accepts an annotation patch with flag %o', (flag) => {
      expect(() => assertMutableEntity(type, { $id: 'urn:v:1', ...flag }, { comment: 'note' })).not.toThrow();
      expect(() => assertMutableEntity(type, { $id: 'urn:v:1', ...flag }, { immutable: true })).not.toThrow();
    });
  });

  it('keeps a benchmark experiment version editable until it is frozen', () => {
    // A benchmark version is a draft that is configured, tried and then frozen.
    expect(() => assertMutableEntity('BenchmarkExperimentVersion', { $id: 'urn:b:1' }, { repeats: 3 })).not.toThrow();
    expect(() => assertMutableEntity('BenchmarkExperimentVersion', { $id: 'urn:b:1', immutable: true }, { repeats: 3 }))
      .toThrow(ImmutableEntityError);
  });

  it('lets an ETL job version take a column mapping after it is created', () => {
    expect(() => assertMutableEntity('EtlJobVersion', { $id: 'urn:e:1' }, { currentColumnMappingVersion: 'urn:m:1' }))
      .not.toThrow();
    expect(() => assertMutableEntity('EtlJobVersion', { $id: 'urn:e:1' }, { sql: 'SELECT 1' })).toThrow(ImmutableEntityError);
  });

  it('lets a frozen version take its annotations', () => {
    // The line the whole exception rests on: a comment is metadata *about* the
    // snapshot, so writing one invalidates no check that named the version.
    const frozen = { $id: 'urn:qv:1', immutable: true };
    expect(() => assertMutableEntity('QueryVersion', frozen, { comment: 'why this one' })).not.toThrow();
    expect(() => assertMutableEntity('QueryVersion', frozen, { immutable: true })).not.toThrow();
    expect(() => assertMutableEntity('QueryVersion', frozen, { comment: 'x', dateModified: 'now' })).not.toThrow();
  });

  it('still refuses content, and refuses unfreezing', () => {
    const frozen = { $id: 'urn:qv:1', immutable: true };
    expect(() => assertMutableEntity('QueryVersion', frozen, { queryString: 'SELECT * {}' })).toThrow(ImmutableEntityError);
    // A content field alongside a legal annotation is still a content write.
    expect(() => assertMutableEntity('QueryVersion', frozen, { comment: 'x', queryString: 'SELECT * {}' })).toThrow(ImmutableEntityError);
    expect(() => assertMutableEntity('QueryVersion', frozen, { immutable: false })).toThrow(ImmutableEntityError);
  });

  it('stays strict when the caller says nothing about what it is writing', () => {
    // Callers that pass no updates get the old all-or-nothing rule, because
    // there is nothing to check the allowlist against.
    expect(() => assertMutableEntity('QueryVersion', { $id: 'urn:qv:1', immutable: true })).toThrow(ImmutableEntityError);
  });
});
