/**
 * The auth graph's own store: SQLite or a file for one instance, a SPARQL
 * dataset for several. Never the library store, so library backups and resets leave
 * grants alone.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthStore } from '../../src/auth/AuthStore.js';
import { AUTH_STORE_FILE, fileAuthGraphPersistence } from '../../src/auth/persistence.js';
import { buildAuthConfig } from '../../src/auth/config.js';
import { AUTH_SQLITE_FILE, sqliteAuthGraphPersistence, type SqliteAuthGraphPersistence } from '../../src/auth/sqlitePersistence.js';

const ALICE = 'urn:sqlib:principal:user:alice';
const LIBRARY = 'urn:sqlib:library:one';
const BACKEND = 'urn:sqlib:backend:one';

describe('file auth store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-auth-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts empty when the file does not exist yet', async () => {
    const store = new AuthStore(fileAuthGraphPersistence(path.join(dir, 'auth')));
    await store.load();
    expect(store.listGrants()).toEqual([]);
  });

  it('keeps grants and principals across a restart', async () => {
    const first = new AuthStore(fileAuthGraphPersistence(dir));
    await first.load();
    await first.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'] });
    const removed = await first.createGrant({ principal: ALICE, resourceKind: 'backend', resource: BACKEND, modes: ['query:saved'] });
    await first.recordPrincipal(ALICE, 'alice', 'user');
    await first.deleteGrant(removed.id);

    const second = new AuthStore(fileAuthGraphPersistence(dir));
    await second.load();
    expect(second.listGrants().map((g) => [g.resource, [...g.modes]])).toEqual([[LIBRARY, ['read']]]);
    expect(second.listPrincipals().map((p) => p.iri)).toContain(ALICE);
    const text = await fs.readFile(path.join(dir, AUTH_STORE_FILE), 'utf8');
    expect(text).toContain('<urn:sqlib:auth>');
    // The temporary file is renamed into place, never left behind.
    expect(await fs.readdir(dir)).toEqual([AUTH_STORE_FILE]);
  });

  it('removes every grant on a deleted backend', async () => {
    const store = new AuthStore(fileAuthGraphPersistence(dir));
    await store.load();
    await store.createGrant({ principal: ALICE, resourceKind: 'backend', resource: BACKEND, modes: ['query:saved'] });
    await store.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'] });

    expect(await store.deleteGrantsForBackend(BACKEND)).toBe(1);
    expect(store.listGrants().map((g) => g.resource)).toEqual([LIBRARY]);
  });
});

describe('sqlite auth store', () => {
  let dir: string;
  const opened: SqliteAuthGraphPersistence[] = [];

  function persistence(at = dir): SqliteAuthGraphPersistence {
    const created = sqliteAuthGraphPersistence(at);
    opened.push(created);
    return created;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-auth-sqlite-'));
  });

  afterEach(async () => {
    for (const each of opened.splice(0)) each.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts empty when the database does not exist yet', async () => {
    const store = new AuthStore(persistence(path.join(dir, 'auth')));
    await store.load();
    expect(store.listGrants()).toEqual([]);
    expect((await fs.stat(path.join(dir, 'auth', AUTH_SQLITE_FILE))).mode & 0o777).toBe(0o600);
  });

  it('keeps grants, principals and groups across a restart', async () => {
    const first = persistence();
    const before = new AuthStore(first);
    await before.load();
    await before.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'] });
    const removed = await before.createGrant({ principal: ALICE, resourceKind: 'backend', resource: BACKEND, modes: ['query:saved'] });
    await before.recordPrincipal(ALICE, 'alice', 'user', 'alice@example.org');
    await before.recordPrincipal(ALICE, 'alice', 'user', 'Alice Example');
    await before.recordGroups(ALICE, ['urn:sqlib:principal:group:analysts']);
    await before.deleteGrant(removed.id);
    first.close();

    const after = new AuthStore(persistence());
    await after.load();
    expect(after.listGrants().map((g) => [g.resource, [...g.modes]])).toEqual([[LIBRARY, ['read']]]);
    expect(after.listPrincipals().find((p) => p.iri === ALICE)?.label).toBe('Alice Example');
    expect(after.lastSeenGroups(ALICE)).toEqual(['urn:sqlib:principal:group:analysts']);
  });

  it('keeps literals with escapes and datatypes exactly', async () => {
    const quads = [
      '<urn:s> <urn:p> "line one\\nline \\"two\\""@en <urn:sqlib:auth> .',
      '<urn:s> <urn:p> "2026-10-28T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> <urn:sqlib:auth> .',
    ].join('\n');
    await persistence().apply({ insert: quads });
    const reloaded = await persistence().load();
    expect(reloaded.split('\n').sort()).toEqual(quads.split('\n').sort());

    // A delete finds the row whatever spelling of the same term it was given.
    await persistence().apply({ delete: '<urn:s> <urn:p> "2026-10-28T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> <urn:sqlib:auth>.' });
    expect((await persistence().load()).split('\n')).toHaveLength(1);
  });

  it('records each change in the audit trail, and only what changed', async () => {
    const store = persistence();
    const quad = '<urn:s> <urn:p> <urn:o> <urn:sqlib:auth> .';
    await store.apply({ insert: quad });
    await store.apply({ insert: quad }); // already there: no event
    await store.apply({ delete: '<urn:s> <urn:p> <urn:missing> <urn:sqlib:auth> .' }); // not there: no event
    await store.apply({ delete: quad, insert: '<urn:s> <urn:p> <urn:o2> <urn:sqlib:auth> .' });

    expect(store.events().map(({ change, op, quad }) => [change, op, quad])).toEqual([
      [1, 'insert', quad],
      [2, 'delete', quad],
      [2, 'insert', '<urn:s> <urn:p> <urn:o2> <urn:sqlib:auth> .'],
    ]);
  });

  it('writes a change whole or not at all', async () => {
    const store = persistence();
    await store.apply({ insert: '<urn:s> <urn:p> <urn:o> <urn:sqlib:auth> .' });
    await expect(store.apply({
      delete: '<urn:s> <urn:p> <urn:o> <urn:sqlib:auth> .',
      insert: 'not n-quads',
    })).rejects.toThrow();
    expect(await store.load()).toBe('<urn:s> <urn:p> <urn:o> <urn:sqlib:auth> .');
    expect(store.events()).toHaveLength(1);
  });

  it('refuses a database written by a newer sqlib', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const newer = new DatabaseSync(path.join(dir, AUTH_SQLITE_FILE));
    newer.exec('PRAGMA user_version = 99');
    newer.close();
    await expect(persistence().load()).rejects.toThrow(/schema version 99/);
  });
});

describe('auth store config', () => {
  it('defaults to SQLite under ./storage/auth', () => {
    expect(buildAuthConfig({}).store).toEqual({ type: 'sqlite', dir: path.resolve('./storage/auth') });
  });

  it('still offers the N-Quads file', () => {
    expect(buildAuthConfig({ SQLIB_AUTH_STORE_TYPE: 'file' }).store).toEqual({ type: 'file', dir: path.resolve('./storage/auth') });
  });

  it('uses a SPARQL dataset when one is named', () => {
    expect(buildAuthConfig({ SQLIB_AUTH_SPARQL_ENDPOINT: 'http://fuseki:3030/auth/' }).store).toEqual({
      type: 'sparql', queryUrl: 'http://fuseki:3030/auth/', updateUrl: 'http://fuseki:3030/auth/', username: undefined, password: undefined,
    });
  });

  it('refuses a SPARQL store with no endpoint, and an unknown type', () => {
    expect(() => buildAuthConfig({ SQLIB_AUTH_STORE_TYPE: 'sparql' })).toThrow(/SQLIB_AUTH_SPARQL_ENDPOINT/);
    expect(() => buildAuthConfig({ SQLIB_AUTH_STORE_TYPE: 'library' })).toThrow(/Expected "sqlite", "file" or "sparql"/);
  });
});
