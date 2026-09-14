/**
 * The persistence path against a real SPARQL endpoint over HTTP.
 *
 * The plan commits to both internal backend modes working (§2), but CI only
 * exercises in-process oxigraph. The parity suites used to be the thing that
 * verified `http` when pointed at one, and they went with LDKit — so this is what
 * is left that actually writes to a network endpoint and reads it back.
 *
 * Skipped unless `INTERNAL_BACKEND_TYPE=http`, which is deliberate: it is a real
 * integration test and needs an endpoint. See README-http-backend.md for how to
 * stand one up and run it.
 *
 * It asserts on the endpoint's own triple count as well as the round-tripped
 * values, because a run that silently fell back to oxigraph would otherwise look
 * exactly like a passing one — that mistake has already been made once here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRepositoryLens } from '../../src/persistence/utils/entityRepository.js';
import { LibrarySchema, type LdkitLibrary } from '../../src/persistence/schemas/LibrarySchema.js';

const isHttp = process.env.INTERNAL_BACKEND_TYPE === 'http';

const queryUrl = process.env.LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT ?? '';
const username = process.env.LIBRARY_STORAGE_SPARQL_USERNAME;
const password = process.env.LIBRARY_STORAGE_SPARQL_PASSWORD;

/** Counts triples via the endpoint directly, not through the code under test. */
async function countTriples(): Promise<number> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'text/csv',
  };
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ query: 'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }' }),
  });
  if (!res.ok) throw new Error(`endpoint returned ${res.status} counting triples`);
  return Number((await res.text()).trim().split('\n')[1]);
}

describe.skipIf(!isHttp)('persistence against an http backend', () => {
  const id = 'http://example.org/httpbackend/library-1';
  const Libraries = createRepositoryLens(LibrarySchema);
  let baseline = 0;

  beforeAll(async () => {
    baseline = await countTriples();
  });

  afterAll(async () => {
    await Libraries.delete(id).catch(() => {});
  });

  it('round-trips an entity through a real endpoint', async () => {
    const created = new Date().toISOString();
    await Libraries.insert({
      $id: id,
      name: 'http round-trip',
      description: 'written over http',
      dateCreated: created,
    } as LdkitLibrary);

    // The triples are really at the endpoint, not in a local store we fell back to.
    expect(await countTriples()).toBeGreaterThan(baseline);

    const read = (await Libraries.findByIri(id)) as (Omit<LdkitLibrary, 'dateCreated'> & { dateCreated?: Date }) | null;
    expect(read?.name).toBe('http round-trip');
    expect(read?.description).toBe('written over http');
    // Datatyped literals have to survive the network round-trip, not just the
    // in-process one — this is where a serialisation difference would show up.
    // `xsd:dateTime` materialises as a Date, so this also pins down that the
    // datatype survived rather than degrading to a plain literal.
    expect(read?.dateCreated).toBeInstanceOf(Date);
    expect(read?.dateCreated?.toISOString()).toBe(created);

    await Libraries.update({ $id: id, name: 'renamed over http' });
    expect(((await Libraries.findByIri(id)) as LdkitLibrary | null)?.name).toBe('renamed over http');

    expect((await Libraries.find()).some((entity) => (entity as LdkitLibrary).$id === id)).toBe(true);

    await Libraries.delete(id);
    expect(await Libraries.findByIri(id)).toBeNull();
    // A delete that left triples behind would still read as null if it removed
    // only the type triple, so check the endpoint rather than the read.
    expect(await countTriples()).toBe(baseline);
  });
});
