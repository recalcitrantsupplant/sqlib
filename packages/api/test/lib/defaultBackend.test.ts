import { describe, it, expect } from 'vitest';
import { resolveQueryDefaultBackend } from '../../src/lib/defaultBackend.js';

const LIB = 'urn:sqlib:library:lib';
const GROUP = 'urn:sqlib:query-group:g';
const QUERY = 'urn:sqlib:query:q';
const VERSION = 'urn:sqlib:query-version:q-1';

function store(entities: Array<Record<string, unknown>>) {
  const byId = new Map(entities.map((e) => [e.$id as string, e]));
  return (id: string) => byId.get(id) ?? null;
}

describe('resolveQueryDefaultBackend', () => {
  const library = (defaultBackend?: string) => ({ $id: LIB, '@type': 'Library', defaultBackend });
  const query = (defaultBackend?: string) => ({
    $id: QUERY, '@type': 'Query', isPartOf: [GROUP, LIB], defaultBackend,
  });
  const group = { $id: GROUP, '@type': 'QueryGroup' };
  const version = { $id: VERSION, '@type': 'QueryVersion', isPartOf: QUERY };

  it("prefers the query's own default", () => {
    const get = store([library('urn:b:lib'), group, query('urn:b:q')]);
    expect(resolveQueryDefaultBackend(get(QUERY), get)).toEqual({ backendId: 'urn:b:q', source: 'query' });
  });

  it("falls back to the library's default, past any group the query is in", () => {
    const get = store([library('urn:b:lib'), group, query()]);
    expect(resolveQueryDefaultBackend(get(QUERY), get)).toEqual({ backendId: 'urn:b:lib', source: 'library' });
  });

  it('answers for a version through its parent query', () => {
    const get = store([library('urn:b:lib'), group, query(), version]);
    expect(resolveQueryDefaultBackend(get(VERSION), get)).toEqual({ backendId: 'urn:b:lib', source: 'library' });
  });

  it('is null when neither names a backend', () => {
    const get = store([library(), group, query(), version]);
    expect(resolveQueryDefaultBackend(get(VERSION), get)).toBeNull();
  });

  it('is null for anything that is not a query', () => {
    const get = store([group]);
    expect(resolveQueryDefaultBackend(get(GROUP), get)).toBeNull();
  });
});
