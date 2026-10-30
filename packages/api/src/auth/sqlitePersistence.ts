/**
 * The auth graph in one SQLite file: a row per quad, written per change.
 *
 * The file store rewrites the whole graph on each change, and the store is
 * small enough for that. This one writes only the quads a change adds or
 * removes, in one transaction, so a write costs the same however many grants
 * exist, and a crash leaves either the whole change or none of it.
 *
 * Every change is also kept in `auth_events`: which quads were added or
 * removed, and when. Grants carry `grantedBy`, so the trail says who as well.
 *
 * Terms are stored in their N-Triples form as `oxigraph` prints them, one
 * spelling per term, so a delete always finds the row its insert wrote. The
 * auth graph has no blank nodes: grants and principals are named by IRI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as oxigraph from 'oxigraph';
import type { AuthGraphPersistence } from './AuthStore.js';

export const AUTH_SQLITE_FILE = 'auth.sqlite';

/** Bumped with each change to the tables below; `PRAGMA user_version` holds it. */
const SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS quads (
    s TEXT NOT NULL,
    p TEXT NOT NULL,
    o TEXT NOT NULL,
    g TEXT NOT NULL,
    PRIMARY KEY (s, p, o, g)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS auth_events (
    id INTEGER PRIMARY KEY,
    change INTEGER NOT NULL,
    at TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('insert', 'delete')),
    s TEXT NOT NULL,
    p TEXT NOT NULL,
    o TEXT NOT NULL,
    g TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS auth_events_by_subject ON auth_events (s);
`;

export interface AuthEvent {
  change: number;
  at: string;
  op: 'insert' | 'delete';
  quad: string;
}

export type SqliteAuthGraphPersistence = AuthGraphPersistence & {
  /** The audit trail, oldest first. */
  events(): AuthEvent[];
  close(): void;
};

type Row = { s: string; p: string; o: string; g: string };

export function sqliteAuthGraphPersistence(dir: string): SqliteAuthGraphPersistence {
  const file = path.join(dir, AUTH_SQLITE_FILE);
  let db: DatabaseSync | null = null;

  function open(): DatabaseSync {
    if (db) return db;
    fs.mkdirSync(dir, { recursive: true });
    // Created empty first so the mode is ours; SQLite gives its WAL and
    // shared-memory files the same permissions as the database.
    fs.writeFileSync(file, '', { flag: 'a', mode: 0o600 });

    const opened = new DatabaseSync(file);
    try {
      // WAL: a write never waits for a reader. FULL: a commit is on disk
      // before `apply` returns; auth writes are rare enough not to notice.
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
    return opened;
  }

  return {
    async load(): Promise<string> {
      const rows = open().prepare('SELECT s, p, o, g FROM quads ORDER BY s, p, o').all() as Row[];
      return rows.map(({ s, p, o, g }) => `${s} ${p} ${o}${g ? ` ${g}` : ''} .`).join('\n');
    },

    async apply({ insert, delete: toDelete }): Promise<void> {
      const removed = toRows(toDelete);
      const added = toRows(insert);
      if (removed.length === 0 && added.length === 0) return;

      const conn = open();
      const deleteQuad = conn.prepare('DELETE FROM quads WHERE s = ? AND p = ? AND o = ? AND g = ?');
      const insertQuad = conn.prepare('INSERT OR IGNORE INTO quads (s, p, o, g) VALUES (?, ?, ?, ?)');
      const record = conn.prepare(
        'INSERT INTO auth_events (change, at, op, s, p, o, g) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      conn.exec('BEGIN IMMEDIATE');
      try {
        const { next } = conn.prepare('SELECT coalesce(max(change), 0) + 1 AS next FROM auth_events').get() as { next: number };
        const at = new Date().toISOString();
        // Only rows that changed are recorded: a delete of a missing quad or an
        // insert of a present one is not an event.
        for (const { s, p, o, g } of removed) {
          if (Number(deleteQuad.run(s, p, o, g).changes) > 0) record.run(next, at, 'delete', s, p, o, g);
        }
        for (const { s, p, o, g } of added) {
          if (Number(insertQuad.run(s, p, o, g).changes) > 0) record.run(next, at, 'insert', s, p, o, g);
        }
        conn.exec('COMMIT');
      } catch (error) {
        conn.exec('ROLLBACK');
        throw error;
      }
    },

    events(): AuthEvent[] {
      const rows = open()
        .prepare('SELECT change, at, op, s, p, o, g FROM auth_events ORDER BY id')
        .all() as Array<Row & { change: number; at: string; op: 'insert' | 'delete' }>;
      return rows.map(({ change, at, op, s, p, o, g }) => ({
        change,
        at,
        op,
        quad: `${s} ${p} ${o}${g ? ` ${g}` : ''} .`,
      }));
    },

    close(): void {
      db?.close();
      db = null;
    },
  };
}

/** Parses N-Quads into rows of canonical N-Triples terms. Throws on bad syntax. */
function toRows(nquads: string | undefined): Row[] {
  if (!nquads?.trim()) return [];
  return oxigraph.parse(nquads, { format: 'application/n-quads' }).map(quad => ({
    s: quad.subject.toString(),
    p: quad.predicate.toString(),
    o: quad.object.toString(),
    g: quad.graph.termType === 'DefaultGraph' ? '' : quad.graph.toString(),
  }));
}
