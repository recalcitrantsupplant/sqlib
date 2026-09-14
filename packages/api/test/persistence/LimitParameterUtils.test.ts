import {
  findLimitParameterById,
  findLimitParameterByName,
  loadLimitParametersByIds,
  createLimitParameter,
  updateLimitParameter,
  deleteLimitParameter,
  LimitParameters
} from '../../src/persistence/utils/LimitParameterUtils.js';
import { LdkitLimitParameter } from '../../src/persistence/schemas/LimitParameterSchema.js';
import { toLdkit } from '../../src/persistence/utils/id-adapter.js';
import { vi, Mocked } from 'vitest';

// Mock the dependencies
vi.mock('../../src/persistence/utils/entityRepository', () => ({
  createRepositoryLens: vi.fn(() => ({
    findByIri: vi.fn(),
    find: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock('../../src/persistence/utils/id-adapter', () => ({
  toLdkit: vi.fn((apiEntity) => {
    const id = apiEntity['@id'] || 'mock-id';
    return { ...apiEntity, '$id': id, '@id': id };
  }),
}));

const mockLimitParameters = LimitParameters as Mocked<typeof LimitParameters>;

describe('LimitParameterUtils', () => {
  const mockLimitParameter: LdkitLimitParameter = {
    '$id': 'urn:test:limit-parameter:1',
    '@type': 'LimitParameter',
    name: 'test-limit'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations for each test
    (mockLimitParameters.findByIri as any).mockResolvedValue(null);
    (mockLimitParameters.find as any).mockResolvedValue([]);
    (mockLimitParameters.insert as any).mockResolvedValue(undefined);
    (mockLimitParameters.update as any).mockResolvedValue(undefined);
    (mockLimitParameters.delete as any).mockResolvedValue(undefined);
  });

  describe('findLimitParameterById', () => {
    it('should find a limit parameter by ID', async () => {
      (mockLimitParameters.findByIri as any).mockResolvedValue(mockLimitParameter);
      const result = await findLimitParameterById('urn:test:limit-parameter:1');
      expect(result).toEqual(mockLimitParameter);
      expect(mockLimitParameters.findByIri).toHaveBeenCalledWith('urn:test:limit-parameter:1');
    });

    it('should return null if limit parameter not found by ID', async () => {
      const result = await findLimitParameterById('non-existent-id');
      expect(result).toBeNull();
      expect(mockLimitParameters.findByIri).toHaveBeenCalledWith('non-existent-id');
    });

    it('should return null and log warning if findByIri throws an error', async () => {
      const error = new Error('DB error');
      (mockLimitParameters.findByIri as any).mockRejectedValue(error);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await findLimitParameterById('error-id');
      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to find LimitParameter error-id:', error);
      consoleWarnSpy.mockRestore();
    });
  });

  describe('findLimitParameterByName', () => {
    it('should find a limit parameter by name', async () => {
      (mockLimitParameters.find as any).mockResolvedValue([mockLimitParameter]);
      const result = await findLimitParameterByName('test-limit');
      expect(result).toEqual(mockLimitParameter);
      expect(mockLimitParameters.find).toHaveBeenCalled();
    });

    it('should return null if limit parameter not found by name', async () => {
      (mockLimitParameters.find as any).mockResolvedValue([]);
      const result = await findLimitParameterByName('non-existent-name');
      expect(result).toBeNull();
      expect(mockLimitParameters.find).toHaveBeenCalled();
    });
  });

  describe('loadLimitParametersByIds', () => {
    it('should load multiple limit parameters by IDs', async () => {
      const mockParam1 = { ...mockLimitParameter, '@id': 'urn:test:limit-parameter:1', '$id': 'urn:test:limit-parameter:1' };
      const mockParam2 = { ...mockLimitParameter, '@id': 'urn:test:limit-parameter:2', '$id': 'urn:test:limit-parameter:2', name: 'test-limit-2' };
      
      (mockLimitParameters.findByIri as any)
        .mockResolvedValueOnce(mockParam1)
        .mockResolvedValueOnce(mockParam2);

      const result = await loadLimitParametersByIds(['urn:test:limit-parameter:1', 'urn:test:limit-parameter:2']);
      expect(result).toEqual([mockParam1, mockParam2]);
      expect(mockLimitParameters.findByIri).toHaveBeenCalledTimes(2);
    });

    it('should return an empty array if no IDs are provided', async () => {
      const result = await loadLimitParametersByIds([]);
      expect(result).toEqual([]);
      expect(mockLimitParameters.findByIri).not.toHaveBeenCalled();
    });

    it('should only return found parameters when some IDs are not found', async () => {
      const mockParam1 = { ...mockLimitParameter, '@id': 'urn:test:limit-parameter:1', '$id': 'urn:test:limit-parameter:1' };
      
      (mockLimitParameters.findByIri as any)
        .mockResolvedValueOnce(mockParam1)
        .mockResolvedValueOnce(null); // Simulate not found

      const result = await loadLimitParametersByIds(['urn:test:limit-parameter:1', 'urn:test:limit-parameter:non-existent']);
      expect(result).toEqual([mockParam1]);
      expect(mockLimitParameters.findByIri).toHaveBeenCalledTimes(2);
    });
  });

  describe('createLimitParameter', () => {
    it('should create a new limit parameter', async () => {
      const newParamData = { name: 'new-limit' };
      const expectedCreatedParam = {
        ...newParamData,
        '@id': 'mock-id', // from toLdkit mock
        '$id': 'mock-id', // from toLdkit mock
        '@type': 'LimitParameter'
      };

      (mockLimitParameters.findByIri as any).mockResolvedValue(expectedCreatedParam);

      const result = await createLimitParameter(newParamData);
      expect(toLdkit).toHaveBeenCalledWith(expect.objectContaining(newParamData));
      expect(mockLimitParameters.insert).toHaveBeenCalledWith(expect.objectContaining({
        $id: expect.any(String),
        '@id': expect.any(String),
        name: 'new-limit',
        '@type': 'LimitParameter'
      }));
      expect(result).toEqual(expectedCreatedParam);
    });

    it('should throw error if name is missing', async () => {
      const newParamData = { name: undefined }; // Missing name
      await expect(createLimitParameter(newParamData as any)).rejects.toThrow('LimitParameter requires name');
      expect(mockLimitParameters.insert).not.toHaveBeenCalled();
    });

    it('should throw error if failed to retrieve after creation', async () => {
      const newParamData = { name: 'new-limit' };
      (mockLimitParameters.findByIri as any).mockResolvedValue(null); // Simulate failure to retrieve

      await expect(createLimitParameter(newParamData)).rejects.toThrow('Failed to retrieve LimitParameter after creation');
      expect(mockLimitParameters.insert).toHaveBeenCalled();
    });
  });

  describe('updateLimitParameter', () => {
    it('should update an existing limit parameter', async () => {
      const updatedData = { name: 'updated-limit' };
      const updatedParameter = { ...mockLimitParameter, ...updatedData };
      
      (mockLimitParameters.findByIri as any).mockResolvedValue(updatedParameter);

      const result = await updateLimitParameter('urn:test:limit-parameter:1', updatedData);
      expect(mockLimitParameters.update).toHaveBeenCalledWith(expect.objectContaining({
        $id: 'urn:test:limit-parameter:1',
        name: 'updated-limit'
      }));
      expect(result).toEqual(updatedParameter);
    });

    it('should return null if limit parameter not found for update', async () => {
      (mockLimitParameters.findByIri as any).mockResolvedValue(null);
      const result = await updateLimitParameter('non-existent-id', { name: 'new' });
      expect(result).toBeNull();
      expect(mockLimitParameters.update).toHaveBeenCalledWith(expect.objectContaining({ $id: 'non-existent-id' }));
    });
  });

  describe('deleteLimitParameter', () => {
    it('should delete a limit parameter by ID', async () => {
      await deleteLimitParameter('urn:test:limit-parameter:1');
      expect(mockLimitParameters.delete).toHaveBeenCalledWith('urn:test:limit-parameter:1');
    });

    it('should throw and log error if delete fails', async () => {
      const error = new Error('Delete failed');
      (mockLimitParameters.delete as any).mockRejectedValue(error);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(deleteLimitParameter('error-id')).rejects.toThrow('Delete failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to delete LimitParameter error-id:', error);
      consoleErrorSpy.mockRestore();
    });
  });
});