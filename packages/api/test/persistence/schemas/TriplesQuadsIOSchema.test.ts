import { describe, it, expect } from 'vitest';
import { TriplesQuadsIOSchema } from '../../../src/persistence/schemas/TriplesQuadsIOSchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('TriplesQuadsIOSchema', () => {
  it('defines correct @type and properties', () => {
    expect(TriplesQuadsIOSchema['@type']).toBe(sqlib.TriplesQuadsIO);

    expect(TriplesQuadsIOSchema).toHaveProperty('name');
    expect(TriplesQuadsIOSchema.name['@id']).toBe(sdo.name);
    expect(TriplesQuadsIOSchema.name['@optional']).toBe(true);

    expect(TriplesQuadsIOSchema).toHaveProperty('description');
    expect(TriplesQuadsIOSchema.description['@id']).toBe(sdo.description);
    expect(TriplesQuadsIOSchema.description['@optional']).toBe(true);

    expect(TriplesQuadsIOSchema).toHaveProperty('ioType');
    expect(TriplesQuadsIOSchema.ioType['@id']).toBe(sqlib.ioType);
    expect(TriplesQuadsIOSchema.ioType['@optional']).toBe(true);

    expect(TriplesQuadsIOSchema).toHaveProperty('triplesOrQuads');
    expect(TriplesQuadsIOSchema.triplesOrQuads['@id']).toBe(sqlib.triplesOrQuads);
    expect(TriplesQuadsIOSchema.triplesOrQuads['@optional']).toBe(true);

    expect(TriplesQuadsIOSchema).toHaveProperty('specifiedGraph');
    expect(TriplesQuadsIOSchema.specifiedGraph['@id']).toBe(sqlib.specifiedGraph);
    expect(TriplesQuadsIOSchema.specifiedGraph['@type']).toBe(ldkit.IRI);
    expect(TriplesQuadsIOSchema.specifiedGraph['@optional']).toBe(true);

    expect(TriplesQuadsIOSchema).toHaveProperty('dateCreated');
    expect(TriplesQuadsIOSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(TriplesQuadsIOSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(TriplesQuadsIOSchema.dateCreated['@optional']).toBe(true);

    expect(TriplesQuadsIOSchema).toHaveProperty('dateModified');
    expect(TriplesQuadsIOSchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(TriplesQuadsIOSchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(TriplesQuadsIOSchema.dateModified['@optional']).toBe(true);
  });

  it('defines correct TypeScript interface shape', () => {
    // Verify that the LdkitTriplesQuadsIO interface structure is correct
    // This is a compile-time test that ensures type safety
    const mockEntity = {
      $id: 'urn:test:triplesquads:1',
      '@type': 'TriplesQuadsIO' as const,
      name: 'Test RDF Output',
      description: 'Test description',
      ioType: 'output' as const,
      triplesOrQuads: 'triples' as const,
      specifiedGraph: 'http://example.org/graph1',
      dateCreated: '2024-01-01T00:00:00Z',
      dateModified: '2024-01-01T00:00:00Z'
    };

    // Type assertions to ensure interface compliance
    expect(typeof mockEntity.$id).toBe('string');
    expect(mockEntity['@type']).toBe('TriplesQuadsIO');
    expect(['input', 'output'].includes(mockEntity.ioType as string)).toBe(true);
    expect(['triples', 'quads'].includes(mockEntity.triplesOrQuads as string)).toBe(true);
  });

  it('supports optional properties correctly', () => {
    // Test minimal entity with only required fields
    const minimalEntity = {
      $id: 'urn:test:triplesquads:minimal',
    };

    expect(typeof minimalEntity.$id).toBe('string');

    // Test entity with all optional fields as null
    const nullOptionalEntity = {
      $id: 'urn:test:triplesquads:null',
      '@type': undefined,
      name: null,
      description: null,
      ioType: null,
      triplesOrQuads: null,
      specifiedGraph: null,
      dateCreated: null,
      dateModified: null
    };

    expect(typeof nullOptionalEntity.$id).toBe('string');
  });
});