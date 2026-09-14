/**
 * `@projects` — a value surfaced on read by following an IRI.
 *
 * The declaration exists because a version's number lives on the version, and
 * every caller listing entities wants it beside the entity ("v3"). The
 * alternatives all put the fact somewhere the model could not check it: stored
 * twice in RDF, encoded in the IRI, or resolved by hand in each list route.
 *
 * A malformed declaration has to fail here, at the schema, because the failures
 * are otherwise silent — a projection with no reference has no schema to read
 * the target property from, and one with two possible targets has two answers
 * to what type the field is.
 */
import { describe, expect, it } from 'vitest';
import { describeSchema, LDKIT_IRI_TYPE } from '../../src/persistence/schemaIntrospection.js';
import { SCHEMA_BY_TYPE } from '../../src/persistence/schemaRegistry.js';

const CLASS = 'https://sparql-query-lib/Thing';
const CURRENT_VERSION = 'https://sparql-query-lib/currentVersion';

function schemaWithProjection(
  projects: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    '@type': CLASS,
    currentVersion: {
      '@id': CURRENT_VERSION,
      '@type': LDKIT_IRI_TYPE,
      '@references': { types: ['QueryVersion'] },
      '@projects': projects,
      ...overrides,
    },
  };
}

describe('entity schema projection declarations', () => {
  it('carries the declaration, resolved to its single target type', () => {
    const field = describeSchema(
      schemaWithProjection({ as: 'currentVersionNumber', property: 'version' }),
    ).fields[0];

    expect(field.projects).toEqual({
      as: 'currentVersionNumber',
      property: 'version',
      targetType: 'QueryVersion',
    });
  });

  it('leaves a property without one at null', () => {
    const info = describeSchema({
      '@type': CLASS,
      currentVersion: { '@id': CURRENT_VERSION, '@type': LDKIT_IRI_TYPE },
    });

    expect(info.fields[0].projects).toBeNull();
  });

  it('rejects a projection on a property that is not an IRI', () => {
    // Nothing to follow: a string is a value, not a reference.
    expect(() =>
      describeSchema(
        schemaWithProjection({ as: 'n', property: 'version' }, { '@type': undefined }),
      ),
    ).toThrow(/not an IRI property/);
  });

  it('rejects a projection with no reference declaration', () => {
    expect(() =>
      describeSchema(
        schemaWithProjection({ as: 'n', property: 'version' }, { '@references': undefined }),
      ),
    ).toThrow(/exactly one type/);
  });

  it('rejects a projection whose reference could resolve to two types', () => {
    // Two targets, two schemas, two possible datatypes for one field.
    expect(() =>
      describeSchema(
        schemaWithProjection(
          { as: 'n', property: 'version' },
          { '@references': { types: ['QueryVersion', 'RuleVersion'] } },
        ),
      ),
    ).toThrow(/exactly one type/);
  });

  it('rejects a projection on an array property', () => {
    expect(() =>
      describeSchema(
        schemaWithProjection({ as: 'n', property: 'version' }, { '@array': true }),
      ),
    ).toThrow(/array property/);
  });

  it('rejects a declaration missing either half', () => {
    expect(() => describeSchema(schemaWithProjection({ property: 'version' }))).toThrow(/"as"/);
    expect(() => describeSchema(schemaWithProjection({ as: 'n' }))).toThrow(/"property"/);
  });

  it('rejects a declaration that is not an object', () => {
    expect(() => describeSchema(schemaWithProjection('version'))).toThrow(/not an object/);
  });

  /**
   * The guard the unit cases above cannot give: every projection declared in
   * the real corpus must name a property that actually exists on the target,
   * or the field it emits can never be populated.
   */
  it('every declared projection reads a property its target really has', () => {
    for (const [typeName, schema] of Object.entries(SCHEMA_BY_TYPE)) {
      const info = describeSchema(schema as Record<string, unknown>);
      for (const field of info.fields) {
        if (!field.projects) continue;

        const target = SCHEMA_BY_TYPE[field.projects.targetType as keyof typeof SCHEMA_BY_TYPE];
        expect(
          target,
          `${typeName}.${field.name} projects from unknown type ${field.projects.targetType}`,
        ).toBeDefined();

        const targetFields = describeSchema(target as Record<string, unknown>).fields;
        expect(
          targetFields.some((candidate) => candidate.name === field.projects!.property),
          `${typeName}.${field.name} projects "${field.projects.property}", which ${field.projects.targetType} does not have`,
        ).toBe(true);
      }
    }
  });
});
