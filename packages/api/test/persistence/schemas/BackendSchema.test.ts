import { describe, it, expect } from 'vitest';
import { BackendSchema } from '../../../src/persistence/schemas/BackendSchema.js';
import { xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('BackendSchema', () => {
  it('defines correct @type and properties', () => {
    expect(BackendSchema['@type']).toBe(sqlib.Backend);

    expect(BackendSchema).toHaveProperty('name');
    expect(BackendSchema.name['@id']).toBe(sdo.name);

    expect(BackendSchema).toHaveProperty('description');
    expect(BackendSchema.description['@id']).toBe(sdo.description);
    expect(BackendSchema.description['@optional']).toBe(true);

    expect(BackendSchema).toHaveProperty('backendType');
    expect(BackendSchema.backendType['@id']).toBe(sqlib.backendType);

    expect(BackendSchema).toHaveProperty('endpoint');
    expect(BackendSchema.endpoint['@id']).toBe(sdo.url);
    expect(BackendSchema.endpoint['@type']).toBe(xsd.anyURI);

    expect(BackendSchema).toHaveProperty('authEnvKey');
    expect(BackendSchema.authEnvKey['@id']).toBe(sqlib.authEnvKey);
    expect(BackendSchema.authEnvKey['@optional']).toBe(true);

    expect(BackendSchema).toHaveProperty('dateCreated');
    expect(BackendSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(BackendSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(BackendSchema.dateCreated['@optional']).toBe(true);

    expect(BackendSchema).toHaveProperty('dateModified');
    expect(BackendSchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(BackendSchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(BackendSchema.dateModified['@optional']).toBe(true);
  });
});
