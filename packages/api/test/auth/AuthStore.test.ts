/**
 * The grant store: RDF in, indexes out, and the union semantics everything else
 * depends on. Persistence is exercised through the in-memory implementation so
 * these stay fast and hermetic; the SPARQL bridge is covered separately.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthStore, inMemoryPersistence, validateModes } from '../../src/auth/AuthStore.js';
import { resolveEffectiveGrants, hasBackendMode, hasLibraryMode } from '../../src/auth/grants.js';
import { PRINCIPAL_AUTHENTICATED } from '../../src/auth/types.js';

const ALICE = 'urn:sqlib:principal:user:alice';
const BOB = 'urn:sqlib:principal:user:bob';
const TEAM = 'urn:sqlib:principal:group:geo';
const LIBRARY = 'urn:sqlib:library:hydrology';
const OTHER_LIBRARY = 'urn:sqlib:library:finance';
const BACKEND = 'urn:sqlib:backend:main';

let store: AuthStore;

beforeEach(async () => {
  store = new AuthStore(inMemoryPersistence());
  await store.load();
});

describe('AuthStore grant lifecycle', () => {
  it('creates, indexes and returns a library grant', async () => {
    const grant = await store.createGrant({
      principal: ALICE,
      resourceKind: 'library',
      resource: LIBRARY,
      modes: ['read', 'execute'],
    });

    expect(grant.id).toMatch(/^urn:sqlib:grant:/);
    expect([...grant.modes].sort()).toEqual(['execute', 'read']);
    expect(store.listGrants({ library: LIBRARY })).toHaveLength(1);
    expect(store.listGrants({ principal: ALICE })).toHaveLength(1);
  });

  it('round-trips grants through persistence', async () => {
    const persistence = inMemoryPersistence();
    const first = new AuthStore(persistence);
    await first.load();
    await first.createGrant({
      principal: ALICE,
      resourceKind: 'library',
      resource: LIBRARY,
      modes: ['read', 'write'],
    });

    // A fresh store over the same storage must see the same grants: this is
    // what a server restart does.
    const second = new AuthStore(persistence);
    await second.load();

    const grants = second.listGrants({ principal: ALICE });
    expect(grants).toHaveLength(1);
    expect([...grants[0].modes].sort()).toEqual(['read', 'write']);
  });

  it('revokes a grant and removes it from every index', async () => {
    const grant = await store.createGrant({
      principal: ALICE,
      resourceKind: 'backend',
      resource: BACKEND,
      modes: ['use'],
    });

    expect(await store.deleteGrant(grant.id)).toBe(true);
    expect(store.getGrant(grant.id)).toBeNull();
    expect(store.listGrants({ backend: BACKEND })).toHaveLength(0);
    expect(store.listGrants({ principal: ALICE })).toHaveLength(0);
    expect(await store.deleteGrant(grant.id)).toBe(false);
  });

  it('deletes only the named grant, leaving its neighbours intact', async () => {
    const doomed = await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'],
    });
    await store.createGrant({
      principal: BOB, resourceKind: 'library', resource: LIBRARY, modes: ['read'],
    });

    await store.deleteGrant(doomed.id);

    expect(store.listGrants({ library: LIBRARY })).toHaveLength(1);
    expect(store.listGrants({ principal: BOB })).toHaveLength(1);
  });

  it('cascades grant removal when a library is deleted', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'] });
    await store.createGrant({ principal: BOB, resourceKind: 'library', resource: LIBRARY, modes: ['write'] });
    await store.createGrant({ principal: ALICE, resourceKind: 'library', resource: OTHER_LIBRARY, modes: ['read'] });

    const removed = await store.deleteGrantsForLibrary(LIBRARY);

    expect(removed).toBe(2);
    expect(store.listGrants({ library: LIBRARY })).toHaveLength(0);
    expect(store.listGrants({ library: OTHER_LIBRARY })).toHaveLength(1);
  });

  it('rejects modes that do not apply to the resource kind', () => {
    expect(() => validateModes('backend', ['use'])).not.toThrow();
    expect(() => validateModes('library', ['read', 'control'])).not.toThrow();
    expect(() => validateModes('backend', ['delete'])).toThrow(/Invalid mode/);
    expect(() => validateModes('library', ['use'])).toThrow(/Invalid mode/);
    expect(() => validateModes('library', [])).toThrow(/at least one mode/);
  });
});

describe('admin resolution', () => {
  it('treats a Control grant on Everything as admin', async () => {
    await store.createGrant({
      principal: ALICE,
      resourceKind: 'everything',
      resource: 'ignored',
      modes: ['control'],
    });

    expect(store.isAdmin([ALICE])).toBe(true);
    expect(store.isAdmin([BOB])).toBe(false);
  });

  it('keeps bootstrap admins across index rebuilds', async () => {
    store.setBootstrapAdmins([ALICE]);
    expect(store.isAdmin([ALICE])).toBe(true);

    // A grant write rebuilds the indexes; env-configured admins must survive it,
    // or the first grant created would lock the operator out.
    await store.createGrant({ principal: BOB, resourceKind: 'library', resource: LIBRARY, modes: ['read'] });

    expect(store.isAdmin([ALICE])).toBe(true);
  });
});

describe('effective grant resolution', () => {
  it('unions grants across all of a caller principals', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'] });
    await store.createGrant({ principal: TEAM, resourceKind: 'library', resource: LIBRARY, modes: ['write'] });

    const grants = resolveEffectiveGrants([ALICE, TEAM], store);

    expect(hasLibraryMode(grants, LIBRARY, 'read')).toBe(true);
    expect(hasLibraryMode(grants, LIBRARY, 'write')).toBe(true);
    expect(hasLibraryMode(grants, LIBRARY, 'delete')).toBe(false);
  });

  it('grants everyone what the authenticated sentinel holds', async () => {
    await store.createGrant({
      principal: PRINCIPAL_AUTHENTICATED,
      resourceKind: 'backend',
      resource: BACKEND,
      modes: ['use'],
    });

    const grants = resolveEffectiveGrants([BOB, PRINCIPAL_AUTHENTICATED], store);

    expect(hasBackendMode(grants, BACKEND, 'use')).toBe(true);
    expect(hasBackendMode(grants, BACKEND, 'write')).toBe(false);
  });

  it('gives an unrelated principal nothing', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'] });

    const grants = resolveEffectiveGrants([BOB], store);

    expect(grants.admin).toBe(false);
    expect(hasLibraryMode(grants, LIBRARY, 'read')).toBe(false);
  });

  it('lets an admin through every check without a matching grant', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'everything', resource: 'x', modes: ['control'] });

    const grants = resolveEffectiveGrants([ALICE], store);

    expect(hasLibraryMode(grants, 'urn:sqlib:library:never-granted', 'delete')).toBe(true);
    expect(hasBackendMode(grants, 'urn:sqlib:backend:never-granted', 'write')).toBe(true);
  });
});

describe('seeding', () => {
  it('loads a Turtle seed file into an empty graph', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-auth-seed-'));
    const seedPath = path.join(dir, 'grants.ttl');
    await fs.writeFile(
      seedPath,
      `@prefix auth: <https://sparql-query-lib/auth#> .
       <urn:sqlib:grant:seeded> a auth:Grant ;
         auth:principal <${PRINCIPAL_AUTHENTICATED}> ;
         auth:onLibrary <${LIBRARY}> ;
         auth:mode auth:Read, auth:Execute .`,
      'utf8'
    );

    const seeded = new AuthStore(inMemoryPersistence());
    await seeded.load({ seedGrantsPath: seedPath });

    const grants = seeded.listGrants({ library: LIBRARY });
    expect(grants).toHaveLength(1);
    expect([...grants[0].modes].sort()).toEqual(['execute', 'read']);
  });

  it('does not re-seed a graph that already holds grants', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-auth-seed-'));
    const seedPath = path.join(dir, 'grants.ttl');
    await fs.writeFile(
      seedPath,
      `@prefix auth: <https://sparql-query-lib/auth#> .
       <urn:sqlib:grant:seeded> a auth:Grant ;
         auth:principal <${ALICE}> ;
         auth:onLibrary <${LIBRARY}> ;
         auth:mode auth:Read .`,
      'utf8'
    );

    const persistence = inMemoryPersistence();
    const first = new AuthStore(persistence);
    await first.load({ seedGrantsPath: seedPath });
    await first.deleteGrant(first.listGrants()[0].id);

    // Second boot: the graph is no longer empty in the operator's sense — the
    // seed already ran — so a revoked seed grant must stay revoked.
    const second = new AuthStore(persistence);
    await second.load({ seedGrantsPath: seedPath });

    expect(second.listGrants()).toHaveLength(0);
  });
});

describe('principal records', () => {
  it('records a principal once and finds it by raw claim', async () => {
    await store.recordPrincipal(ALICE, 'alice@example.com', 'user');
    await store.recordPrincipal(ALICE, 'alice@example.com', 'user');

    expect(store.listPrincipals()).toHaveLength(1);
    expect(store.listPrincipals('ALICE@')).toHaveLength(1);
    expect(store.listPrincipals('nobody')).toHaveLength(0);
  });
});
