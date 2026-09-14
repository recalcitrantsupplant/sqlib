import { describe, it, expect } from 'vitest';
import { QueryIdInputSchema } from '../../../src/persistence/schemas/QueryIdInputSchema.js';
import { sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryIdInputSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryIdInputSchema['@type']).toBe(sqlib.QueryIdInput);

    expect(QueryIdInputSchema).toHaveProperty('name');
    expect(QueryIdInputSchema.name['@id']).toBe(sdo.name);
    expect(QueryIdInputSchema.name['@optional']).toBe(true);

    expect(QueryIdInputSchema).toHaveProperty('description');
    expect(QueryIdInputSchema.description['@id']).toBe(sdo.description);
    expect(QueryIdInputSchema.description['@optional']).toBe(true);

    expect(QueryIdInputSchema).toHaveProperty('isPartOf');
    expect(QueryIdInputSchema.isPartOf['@id']).toBe(sdo.isPartOf);
  });
});
