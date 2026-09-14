/**
 * `@values` — a property's permitted values, as `API token -> stored RDF value`.
 *
 * `describeSchema` is the one module that interprets the schema format, so it is
 * where a malformed vocabulary has to be caught: an empty or duplicated one that
 * got through would be emitted into the published contract as an `enum` nobody
 * could satisfy, and the failure would surface as a rejected request rather than
 * as a broken schema.
 */
import { describe, expect, it } from 'vitest';
import { describeSchema, LDKIT_IRI_TYPE } from '../../src/persistence/schemaIntrospection.js';
import { BackendSchema, BackendTypeIri, QueryMethodIri } from '../../src/persistence/schemas/BackendSchema.js';

const CLASS = 'https://sparql-query-lib/Thing';

function schemaWithValues(values: unknown): Record<string, unknown> {
  return {
    '@type': CLASS,
    kind: { '@id': 'https://sparql-query-lib/kind', '@type': LDKIT_IRI_TYPE, '@values': values },
  };
}

describe('entity schema value vocabularies', () => {
  it('carries the declared vocabulary onto the described field', () => {
    const field = describeSchema(schemaWithValues({ a: 'urn:v:a', b: 'urn:v:b' })).fields[0];

    expect(field.values).toEqual({ a: 'urn:v:a', b: 'urn:v:b' });
    // A vocabulary constrains which values are legal, not how a legal one
    // decodes: the field is still an IRI reference.
    expect(field.kind).toBe('iri');
  });

  it('leaves fields without one at null', () => {
    const info = describeSchema({
      '@type': CLASS,
      name: { '@id': 'https://schema.org/name' },
    });

    expect(info.fields[0].values).toBeNull();
  });

  it('rejects an empty vocabulary', () => {
    expect(() => describeSchema(schemaWithValues({}))).toThrow(/empty "@values"/);
  });

  it('rejects a vocabulary that is not a token map', () => {
    expect(() => describeSchema(schemaWithValues(['a', 'b']))).toThrow(/not an object/);
    expect(() => describeSchema(schemaWithValues({ a: 3 }))).toThrow(/non-string value/);
  });

  it('rejects two tokens sharing one stored value', () => {
    // Translation back from the store would be ambiguous, so the store could not
    // say which token to put on the wire.
    expect(() => describeSchema(schemaWithValues({ a: 'urn:v:x', b: 'urn:v:x' }))).toThrow(
      /same value urn:v:x/,
    );
  });

  it("declares Backend's two vocabularies from the maps its routes translate with", () => {
    const info = describeSchema(BackendSchema as unknown as Record<string, unknown>);

    expect(info.fieldByPredicate.get('https://sparql-query-lib/backendType')?.values).toBe(
      BackendTypeIri,
    );
    expect(info.fieldByPredicate.get('https://sparql-query-lib/queryMethod')?.values).toBe(
      QueryMethodIri,
    );
  });
});
