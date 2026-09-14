/**
 * Unit coverage for serialisation. The parity suite proves agreement with LDKit
 * against a real store; these pin the term-level details that are easier to read
 * as assertions than as N-Triples diffs.
 */
import { describe, expect, it } from 'vitest';
import { serialiseEntity, toNTriples } from '../../src/persistence/EntitySerialiser.js';
import { LDKIT_IRI_TYPE, RDF_JSON_TYPE } from '../../src/persistence/schemaIntrospection.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const P = 'http://example.org/p';

const SCHEMA = {
  '@type': 'http://example.org/Thing',
  label: { '@id': `${P}/label` },
  explicitString: { '@id': `${P}/explicitString`, '@type': `${XSD}string` },
  count: { '@id': `${P}/count`, '@type': `${XSD}integer` },
  ratio: { '@id': `${P}/ratio`, '@type': `${XSD}decimal` },
  enabled: { '@id': `${P}/enabled`, '@type': `${XSD}boolean` },
  createdAt: { '@id': `${P}/createdAt`, '@type': `${XSD}dateTime` },
  window: { '@id': `${P}/window`, '@type': `${XSD}duration` },
  ref: { '@id': `${P}/ref`, '@type': LDKIT_IRI_TYPE },
  tags: { '@id': `${P}/tags`, '@array': true },
  config: { '@id': `${P}/config`, '@type': RDF_JSON_TYPE },
} as Record<string, unknown>;

const ID = 'http://example.org/thing-1';

function objectFor(entity: Record<string, unknown>, predicate: string): string[] {
  return serialiseEntity(SCHEMA, entity)
    .filter((triple) => triple.predicate === `<${P}/${predicate}>`)
    .map((triple) => triple.object);
}

describe('EntitySerialiser', () => {
  it('always writes an rdf:type triple', () => {
    const triples = serialiseEntity(SCHEMA, { $id: ID });

    expect(triples).toEqual([
      {
        subject: `<${ID}>`,
        predicate: '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>',
        object: '<http://example.org/Thing>',
      },
    ]);
  });

  it('writes plain literals for untyped and xsd:string properties', () => {
    // LDKit writes both without a datatype, and RDF 1.1 makes them the same term.
    expect(objectFor({ $id: ID, label: 'a' }, 'label')).toEqual(['"a"']);
    expect(objectFor({ $id: ID, explicitString: 'b' }, 'explicitString')).toEqual(['"b"']);
  });

  it('writes the declared datatype for everything else', () => {
    expect(objectFor({ $id: ID, count: 42 }, 'count')).toEqual([`"42"^^<${XSD}integer>`]);
    expect(objectFor({ $id: ID, ratio: 1.5 }, 'ratio')).toEqual([`"1.5"^^<${XSD}decimal>`]);
    expect(objectFor({ $id: ID, enabled: true }, 'enabled')).toEqual([`"true"^^<${XSD}boolean>`]);
    // A datatype that merely decodes as a string still round-trips as itself.
    expect(objectFor({ $id: ID, window: 'PT5M' }, 'window')).toEqual([`"PT5M"^^<${XSD}duration>`]);
  });

  it('writes IRI references as nodes, not literals', () => {
    expect(objectFor({ $id: ID, ref: 'http://example.org/other' }, 'ref')).toEqual(['<http://example.org/other>']);
  });

  it('passes a dateTime string through without rewriting its offset', () => {
    // Round-tripping via `Date` would normalise this to UTC, changing the stored
    // lexical form that write-parity compares.
    expect(objectFor({ $id: ID, createdAt: '2026-01-02T03:04:05+02:00' }, 'createdAt')).toEqual([
      `"2026-01-02T03:04:05+02:00"^^<${XSD}dateTime>`,
    ]);
  });

  it('serialises a Date, which LDKit drops', () => {
    expect(objectFor({ $id: ID, createdAt: new Date('2026-01-02T03:04:05.456Z') }, 'createdAt')).toEqual([
      `"2026-01-02T03:04:05.456Z"^^<${XSD}dateTime>`,
    ]);
  });

  it('omits null and undefined, including inside arrays', () => {
    const triples = serialiseEntity(SCHEMA, {
      $id: ID,
      label: null,
      count: undefined,
      tags: ['keep', null, undefined, 'also-keep'],
    });

    expect(triples.filter((t) => t.predicate.includes('label'))).toEqual([]);
    expect(triples.filter((t) => t.predicate.includes('count'))).toEqual([]);
    expect(triples.filter((t) => t.predicate.includes('tags')).map((t) => t.object)).toEqual(['"keep"', '"also-keep"']);
  });

  it('ignores properties the schema does not declare', () => {
    const triples = serialiseEntity(SCHEMA, { $id: ID, notInSchema: 'ignored', '@type': 'Thing', '@id': ID });

    expect(triples.map((t) => t.object)).not.toContain('"ignored"');
    expect(triples).toHaveLength(1); // rdf:type only
  });

  it('escapes literals rather than letting them break out', () => {
    const [object] = objectFor({ $id: ID, label: 'say "hi"\\\nthere\ttab' }, 'label');

    expect(object).toBe('"say \\"hi\\"\\\\\\nthere\\ttab"');
    expect(toNTriples(serialiseEntity(SCHEMA, { $id: ID, label: 'a\nb' }))).not.toMatch(/\n\s*b/);
  });

  it('rejects values that cannot be the declared datatype', () => {
    expect(() => serialiseEntity(SCHEMA, { $id: ID, count: 1.5 })).toThrow(/Expected an integer for count/);
    expect(() => serialiseEntity(SCHEMA, { $id: ID, count: 'abc' })).toThrow(/Expected a number for count/);
    expect(() => serialiseEntity(SCHEMA, { $id: ID, ref: 42 })).toThrow(/Expected an IRI string for ref/);
    expect(() => serialiseEntity(SCHEMA, { $id: ID, createdAt: new Date('nope') })).toThrow(/invalid Date/);
  });

  /*
   * The regression that motivated the `json` kind. Before it, a structured
   * value fell through to the string default and `String(value)` stored the
   * literal `"[object Object]"`, which read back as a string and silently
   * emptied the property on the next cache rebuild (issue #305).
   */
  it('writes a JSON property as a serialised document, not String(value)', () => {
    const [object] = objectFor(
      { $id: ID, config: { type: 'ephemeral-oxigraph', storeId: 'store-a' } },
      'config',
    );

    expect(object).not.toContain('object Object');
    expect(object).toBe(
      `"{\\"type\\":\\"ephemeral-oxigraph\\",\\"storeId\\":\\"store-a\\"}"^^<${RDF_JSON_TYPE}>`,
    );
  });

  it('writes JSON scalars and arrays as documents too', () => {
    expect(objectFor({ $id: ID, config: [1, 2] }, 'config')[0]).toBe(`"[1,2]"^^<${RDF_JSON_TYPE}>`);
    expect(objectFor({ $id: ID, config: 'plain' }, 'config')[0]).toBe(
      `"\\"plain\\""^^<${RDF_JSON_TYPE}>`,
    );
  });

  it('refuses a JSON value that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => serialiseEntity(SCHEMA, { $id: ID, config: cyclic })).toThrow(
      /Could not serialise config/,
    );
  });

  it('refuses an entity without an id, or with an unsafe one', () => {
    expect(() => serialiseEntity(SCHEMA, { label: 'x' })).toThrow(/without a \$id/);
    expect(() => serialiseEntity(SCHEMA, { $id: 'http://example.org/a> <b> <c' })).toThrow(/unsafe IRI/);
  });
});
