import { describe, it, expect } from 'vitest';

import { QueryVersionSchema } from '../../../src/persistence/schemas/QueryVersionSchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryVersionSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryVersionSchema['@type']).toBe(sqlib.QueryVersion);

    expect(QueryVersionSchema).toHaveProperty('isPartOf');
    expect(QueryVersionSchema.isPartOf['@id']).toBe(sdo.isPartOf);
    expect(QueryVersionSchema.isPartOf['@type']).toBe(ldkit.IRI);

    expect(QueryVersionSchema).toHaveProperty('version');
    expect(QueryVersionSchema.version['@id']).toBe(sdo.version);
    expect(QueryVersionSchema.version['@type']).toBe(xsd.integer);

    expect(QueryVersionSchema).toHaveProperty('queryString');
    expect(QueryVersionSchema.queryString['@id']).toBe(sqlib.query);
    expect(QueryVersionSchema.queryString['@type']).toBe(xsd.string);

    expect(QueryVersionSchema).toHaveProperty('comment');
    expect(QueryVersionSchema.comment['@id']).toBe(sdo.comment);
    expect(QueryVersionSchema.comment['@optional']).toBe(true);

    expect(QueryVersionSchema).toHaveProperty('queryType');
    expect(QueryVersionSchema.queryType['@id']).toBe(sqlib.queryType);
    expect(QueryVersionSchema.queryType['@optional']).toBe(true);

    expect(QueryVersionSchema).toHaveProperty('limitParameters');
    expect(QueryVersionSchema.limitParameters['@id']).toBe(sqlib.limitParameters);
    expect(QueryVersionSchema.limitParameters['@array']).toBe(true);
    expect(QueryVersionSchema.limitParameters['@type']).toBe(ldkit.IRI);
    expect(QueryVersionSchema.limitParameters['@optional']).toBe(true);

    expect(QueryVersionSchema).toHaveProperty('offsetParameters');
    expect(QueryVersionSchema.offsetParameters['@id']).toBe(sqlib.offsetParameters);
    expect(QueryVersionSchema.offsetParameters['@array']).toBe(true);
    expect(QueryVersionSchema.offsetParameters['@type']).toBe(ldkit.IRI);
    expect(QueryVersionSchema.offsetParameters['@optional']).toBe(true);

    expect(QueryVersionSchema).toHaveProperty('inferredInputs');
    expect(QueryVersionSchema.inferredInputs['@id']).toBe(sqlib.inferredInputs);
    expect(QueryVersionSchema.inferredInputs['@array']).toBe(true);
    expect(QueryVersionSchema.inferredInputs['@type']).toBe(ldkit.IRI);
    expect(QueryVersionSchema.inferredInputs['@optional']).toBe(true);

    expect(QueryVersionSchema).toHaveProperty('inferredOutputs');
    expect(QueryVersionSchema.inferredOutputs['@id']).toBe(sqlib.inferredOutputs);
    expect(QueryVersionSchema.inferredOutputs['@array']).toBe(true);
    expect(QueryVersionSchema.inferredOutputs['@type']).toBe(ldkit.IRI);
    expect(QueryVersionSchema.inferredOutputs['@optional']).toBe(true);

    expect(QueryVersionSchema).toHaveProperty('dateCreated');
    expect(QueryVersionSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(QueryVersionSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(QueryVersionSchema.dateCreated['@optional']).toBe(true);

  });
});
