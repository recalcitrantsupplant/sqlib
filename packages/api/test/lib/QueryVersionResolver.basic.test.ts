import { describe, it, expect, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { expandQueryVersion } from '../../src/lib/QueryVersionResolver.js';
import type { LdkitQueryVersion } from '../../src/persistence/schemas/QueryVersionSchema.js';

const hoisted = vi.hoisted(() => ({
  mockGet: vi.fn().mockReturnValue(null),
}));

// Mock the CacheCoordinatorProvider
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.mockGet,
  }),
}));

// Mock all the LDKit persistence utils
vi.mock('../../src/persistence/utils/LimitParameterUtils.js', () => ({
  loadLimitParametersByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/OffsetParameterUtils.js', () => ({
  loadOffsetParametersByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/QueryInputTupleUtils.js', () => ({
  loadQueryInputTuplesByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/QueryInputUtils.js', () => ({
  loadQueryInputsByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/QueryOutputUtils.js', () => ({
  loadQueryOutputsByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/QueryOutputTupleUtils.js', () => ({
  loadQueryOutputTuplesByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/TriplesQuadsIOUtils.js', () => ({
  loadTriplesQuadsIOsByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/BooleanIOUtils.js', () => ({
  loadBooleanIOsByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/TupleMemberUtils.js', () => ({
  loadTupleMembersByIds: vi.fn().mockResolvedValue([]),
}));

describe('QueryVersionResolver - Basic Tests', () => {
  it('should return outputTuples field in expanded response', async () => {
    // Create a mock QueryVersion with inferredOutputs
    const mockQueryVersion: LdkitQueryVersion = {
      $id: 'urn:test:query-version:123',
      isPartOf: 'urn:test:query:456',
      version: 1,
      queryString: 'SELECT ?x WHERE { ?x a foaf:Person }',
      queryType: QueryTypeIri.select,
      inferredOutputs: ['urn:test:output-tuple:789'],
      dateCreated: new Date().toISOString(),
    };

    const expanded = await expandQueryVersion(mockQueryVersion);

    console.log('Test expanded keys:', Object.keys(expanded));
    console.log('Test outputTuples:', expanded.outputTuples);
    console.log('Test outputTuples length:', expanded.outputTuples?.length);

    // Basic structure checks
    expect(expanded).toHaveProperty('queryVersion');
    expect(expanded).toHaveProperty('outputTuples');
    expect(Array.isArray(expanded.outputTuples)).toBe(true);

    // outputTuples should be defined (may be empty if entities not in cache)
    expect(expanded.outputTuples).toBeDefined();
  });

  it('should handle empty inferredOutputs correctly', async () => {
    // Test what happens when inferredOutputs is empty in queryVersion
    const mockQueryVersion: LdkitQueryVersion = {
      $id: 'urn:test:query-version:456',
      isPartOf: 'urn:test:query:789',
      version: 1,
      queryString: 'SELECT ?x WHERE { ?x a foaf:Person }',
      queryType: QueryTypeIri.select,
      inferredOutputs: [], // Empty array
      dateCreated: new Date().toISOString(),
    };

    const expanded = await expandQueryVersion(mockQueryVersion);

    console.log('Empty test expanded keys:', Object.keys(expanded));
    console.log('Empty test outputTuples:', expanded.outputTuples);
    console.log('Empty test JSON:', JSON.stringify(expanded, null, 2));

    // outputTuples should exist even if empty
    expect(expanded).toHaveProperty('outputTuples');
    expect(Array.isArray(expanded.outputTuples)).toBe(true);
    expect(expanded.outputTuples).toEqual([]);
  });

  it('should handle JSON serialization of inferredOutputs', async () => {
    const mockQueryVersion: LdkitQueryVersion = {
      $id: 'urn:test:query-version:999',
      isPartOf: 'urn:test:query:111',
      version: 1,
      queryString: 'SELECT ?x WHERE { ?x a foaf:Person }',
      queryType: QueryTypeIri.select,
      inferredOutputs: ['urn:test:output-tuple:888'],
      dateCreated: new Date().toISOString(),
    };

    const expanded = await expandQueryVersion(mockQueryVersion);
    const jsonString = JSON.stringify(expanded);
    const parsed = JSON.parse(jsonString);

    console.log('JSON test - original keys:', Object.keys(expanded));
    console.log('JSON test - parsed keys:', Object.keys(parsed));
    console.log('JSON test - original outputTuples:', expanded.outputTuples);
    console.log('JSON test - parsed outputTuples:', parsed.outputTuples);

    // JSON round-trip should preserve the field
    expect(parsed).toHaveProperty('outputTuples');
    expect(Array.isArray(parsed.outputTuples)).toBe(true);
  });
});
