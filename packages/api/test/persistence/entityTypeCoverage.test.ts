/**
 * `LENS_BY_TYPE` and `SCHEMA_BY_TYPE` describe the same set of entity types by two
 * different routes. A type added to one and not the other fails here rather than
 * at runtime, where it would surface as a type silently missing from boot load.
 */
import { describe, expect, it } from 'vitest';
import { LENS_BY_TYPE } from '../../src/lib/EntityRegistry.js';
import { SCHEMA_BY_TYPE } from '../../src/persistence/schemaRegistry.js';
import { describeSchema } from '../../src/persistence/schemaIntrospection.js';

describe('entity type coverage', () => {
  it('registers a schema for every lens-backed entity type', () => {
    expect(Object.keys(SCHEMA_BY_TYPE).sort()).toEqual(Object.keys(LENS_BY_TYPE).sort());
  });

  it.each(Object.keys(SCHEMA_BY_TYPE))('describes %s without unsupported constructs', (type) => {
    const info = describeSchema(SCHEMA_BY_TYPE[type as keyof typeof SCHEMA_BY_TYPE] as unknown as Record<string, unknown>);

    expect(info.classIri).toMatch(/^https?:\/\//);
    // Every field must map to a predicate; a duplicate predicate would have thrown.
    expect(info.fields.length).toBe(info.fieldByPredicate.size);
  });
});
