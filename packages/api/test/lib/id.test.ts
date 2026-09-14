import { describe, it, expect } from 'vitest';
import { dashlessUUID, getPrefix, mintId, NS } from '../../src/lib/id.js';

describe('id.ts', () => {
  describe('NS', () => {
    it('should contain known prefixes', () => {
      expect(NS.query).toBe('urn:sqlib:query:');
      expect(Object.keys(NS).length).toBeGreaterThan(10);
    });
  });

  describe('dashlessUUID()', () => {
    it('should return a 32-character string without dashes', () => {
      const uuid = dashlessUUID();
      expect(typeof uuid).toBe('string');
      expect(uuid.length).toBe(32);
      expect(uuid).not.toContain('-');
    });

    it('should return different UUIDs on subsequent calls', () => {
      const uuid1 = dashlessUUID();
      const uuid2 = dashlessUUID();
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('getPrefix(kind)', () => {
    it('should return correct prefixes for known kinds', () => {
      for (const key of Object.keys(NS)) {
        expect(getPrefix(key)).toBe(NS[key as keyof typeof NS]);
      }
    });

    it('should handle aliases correctly', () => {
      expect(getPrefix('query-version')).toBe(NS.queryVersion);
      expect(getPrefix('group-version')).toBe(NS.groupVersion);
      expect(getPrefix('start-node')).toBe(NS.startNode);
      expect(getPrefix('end-node')).toBe(NS.endNode);
      expect(getPrefix('dyn-node')).toBe(NS.dynNode);
      expect(getPrefix('tuple-member')).toBe(NS.tupleMember);
      expect(getPrefix('input-tuple')).toBe(NS.inputTuple);
      expect(getPrefix('output-tuple')).toBe(NS.outputTuple);
      expect(getPrefix('limit-param')).toBe(NS.limitParam);
      expect(getPrefix('offset-param')).toBe(NS.offsetParam);
      expect(getPrefix('rdf-output')).toBe(NS.rdfOutput);
    });

    it('should handle case-insensitivity and normalization', () => {
      expect(getPrefix('QueryVersion')).toBe(NS.queryVersion);
      expect(getPrefix('QUERY_VERSION')).toBe(NS.queryVersion);
      expect(getPrefix(' group-version ')).toBe(NS.groupVersion);
    });

    it('should throw an error for unknown kinds', () => {
      expect(() => getPrefix('unknown-kind')).toThrow('Unknown id kind: unknown-kind');
      expect(() => getPrefix('')).toThrow('Unknown id kind: ');
      expect(() => getPrefix(' ')).toThrow('Unknown id kind:  ');
    });
  });

  describe('mintId(kind, suffix?)', () => {
    it('should mint an ID with a random suffix if none is provided', () => {
      const id = mintId('query');
      expect(id.startsWith(NS.query)).toBe(true);
      expect(id.length).toBe(NS.query.length + 32);
    });

    it('should mint an ID with the provided suffix', () => {
      const id = mintId('group', 'my-suffix');
      expect(id).toBe(`${NS.group}my-suffix`);
    });

    it('should handle various kinds', () => {
      const id = mintId('backend', 'my-backend');
      expect(id).toBe(`${NS.backend}my-backend`);
    });

    it('should throw an error for unknown kinds', () => {
      expect(() => mintId('unknown-kind')).toThrow('Unknown id kind: unknown-kind');
    });
  });
});
