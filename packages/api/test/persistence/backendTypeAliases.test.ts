/**
 * Backend type resolution, including the legacy spellings.
 *
 * Until `oxigraphMemory` existed there was one in-process backend type, so
 * every historical spelling — "persistent" ones included — resolved to
 * `oxigraphEphemeral`. Untangling that collapse is behaviour-changing, so the
 * intended mapping is pinned here rather than left to be rediscovered.
 */
import { describe, it, expect } from 'vitest';
import {
  BackendTypeIri,
  backendTypeIriToKey,
  backendTypeKeyToIri,
  backendTypeKeyToIriSafe,
  isBackendTypeIri,
  isOxigraphStoreMode,
  OXIGRAPH_STORE_MODES,
} from '../../src/persistence/schemas/BackendSchema.js';

describe('backend type resolution', () => {
  it('round-trips every declared type', () => {
    for (const key of Object.keys(BackendTypeIri) as Array<keyof typeof BackendTypeIri>) {
      expect(backendTypeIriToKey(backendTypeKeyToIri(key))).toBe(key);
    }
  });

  it('exposes oxigraphMemory as a first-class type', () => {
    expect(BackendTypeIri.oxigraphMemory).toBeTruthy();
    expect(isBackendTypeIri(BackendTypeIri.oxigraphMemory)).toBe(true);
    expect(backendTypeIriToKey(BackendTypeIri.oxigraphMemory)).toBe('oxigraphMemory');
  });

  it('keeps ephemeral spellings meaning ephemeral', () => {
    // The one case where the old and new readings agree.
    expect(backendTypeKeyToIriSafe('oxigraphEphemeral')).toBe(BackendTypeIri.oxigraphEphemeral);
    expect(backendTypeKeyToIriSafe('OxigraphEphemeralBackend')).toBe(BackendTypeIri.oxigraphEphemeral);
  });

  it('resolves legacy persistent spellings to oxigraphMemory, not ephemeral', () => {
    for (const spelling of [
      'oxigraphPersistent',
      'OxigraphPersistentBackend',
      'https://sparql-query-lib/backend-type/oxigraphPersistent',
    ]) {
      expect(backendTypeKeyToIriSafe(spelling)).toBe(BackendTypeIri.oxigraphMemory);
    }
  });

  it('resolves memory spellings to oxigraphMemory', () => {
    expect(backendTypeKeyToIriSafe('oxigraphMemory')).toBe(BackendTypeIri.oxigraphMemory);
    expect(backendTypeKeyToIriSafe('oxigraph memory')).toBe(BackendTypeIri.oxigraphMemory);
  });

  it('returns undefined for a type it does not know', () => {
    expect(backendTypeKeyToIriSafe('mysteryStore')).toBeUndefined();
    expect(backendTypeIriToKey('https://example.org/not-a-backend-type')).toBeUndefined();
  });
});

describe('oxigraph store modes', () => {
  it('accepts exactly the three declared modes', () => {
    expect([...OXIGRAPH_STORE_MODES]).toEqual(['readOnly', 'ephemeral', 'durable']);
    for (const mode of OXIGRAPH_STORE_MODES) {
      expect(isOxigraphStoreMode(mode)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const value of ['persistent', 'read-only', '', null, undefined, 1]) {
      expect(isOxigraphStoreMode(value)).toBe(false);
    }
  });
});
