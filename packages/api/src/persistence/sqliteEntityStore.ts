/**
 * The library store in one SQLite file: a row per entity, holding its triples.
 *
 * The `sqlite` storage mode's half of `EntityStore.ts`. Each function here does
 * what its SPARQL counterpart does against an RDF store, edge cases included,
 * and hands `assembleEntities` the same `?id ?p ?o` rows a SELECT would. So the
 * typing rules — dates, numbers, booleans, required fields, `@projects` — live
 * in one place for every mode, and this file only decides which triples a read
 * sees.
 *
 * A row's triples are kept as SPARQL JSON terms (`{type, value, datatype?,
 * xml:lang?}`), so a read is a `JSON.parse` and nothing more. Writes come from
 * `EntitySerialiser` as N-Triples and are parsed once, on the way in.
 *
 * Every write bumps `libraryWriteCount()`, which is how the read-only SPARQL
 * view over this store (see `librarySparqlView.ts`) knows to rebuild.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as oxigraph from 'oxigraph';
import type { SparqlBindingValue } from '@sparql-query-lib/types';
import { assembleEntities, type BindingRow } from './EntityAssembler.js';
import { serialiseEntity, serialiseField, toNTriples } from './EntitySerialiser.js';
import { describeSchema, type EntitySchemaInfo } from './schemaIntrospection.js';
import { RDF_TYPE } from './sparqlTerms.js';

export const LIBRARY_SQLITE_FILE = 'library.sqlite';

/** Bumped with each change to the table below; `PRAGMA user_version` holds it. */
const SCHEMA_VERSION = 1;

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entities (
    iri TEXT PRIMARY KEY,
    class TEXT NOT NULL,
    triples TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS entities_by_class ON entities (class);
`;

/** One triple of an entity, its subject being the row's IRI. */
export interface StoredTriple {
  p: string;
  o: SparqlBindingValue;
}

type Row = { iri: string; class: string; triples: string };

let db: DatabaseSync | null = null;
let dbFile: string | null = null;
let writes = 0;

/**
 * The database in `dir`, opened on first use.
 *
 * A different `dir` closes the open one first: tests point successive cases at
 * fresh directories, and a server only ever names one.
 */
export function openLibraryDatabase(dir: string): DatabaseSync {
  const file = dir === ':memory:' ? ':memory:' : path.join(dir, LIBRARY_SQLITE_FILE);
  if (db && dbFile === file) return db;
  closeLibraryDatabase();

  if (file !== ':memory:') {
    fs.mkdirSync(dir, { recursive: true });
    // Created empty first so the mode is ours; SQLite gives its WAL and
    // shared-memory files the same permissions as the database.
    fs.writeFileSync(file, '', { flag: 'a', mode: 0o600 });
  }

  const opened = new DatabaseSync(file);
  try {
    // WAL: a write never waits for a reader. FULL: a commit is on disk before
    // the write returns, which is what makes the store durable without a
    // checkpoint.
    opened.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    const { user_version: version } = opened.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version > SCHEMA_VERSION) {
      throw new Error(`${file} has schema version ${version}; this sqlib knows ${SCHEMA_VERSION}. Upgrade sqlib.`);
    }
    opened.exec(SCHEMA);
    opened.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } catch (error) {
    opened.close();
    throw error;
  }

  db = opened;
  dbFile = file;
  writes += 1;
  return opened;
}

export function closeLibraryDatabase(): void {
  db?.close();
  db = null;
  dbFile = null;
}

/** Increases with every write, and when a different database is opened. */
export function libraryWriteCount(): number {
  return writes;
}

/** Every entity's triples, for the SPARQL view and for export. */
export function allTriples(database: DatabaseSync): Array<{ s: string; triples: StoredTriple[] }> {
  const rows = database.prepare('SELECT iri, triples FROM entities ORDER BY iri').all() as Row[];
  return rows.map((row) => ({ s: row.iri, triples: JSON.parse(row.triples) as StoredTriple[] }));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function findAll(database: DatabaseSync, schema: Record<string, unknown>): Record<string, unknown>[] {
  const info = describeSchema(schema);
  const rows = database.prepare('SELECT iri, class, triples FROM entities WHERE class = ? ORDER BY iri').all(info.classIri) as Row[];
  return assembleEntities(schema, bindingRows(database, info, rows));
}

export function findByIri(
  database: DatabaseSync,
  schema: Record<string, unknown>,
  id: string,
): Record<string, unknown> | null {
  const info = describeSchema(schema);
  const row = database.prepare('SELECT iri, class, triples FROM entities WHERE iri = ?').get(id) as Row | undefined;
  if (!row) return null;
  return assembleEntities(schema, bindingRows(database, info, [row]))[0] ?? null;
}

export function highestVersion(database: DatabaseSync, schema: Record<string, unknown>, parentId: string): number {
  const info = describeSchema(schema);
  const field = (name: string) => {
    const found = info.fields.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`${info.classIri} declares no ${name}; it is not a version schema.`);
    return found.predicate;
  };
  const isPartOf = field('isPartOf');
  const version = field('version');

  let highest = 0;
  const rows = database.prepare('SELECT iri, class, triples FROM entities WHERE class = ?').all(info.classIri) as Row[];
  for (const row of rows) {
    const triples = JSON.parse(row.triples) as StoredTriple[];
    if (!triples.some((t) => t.p === isPartOf && t.o.value === parentId)) continue;
    for (const t of triples) {
      if (t.p !== version) continue;
      const value = Number.parseInt(t.o.value, 10);
      if (!Number.isNaN(value) && value > highest) highest = value;
    }
  }
  return highest;
}

/**
 * The `?id ?p ?o` rows the generated SELECT returns for these entities.
 *
 * Mirrors `readQueryGenerator.buildSelect`: an entity missing any required
 * field contributes nothing, only declared predicates are returned, and each
 * `@projects` field follows its reference to the target's own triples. A
 * schema with no fields at all returns one `rdf:type` row per entity.
 */
function bindingRows(database: DatabaseSync, info: EntitySchemaInfo, rows: Row[]): BindingRow[] {
  const declared = new Set(info.fields.map((field) => field.predicate));
  const required = info.fields.filter((field) => !field.isOptional).map((field) => field.predicate);
  const lookupTarget = database.prepare('SELECT triples FROM entities WHERE iri = ?');
  const out: BindingRow[] = [];

  for (const row of rows) {
    const triples = JSON.parse(row.triples) as StoredTriple[];
    if (!triples.some((t) => t.p === RDF_TYPE && t.o.type === 'uri' && t.o.value === info.classIri)) continue;
    const present = new Set(triples.map((t) => t.p));
    if (!required.every((predicate) => present.has(predicate))) continue;

    const id: SparqlBindingValue = { type: 'uri', value: row.iri };

    if (info.fields.length === 0 && info.projectionByPredicate.size === 0) {
      out.push({ id, p: { type: 'uri', value: RDF_TYPE }, o: { type: 'uri', value: info.classIri } });
      continue;
    }

    const seen = new Set<string>();
    const push = (p: string, o: SparqlBindingValue) => {
      // SELECT DISTINCT: a row the store would return once is returned once.
      const key = `${p}\u0000${termKey(o)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id, p: { type: 'uri', value: p }, o });
    };

    for (const t of triples) {
      if (declared.has(t.p)) push(t.p, t.o);
    }

    for (const [predicate, projection] of info.projectionByPredicate) {
      for (const t of triples) {
        if (t.p !== projection.via || t.o.type !== 'uri') continue;
        const target = lookupTarget.get(t.o.value) as { triples: string } | undefined;
        if (!target) continue;
        for (const projected of JSON.parse(target.triples) as StoredTriple[]) {
          if (projected.p === projection.targetPredicate) push(predicate, projected.o);
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * `INSERT DATA` of the entity's triples. An IRI already stored keeps what it
 * had and gains what is new, as triples added to a graph would.
 */
export function insert(database: DatabaseSync, schema: Record<string, unknown>, entity: Record<string, unknown>): void {
  const info = describeSchema(schema);
  const serialised = serialiseEntity(schema, entity);
  const id = (entity.$id ?? entity['@id']) as string;
  const added = parseTriples(toNTriples(serialised));

  transaction(database, () => {
    const existing = database.prepare('SELECT iri, class, triples FROM entities WHERE iri = ?').get(id) as Row | undefined;
    const triples = existing ? union(JSON.parse(existing.triples) as StoredTriple[], added) : dedupe(added);
    write(database, id, existing?.class ?? info.classIri, triples);
  });
}

/**
 * Replaces the patched fields' values, as the generated `DELETE … INSERT …
 * WHERE` does: only on an entity stored with this schema's class, and only
 * the predicates the patch names.
 */
export function update(
  database: DatabaseSync,
  schema: Record<string, unknown>,
  id: string,
  patch: Record<string, unknown>,
): void {
  const info = describeSchema(schema);
  const patched = info.fields.filter((field) => field.name in patch && patch[field.name] !== undefined);
  if (patched.length === 0) return;

  const replaced = new Set(patched.map((field) => field.predicate));
  const added = parseTriples(
    toNTriples(patched.flatMap((field) => serialiseField(field, patch[field.name], id))),
  );

  transaction(database, () => {
    const existing = database.prepare('SELECT iri, class, triples FROM entities WHERE iri = ?').get(id) as Row | undefined;
    if (!existing) return;
    const current = JSON.parse(existing.triples) as StoredTriple[];
    if (!current.some((t) => t.p === RDF_TYPE && t.o.value === info.classIri)) return;
    write(database, id, existing.class, union(current.filter((t) => !replaced.has(t.p)), added));
  });
}

/** `DELETE WHERE { <id> ?p ?o }`: the entity's own triples, nothing that points at it. */
export function remove(database: DatabaseSync, id: string): void {
  transaction(database, () => {
    if (Number(database.prepare('DELETE FROM entities WHERE iri = ?').run(id).changes) > 0) writes += 1;
  });
}

/**
 * Writes rows of triples grouped by subject, for an import. Each subject needs
 * an `rdf:type`; the first one names the row's class.
 */
export function importSubjects(database: DatabaseSync, subjects: Map<string, StoredTriple[]>): { imported: number; untyped: string[] } {
  const untyped: string[] = [];
  let imported = 0;
  transaction(database, () => {
    for (const [s, triples] of subjects) {
      const type = triples.find((t) => t.p === RDF_TYPE && t.o.type === 'uri');
      if (!type) {
        untyped.push(s);
        continue;
      }
      write(database, s, type.o.value, dedupe(triples));
      imported += 1;
    }
  });
  return { imported, untyped };
}

/** How many entities are stored. */
export function countEntities(database: DatabaseSync): number {
  return (database.prepare('SELECT count(*) AS n FROM entities').get() as { n: number }).n;
}

/** Removes every entity, for an import that replaces the store. */
export function clearEntities(database: DatabaseSync): void {
  transaction(database, () => {
    database.exec('DELETE FROM entities');
    writes += 1;
  });
}

function write(database: DatabaseSync, iri: string, cls: string, triples: StoredTriple[]): void {
  database
    .prepare(
      `INSERT INTO entities (iri, class, triples, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (iri) DO UPDATE SET triples = excluded.triples, updated_at = excluded.updated_at`,
    )
    .run(iri, cls, JSON.stringify(triples), new Date().toISOString());
  writes += 1;
}

function transaction(database: DatabaseSync, body: () => void): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    body();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/** N-Triples, as `EntitySerialiser` writes them, to stored triples. */
export function parseTriples(ntriples: string): StoredTriple[] {
  if (!ntriples.trim()) return [];
  return oxigraph.parse(ntriples, { format: 'application/n-triples' }).map((quad) => ({
    p: quad.predicate.value,
    o: toBinding(quad.object),
  }));
}

/** A term in the SPARQL JSON results shape, as Oxigraph's own SELECT output gives it. */
export function toBinding(term: oxigraph.Term): SparqlBindingValue {
  if (term.termType === 'NamedNode') return { type: 'uri', value: term.value };
  if (term.termType === 'BlankNode') return { type: 'bnode', value: term.value };
  if (term.termType === 'Literal') {
    if (term.language) return { type: 'literal', value: term.value, 'xml:lang': term.language };
    const datatype = term.datatype.value;
    return datatype === XSD_STRING || datatype === RDF_LANG_STRING
      ? { type: 'literal', value: term.value }
      : { type: 'literal', value: term.value, datatype };
  }
  throw new Error(`Cannot store a ${term.termType} as an object.`);
}

/** The Oxigraph term for a stored binding, for building the SPARQL view. */
export function fromBinding(value: SparqlBindingValue): oxigraph.NamedNode | oxigraph.BlankNode | oxigraph.Literal {
  if (value.type === 'uri') return oxigraph.namedNode(value.value);
  if (value.type === 'bnode') return oxigraph.blankNode(value.value);
  if (value['xml:lang']) return oxigraph.literal(value.value, value['xml:lang']);
  return value.datatype
    ? oxigraph.literal(value.value, oxigraph.namedNode(value.datatype))
    : oxigraph.literal(value.value);
}

function termKey(o: SparqlBindingValue): string {
  return `${o.type}\u0000${o.value}\u0000${o.datatype ?? ''}\u0000${o['xml:lang'] ?? ''}`;
}

function dedupe(triples: StoredTriple[]): StoredTriple[] {
  return union([], triples);
}

function union(base: StoredTriple[], added: StoredTriple[]): StoredTriple[] {
  const seen = new Set(base.map((t) => `${t.p}\u0000${termKey(t.o)}`));
  const out = [...base];
  for (const t of added) {
    const key = `${t.p}\u0000${termKey(t.o)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
