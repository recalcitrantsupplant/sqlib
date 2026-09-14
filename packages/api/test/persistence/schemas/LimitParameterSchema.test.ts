import { describe, it, expect } from 'vitest';
import { LimitParameterSchema } from '../../../src/persistence/schemas/LimitParameterSchema.js';

describe('LimitParameterSchema', () => {
  it('defines correct @type and properties', () => {
    expect(LimitParameterSchema['@type']).toBe('https://sparql-query-lib/LimitParameter');

    // identifier
    expect(LimitParameterSchema).toHaveProperty('name');
    expect(LimitParameterSchema.name['@id']).toBe('https://schema.org/name');

    // value (optional)
    expect(LimitParameterSchema).toHaveProperty('value');
    expect(LimitParameterSchema.value['@id']).toBe('https://sparql-query-lib/value');
    expect(LimitParameterSchema.value['@optional']).toBe(true);

    // no description on LimitParameter
    expect(LimitParameterSchema).not.toHaveProperty('description');
  });
});
