import { describe, it, expect, beforeEach } from 'vitest';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import {
  getLastBackend,
  setLastBackend,
  resolveQueryBackend,
  resolveQueryDefault,
  resolveEtlBackend,
} from '@/lib/backendDefaults';

describe('backendDefaults', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('last pick', () => {
    it('is remembered per entity and per kind', () => {
      setLastBackend('query', 'q1', 'urn:b:one');
      setLastBackend('etlJob', 'q1', 'urn:b:two');
      expect(getLastBackend('query', 'q1')).toBe('urn:b:one');
      expect(getLastBackend('etlJob', 'q1')).toBe('urn:b:two');
      expect(getLastBackend('query', 'q2')).toBeNull();
    });

    it('is forgotten when set to nothing', () => {
      setLastBackend('query', 'q1', 'urn:b:one');
      setLastBackend('query', 'q1', null);
      expect(getLastBackend('query', 'q1')).toBeNull();
    });

    it('ignores an entity with no id yet', () => {
      setLastBackend('query', null, 'urn:b:one');
      expect(getLastBackend('query', null)).toBeNull();
    });

    it('survives corrupt storage', () => {
      window.localStorage.setItem('sqlib.lastBackends.v1', '{not json');
      expect(getLastBackend('query', 'q1')).toBeNull();
      setLastBackend('query', 'q1', 'urn:b:one');
      expect(getLastBackend('query', 'q1')).toBe('urn:b:one');
    });
  });

  describe('resolveQueryBackend', () => {
    const all = { lastPick: 'urn:b:last', queryDefault: 'urn:b:query', libraryDefault: 'urn:b:lib' };

    it('prefers the last pick, then the query default, then the library default', () => {
      expect(resolveQueryBackend(all)).toBe('urn:b:last');
      expect(resolveQueryBackend({ ...all, lastPick: null })).toBe('urn:b:query');
      expect(resolveQueryBackend({ ...all, lastPick: null, queryDefault: null })).toBe('urn:b:lib');
    });

    it('is nothing when nothing is set, rather than the in-memory store', () => {
      expect(resolveQueryBackend({})).toBeNull();
    });

    it('skips a candidate that is no longer available', () => {
      const isAvailable = (id: string) => id !== 'urn:b:last';
      expect(resolveQueryBackend({ ...all, isAvailable })).toBe('urn:b:query');
    });

    it('resolveQueryDefault ignores the last pick', () => {
      expect(resolveQueryDefault({ queryDefault: null, libraryDefault: 'urn:b:lib' })).toBe('urn:b:lib');
    });
  });

  describe('resolveEtlBackend', () => {
    it('prefers the last pick, then the job default, then the in-memory store', () => {
      expect(resolveEtlBackend({ lastPick: 'urn:b:last', jobDefault: 'urn:b:job' })).toBe('urn:b:last');
      expect(resolveEtlBackend({ jobDefault: 'urn:b:job' })).toBe('urn:b:job');
      expect(resolveEtlBackend({})).toBe(EPHEMERAL_BACKEND_ID);
    });
  });
});
