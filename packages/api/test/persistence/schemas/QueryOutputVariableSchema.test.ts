import { describe, it, expect } from 'vitest';

import { QueryOutputVariableSchema } from '../../../src/persistence/schemas/QueryOutputVariableSchema.js';
import { sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryOutputVariableSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryOutputVariableSchema['@type']).toBe(sqlib.QueryOutputVariable);

    expect(QueryOutputVariableSchema).toHaveProperty('variableName');
    expect(QueryOutputVariableSchema.variableName['@id']).toBe(sqlib.variableName);

    expect(QueryOutputVariableSchema).toHaveProperty('description');
    expect(QueryOutputVariableSchema.description['@id']).toBe(sdo.description);
    expect(QueryOutputVariableSchema.description['@optional']).toBe(true);
  });
});
