/**
 * `@references` — what a property's IRI is allowed to point at.
 *
 * The declaration exists because `'@type': ldkit.IRI` says a value is an IRI and
 * nothing more, so every rule about *what* it must resolve to was written out by
 * hand somewhere else (issue #65 Phase B3). A malformed or stale declaration has
 * to fail here: a rule naming a type that no longer exists matches nothing, and
 * a reference check that matches nothing is a check that passes everything.
 */
import { describe, expect, it } from 'vitest';
import { describeSchema, LDKIT_IRI_TYPE } from '../../src/persistence/schemaIntrospection.js';
import { SCHEMA_BY_TYPE } from '../../src/persistence/schemaRegistry.js';
import { ENTITY_TYPE_NAMES } from '../../src/persistence/entityTypeNames.js';

const CLASS = 'https://sparql-query-lib/Thing';

function schemaWithReferences(
  references: unknown,
  extra: Record<string, unknown> = { '@type': LDKIT_IRI_TYPE },
): Record<string, unknown> {
  return {
    '@type': CLASS,
    parent: { '@id': 'https://schema.org/isPartOf', ...extra, '@references': references },
  };
}

describe('entity schema reference declarations', () => {
  it('carries the declared targets onto the described field', () => {
    const field = describeSchema(schemaWithReferences({ types: ['Library'] })).fields[0];

    expect(field.references).toEqual({ types: ['Library'], exactlyOne: null });
  });

  it('leaves fields without one at null', () => {
    const info = describeSchema({
      '@type': CLASS,
      currentVersion: { '@id': 'https://sparql-query-lib/currentVersion', '@type': LDKIT_IRI_TYPE },
    });

    expect(info.fields[0].references).toBeNull();
  });

  it('carries exactlyOne for an array property', () => {
    const field = describeSchema(
      schemaWithReferences(
        { types: ['Library', 'QueryGroup'], exactlyOne: 'Library' },
        { '@type': LDKIT_IRI_TYPE, '@array': true },
      ),
    ).fields[0];

    expect(field.references).toEqual({
      types: ['Library', 'QueryGroup'],
      exactlyOne: 'Library',
    });
  });

  it('rejects a target that is not an entity type', () => {
    expect(() => describeSchema(schemaWithReferences({ types: ['Librarry'] }))).toThrow(
      /not an entity type/,
    );
  });

  it('rejects a declaration with no targets', () => {
    expect(() => describeSchema(schemaWithReferences({ types: [] }))).toThrow(/non-empty "types"/);
    expect(() => describeSchema(schemaWithReferences({}))).toThrow(/non-empty "types"/);
    expect(() => describeSchema(schemaWithReferences(['Library']))).toThrow(/not an object/);
  });

  it('rejects a repeated target', () => {
    expect(() =>
      describeSchema(schemaWithReferences({ types: ['Library', 'Library'] })),
    ).toThrow(/lists "Library" twice/);
  });

  it('rejects exactlyOne that is not one of the targets', () => {
    expect(() =>
      describeSchema(
        schemaWithReferences(
          { types: ['Library'], exactlyOne: 'QueryGroup' },
          { '@type': LDKIT_IRI_TYPE, '@array': true },
        ),
      ),
    ).toThrow(/not among its reference types/);
  });

  it('rejects exactlyOne on a scalar property, where it says nothing', () => {
    expect(() =>
      describeSchema(schemaWithReferences({ types: ['Library'], exactlyOne: 'Library' })),
    ).toThrow(/scalar property/);
  });

  it('rejects a declaration on a property that is not an IRI', () => {
    expect(() =>
      describeSchema(schemaWithReferences({ types: ['Library'] }, { '@type': undefined })),
    ).toThrow(/not an IRI property/);
  });

  it('describes every registered schema, so no declaration in the corpus is stale', () => {
    for (const [type, schema] of Object.entries(SCHEMA_BY_TYPE)) {
      expect(() =>
        describeSchema(schema as unknown as Record<string, unknown>),
        `${type} declares a reference that no longer resolves`,
      ).not.toThrow();
    }
  });

  it('keeps the name list and the schema registry keyed the same', () => {
    // `satisfies Record<EntityTypeName, …>` on both registries makes a missing
    // key a compile error; this catches the reverse — a name in the list that
    // nothing registers, which would let `@references` point at a type the
    // store cannot resolve.
    expect(Object.keys(SCHEMA_BY_TYPE).sort()).toEqual([...ENTITY_TYPE_NAMES].sort());
  });
});
