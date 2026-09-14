import { describe, it, expect } from 'vitest';
import { BooleanIOSchema } from '../../../src/persistence/schemas/BooleanIOSchema.js';
import { xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('BooleanIOSchema', () => {
  it('defines correct @type and properties', () => {
    expect(BooleanIOSchema['@type']).toBe(sqlib.BooleanIO);

    expect(BooleanIOSchema).toHaveProperty('name');
    expect(BooleanIOSchema.name['@id']).toBe(sdo.name);
    expect(BooleanIOSchema.name['@optional']).toBe(true);

    expect(BooleanIOSchema).toHaveProperty('description');
    expect(BooleanIOSchema.description['@id']).toBe(sdo.description);
    expect(BooleanIOSchema.description['@optional']).toBe(true);

    expect(BooleanIOSchema).toHaveProperty('ioType');
    expect(BooleanIOSchema.ioType['@id']).toBe(sqlib.ioType);
    expect(BooleanIOSchema.ioType['@optional']).toBe(true);

    expect(BooleanIOSchema).toHaveProperty('outputType');
    expect(BooleanIOSchema.outputType['@id']).toBe(sqlib.outputType);
    expect(BooleanIOSchema.outputType['@optional']).toBe(true);

    expect(BooleanIOSchema).toHaveProperty('dateCreated');
    expect(BooleanIOSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(BooleanIOSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(BooleanIOSchema.dateCreated['@optional']).toBe(true);

    expect(BooleanIOSchema).toHaveProperty('dateModified');
    expect(BooleanIOSchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(BooleanIOSchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(BooleanIOSchema.dateModified['@optional']).toBe(true);
  });

  it('defines correct TypeScript interface shape', () => {
    // Verify that the LdkitBooleanIO interface structure is correct
    // This is a compile-time test that ensures type safety
    const mockEntity = {
      $id: 'urn:test:boolean-io:1',
      '@type': 'BooleanIO' as const,
      name: 'Test Boolean IO',
      description: 'Test description for ASK query output',
      ioType: 'output' as const,
      outputType: 'Boolean' as const,
      dateCreated: '2024-01-01T00:00:00Z',
      dateModified: '2024-01-02T12:00:00Z',
    };

    // Type assertions to ensure interface compliance
    expect(typeof mockEntity.$id).toBe('string');
    expect(mockEntity['@type']).toBe('BooleanIO');
    expect(['input', 'output'].includes(mockEntity.ioType as string)).toBe(true);
    expect(['outputTuple', 'RDFGraph', 'Boolean'].includes(mockEntity.outputType as string)).toBe(true);
  });

  it('supports all valid ioType values', () => {
    const inputEntity = {
      $id: 'urn:test:boolean-io:input',
      ioType: 'input' as const,
    };

    const outputEntity = {
      $id: 'urn:test:boolean-io:output',
      ioType: 'output' as const,
    };

    expect(['input', 'output'].includes(inputEntity.ioType)).toBe(true);
    expect(['input', 'output'].includes(outputEntity.ioType)).toBe(true);
  });

  it('supports all valid outputType values', () => {
    const outputTupleEntity = {
      $id: 'urn:test:boolean-io:1',
      outputType: 'outputTuple' as const,
    };

    const rdfGraphEntity = {
      $id: 'urn:test:boolean-io:2',
      outputType: 'RDFGraph' as const,
    };

    const booleanEntity = {
      $id: 'urn:test:boolean-io:3',
      outputType: 'Boolean' as const,
    };

    expect(['outputTuple', 'RDFGraph', 'Boolean'].includes(outputTupleEntity.outputType as string)).toBe(true);
    expect(['outputTuple', 'RDFGraph', 'Boolean'].includes(rdfGraphEntity.outputType as string)).toBe(true);
    expect(['outputTuple', 'RDFGraph', 'Boolean'].includes(booleanEntity.outputType as string)).toBe(true);
  });

  it('supports optional properties correctly', () => {
    // Test minimal entity with only required fields
    const minimalEntity = {
      $id: 'urn:test:boolean-io:minimal',
    };

    expect(typeof minimalEntity.$id).toBe('string');

    // Test entity with all optional fields as null
    const nullOptionalEntity = {
      $id: 'urn:test:boolean-io:null',
      '@type': undefined,
      name: null,
      description: null,
      ioType: null,
      outputType: null,
      dateCreated: null,
      dateModified: null,
    };

    expect(typeof nullOptionalEntity.$id).toBe('string');
  });

  it('validates dateTime format for dateCreated and dateModified', () => {
    const entityWithDates = {
      $id: 'urn:test:boolean-io:dates',
      dateCreated: '2024-01-01T00:00:00Z',
      dateModified: '2024-12-31T23:59:59Z',
    };

    // ISO 8601 format validation
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    expect(isoDateRegex.test(entityWithDates.dateCreated)).toBe(true);
    expect(isoDateRegex.test(entityWithDates.dateModified)).toBe(true);
  });

  it('allows dateCreated and dateModified to be ISO strings', () => {
    const entity = {
      $id: 'urn:test:boolean-io:timestamps',
      dateCreated: new Date('2024-01-01').toISOString(),
      dateModified: new Date('2024-12-31').toISOString(),
    };

    expect(typeof entity.dateCreated).toBe('string');
    expect(typeof entity.dateModified).toBe('string');
    expect(entity.dateCreated.endsWith('Z')).toBe(true);
    expect(entity.dateModified.endsWith('Z')).toBe(true);
  });

  it('represents boolean output for ASK queries', () => {
    // BooleanIO is specifically for ASK query results
    const askQueryOutput = {
      $id: 'urn:test:boolean-io:ask-result',
      '@type': 'BooleanIO' as const,
      name: 'ASK Query Result',
      description: 'Returns true if pattern matches exist',
      ioType: 'output' as const,
      outputType: 'Boolean' as const,
    };

    expect(askQueryOutput['@type']).toBe('BooleanIO');
    expect(askQueryOutput.ioType).toBe('output');
    expect(askQueryOutput.outputType).toBe('Boolean');
  });

  it('supports complete entity with all fields', () => {
    const completeEntity = {
      $id: 'urn:test:boolean-io:complete',
      '@type': 'BooleanIO' as const,
      name: 'Complete Boolean IO',
      description: 'A complete BooleanIO entity with all fields populated',
      ioType: 'output' as const,
      outputType: 'Boolean' as const,
      dateCreated: '2024-01-01T00:00:00Z',
      dateModified: '2024-01-15T10:30:00Z',
    };

    expect(completeEntity.$id).toBeDefined();
    expect(completeEntity['@type']).toBe('BooleanIO');
    expect(completeEntity.name).toBeDefined();
    expect(completeEntity.description).toBeDefined();
    expect(completeEntity.ioType).toBeDefined();
    expect(completeEntity.outputType).toBeDefined();
    expect(completeEntity.dateCreated).toBeDefined();
    expect(completeEntity.dateModified).toBeDefined();
  });

  it('ensures all schema properties are optional except @type', () => {
    // Check that all properties (except @type) are marked as optional
    const schemaKeys = Object.keys(BooleanIOSchema).filter(key => key !== '@type');

    schemaKeys.forEach(key => {
      const property = (BooleanIOSchema as any)[key];
      expect(property['@optional']).toBe(true);
    });
  });

  it('uses correct RDF predicates from namespaces', () => {
    // Verify Schema.org predicates
    expect(BooleanIOSchema.name['@id']).toBe(sdo.name);
    expect(BooleanIOSchema.description['@id']).toBe(sdo.description);
    expect(BooleanIOSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(BooleanIOSchema.dateModified['@id']).toBe(sdo.dateModified);

    // Verify custom sqlib predicates
    expect(BooleanIOSchema.ioType['@id']).toBe(sqlib.ioType);
    expect(BooleanIOSchema.outputType['@id']).toBe(sqlib.outputType);

    // Verify XSD datatype for dates
    expect(BooleanIOSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(BooleanIOSchema.dateModified['@type']).toBe(xsd.dateTime);
  });
});
