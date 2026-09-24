import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { SRL_IMPORT_REVISION } from '@sparql-query-lib/srl';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

/**
 * The `srlImportable` flag, decided once when a version is written.
 *
 * The flag exists so the rule-import picker can filter a library without
 * converting every query in it on every open, and the whole design rests on it
 * being cheap and honest: cheap because a version is immutable and this runs
 * once, honest because it is stamped with the whitelist revision that decided
 * it. What is tested here is the decision itself — that it tracks the converter
 * rather than guessing from the query type, and that it never costs a write.
 */

type Entity = Record<string, unknown>;

const versions: Entity[] = [];

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    create: vi.fn(async (entityType: string, entity: Entity) => {
      if (entityType === 'QueryVersion') versions.push(entity);
      return { ...entity, '@type': entityType };
    }),
    update: vi.fn(async (_type: string, id: string, updates: Entity) => ({ $id: id, ...updates })),
    list: vi.fn(() => []),
    get: vi.fn(() => ({ '@type': 'Query' })),
  }),
});

/** The version record a write produced. */
async function write(queryString: string, queryType?: string) {
  const { createQueryVersionFlat } = await import('../../src/lib/QueryVersionWriter.js');
  await createQueryVersionFlat('urn:query:1', { queryString, queryType });
  return versions[versions.length - 1];
}

describe('QueryVersionWriter — srlImportable', () => {
  beforeEach(() => { versions.length = 0; });

  it.each([
    ['a CONSTRUCT', 'PREFIX : <http://e/> CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }', QueryTypeIri.construct],
    ['an INSERT … WHERE', 'PREFIX : <http://e/> INSERT { ?s :q ?o } WHERE { ?s :p ?o }', QueryTypeIri.update],
  ])('flags %s as importable', async (_name, query, type) => {
    expect((await write(query, type)).srlImportable).toBe(true);
  });

  it.each([
    ['a SELECT', 'SELECT * WHERE { ?s ?p ?o }', QueryTypeIri.select],
    ['an ASK', 'ASK { ?s ?p ?o }', QueryTypeIri.ask],
    ['a DESCRIBE', 'DESCRIBE <http://e/a>', QueryTypeIri.describe],
  ])('flags %s as not importable', async (_name, query, type) => {
    expect((await write(query, type)).srlImportable).toBe(false);
  });

  /*
   * The point of running the converter rather than trusting the query type: a
   * CONSTRUCT is only a candidate, and an update is a candidate only in the one
   * shape of the eleven that can hold a rule.
   */
  it('flags a CONSTRUCT the whitelist rejects as not importable', async () => {
    const query = 'PREFIX : <http://e/> CONSTRUCT { ?s :q ?o } WHERE { { ?s :p ?o } UNION { ?s :r ?o } }';
    expect((await write(query, QueryTypeIri.construct)).srlImportable).toBe(false);
  });

  it('flags a DELETE WHERE as not importable even though it is an update', async () => {
    expect((await write('DELETE WHERE { ?s ?p ?o }', QueryTypeIri.update)).srlImportable).toBe(false);
  });

  it('flags an INSERT DATA as not importable', async () => {
    expect((await write('INSERT DATA { <http://e/a> <http://e/q> 1 }', QueryTypeIri.update)).srlImportable)
      .toBe(false);
  });

  it('counts a query that converts with a warning as importable', async () => {
    // A bare BIND becomes a SET with a warning attached; a warning is not a
    // refusal, and the picker must still offer it.
    const query = 'PREFIX : <http://e/> CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) }';
    expect((await write(query, QueryTypeIri.construct)).srlImportable).toBe(true);
  });

  it('stamps the revision that decided the flag', async () => {
    const version = await write('SELECT * WHERE { ?s ?p ?o }', QueryTypeIri.select);
    // Without this a stored `false` is indistinguishable from a `false` decided
    // by a whitelist that has since been loosened.
    expect(version.srlImportRevision).toBe(SRL_IMPORT_REVISION);
  });

  /*
   * The flag is advisory — the import re-runs the converter regardless — so
   * nothing about it is worth failing a write over.
   */
  it('does not fail the write when the query cannot be parsed', async () => {
    const version = await write('this is not sparql', QueryTypeIri.construct);
    expect(version.srlImportable).toBe(false);
    expect(version.queryString).toBe('this is not sparql');
  });

  it('settles a non-convertible form without parsing it', async () => {
    // An unparseable SELECT still comes out false: the query type alone rules
    // the form out, which is what keeps the cost off most of a library.
    expect((await write('SELECT nonsense (', QueryTypeIri.select)).srlImportable).toBe(false);
  });
});
