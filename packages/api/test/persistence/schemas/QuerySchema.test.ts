import { describe, it, expect } from 'vitest';

import { QuerySchema } from '../../../src/persistence/schemas/QuerySchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QuerySchema', () => {
  it('defines correct @type and properties', () => {
    expect(QuerySchema['@type']).toBe(sqlib.Query);

    expect(QuerySchema).toHaveProperty('name');
    expect(QuerySchema.name['@id']).toBe(sdo.name);

    expect(QuerySchema).toHaveProperty('description');
    expect(QuerySchema.description['@id']).toBe(sdo.description);
    expect(QuerySchema.description['@optional']).toBe(true);

    expect(QuerySchema).toHaveProperty('currentVersion');
    expect(QuerySchema.currentVersion['@id']).toBe(sqlib.currentVersion);
    expect(QuerySchema.currentVersion['@type']).toBe(ldkit.IRI);
    expect(QuerySchema.currentVersion['@optional']).toBe(true);

    expect(QuerySchema).toHaveProperty('defaultBackend');
    expect(QuerySchema.defaultBackend['@id']).toBe(sqlib.defaultBackend);
    expect(QuerySchema.defaultBackend['@type']).toBe(ldkit.IRI);
    expect(QuerySchema.defaultBackend['@optional']).toBe(true);

    expect(QuerySchema).toHaveProperty('dateCreated');
    expect(QuerySchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(QuerySchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(QuerySchema.dateCreated['@optional']).toBe(true);

    expect(QuerySchema).toHaveProperty('dateModified');
    expect(QuerySchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(QuerySchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(QuerySchema.dateModified['@optional']).toBe(true);
  });
});
