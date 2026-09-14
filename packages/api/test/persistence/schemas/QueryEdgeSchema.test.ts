import { describe, it, expect } from 'vitest';

import { QueryEdgeSchema } from '../../../src/persistence/schemas/QueryEdgeSchema.js';
import { ldkit, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryEdgeSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryEdgeSchema['@type']).toBe(sqlib.QueryEdge);

    expect(QueryEdgeSchema).toHaveProperty('sourceNodeId');
    expect(QueryEdgeSchema.sourceNodeId['@id']).toBe(sqlib.sourceNodeId);
    expect(QueryEdgeSchema.sourceNodeId['@type']).toBe(ldkit.IRI);

    expect(QueryEdgeSchema).toHaveProperty('targetNodeId');
    expect(QueryEdgeSchema.targetNodeId['@id']).toBe(sqlib.targetNodeId);
    expect(QueryEdgeSchema.targetNodeId['@type']).toBe(ldkit.IRI);

    expect(QueryEdgeSchema).toHaveProperty('dataFlowType');
    expect(QueryEdgeSchema.dataFlowType['@id']).toBe(sqlib.dataFlowType);
    expect(QueryEdgeSchema.dataFlowType['@optional']).toBe(true);

    expect(QueryEdgeSchema).toHaveProperty('sourceOutputId');
    expect(QueryEdgeSchema.sourceOutputId['@id']).toBe(sqlib.sourceOutputId);
    expect(QueryEdgeSchema.sourceOutputId['@type']).toBe(ldkit.IRI);
    expect(QueryEdgeSchema.sourceOutputId['@optional']).toBe(true);

    expect(QueryEdgeSchema).toHaveProperty('targetInputId');
    expect(QueryEdgeSchema.targetInputId['@id']).toBe(sqlib.targetInputId);
    expect(QueryEdgeSchema.targetInputId['@type']).toBe(ldkit.IRI);
    expect(QueryEdgeSchema.targetInputId['@optional']).toBe(true);

  });
});
