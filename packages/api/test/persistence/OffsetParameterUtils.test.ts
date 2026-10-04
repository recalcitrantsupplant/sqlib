import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findOffsetParameterById,
  loadOffsetParametersByIds,
  createOffsetParameter,
  updateOffsetParameter,
  deleteOffsetParameter,
  OffsetParameters
} from '../../src/persistence/utils/OffsetParameterUtils.js';
import type { LdkitOffsetParameter } from '../../src/persistence/schemas/OffsetParameterSchema.js';
import { log } from '../../src/lib/log.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

describe('OffsetParameterUtils', () => {
  const stored: LdkitOffsetParameter = {
    '$id': 'urn:test:offset-parameter:1',
    '@type': 'OffsetParameter',
    name: '1'
  };
  const second: LdkitOffsetParameter = { ...stored, '$id': 'urn:test:offset-parameter:2', name: 'test-offset-2' };

  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    store = await installFakePersistenceAdapter([
      { type: 'OffsetParameter', entity: stored },
      { type: 'OffsetParameter', entity: second },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.restore();
  });

  describe('findOffsetParameterById', () => {
    it('should find a offset parameter by ID', async () => {
      const result = await findOffsetParameterById('urn:test:offset-parameter:1');
      expect(result).toEqual(stored);
    });

    it('should return null if offset parameter not found by ID', async () => {
      const result = await findOffsetParameterById('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return null and log warning if findByIri throws an error', async () => {
      const error = new Error('DB error');
      vi.spyOn(OffsetParameters, 'findByIri').mockRejectedValue(error);
      const logWarnSpy = vi.spyOn(log, 'warn');

      const result = await findOffsetParameterById('error-id');
      expect(result).toBeNull();
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, id: 'error-id' }),
        expect.stringContaining('Failed to find OffsetParameter'),
      );
    });
  });

  describe('loadOffsetParametersByIds', () => {
    it('should load multiple offset parameters by IDs', async () => {
      const result = await loadOffsetParametersByIds(['urn:test:offset-parameter:1', 'urn:test:offset-parameter:2']);
      expect(result).toEqual([stored, second]);
    });

    it('should return an empty array if no IDs are provided', async () => {
      const result = await loadOffsetParametersByIds([]);
      expect(result).toEqual([]);
    });

    it('should only return found parameters when some IDs are not found', async () => {
      const result = await loadOffsetParametersByIds(['urn:test:offset-parameter:1', 'urn:test:offset-parameter:non-existent']);
      expect(result).toEqual([stored]);
    });
  });

  describe('createOffsetParameter', () => {
    it('should create a new offset parameter', async () => {
      const result = await createOffsetParameter({ '@id': 'urn:test:offset-parameter:new', name: 'new-offset' });

      const expected = {
        '@id': 'urn:test:offset-parameter:new',
        '$id': 'urn:test:offset-parameter:new',
        '@type': 'OffsetParameter',
        name: 'new-offset',
      };
      expect(store.get('urn:test:offset-parameter:new')).toEqual(expected);
      expect(result).toEqual(expected);
    });

    it('should throw error if name is missing', async () => {
      const missingName = { '@id': 'urn:test:offset-parameter:new' } as Parameters<typeof createOffsetParameter>[0];
      await expect(createOffsetParameter(missingName)).rejects.toThrow('OffsetParameter requires name');
      expect(store.all('OffsetParameter')).toHaveLength(2);
    });

    it('should throw error if failed to retrieve after creation', async () => {
      vi.spyOn(OffsetParameters, 'findByIri').mockResolvedValue(null);

      await expect(createOffsetParameter({ '@id': 'urn:test:offset-parameter:new', name: 'new-offset' }))
        .rejects.toThrow('Failed to retrieve OffsetParameter after creation');
      expect(store.get('urn:test:offset-parameter:new')).toMatchObject({ name: 'new-offset' });
    });
  });

  describe('updateOffsetParameter', () => {
    it('should update an existing offset parameter', async () => {
      const result = await updateOffsetParameter('urn:test:offset-parameter:1', { name: 'updated-offset' });

      expect(store.get('urn:test:offset-parameter:1')).toEqual({ ...stored, name: 'updated-offset' });
      expect(result).toEqual({ ...stored, name: 'updated-offset' });
    });

    it('should return null if offset parameter not found for update', async () => {
      // The fake store refuses to patch an entity it does not hold; the triple
      // store would accept the write, so stand in for that here.
      vi.spyOn(OffsetParameters, 'update').mockResolvedValue(undefined);
      const result = await updateOffsetParameter('non-existent-id', { name: 'new' });
      expect(result).toBeNull();
    });
  });

  describe('deleteOffsetParameter', () => {
    it('should delete a offset parameter by ID', async () => {
      await deleteOffsetParameter('urn:test:offset-parameter:1');
      expect(store.get('urn:test:offset-parameter:1')).toBeUndefined();
      expect(store.all('OffsetParameter')).toEqual([second]);
    });

    it('should throw and log error if delete fails', async () => {
      const error = new Error('Delete failed');
      vi.spyOn(OffsetParameters, 'delete').mockRejectedValue(error);
      const logErrorSpy = vi.spyOn(log, 'error');

      await expect(deleteOffsetParameter('error-id')).rejects.toThrow('Delete failed');
      expect(logErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, id: 'error-id' }),
        expect.stringContaining('Failed to delete OffsetParameter'),
      );
    });
  });
});
