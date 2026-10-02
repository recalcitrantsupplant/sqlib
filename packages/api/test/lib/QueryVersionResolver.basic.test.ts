import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { expandQueryVersion } from '../../src/lib/QueryVersionResolver.js';
import type { LdkitQueryVersion } from '../../src/persistence/schemas/QueryVersionSchema.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

describe('QueryVersionResolver - Basic Tests', () => {
  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    // One output tuple with one member; the other ids the versions name are unknown.
    store = await installFakePersistenceAdapter([
      {
        type: 'QueryOutputTuple',
        entity: { $id: 'urn:test:output-tuple:789', '@type': 'QueryOutputTuple', memberEntries: ['urn:test:member:1'] },
      },
      {
        type: 'TupleMember',
        entity: { $id: 'urn:test:member:1', '@type': 'TupleMember', position: 0, variable: 'urn:test:output:x' },
      },
    ]);
  });

  afterEach(() => store.restore());

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

    // Basic structure checks
    expect(expanded).toHaveProperty('queryVersion');
    expect(expanded).toHaveProperty('outputTuples');
    expect(Array.isArray(expanded.outputTuples)).toBe(true);

    // The stored output tuple the version names is resolved into it
    expect(expanded.outputTuples).toEqual([
      expect.objectContaining({ id: 'urn:test:output-tuple:789', memberEntries: ['urn:test:member:1'] }),
    ]);
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

    // JSON round-trip should preserve the field
    expect(parsed).toHaveProperty('outputTuples');
    expect(Array.isArray(parsed.outputTuples)).toBe(true);
  });
});
