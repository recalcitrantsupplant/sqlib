/**
 * `SCHEMA_BY_TYPE` must cover exactly `ENTITY_TYPE_NAMES`. The registry's
 * `satisfies` already makes a missing type a compile error; this also catches an
 * extra key, which would be a type the cache never preloads.
 */
import { describe, expect, it } from 'vitest';
import { ENTITY_TYPE_NAMES } from '../../src/persistence/entityTypeNames.js';
import { SCHEMA_BY_TYPE } from '../../src/persistence/schemaRegistry.js';
import { describeSchema } from '../../src/persistence/schemaIntrospection.js';

describe('entity type coverage', () => {
  it('registers a schema for every entity type and no others', () => {
    expect(Object.keys(SCHEMA_BY_TYPE).sort()).toEqual([...ENTITY_TYPE_NAMES].sort());
  });

  it.each(Object.keys(SCHEMA_BY_TYPE))('describes %s without unsupported constructs', (type) => {
    const info = describeSchema(SCHEMA_BY_TYPE[type as keyof typeof SCHEMA_BY_TYPE] as unknown as Record<string, unknown>);

    expect(info.classIri).toMatch(/^https?:\/\//);
    // Every field must map to a predicate; a duplicate predicate would have thrown.
    expect(info.fields.length).toBe(info.fieldByPredicate.size);
  });
});
