/**
 * `createdBy` and `modifiedBy`: who made an entity, and who made its last
 * write (`persistence/authorship.ts`).
 *
 * The coordinator stamps both from `currentWriteActor`, which reads the
 * request the write is made in (`auth/writeActor.ts`). Three cases matter:
 * a signed-in caller, a request that names no one, and no request at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { CacheCoordinator, stampCreateAuthorship, stampUpdateAuthorship } from '../../src/lib/CacheCoordinator.js';
import { currentWriteActor, NO_REQUEST, registerWriteActorHooks, runWithWriteRequest } from '../../src/auth/writeActor.js';
import { createAnonymousContext, createFullAccessContext, type AuthContext } from '../../src/auth/types.js';
import { generateInsertQuery, generateUpdateQuery } from '../../src/persistence/writeQueryGenerator.js';
import { QuerySchema } from '../../src/persistence/schemas/QuerySchema.js';
import { SCHEMA_BY_TYPE } from '../../src/persistence/schemaRegistry.js';
import { loadSystemStore } from '../../src/system-store/SystemStoreLoader.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

vi.mock('../../src/system-store/SystemStoreLoader', () => ({
  loadSystemStore: vi.fn(async () => ({ cacheEntries: new Map(), assetDir: 'mock', store: {} as never })),
  getKnownSystemEntityIds: vi.fn(() => new Set()),
}));

vi.mock('../../src/server/config', () => ({
  config: { cachePreloadEnabled: true, cacheWriteThroughEnabled: true },
}));

const ALICE = 'urn:sqlib:principal:user:alice';
const BOB = 'urn:sqlib:principal:user:bob';

function userContext(subject: string): AuthContext {
  return {
    subject,
    principals: [subject],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: { admin: false, backends: new Map(), libraries: new Map() },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const requestAs = (context: AuthContext) => ({ authContext: context }) as unknown as FastifyRequest;
const as = <T>(context: AuthContext, fn: () => T): T => runWithWriteRequest(requestAs(context), fn);

describe('currentWriteActor', () => {
  it('names the signed-in user', () => {
    expect(as(userContext(ALICE), currentWriteActor)).toBe(ALICE);
  });

  it('names no one for a request that identifies no one', () => {
    expect(as(createFullAccessContext('disabled'), currentWriteActor)).toBeNull();
    expect(as(createFullAccessContext('dry-run'), currentWriteActor)).toBeNull();
    expect(as(createAnonymousContext({ admin: false, backends: new Map(), libraries: new Map() }), currentWriteActor))
      .toBeNull();
    expect(as({ ...userContext('urn:sqlib:principal:client:ci'), tokenType: 'system' }, currentWriteActor)).toBeNull();
  });

  it('says when there is no request at all', () => {
    expect(currentWriteActor()).toBe(NO_REQUEST);
  });

  it('carries the request through hooks, body parsing and awaits to the handler', async () => {
    const app = Fastify({ logger: false });
    app.decorateRequest('authContext', undefined);
    registerWriteActorHooks(app);
    // After the write-actor hooks, as the auth plugin's own hook is: the
    // scope holds the request and reads its context at write time.
    app.addHook('onRequest', async request => {
      request.authContext = userContext(ALICE);
    });
    app.post('/write', async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      await Promise.resolve();
      return { actor: currentWriteActor() };
    });
    await app.ready();
    const response = await app.inject({ method: 'POST', url: '/write', payload: { big: 'x'.repeat(100_000) } });
    await app.close();
    expect(response.json()).toEqual({ actor: ALICE });
  });
});

describe('stamping rules', () => {
  it('a create in a request takes the caller, whatever the body said', () => {
    const entity: Record<string, unknown> = { $id: 'e', createdBy: BOB, modifiedBy: BOB };
    stampCreateAuthorship(entity, ALICE);
    expect(entity).toMatchObject({ createdBy: ALICE, modifiedBy: ALICE });

    const anonymous: Record<string, unknown> = { $id: 'e', createdBy: BOB };
    stampCreateAuthorship(anonymous, null);
    expect(anonymous).not.toHaveProperty('createdBy');
    expect(anonymous).not.toHaveProperty('modifiedBy');
  });

  it('a create outside a request keeps what it carries, so an import restores it', () => {
    const entity: Record<string, unknown> = { $id: 'e', createdBy: BOB, modifiedBy: ALICE };
    stampCreateAuthorship(entity, NO_REQUEST);
    expect(entity).toMatchObject({ createdBy: BOB, modifiedBy: ALICE });
  });

  it('an update never moves createdBy, and names the caller as modifiedBy', () => {
    const updates: Record<string, unknown> = { name: 'x', createdBy: BOB, modifiedBy: BOB };
    stampUpdateAuthorship(updates, { createdBy: BOB }, ALICE);
    expect(updates).toEqual({ name: 'x', modifiedBy: ALICE });
  });

  it('an update by no one clears an earlier editor, and adds nothing when there is none', () => {
    const clears: Record<string, unknown> = { name: 'x' };
    stampUpdateAuthorship(clears, { modifiedBy: ALICE }, null);
    expect(clears).toEqual({ name: 'x', modifiedBy: null });

    const untouched: Record<string, unknown> = { name: 'x' };
    stampUpdateAuthorship(untouched, {}, null);
    expect(untouched).toEqual({ name: 'x' });
  });
});

describe('CacheCoordinator', () => {
  let coordinator: CacheCoordinator;
  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    store = await installFakePersistenceAdapter();
    coordinator = new CacheCoordinator();
    vi.mocked(loadSystemStore).mockResolvedValue({ cacheEntries: new Map(), assetDir: 'mock' } as never);
    await coordinator.loadAll();
  });

  afterEach(() => {
    store.restore();
  });

  it('stamps the creator, then the editor, in the store and the cache', async () => {
    await as(userContext(ALICE), () =>
      coordinator.create('Query', { $id: 'urn:q', name: 'Flow', isPartOf: ['urn:lib'] } as never));
    expect(store.get('urn:q')).toMatchObject({ createdBy: ALICE, modifiedBy: ALICE });

    const updated = await as(userContext(BOB), () => coordinator.update('Query', 'urn:q', { name: 'Flow 2' } as never));
    expect(updated).toMatchObject({ createdBy: ALICE, modifiedBy: BOB });
    expect(store.get('urn:q')).toMatchObject({ createdBy: ALICE, modifiedBy: BOB });
    expect(coordinator.get('urn:q')).toMatchObject({ createdBy: ALICE, modifiedBy: BOB });
  });

  it('does not write into the caller\'s update object', async () => {
    await as(userContext(ALICE), () =>
      coordinator.create('Query', { $id: 'urn:q', name: 'Flow', isPartOf: ['urn:lib'] } as never));
    const updates = { name: 'Flow 2' };
    await as(userContext(BOB), () => coordinator.update('Query', 'urn:q', updates as never));
    expect(updates).toEqual({ name: 'Flow 2' });
  });

  it('lets a signed-in caller add a comment to a frozen version', async () => {
    await as(userContext(ALICE), () =>
      coordinator.create('QueryVersion', { $id: 'urn:qv', isPartOf: 'urn:q', version: 1, queryString: 'ASK {}' } as never));
    const updated = await as(userContext(BOB), () =>
      coordinator.update('QueryVersion', 'urn:qv', { comment: 'reviewed' } as never));
    expect(updated).toMatchObject({ createdBy: ALICE, modifiedBy: BOB, comment: 'reviewed' });
  });
});

describe('schemas', () => {
  it('every entity with timestamps carries both fields', () => {
    for (const [type, schema] of Object.entries(SCHEMA_BY_TYPE)) {
      if (!('dateModified' in schema)) continue;
      expect(schema, type).toHaveProperty('createdBy');
      expect(schema, type).toHaveProperty('modifiedBy');
    }
  });

  it('writes dct:creator and sqlib:modifiedBy as IRIs', () => {
    const insert = generateInsertQuery(QuerySchema, {
      $id: 'urn:q', name: 'Flow', isPartOf: ['urn:lib'], createdBy: ALICE, modifiedBy: ALICE,
    });
    expect(insert).toContain(`<http://purl.org/dc/terms/creator> <${ALICE}>`);
    expect(insert).toContain(`<https://sparql-query-lib/modifiedBy> <${ALICE}>`);

    const clear = generateUpdateQuery(QuerySchema, 'urn:q', { modifiedBy: null });
    expect(clear).toContain('<https://sparql-query-lib/modifiedBy>');
    expect(clear).not.toContain('INSERT');
  });
});
