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

  it('allows mutable entities and non-version types', () => {
    expect(() => assertMutableEntity('QueryVersion', { $id: 'urn:qv:1', immutable: false })).not.toThrow();
    expect(() => assertMutableEntity('Library', { $id: 'urn:lib:1', immutable: true })).not.toThrow();
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
