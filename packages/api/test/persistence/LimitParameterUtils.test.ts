import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findLimitParameterById,
  findLimitParameterByName,
  loadLimitParametersByIds,
  createLimitParameter,
  updateLimitParameter,
  deleteLimitParameter,
  LimitParameters
} from '../../src/persistence/utils/LimitParameterUtils.js';
import type { LdkitLimitParameter } from '../../src/persistence/schemas/LimitParameterSchema.js';
import { log } from '../../src/lib/log.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

describe('LimitParameterUtils', () => {
  const stored: LdkitLimitParameter = {
    '$id': 'urn:test:limit-parameter:1',
    '@type': 'LimitParameter',
    name: 'test-limit'
  };
  const second: LdkitLimitParameter = { ...stored, '$id': 'urn:test:limit-parameter:2', name: 'test-limit-2' };

  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    store = await installFakePersistenceAdapter([
      { type: 'LimitParameter', entity: stored },
      { type: 'LimitParameter', entity: second },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.restore();
  });

  describe('findLimitParameterById', () => {
    it('should find a limit parameter by ID', async () => {
      const result = await findLimitParameterById('urn:test:limit-parameter:1');
      expect(result).toEqual(stored);
    });

    it('should return null if limit parameter not found by ID', async () => {
      const result = await findLimitParameterById('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return null and log warning if findByIri throws an error', async () => {
      const error = new Error('DB error');
      vi.spyOn(LimitParameters, 'findByIri').mockRejectedValue(error);
      const logWarnSpy = vi.spyOn(log, 'warn');

      const result = await findLimitParameterById('error-id');
      expect(result).toBeNull();
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, id: 'error-id' }),
        expect.stringContaining('Failed to find LimitParameter'),
      );
    });
  });

  describe('findLimitParameterByName', () => {
    it('should find a limit parameter by name', async () => {
      const result = await findLimitParameterByName('test-limit');
      expect(result).toEqual(stored);
    });

    it('should return null if limit parameter not found by name', async () => {
      const result = await findLimitParameterByName('non-existent-name');
      expect(result).toBeNull();
    });
  });

  describe('loadLimitParametersByIds', () => {
    it('should load multiple limit parameters by IDs', async () => {
      const result = await loadLimitParametersByIds(['urn:test:limit-parameter:1', 'urn:test:limit-parameter:2']);
      expect(result).toEqual([stored, second]);
    });

    it('should return an empty array if no IDs are provided', async () => {
      const result = await loadLimitParametersByIds([]);
      expect(result).toEqual([]);
    });

    it('should only return found parameters when some IDs are not found', async () => {
      const result = await loadLimitParametersByIds(['urn:test:limit-parameter:1', 'urn:test:limit-parameter:non-existent']);
      expect(result).toEqual([stored]);
    });
  });

  describe('createLimitParameter', () => {
    it('should create a new limit parameter', async () => {
      const result = await createLimitParameter({ '@id': 'urn:test:limit-parameter:new', name: 'new-limit' });

      const expected = {
        '@id': 'urn:test:limit-parameter:new',
        '$id': 'urn:test:limit-parameter:new',
        '@type': 'LimitParameter',
        name: 'new-limit',
      };
      expect(store.get('urn:test:limit-parameter:new')).toEqual(expected);
      expect(result).toEqual(expected);
    });

    it('should throw error if name is missing', async () => {
      const missingName = { '@id': 'urn:test:limit-parameter:new' } as Parameters<typeof createLimitParameter>[0];
      await expect(createLimitParameter(missingName)).rejects.toThrow('LimitParameter requires name');
      expect(store.all('LimitParameter')).toHaveLength(2);
    });

    it('should throw error if failed to retrieve after creation', async () => {
      vi.spyOn(LimitParameters, 'findByIri').mockResolvedValue(null);

      await expect(createLimitParameter({ '@id': 'urn:test:limit-parameter:new', name: 'new-limit' }))
        .rejects.toThrow('Failed to retrieve LimitParameter after creation');
      expect(store.get('urn:test:limit-parameter:new')).toMatchObject({ name: 'new-limit' });
    });
  });

  describe('updateLimitParameter', () => {
    it('should update an existing limit parameter', async () => {
      const result = await updateLimitParameter('urn:test:limit-parameter:1', { name: 'updated-limit' });

      expect(store.get('urn:test:limit-parameter:1')).toEqual({ ...stored, name: 'updated-limit' });
      expect(result).toEqual({ ...stored, name: 'updated-limit' });
    });

    it('should return null if limit parameter not found for update', async () => {
      // The fake store refuses to patch an entity it does not hold; the triple
      // store would accept the write, so stand in for that here.
      vi.spyOn(LimitParameters, 'update').mockResolvedValue(undefined);
      const result = await updateLimitParameter('non-existent-id', { name: 'new' });
      expect(result).toBeNull();
    });
  });

  describe('deleteLimitParameter', () => {
    it('should delete a limit parameter by ID', async () => {
      await deleteLimitParameter('urn:test:limit-parameter:1');
      expect(store.get('urn:test:limit-parameter:1')).toBeUndefined();
      expect(store.all('LimitParameter')).toEqual([second]);
    });

    it('should throw and log error if delete fails', async () => {
      const error = new Error('Delete failed');
      vi.spyOn(LimitParameters, 'delete').mockRejectedValue(error);
      const logErrorSpy = vi.spyOn(log, 'error');

      await expect(deleteLimitParameter('error-id')).rejects.toThrow('Delete failed');
      expect(logErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, id: 'error-id' }),
        expect.stringContaining('Failed to delete LimitParameter'),
      );
    });
  });
});
