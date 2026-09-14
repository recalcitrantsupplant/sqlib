import { describe, it, expect } from 'vitest';

import { TupleMemberSchema } from '../../../src/persistence/schemas/TupleMemberSchema.js';
import { ldkit, xsd, sqlib } from '../../../src/persistence/namespaces.js';

describe('TupleMemberSchema', () => {
  it('defines correct @type and properties', () => {
    expect(TupleMemberSchema['@type']).toBe(sqlib.TupleMember);

    expect(TupleMemberSchema).toHaveProperty('position');
    expect(TupleMemberSchema.position['@id']).toBe(sqlib.position);
    expect(TupleMemberSchema.position['@type']).toBe(xsd.integer);

    expect(TupleMemberSchema).toHaveProperty('variable');
    expect(TupleMemberSchema.variable['@id']).toBe(sqlib.variable);
    expect(TupleMemberSchema.variable['@type']).toBe(ldkit.IRI);
  });
});
