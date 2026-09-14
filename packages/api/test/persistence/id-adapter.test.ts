
import {
  normalizeId,
  toLdkit,
  toApi,
  normalizeRef,
  normalizeRefArray
} from '../../src/persistence/utils/id-adapter.js';

describe('id-adapter', () => {

  describe('normalizeId', () => {
    it('should return $id when present', () => {
      const obj = { '$id': 'test-id-dollar' };
      expect(normalizeId(obj)).toBe('test-id-dollar');
    });

    it('should ignore @id and only use $id', () => {
      const obj = { '@id': 'test-id-at', '$id': 'test-id-dollar' };
      expect(normalizeId(obj)).toBe('test-id-dollar');
    });

    it('should not throw error if $id is present even with falsy @id', () => {
      const obj = { '@id': '', '$id': 'test-id-dollar' };
      expect(normalizeId(obj)).toBe('test-id-dollar');
    });

    it('should throw error if neither @id nor $id are present', () => {
      const obj = { name: 'test' };
      expect(() => normalizeId(obj)).toThrow("normalizeId: object must contain a '$id' string");
    });

    it('should throw error if id is not a string', () => {
      const obj = { '$id': 123 };
      expect(() => normalizeId(obj)).toThrow("normalizeId: object must contain a '$id' string");
    });
  });

  describe('toLdkit', () => {
    it('should convert API entity to LDKit entity with both @id and $id', () => {
      const apiEntity = { '@id': 'api-id', name: 'test' };
      const ldkitEntity = toLdkit(apiEntity);
      expect(ldkitEntity).toEqual({
        '@id': 'api-id',
        '$id': 'api-id',
        name: 'test',
      });
    });

    it('should use $id if present in API entity and set both', () => {
      const apiEntity = { '$id': 'api-id-dollar', name: 'test' };
      const ldkitEntity = toLdkit(apiEntity);
      expect(ldkitEntity).toEqual({
        '@id': 'api-id-dollar',
        '$id': 'api-id-dollar',
        name: 'test',
      });
    });

    it('should prioritize @id over $id if both are present and different', () => {
      const apiEntity = { '@id': 'api-id-at', '$id': 'api-id-dollar', name: 'test' };
      const ldkitEntity = toLdkit(apiEntity);
      expect(ldkitEntity).toEqual({
        '@id': 'api-id-at',
        '$id': 'api-id-at',
        name: 'test',
      });
    });

    it('should throw error if no valid id is present', () => {
      const apiEntity = { name: 'test' };
      expect(() => toLdkit(apiEntity)).toThrow("normalizeApiId: object must contain an '@id' or '$id' string");
    });
  });

  describe('toApi', () => {
    it('should convert LDKit entity to API entity, removing $id', () => {
      const ldkitEntity = { '$id': 'ldkit-id', '@id': 'ldkit-id', name: 'test' };
      const apiEntity = toApi(ldkitEntity);
      expect(apiEntity).toEqual({
        '@id': 'ldkit-id',
        name: 'test',
      });
      expect(apiEntity).not.toHaveProperty('$id');
    });

    it('should use $id if @id is not present in LDKit entity', () => {
      const ldkitEntity = { '$id': 'ldkit-id-dollar', name: 'test' };
      const apiEntity = toApi(ldkitEntity);
      expect(apiEntity).toEqual({
        '@id': 'ldkit-id-dollar',
        name: 'test',
      });
      expect(apiEntity).not.toHaveProperty('$id');
    });

    it('should prioritize @id over $id if both are present and different', () => {
      const ldkitEntity = { '$id': 'ldkit-id-dollar', '@id': 'ldkit-id-at', name: 'test' };
      const apiEntity = toApi(ldkitEntity);
      expect(apiEntity).toEqual({
        '@id': 'ldkit-id-at',
        name: 'test',
      });
      expect(apiEntity).not.toHaveProperty('$id');
    });

    it('should throw error if no valid id is present', () => {
      const ldkitEntity = { name: 'test' };
      expect(() => toApi(ldkitEntity)).toThrow("normalizeId: object must contain a '$id' string");
    });
  });

  describe('normalizeRef', () => {
    it('should return string if ref is a string', () => {
      expect(normalizeRef('test-ref')).toBe('test-ref');
    });

    it('should return @id from object if present', () => {
      expect(normalizeRef({ '@id': 'test-ref-obj' })).toBe('test-ref-obj');
    });

    it('should return undefined if @id is not a string', () => {
      expect(normalizeRef({ '@id': 123 })).toBeUndefined();
    });

    it('should return undefined if ref is null or undefined', () => {
      expect(normalizeRef(null)).toBeUndefined();
      expect(normalizeRef(undefined)).toBeUndefined();
    });

    it('should return undefined if ref is an object without @id', () => {
      expect(normalizeRef({ name: 'test' })).toBeUndefined();
    });
  });

  describe('normalizeRefArray', () => {
    it('should normalize an array of string IDs', () => {
      const refs = ['id1', 'id2'];
      expect(normalizeRefArray(refs)).toEqual(['id1', 'id2']);
    });

    it('should normalize an array of object IDs', () => {
      const refs = [{'@id': 'id1'}, {'@id': 'id2'}];
      expect(normalizeRefArray(refs)).toEqual(['id1', 'id2']);
    });

    it('should normalize a mixed array of IDs', () => {
      const refs = ['id1', {'@id': 'id2'}, 'id3', {'@id': 'id4'}];
      expect(normalizeRefArray(refs)).toEqual(['id1', 'id2', 'id3', 'id4']);
    });

    it('should filter out invalid references', () => {
      const refs = ['id1', null, {'@id': 123}, undefined, 'id2', {}];
      expect(normalizeRefArray(refs)).toEqual(['id1', 'id2']);
    });

    it('should handle a single string reference', () => {
      expect(normalizeRefArray('single-id')).toEqual(['single-id']);
    });

    it('should handle a single object reference', () => {
      expect(normalizeRefArray({'@id': 'single-id-obj'})).toEqual(['single-id-obj']);
    });

    it('should return empty array for null or undefined input', () => {
      expect(normalizeRefArray(null)).toEqual([]);
      expect(normalizeRefArray(undefined)).toEqual([]);
    });

    it('should return empty array for an empty array', () => {
      expect(normalizeRefArray([])).toEqual([]);
    });
  });
});
