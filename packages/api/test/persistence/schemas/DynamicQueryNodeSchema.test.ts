import { describe, it, expect } from 'vitest';

import { DynamicQueryNodeSchema } from '../../../src/persistence/schemas/DynamicQueryNodeSchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('DynamicQueryNodeSchema', () => {
  it('defines correct @type and properties', () => {
    expect(DynamicQueryNodeSchema['@type']).toBe(sqlib.DynamicQueryNode);

    expect(DynamicQueryNodeSchema).toHaveProperty('queryId');
    expect(DynamicQueryNodeSchema.queryId['@id']).toBe(sqlib.queryId);
    expect(DynamicQueryNodeSchema.queryId['@type']).toBe(ldkit.IRI);
    expect(DynamicQueryNodeSchema.queryId['@optional']).toBe(true);

    expect(DynamicQueryNodeSchema).toHaveProperty('backendId');
    expect(DynamicQueryNodeSchema.backendId['@id']).toBe(sqlib.backendId);
    expect(DynamicQueryNodeSchema.backendId['@type']).toBe(ldkit.IRI);

    expect(DynamicQueryNodeSchema).toHaveProperty('inputs');
    expect(DynamicQueryNodeSchema.inputs['@id']).toBe(sqlib.inputs);
    expect(DynamicQueryNodeSchema.inputs['@array']).toBe(true);
    expect(DynamicQueryNodeSchema.inputs['@type']).toBe(ldkit.IRI);
    expect(DynamicQueryNodeSchema.inputs['@optional']).toBe(true);

    expect(DynamicQueryNodeSchema).toHaveProperty('outputs');
    expect(DynamicQueryNodeSchema.outputs['@id']).toBe(sqlib.outputs);
    expect(DynamicQueryNodeSchema.outputs['@array']).toBe(true);
    expect(DynamicQueryNodeSchema.outputs['@type']).toBe(ldkit.IRI);
    expect(DynamicQueryNodeSchema.outputs['@optional']).toBe(true);


    expect(DynamicQueryNodeSchema).toHaveProperty('dateCreated');
    expect(DynamicQueryNodeSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(DynamicQueryNodeSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(DynamicQueryNodeSchema.dateCreated['@optional']).toBe(true);

    expect(DynamicQueryNodeSchema).toHaveProperty('dateModified');
    expect(DynamicQueryNodeSchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(DynamicQueryNodeSchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(DynamicQueryNodeSchema.dateModified['@optional']).toBe(true);
  });
});
