import { describe, it, expect } from 'vitest';
import { OffsetParameterSchema } from '../../../src/persistence/schemas/OffsetParameterSchema.js';

describe('OffsetParameterSchema', () => {
  it('defines correct @type and properties', () => {
    expect(OffsetParameterSchema['@type']).toBe('https://sparql-query-lib/OffsetParameter');

    // identifier
    expect(OffsetParameterSchema).toHaveProperty('name');
    expect(OffsetParameterSchema.name['@id']).toBe('https://schema.org/name');

    // value (optional)
    expect(OffsetParameterSchema).toHaveProperty('value');
    expect(OffsetParameterSchema.value['@id']).toBe('https://sparql-query-lib/value');
    expect(OffsetParameterSchema.value['@optional']).toBe(true);

    // no description on OffsetParameter
    expect(OffsetParameterSchema).not.toHaveProperty('description');
  });
});
