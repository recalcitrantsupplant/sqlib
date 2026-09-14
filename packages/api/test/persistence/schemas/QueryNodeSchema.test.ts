import { describe, it, expect } from 'vitest';

import { QueryNodeSchema } from '../../../src/persistence/schemas/QueryNodeSchema.js';
import { ldkit, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryNodeSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryNodeSchema['@type']).toBe(sqlib.QueryNode);

    expect(QueryNodeSchema).toHaveProperty('queryId');
    expect(QueryNodeSchema.queryId['@id']).toBe(sqlib.queryId);
    expect(QueryNodeSchema.queryId['@type']).toBe(ldkit.IRI);

    expect(QueryNodeSchema).toHaveProperty('backendId');
    expect(QueryNodeSchema.backendId['@id']).toBe(sqlib.backendId);
    expect(QueryNodeSchema.backendId['@type']).toBe(ldkit.IRI);

    expect(QueryNodeSchema).toHaveProperty('inputs');
    expect(QueryNodeSchema.inputs['@id']).toBe(sqlib.inputs);
    expect(QueryNodeSchema.inputs['@array']).toBe(true);
    expect(QueryNodeSchema.inputs['@type']).toBe(ldkit.IRI);
    expect(QueryNodeSchema.inputs['@optional']).toBe(true);

    expect(QueryNodeSchema).toHaveProperty('outputs');
    expect(QueryNodeSchema.outputs['@id']).toBe(sqlib.outputs);
    expect(QueryNodeSchema.outputs['@array']).toBe(true);
    expect(QueryNodeSchema.outputs['@type']).toBe(ldkit.IRI);
    expect(QueryNodeSchema.outputs['@optional']).toBe(true);

  });
});
