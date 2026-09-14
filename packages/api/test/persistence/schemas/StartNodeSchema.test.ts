import { describe, it, expect } from 'vitest';

import { StartNodeSchema } from '../../../src/persistence/schemas/StartNodeSchema.js';
import { ldkit, xsd, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('StartNodeSchema', () => {
  it('defines correct @type and properties', () => {
    expect(StartNodeSchema['@type']).toBe(sqlib.StartNode);

    // StartNode should NOT have inputs, only outputs
    expect(StartNodeSchema).not.toHaveProperty('inputs');

    expect(StartNodeSchema).toHaveProperty('outputs');
    expect(StartNodeSchema.outputs['@id']).toBe(sqlib.outputs);
    expect(StartNodeSchema.outputs['@array']).toBe(true);
    expect(StartNodeSchema.outputs['@type']).toBe(ldkit.IRI);
    expect(StartNodeSchema.outputs['@optional']).toBe(true);

    expect(StartNodeSchema).toHaveProperty('dateCreated');
    expect(StartNodeSchema.dateCreated['@id']).toBe(sdo.dateCreated);
    expect(StartNodeSchema.dateCreated['@type']).toBe(xsd.dateTime);
    expect(StartNodeSchema.dateCreated['@optional']).toBe(true);

    expect(StartNodeSchema).toHaveProperty('dateModified');
    expect(StartNodeSchema.dateModified['@id']).toBe(sdo.dateModified);
    expect(StartNodeSchema.dateModified['@type']).toBe(xsd.dateTime);
    expect(StartNodeSchema.dateModified['@optional']).toBe(true);
  });
});
