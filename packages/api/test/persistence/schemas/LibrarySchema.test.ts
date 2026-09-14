import { describe, it, expect } from 'vitest';

import { LibrarySchema } from '../../../src/persistence/schemas/LibrarySchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('LibrarySchema', () => {
  it('defines correct @type and properties', () => {
    expect(LibrarySchema['@type']).toBe(sqlib.Library);

    expect(LibrarySchema).toHaveProperty('name');
    expect(LibrarySchema.name['@id']).toBe(sdo.name);

    expect(LibrarySchema).toHaveProperty('description');
    expect(LibrarySchema.description['@id']).toBe(sdo.description);
    expect(LibrarySchema.description['@optional']).toBe(true);

    expect(LibrarySchema).toHaveProperty('defaultBackend');
    expect(LibrarySchema.defaultBackend['@id']).toBe(sqlib.defaultBackend);
    expect(LibrarySchema.defaultBackend['@type']).toBe(ldkit.IRI);
    expect(LibrarySchema.defaultBackend['@optional']).toBe(true);

    expect(LibrarySchema).toHaveProperty('dateCreated');
    expect(LibrarySchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(LibrarySchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(LibrarySchema.dateCreated['@optional']).toBe(true);

    expect(LibrarySchema).toHaveProperty('dateModified');
    expect(LibrarySchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(LibrarySchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(LibrarySchema.dateModified['@optional']).toBe(true);
  });
});
