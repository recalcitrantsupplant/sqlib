/**
 * The `sqlite` library store against the SPARQL it replaces.
 *
 * Every case runs the same writes twice: once as the generated SPARQL against
 * an Oxigraph store, once through `sqliteEntityStore`. The reads must agree,
 * because the SQLite mode's whole claim is that it returns what the query
 * would have.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as oxigraph from 'oxigraph';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';
import type { SparqlSelectJsonOutput } from '../../src/server/ISparqlExecutor.js';
import { assembleEntities, type BindingRow } from '../../src/persistence/EntityAssembler.js';
import { generateFindAllQuery, generateFindByIriQuery } from '../../src/persistence/readQueryGenerator.js';
import { generateDeleteQuery, generateInsertQuery, generateUpdateQuery } from '../../src/persistence/writeQueryGenerator.js';
import * as sqliteStore from '../../src/persistence/sqliteEntityStore.js';
import { LibrarySparqlViewExecutor, dropLibrarySparqlView } from '../../src/persistence/librarySparqlView.js';
import { LibrarySchema } from '../../src/persistence/schemas/LibrarySchema.js';
import { QuerySchema } from '../../src/persistence/schemas/QuerySchema.js';
import { QueryVersionSchema } from '../../src/persistence/schemas/QueryVersionSchema.js';

const LIBRARY = 'urn:sqlib:library:one';
const QUERY = 'urn:sqlib:query:one';
const V1 = 'urn:sqlib:query-version:one-1';
const V2 = 'urn:sqlib:query-version:one-2';

type Schema = Record<string, unknown>;

/** The SPARQL path, as `EntityStore` runs it in the RDF modes. */
function sparqlPath() {
  const executor = new OxigraphSparqlExecutor(new oxigraph.Store());
  const select = async (query: string) => {
    const { result } = await executor.selectQueryParsed(query);
    return ((result as SparqlSelectJsonOutput).results.bindings ?? []) as BindingRow[];
  };
  return {
    findAll: async (schema: Schema) => assembleEntities(schema, await select(generateFindAllQuery(schema))),
    findByIri: async (schema: Schema, id: string) =>
      assembleEntities(schema, await select(generateFindByIriQuery(schema, id)))[0] ?? null,
    insert: async (schema: Schema, entity: Record<string, unknown>) => { await executor.update(generateInsertQuery(schema, entity)); },
    update: async (schema: Schema, id: string, patch: Record<string, unknown>) => {
      const query = generateUpdateQuery(schema, id, patch);
      if (query) await executor.update(query);
    },
    remove: async (id: string) => { await executor.update(generateDeleteQuery(id)); },
  };
}

/** The SQLite path. */
function sqlitePath(dir: string) {
  const db = () => sqliteStore.openLibraryDatabase(dir);
  return {
    findAll: async (schema: Schema) => sqliteStore.findAll(db(), schema),
    findByIri: async (schema: Schema, id: string) => sqliteStore.findByIri(db(), schema, id),
    insert: async (schema: Schema, entity: Record<string, unknown>) => sqliteStore.insert(db(), schema, entity),
    update: async (schema: Schema, id: string, patch: Record<string, unknown>) => sqliteStore.update(db(), schema, id, patch),
    remove: async (id: string) => sqliteStore.remove(db(), id),
  };
}

type Path = ReturnType<typeof sparqlPath>;

const library = {
  $id: LIBRARY,
  name: 'Library "one"\nwith a newline',
  description: 'Described',
  dateCreated: '2026-10-29T10:00:00.000Z',
};
const query = { $id: QUERY, name: 'Query one', isPartOf: [LIBRARY], currentVersion: V1, tags: [] };
const version = (id: string, n: number) => ({
  $id: id,
  isPartOf: QUERY,
  version: n,
  immutable: true,
  queryString: 'SELECT * WHERE { ?s ?p ?o }',
  queryType: 'https://sparql-query-lib/QueryType/select',
});

async function seed(target: Path) {
  await target.insert(LibrarySchema, library);
  await target.insert(QuerySchema, query);
  await target.insert(QueryVersionSchema, version(V1, 1));
  await target.insert(QueryVersionSchema, version(V2, 2));
}

async function readAll(target: Path) {
  return {
    libraries: await target.findAll(LibrarySchema),
    queries: await target.findAll(QuerySchema),
    versions: (await target.findAll(QueryVersionSchema)).sort((a, b) => String(a.$id).localeCompare(String(b.$id))),
    query: await target.findByIri(QuerySchema, QUERY),
    missing: await target.findByIri(QuerySchema, 'urn:sqlib:query:missing'),
    wrongType: await target.findByIri(LibrarySchema, QUERY),
  };
}

describe('sqlite library store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-library-sqlite-'));
  });

  afterEach(async () => {
    sqliteStore.closeLibraryDatabase();
    dropLibrarySparqlView();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function both(steps: (target: Path) => Promise<void>) {
    const sparql = sparqlPath();
    const sqlite = sqlitePath(dir);
    await steps(sparql);
    await steps(sqlite);
    return { expected: await readAll(sparql), actual: await readAll(sqlite) };
  }

  it('reads back what SPARQL reads back, projections included', async () => {
    const { expected, actual } = await both(seed);
    expect(actual).toEqual(expected);
    // The projection followed currentVersion to the version's own number.
    expect(actual.query?.currentVersionNumber).toBe(1);
    expect(actual.libraries[0]?.name).toBe(library.name);
  });

  it('updates only the patched fields, and only on an entity of that class', async () => {
    const { expected, actual } = await both(async (target) => {
      await seed(target);
      await target.update(QuerySchema, QUERY, { currentVersion: V2, description: 'Now described' });
      await target.update(LibrarySchema, QUERY, { name: 'not a library' });
      await target.update(QuerySchema, 'urn:sqlib:query:missing', { name: 'nothing' });
    });
    expect(actual).toEqual(expected);
    expect(actual.query?.currentVersionNumber).toBe(2);
    expect(actual.query?.name).toBe('Query one');
  });

  it('deletes an entity and leaves what points at it', async () => {
    const { expected, actual } = await both(async (target) => {
      await seed(target);
      await target.remove(V1);
    });
    expect(actual).toEqual(expected);
    expect(actual.versions.map((v) => v.$id)).toEqual([V2]);
    expect(actual.query?.currentVersion).toBe(V1);
  });

  it('merges a second insert of the same IRI, as INSERT DATA does', async () => {
    const { expected, actual } = await both(async (target) => {
      await seed(target);
      await target.insert(LibrarySchema, { $id: LIBRARY, name: library.name, defaultBackend: 'urn:sqlib:backend:one' });
    });
    expect(actual).toEqual(expected);
    expect(actual.libraries[0]).toMatchObject({ description: 'Described', defaultBackend: 'urn:sqlib:backend:one' });
  });

  it('omits an entity missing a required field', async () => {
    const { expected, actual } = await both(async (target) => {
      await seed(target);
      await target.update(QuerySchema, QUERY, { name: null });
    });
    expect(actual).toEqual(expected);
    expect(actual.query).toBeNull();
  });

  it('finds the highest version of a parent', async () => {
    const sqlite = sqlitePath(dir);
    await seed(sqlite);
    const db = sqliteStore.openLibraryDatabase(dir);
    expect(sqliteStore.highestVersion(db, QueryVersionSchema, QUERY)).toBe(2);
    expect(sqliteStore.highestVersion(db, QueryVersionSchema, 'urn:sqlib:query:other')).toBe(0);
  });

  it('keeps its rows across a reopen, in a 0600 file', async () => {
    await seed(sqlitePath(dir));
    sqliteStore.closeLibraryDatabase();
    expect(await sqlitePath(dir).findByIri(LibrarySchema, LIBRARY)).toMatchObject({ name: library.name });
    const { mode } = await fs.stat(path.join(dir, sqliteStore.LIBRARY_SQLITE_FILE));
    expect(mode & 0o777).toBe(0o600);
  });

  it('answers SPARQL from a view that follows writes, and refuses updates', async () => {
    const sqlite = sqlitePath(dir);
    await seed(sqlite);
    const view = new LibrarySparqlViewExecutor(dir);
    const count = async () => {
      const { result } = await view.selectQueryParsed('SELECT (COUNT(*) AS ?n) WHERE { ?s a <https://sparql-query-lib/QueryVersion> }');
      return Number((result as SparqlSelectJsonOutput).results.bindings[0]?.n?.value);
    };
    expect(await count()).toBe(2);
    await sqlite.remove(V2);
    expect(await count()).toBe(1);
    await expect(view.update('INSERT DATA { <urn:a> <urn:b> <urn:c> }')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('imports triples grouped by subject and reports the untyped ones', async () => {
    const db = sqliteStore.openLibraryDatabase(dir);
    const triples = sqliteStore.parseTriples(
      `<${LIBRARY}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://sparql-query-lib/Library> .\n` +
      `<${LIBRARY}> <https://schema.org/name> "Imported" .\n` +
      `<urn:orphan> <https://schema.org/name> "No type" .`,
    );
    const subjects = new Map([
      [LIBRARY, triples.slice(0, 2)],
      ['urn:orphan', triples.slice(2)],
    ]);
    expect(sqliteStore.importSubjects(db, subjects)).toEqual({ imported: 1, untyped: ['urn:orphan'] });
    expect(sqliteStore.findByIri(db, LibrarySchema, LIBRARY)).toMatchObject({ name: 'Imported' });
  });
});
