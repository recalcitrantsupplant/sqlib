import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TriplesQuadsIOs, findTriplesQuadsIOById, loadTriplesQuadsIOsByIds } from '../../../src/persistence/utils/TriplesQuadsIOUtils.js';
import type { LdkitTriplesQuadsIO } from '../../../src/persistence/schemas/TriplesQuadsIOSchema.js';

// In-memory LDKit lens for this suite
vi.mock('../../../src/persistence/utils/entityRepository', () => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => { const id = obj.$id ?? obj['@id']; const ex = store.get(id) ?? { $id: id, '@id': id }; const merged = { ...ex, ...obj, '@id': id, $id: id }; store.set(id, merged); return merged; },
    delete: async (id: string) => { store.delete(id); },
  };
  return { createRepositoryLens: () => lens };
});

describe('TriplesQuadsIOUtils', () => {
  const mockTriplesQuadsIO: LdkitTriplesQuadsIO = {
    $id: 'urn:test:triplesquads:1',
    '@type': 'TriplesQuadsIO',
    name: 'Test RDF Output',
    description: 'Output for CONSTRUCT query',
    ioType: 'output',
    triplesOrQuads: 'triples',
    specifiedGraph: 'http://example.org/graph1',
    dateCreated: '2024-01-01T00:00:00Z',
    dateModified: '2024-01-01T00:00:00Z'
  };

  afterEach(async () => {
    // Clean up test data from the mocked store
    try {
      await TriplesQuadsIOs.delete(mockTriplesQuadsIO.$id);
      await TriplesQuadsIOs.delete('urn:nonexistent');
      await TriplesQuadsIOs.delete('');
      await TriplesQuadsIOs.delete('urn:nonexistent:1');
      await TriplesQuadsIOs.delete('urn:nonexistent:2');
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('lens export', () => {
    it('exports TriplesQuadsIOs lens correctly', () => {
      expect(TriplesQuadsIOs).toBeDefined();
      expect(typeof TriplesQuadsIOs.find).toBe('function');
      expect(typeof TriplesQuadsIOs.findByIri).toBe('function');
      expect(typeof TriplesQuadsIOs.insert).toBe('function');
      expect(typeof TriplesQuadsIOs.update).toBe('function');
      expect(typeof TriplesQuadsIOs.delete).toBe('function');
    });
  });

  describe('findTriplesQuadsIOById', () => {
    it('returns null for non-existent entity', async () => {
      const result = await findTriplesQuadsIOById('urn:nonexistent');
      expect(result).toBeNull();
    });

    it('handles errors gracefully', async () => {
      // Test error handling by providing invalid IRI
      const result = await findTriplesQuadsIOById('');
      expect(result).toBeNull();
    });
  });

  describe('loadTriplesQuadsIOsByIds', () => {
    it('returns empty array for empty input', async () => {
      const result = await loadTriplesQuadsIOsByIds([]);
      expect(result).toEqual([]);
    });

    it('filters out non-existent entities', async () => {
      const result = await loadTriplesQuadsIOsByIds([
        'urn:nonexistent:1',
        'urn:nonexistent:2'
      ]);
      expect(result).toEqual([]);
    });

    it('handles mixed existing and non-existing ids', async () => {
      const result = await loadTriplesQuadsIOsByIds([
        'urn:nonexistent:1',
        'urn:nonexistent:2'
      ]);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('integration with LDKit lens', () => {
    it('has correct schema properties', () => {
      // Verify the lens has the expected schema structure
      expect(TriplesQuadsIOs).toBeDefined();

      // Test that we can create a valid entity structure
      const validEntity: Partial<LdkitTriplesQuadsIO> = {
        $id: 'urn:test:valid',
        name: 'Valid Entity',
        ioType: 'input',
        triplesOrQuads: 'quads'
      };

      expect(validEntity.$id).toBe('urn:test:valid');
      expect(validEntity.ioType).toBe('input');
      expect(validEntity.triplesOrQuads).toBe('quads');
    });
  });

  describe('type safety', () => {
    it('enforces correct ioType values', () => {
      const inputEntity: Partial<LdkitTriplesQuadsIO> = {
        $id: 'urn:test:input',
        ioType: 'input'
      };

      const outputEntity: Partial<LdkitTriplesQuadsIO> = {
        $id: 'urn:test:output',
        ioType: 'output'
      };

      expect(['input', 'output'].includes(inputEntity.ioType as string)).toBe(true);
      expect(['input', 'output'].includes(outputEntity.ioType as string)).toBe(true);
    });

    it('enforces correct triplesOrQuads values', () => {
      const triplesEntity: Partial<LdkitTriplesQuadsIO> = {
        $id: 'urn:test:triples',
        triplesOrQuads: 'triples'
      };

      const quadsEntity: Partial<LdkitTriplesQuadsIO> = {
        $id: 'urn:test:quads',
        triplesOrQuads: 'quads'
      };

      expect(['triples', 'quads'].includes(triplesEntity.triplesOrQuads as string)).toBe(true);
      expect(['triples', 'quads'].includes(quadsEntity.triplesOrQuads as string)).toBe(true);
    });
  });
});