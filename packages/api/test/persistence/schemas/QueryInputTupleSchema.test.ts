import { describe, it, expect } from 'vitest';

import { QueryInputTupleSchema } from '../../../src/persistence/schemas/QueryInputTupleSchema.js';
import { ldkit, sqlib, sdo } from '../../../src/persistence/namespaces.js';

describe('QueryInputTupleSchema', () => {
  it('defines correct @type and properties', () => {
    expect(QueryInputTupleSchema['@type']).toBe(sqlib.QueryInputTuple);

    expect(QueryInputTupleSchema).toHaveProperty('name');
    expect(QueryInputTupleSchema.name['@id']).toBe(sdo.name);
    expect(QueryInputTupleSchema.name['@optional']).toBe(true);

    expect(QueryInputTupleSchema).toHaveProperty('memberEntries');
    expect(QueryInputTupleSchema.memberEntries['@id']).toBe(sqlib.memberEntries);
    expect(QueryInputTupleSchema.memberEntries['@array']).toBe(true);
    expect(QueryInputTupleSchema.memberEntries['@type']).toBe(ldkit.IRI);
  });
});
