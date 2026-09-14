import { describe, it, expect } from 'vitest';

import { EndNodeSchema, isValidMediaType } from '../../../src/persistence/schemas/EndNodeSchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';
import { OUTPUT_MEDIA_TYPE_VALUES } from '../../../src/types/media-types.js';

describe('EndNodeSchema', () => {
  it('defines correct @type and properties', () => {
    expect(EndNodeSchema['@type']).toBe(sqlib.EndNode);

    expect(EndNodeSchema).toHaveProperty('inputs');
    expect(EndNodeSchema.inputs['@id']).toBe(sqlib.inputs);
    expect(EndNodeSchema.inputs['@array']).toBe(true);
    expect(EndNodeSchema.inputs['@type']).toBe(ldkit.IRI);
    expect(EndNodeSchema.inputs['@optional']).toBe(true);

    expect(EndNodeSchema).toHaveProperty('mediaType');
    expect(EndNodeSchema.mediaType['@id']).toBe(sqlib.mediaType);
    expect(EndNodeSchema.mediaType['@optional']).toBe(true);

    expect(EndNodeSchema).toHaveProperty('dateCreated');
    expect(EndNodeSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(EndNodeSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(EndNodeSchema.dateCreated['@optional']).toBe(true);

    expect(EndNodeSchema).toHaveProperty('dateModified');
    expect(EndNodeSchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(EndNodeSchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(EndNodeSchema.dateModified['@optional']).toBe(true);
  });
});

describe('isValidMediaType', () => {
  it('should return true for valid media types', () => {
    OUTPUT_MEDIA_TYPE_VALUES.forEach(mediaType => {
      expect(isValidMediaType(mediaType)).toBe(true);
    });
  });

  it('should return false for invalid media types', () => {
    expect(isValidMediaType('invalid/media-type')).toBe(false);
    expect(isValidMediaType('application/json+ld')).toBe(false); // Not an output type
  });
});
