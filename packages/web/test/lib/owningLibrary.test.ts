import { describe, it, expect } from 'vitest';
import { owningLibrary, type OwnedEntity } from '@/lib/owningLibrary';

const LIBRARIES = new Set(['urn:lib:a', 'urn:lib:b']);

function lookup(entities: Record<string, OwnedEntity> = {}) {
  return {
    isLibrary: (id: string) => LIBRARIES.has(id),
    entityById: (id: string) => entities[id],
  };
}

describe('owningLibrary', () => {
  it('reads a library named directly, as an array or a bare string', () => {
    expect(owningLibrary({ isPartOf: ['urn:lib:b'] }, lookup())).toBe('urn:lib:b');
    expect(owningLibrary({ isPartOf: 'urn:lib:a' }, lookup())).toBe('urn:lib:a');
  });

  it('prefers the library over a group named beside it', () => {
    const groups = { 'urn:group:1': { isPartOf: 'urn:lib:a' } };
    expect(owningLibrary({ isPartOf: ['urn:group:1', 'urn:lib:b'] }, lookup(groups))).toBe('urn:lib:b');
  });

  it('follows a group to its library when no library is named', () => {
    const groups = { 'urn:group:1': { isPartOf: 'urn:lib:a' } };
    expect(owningLibrary({ isPartOf: ['urn:group:1'] }, lookup(groups))).toBe('urn:lib:a');
  });

  it('is null for an unknown container, no container, or a cycle', () => {
    expect(owningLibrary({ isPartOf: ['urn:lib:gone'] }, lookup())).toBeNull();
    expect(owningLibrary({}, lookup())).toBeNull();
    expect(owningLibrary(null, lookup())).toBeNull();
    const cycle = { 'urn:g:1': { isPartOf: 'urn:g:2' }, 'urn:g:2': { isPartOf: 'urn:g:1' } };
    expect(owningLibrary({ isPartOf: 'urn:g:1' }, lookup(cycle))).toBeNull();
  });
});
