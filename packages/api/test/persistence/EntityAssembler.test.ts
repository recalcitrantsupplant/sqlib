/**
 * Unit coverage for the assembler's edge cases.
 *
 * The parity suite proves agreement with LDKit on real stored data; these tests
 * pin the behaviours that are awkward to provoke through a store — malformed
 * literals, duplicate scalars, undeclared predicates.
 */
import { describe, expect, it, vi } from 'vitest';
import { assembleEntities, assembleEntity, type BindingRow } from '../../src/persistence/EntityAssembler.js';
import { LDKIT_IRI_TYPE, RDF_JSON_TYPE } from '../../src/persistence/schemaIntrospection.js';

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const P = 'http://example.org/p';

const SCHEMA = {
  '@type': 'http://example.org/Thing',
  label: { '@id': `${P}/label` },
  count: { '@id': `${P}/count`, '@type': `${XSD}integer` },
  ratio: { '@id': `${P}/ratio`, '@type': `${XSD}decimal`, '@optional': true },
  enabled: { '@id': `${P}/enabled`, '@type': `${XSD}boolean`, '@optional': true },
  createdAt: { '@id': `${P}/createdAt`, '@type': `${XSD}dateTime`, '@optional': true },
  refs: { '@id': `${P}/refs`, '@type': LDKIT_IRI_TYPE, '@array': true, '@optional': true },
  tags: { '@id': `${P}/tags`, '@array': true },
  config: { '@id': `${P}/config`, '@type': RDF_JSON_TYPE, '@optional': true },
} as Record<string, unknown>;

function row(id: string, predicate: string, object: string): BindingRow {
  return {
    id: { type: 'uri', value: id },
    p: { type: 'uri', value: predicate },
    o: { type: 'literal', value: object },
  } as unknown as BindingRow;
}

describe('EntityAssembler', () => {
  it('groups rows by subject even when they are interleaved', () => {
    const entities = assembleEntities(SCHEMA, [
      row('http://example.org/a', `${P}/label`, 'A'),
      row('http://example.org/b', `${P}/label`, 'B'),
      row('http://example.org/a', `${P}/tags`, 'x'),
      row('http://example.org/b', `${P}/tags`, 'y'),
      row('http://example.org/a', `${P}/tags`, 'z'),
    ]);

    expect(entities).toHaveLength(2);
    const a = entities.find((e) => e.$id === 'http://example.org/a')!;
    expect(a.label).toBe('A');
    expect(a.tags).toEqual(['x', 'z']);
  });

  it('coerces each declared datatype', () => {
    const entity = assembleEntity(SCHEMA, [
      row('http://example.org/a', `${P}/label`, 'A'),
      row('http://example.org/a', `${P}/count`, '42'),
      row('http://example.org/a', `${P}/ratio`, '1.5'),
      row('http://example.org/a', `${P}/enabled`, 'true'),
      row('http://example.org/a', `${P}/createdAt`, '2026-01-02T03:04:05.000Z'),
    ])!;

    expect(entity.count).toBe(42);
    expect(entity.ratio).toBe(1.5);
    expect(entity.enabled).toBe(true);
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect((entity.createdAt as Date).toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('accepts the "1"/"0" lexical forms of xsd:boolean', () => {
    const on = assembleEntity(SCHEMA, [row('http://example.org/a', `${P}/enabled`, '1')])!;
    const off = assembleEntity(SCHEMA, [row('http://example.org/a', `${P}/enabled`, '0')])!;

    expect(on.enabled).toBe(true);
    expect(off.enabled).toBe(false);
  });

  it('defaults absent arrays to [] and absent optional scalars to null', () => {
    const entity = assembleEntity(SCHEMA, [row('http://example.org/a', `${P}/label`, 'A')])!;

    expect(entity.tags).toEqual([]);
    expect(entity.refs).toEqual([]);
    expect(entity.enabled).toBeNull();
    expect(entity.createdAt).toBeNull();
    // A required scalar with no row stays missing rather than becoming null.
    expect('count' in entity).toBe(false);
  });

  it('keeps the first value when a scalar has several stored', () => {
    const entity = assembleEntity(SCHEMA, [
      row('http://example.org/a', `${P}/label`, 'first'),
      row('http://example.org/a', `${P}/label`, 'second'),
    ])!;

    expect(entity.label).toBe('first');
  });

  it('ignores predicates the schema does not declare', () => {
    const entity = assembleEntity(SCHEMA, [
      row('http://example.org/a', `${P}/label`, 'A'),
      row('http://example.org/a', 'http://example.org/undeclared', 'ignored'),
    ])!;

    expect(Object.values(entity)).not.toContain('ignored');
  });

  it('rejects a literal that cannot be the datatype the schema declares', () => {
    expect(() => assembleEntity(SCHEMA, [row('http://example.org/a', `${P}/count`, 'not-a-number')])).toThrow(
      /Expected an integer for count/,
    );
    expect(() => assembleEntity(SCHEMA, [row('http://example.org/a', `${P}/createdAt`, 'not-a-date')])).toThrow(
      /Expected an xsd:dateTime for createdAt/,
    );
  });

  it('reads a JSON property back as the document that was stored', () => {
    const entity = assembleEntity(SCHEMA, [
      row('http://example.org/a', `${P}/config`, '{"type":"ephemeral-oxigraph","storeId":"store-a"}'),
    ])!;

    expect(entity.config).toEqual({ type: 'ephemeral-oxigraph', storeId: 'store-a' });
  });

  /*
   * Deliberately lenient, unlike every other datatype above. Stores written
   * before `backendConfig` had a datatype hold the literal `"[object Object]"`
   * for it (issue #305), and they are read by `loadAll` at startup — throwing
   * would turn one mangled node into an API that cannot boot. `null` is the
   * value an absent property has, so the node arrives without a config and the
   * graph builder rejects it with the error that names the real problem.
   */
  it('reads an unparseable JSON literal as absent instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const entity = assembleEntity(SCHEMA, [
        row('http://example.org/a', `${P}/config`, '[object Object]'),
      ])!;

      expect(entity.config).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not readable as JSON'));
    } finally {
      warn.mockRestore();
    }
  });

  it('returns null rather than an empty shell when nothing matched', () => {
    expect(assembleEntity(SCHEMA, [])).toBeNull();
    expect(assembleEntities(SCHEMA, [])).toEqual([]);
  });
});
