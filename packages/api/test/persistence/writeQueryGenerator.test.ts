/**
 * Unit coverage for update generation. The parity suite proves the queries do the
 * right thing to a real store; these assert the two structural properties that are
 * the point of the phase, where a diff would be harder to read.
 */
import { describe, expect, it } from 'vitest';
import { generateUpdateQuery, generateDeleteQuery } from '../../src/persistence/writeQueryGenerator.js';
import { LDKIT_IRI_TYPE } from '../../src/persistence/schemaIntrospection.js';

const P = 'http://example.org/p';
const SCHEMA = {
  '@type': 'http://example.org/Thing',
  label: { '@id': `${P}/label` },
  refs: { '@id': `${P}/refs`, '@type': LDKIT_IRI_TYPE, '@array': true, '@optional': true },
} as Record<string, unknown>;

const ID = 'http://example.org/thing-1';

describe('generateUpdateQuery', () => {
  it('wraps every old-value pattern in OPTIONAL', () => {
    // Bug class #1: a required pattern for an absent property makes the whole
    // WHERE match nothing, so the update silently no-ops.
    const query = generateUpdateQuery(SCHEMA, ID, { label: 'x', refs: ['http://example.org/r'] })!;
    const where = query.slice(query.indexOf('WHERE'));

    expect(where).toContain(`OPTIONAL { <${ID}> <${P}/label> ?old0 . }`);
    expect(where).toContain(`OPTIONAL { <${ID}> <${P}/refs> ?old1 . }`);
    // The only non-optional pattern is the existence anchor.
    expect(where.match(/OPTIONAL/g)).toHaveLength(2);
  });

  it('anchors on rdf:type so a missing entity cannot be conjured into being', () => {
    const query = generateUpdateQuery(SCHEMA, ID, { label: 'x' })!;
    const where = query.slice(query.indexOf('WHERE'));

    expect(where).toContain('<http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Thing> .');
    expect(where).not.toContain('OPTIONAL { <http://example.org/thing-1> <http://www.w3.org/1999/02/22');
  });

  it('generates scalars and arrays through the same path', () => {
    // Bug class #2 was a mixed scalar+array update failing. There is no mixed
    // case to get wrong if nothing distinguishes them.
    const query = generateUpdateQuery(SCHEMA, ID, { label: 'x', refs: ['http://example.org/a', 'http://example.org/b'] })!;

    expect(query).toContain(`DELETE {\n  <${ID}> <${P}/label> ?old0 .\n  <${ID}> <${P}/refs> ?old1 .\n}`);
    expect(query).toContain(`<${ID}> <${P}/label> "x" .`);
    expect(query).toContain(`<${ID}> <${P}/refs> <http://example.org/a> .`);
    expect(query).toContain(`<${ID}> <${P}/refs> <http://example.org/b> .`);
  });

  it('clears a property given null or an empty array', () => {
    // A value is present in the patch and it has no triples: delete, insert nothing.
    for (const patch of [{ refs: [] }, { label: null }]) {
      const query = generateUpdateQuery(SCHEMA, ID, patch)!;
      expect(query).toContain('DELETE {');
      expect(query).not.toContain('INSERT {');
    }
  });

  it('skips undefined, which means "not patched"', () => {
    expect(generateUpdateQuery(SCHEMA, ID, { label: undefined })).toBeNull();
    const query = generateUpdateQuery(SCHEMA, ID, { label: undefined, refs: ['http://example.org/r'] })!;
    expect(query).not.toContain(`${P}/label`);
  });

  it('returns null when nothing in the patch is a declared property', () => {
    expect(generateUpdateQuery(SCHEMA, ID, { notInSchema: 'x' })).toBeNull();
    expect(generateUpdateQuery(SCHEMA, ID, {})).toBeNull();
  });

  it('refuses an unsafe id', () => {
    expect(() => generateUpdateQuery(SCHEMA, 'http://example.org/a> <b> <c', { label: 'x' })).toThrow(/unsafe IRI/);
  });
});

describe('generateDeleteQuery', () => {
  it('removes only the entity own triples', () => {
    expect(generateDeleteQuery(ID)).toBe(`DELETE WHERE { <${ID}> ?p ?o }`);
  });
});
