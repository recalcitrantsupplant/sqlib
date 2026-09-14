import { describe, it, expect } from 'vitest';

import { QueryGroupSchema } from '../../../src/persistence/schemas/QueryGroupSchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryGroupSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryGroupSchema['@type']).toBe(sqlib.QueryGroup);

    expect(QueryGroupSchema).toHaveProperty('name');
    expect(QueryGroupSchema.name['@id']).toBe(sdo.name);

    expect(QueryGroupSchema).toHaveProperty('description');
    expect(QueryGroupSchema.description['@id']).toBe(sdo.description);
    expect(QueryGroupSchema.description['@optional']).toBe(true);

    expect(QueryGroupSchema).toHaveProperty('currentVersion');
    expect(QueryGroupSchema.currentVersion['@id']).toBe(sqlib.currentVersion);
    expect(QueryGroupSchema.currentVersion['@type']).toBe(ldkit.IRI);

    expect(QueryGroupSchema).toHaveProperty('dateCreated');
    expect(QueryGroupSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(QueryGroupSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(QueryGroupSchema.dateCreated['@optional']).toBe(true);

    expect(QueryGroupSchema).toHaveProperty('dateModified');
    expect(QueryGroupSchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(QueryGroupSchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(QueryGroupSchema.dateModified['@optional']).toBe(true);

    expect(QueryGroupSchema).toHaveProperty('isPartOf');
    expect(QueryGroupSchema.isPartOf['@id']).toBe(sdo.isPartOf);
    expect(QueryGroupSchema.isPartOf['@type']).toBe(ldkit.IRI);
  });
});
