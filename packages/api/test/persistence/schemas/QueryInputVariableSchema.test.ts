import { describe, it, expect } from 'vitest';

import { QueryInputVariableSchema } from '../../../src/persistence/schemas/QueryInputVariableSchema.js';
import { ldkit, sqlib } from '../../../src/persistence/namespaces.js';

describe('QueryInputVariableSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryInputVariableSchema['@type']).toBe(sqlib.QueryInputVariable);

    expect(QueryInputVariableSchema).toHaveProperty('variableName');
    expect(QueryInputVariableSchema.variableName['@id']).toBe(sqlib.variableName);

    expect(QueryInputVariableSchema).toHaveProperty('allowedTypes');
    expect(QueryInputVariableSchema.allowedTypes['@id']).toBe(sqlib.allowedTypes);
    expect(QueryInputVariableSchema.allowedTypes['@array']).toBe(true);
    expect(QueryInputVariableSchema.allowedTypes['@type']).toBe(ldkit.IRI);
    expect(QueryInputVariableSchema.allowedTypes['@optional']).toBe(true);
  });
});
