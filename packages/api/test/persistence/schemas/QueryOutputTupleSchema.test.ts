import { describe, it, expect } from 'vitest';

import { QueryOutputTupleSchema } from '../../../src/persistence/schemas/QueryOutputTupleSchema.js';
import { ldkit, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryOutputTupleSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryOutputTupleSchema['@type']).toBe(sqlib.QueryOutputTuple);

    expect(QueryOutputTupleSchema).toHaveProperty('name');
    expect(QueryOutputTupleSchema.name['@id']).toBe(sdo.name);

    expect(QueryOutputTupleSchema).toHaveProperty('memberEntries');
    expect(QueryOutputTupleSchema.memberEntries['@id']).toBe(sqlib.memberEntries);
    expect(QueryOutputTupleSchema.memberEntries['@array']).toBe(true);
    expect(QueryOutputTupleSchema.memberEntries['@type']).toBe(ldkit.IRI);
  });
});
