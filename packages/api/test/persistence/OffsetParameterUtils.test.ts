import {
  findOffsetParameterById,
  findOffsetParameterByName,
  loadOffsetParametersByIds,
  createOffsetParameter,
  updateOffsetParameter,
  deleteOffsetParameter,
  OffsetParameters
} from '../../src/persistence/utils/OffsetParameterUtils.js';
import { LdkitOffsetParameter } from '../../src/persistence/schemas/OffsetParameterSchema.js';
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

const mockOffsetParameters = OffsetParameters as Mocked<typeof OffsetParameters>;

describe('OffsetParameterUtils', () => {
  const mockOffsetParameter: LdkitOffsetParameter = {
    '$id': 'urn:test:offset-parameter:1',
    '@type': 'OffsetParameter',
    name: "1"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations for each test
    (mockOffsetParameters.findByIri as any).mockResolvedValue(null);
    (mockOffsetParameters.find as any).mockResolvedValue([]);
    (mockOffsetParameters.insert as any).mockResolvedValue(undefined);
    (mockOffsetParameters.update as any).mockResolvedValue(undefined);
    (mockOffsetParameters.delete as any).mockResolvedValue(undefined);
  });

  describe('findOffsetParameterById', () => {
    it('should find a offset parameter by ID', async () => {
      (mockOffsetParameters.findByIri as any).mockResolvedValue(mockOffsetParameter);
      const result = await findOffsetParameterById('urn:test:offset-parameter:1');
      expect(result).toEqual(mockOffsetParameter);
      expect(mockOffsetParameters.findByIri).toHaveBeenCalledWith('urn:test:offset-parameter:1');
    });

    it('should return null if offset parameter not found by ID', async () => {
      const result = await findOffsetParameterById('non-existent-id');
      expect(result).toBeNull();
      expect(mockOffsetParameters.findByIri).toHaveBeenCalledWith('non-existent-id');
    });

    it('should return null and log warning if findByIri throws an error', async () => {
      const error = new Error('DB error');
      (mockOffsetParameters.findByIri as any).mockRejectedValue(error);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await findOffsetParameterById('error-id');
      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to find OffsetParameter error-id:', error);
      consoleWarnSpy.mockRestore();
    });
  });

  describe('loadOffsetParametersByIds', () => {
    it('should load multiple offset parameters by IDs', async () => {
      const mockParam1 = { ...mockOffsetParameter, '$id': 'urn:test:offset-parameter:1', '@id': 'urn:test:offset-parameter:1' };
      const mockParam2 = { ...mockOffsetParameter, '$id': 'urn:test:offset-parameter:2', '@id': 'urn:test:offset-parameter:2', name: 'test-offset-2' };
      
      (mockOffsetParameters.findByIri as any)
        .mockResolvedValueOnce(mockParam1)
        .mockResolvedValueOnce(mockParam2);

      const result = await loadOffsetParametersByIds(['urn:test:offset-parameter:1', 'urn:test:offset-parameter:2']);
      expect(result).toEqual([mockParam1, mockParam2]);
      expect(mockOffsetParameters.findByIri).toHaveBeenCalledTimes(2);
    });

    it('should return an empty array if no IDs are provided', async () => {
      const result = await loadOffsetParametersByIds([]);
      expect(result).toEqual([]);
      expect(mockOffsetParameters.findByIri).not.toHaveBeenCalled();
    });

    it('should only return found parameters when some IDs are not found', async () => {
      const mockParam1 = { ...mockOffsetParameter, '$id': 'urn:test:offset-parameter:1', '@id': 'urn:test:offset-parameter:1' };
      
      (mockOffsetParameters.findByIri as any)
        .mockResolvedValueOnce(mockParam1)
        .mockResolvedValueOnce(null); // Simulate not found

      const result = await loadOffsetParametersByIds(['urn:test:offset-parameter:1', 'urn:test:offset-parameter:non-existent']);
      expect(result).toEqual([mockParam1]);
      expect(mockOffsetParameters.findByIri).toHaveBeenCalledTimes(2);
    });
  });

  describe('createOffsetParameter', () => {
    it('should create a new offset parameter', async () => {
      const newParamData = { name: 'new-offset' };
      const expectedCreatedParam = {
        ...newParamData,
        '$id': 'mock-id', // from toLdkit mock
        '@id': 'mock-id',
        '@type': 'OffsetParameter'
      };

      (mockOffsetParameters.findByIri as any).mockResolvedValue(expectedCreatedParam);

      const result = await createOffsetParameter(newParamData);
      expect(toLdkit).toHaveBeenCalledWith(expect.objectContaining(newParamData));
      expect(mockOffsetParameters.insert).toHaveBeenCalledWith(expect.objectContaining({
        $id: expect.any(String),
        '@id': expect.any(String),
        name: 'new-offset',
        '@type': 'OffsetParameter'
      }));
      expect(result).toEqual(expectedCreatedParam);
    });

    it('should throw error if name is missing', async () => {
      const newParamData = { name: undefined }; // Missing name
      await expect(createOffsetParameter(newParamData as any)).rejects.toThrow('OffsetParameter requires name');
      expect(mockOffsetParameters.insert).not.toHaveBeenCalled();
    });

    it('should throw error if failed to retrieve after creation', async () => {
      const newParamData = { name: 'new-offset' };
      (mockOffsetParameters.findByIri as any).mockResolvedValue(null); // Simulate failure to retrieve

      await expect(createOffsetParameter(newParamData)).rejects.toThrow('Failed to retrieve OffsetParameter after creation');
      expect(mockOffsetParameters.insert).toHaveBeenCalled();
    });
  });

  describe('updateOffsetParameter', () => {
    it('should update an existing offset parameter', async () => {
      const updatedData = { name: 'updated-offset' };
      const updatedParameter = { ...mockOffsetParameter, ...updatedData, 'dateModified': expect.any(String) };
      
      (mockOffsetParameters.findByIri as any).mockResolvedValue(updatedParameter); // For retrieval after update

      const result = await updateOffsetParameter('urn:test:offset-parameter:1', updatedData);
      expect(mockOffsetParameters.update).toHaveBeenCalledWith(expect.objectContaining({
        $id: 'urn:test:offset-parameter:1',
        name: 'updated-offset',
      }));
      expect(result).toEqual(updatedParameter);
    });

    it('should return null if offset parameter not found for update', async () => {
      (mockOffsetParameters.findByIri as any).mockResolvedValue(null);
      const result = await updateOffsetParameter('non-existent-id', { name: 'new' });
      expect(result).toBeNull();
      expect(mockOffsetParameters.update).toHaveBeenCalledWith(expect.objectContaining({ $id: 'non-existent-id' }));
    });
  });

  describe('deleteOffsetParameter', () => {
    it('should delete a offset parameter by ID', async () => {
      await deleteOffsetParameter('urn:test:offset-parameter:1');
      expect(mockOffsetParameters.delete).toHaveBeenCalledWith('urn:test:offset-parameter:1');
    });

    it('should throw and log error if delete fails', async () => {
      const error = new Error('Delete failed');
      (mockOffsetParameters.delete as any).mockRejectedValue(error);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(deleteOffsetParameter('error-id')).rejects.toThrow('Delete failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to delete OffsetParameter error-id:', error);
      consoleErrorSpy.mockRestore();
    });
  });
});