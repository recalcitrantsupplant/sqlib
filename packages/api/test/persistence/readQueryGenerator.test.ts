/**
 * The generated SQL-equivalent is only checked for the properties that matter:
 * that required properties filter, that optional ones do not, and that ids cannot
 * inject query text. Exact query text is deliberately not asserted — the parity
 * suite is what proves the queries return the right thing.
 */
import { describe, expect, it } from 'vitest';
import { generateFindAllQuery, generateFindByIriQuery } from '../../src/persistence/readQueryGenerator.js';
import { LDKIT_IRI_TYPE } from '../../src/persistence/schemaIntrospection.js';

const SCHEMA = {
  '@type': 'http://example.org/Thing',
  required: { '@id': 'http://example.org/p/required' },
  optional: { '@id': 'http://example.org/p/optional', '@optional': true },
  refs: { '@id': 'http://example.org/p/refs', '@type': LDKIT_IRI_TYPE, '@array': true, '@optional': true },
} as Record<string, unknown>;

describe('readQueryGenerator', () => {
  it('anchors on rdf:type and every required predicate', () => {
    const query = generateFindAllQuery(SCHEMA);

    expect(query).toContain('<http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Thing>');
    // The required predicate appears as a filtering pattern, not only as a branch.
    expect(query).toContain('?id <http://example.org/p/required> ?required0 .');
  });

  it('does not let an optional predicate filter the result set', () => {
    const query = generateFindAllQuery(SCHEMA);

    expect(query).not.toContain('?id <http://example.org/p/optional> ?required');
    // ...but it is still projected.
    expect(query).toContain('BIND(<http://example.org/p/optional> AS ?p)');
  });

  it('projects DISTINCT, since required patterns multiply rows', () => {
    expect(generateFindAllQuery(SCHEMA)).toMatch(/^SELECT DISTINCT \?id \?p \?o/);
  });

  it('binds the requested id in the findByIri variant', () => {
    const query = generateFindByIriQuery(SCHEMA, 'http://example.org/thing-1');

    expect(query).toContain('BIND(<http://example.org/thing-1> AS ?id)');
  });

  it('refuses an id that would break out of its angle brackets', () => {
    for (const hostile of [
      'http://example.org/x> } INSERT DATA { <http://evil> <http://evil> <http://evil> } #',
      'http://example.org/x y',
      'http://example.org/x"',
    ]) {
      expect(() => generateFindByIriQuery(SCHEMA, hostile)).toThrow(/unsafe IRI/);
    }
  });

  it('still enumerates instances of a type that declares no properties', () => {
    const query = generateFindAllQuery({ '@type': 'http://example.org/Empty' });

    expect(query).toContain('<http://example.org/Empty>');
    expect(query).toMatch(/^SELECT DISTINCT/);
  });
});
