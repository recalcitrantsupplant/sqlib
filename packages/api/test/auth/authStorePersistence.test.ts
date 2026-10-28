/**
 * The auth graph's own store: a file for one instance, a SPARQL dataset for
 * several. Never the library store, so library backups and resets leave
 * grants alone.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthStore } from '../../src/auth/AuthStore.js';
import { AUTH_STORE_FILE, fileAuthGraphPersistence } from '../../src/auth/persistence.js';
import { buildAuthConfig } from '../../src/auth/config.js';

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

describe('auth store config', () => {
  it('defaults to a file under ./storage/auth', () => {
    expect(buildAuthConfig({}).store).toEqual({ type: 'file', dir: path.resolve('./storage/auth') });
  });

  it('uses a SPARQL dataset when one is named', () => {
    expect(buildAuthConfig({ SQLIB_AUTH_SPARQL_ENDPOINT: 'http://fuseki:3030/auth/' }).store).toEqual({
      type: 'sparql', queryUrl: 'http://fuseki:3030/auth/', updateUrl: 'http://fuseki:3030/auth/', username: undefined, password: undefined,
    });
  });

  it('refuses a SPARQL store with no endpoint, and an unknown type', () => {
    expect(() => buildAuthConfig({ SQLIB_AUTH_STORE_TYPE: 'sparql' })).toThrow(/SQLIB_AUTH_SPARQL_ENDPOINT/);
    expect(() => buildAuthConfig({ SQLIB_AUTH_STORE_TYPE: 'library' })).toThrow(/Expected "file" or "sparql"/);
  });
});
