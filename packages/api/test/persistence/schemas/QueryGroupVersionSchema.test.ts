import { describe, it, expect } from 'vitest';

import { QueryGroupVersionSchema } from '../../../src/persistence/schemas/QueryGroupVersionSchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryGroupVersionSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryGroupVersionSchema['@type']).toBe(sqlib.QueryGroupVersion);

    expect(QueryGroupVersionSchema).toHaveProperty('version');
    expect(QueryGroupVersionSchema.version['@id']).toBe(sdo.version);
    expect(QueryGroupVersionSchema.version['@type']).toBe(xsd.integer);

    expect(QueryGroupVersionSchema).toHaveProperty('executionNodes');
    expect(QueryGroupVersionSchema.executionNodes['@id']).toBe(sqlib.executionNodes);
    expect(QueryGroupVersionSchema.executionNodes['@array']).toBe(true);
    expect(QueryGroupVersionSchema.executionNodes['@type']).toBe(ldkit.IRI);
    expect(QueryGroupVersionSchema.executionNodes['@optional']).toBe(true);

    expect(QueryGroupVersionSchema).toHaveProperty('edges');
    expect(QueryGroupVersionSchema.edges['@id']).toBe(sqlib.edges);
    expect(QueryGroupVersionSchema.edges['@array']).toBe(true);
    expect(QueryGroupVersionSchema.edges['@type']).toBe(ldkit.IRI);
    expect(QueryGroupVersionSchema.edges['@optional']).toBe(true);

    expect(QueryGroupVersionSchema).toHaveProperty('canvasData');
    expect(QueryGroupVersionSchema.canvasData['@id']).toBe(sqlib.canvasData);
    expect(QueryGroupVersionSchema.canvasData['@optional']).toBe(true);

    expect(QueryGroupVersionSchema).toHaveProperty('comment');
    expect(QueryGroupVersionSchema.comment['@id']).toBe(sdo.comment);
    expect(QueryGroupVersionSchema.comment['@optional']).toBe(true);

    expect(QueryGroupVersionSchema).toHaveProperty('dateCreated');
    expect(QueryGroupVersionSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(QueryGroupVersionSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(QueryGroupVersionSchema.dateCreated['@optional']).toBe(true);

    expect(QueryGroupVersionSchema).toHaveProperty('isPartOf');
    expect(QueryGroupVersionSchema.isPartOf['@id']).toBe(sdo.isPartOf);
    expect(QueryGroupVersionSchema.isPartOf['@type']).toBe(ldkit.IRI);
  });
});
