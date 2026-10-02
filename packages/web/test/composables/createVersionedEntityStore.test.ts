/**
 * The store core every saved-entity store builds on: the token it keeps per
 * record, and what a guarded write does when it loses a race.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createVersionedEntityStore,
  deriveIfMatchToken,
  EntityConflictError,
  type EntityApi,
} from '@/composables/createVersionedEntityStore';

interface Thing {
  id: string;
  name: string;
  dateModified?: string | null;
}

function preconditionFailed() {
  return Object.assign(new Error('Precondition Failed'), { statusCode: 412 });
}

function fakeApi(overrides: Partial<EntityApi<Thing, Partial<Thing>, Partial<Thing>>> = {}) {
  let revision = 1;
  const api = {
    list: vi.fn(async () => [{ id: 'urn:thing:1', name: 'One' }]),
    get: vi.fn(async (id: string) => ({
      data: { id, name: 'One', dateModified: `r${revision}` },
      etag: `"r${revision}"`,
      lastModified: null,
      status: 200,
    })),
    update: vi.fn(async (id: string, input: Partial<Thing>) => ({
      data: { id, name: input.name ?? 'One', dateModified: `r${++revision}` },
      etag: `"r${revision}"`,
      lastModified: null,
      status: 200,
    })),
    ...overrides,
  };
  return { api, bump: () => { revision += 1; } };
}

describe('createVersionedEntityStore', () => {
  it('keeps the token a read returned and sends it with the next write', async () => {
    const { api } = fakeApi();
    const store = createVersionedEntityStore<Thing, Partial<Thing>, Partial<Thing>>({
      noun: 'thing', nounPlural: 'things', api: () => api,
    })();

    await store.fetch('urn:thing:1');
    expect(store.concurrency['urn:thing:1']).toBe('"r1"');

    await store.update('urn:thing:1', { name: 'Renamed' });
    expect(api.update).toHaveBeenCalledWith('urn:thing:1', { name: 'Renamed' }, { ifMatch: '"r1"' });
    expect(store.concurrency['urn:thing:1']).toBe('"r2"');
  });

  it('re-reads and replays once when another writer got there first', async () => {
    const { api, bump } = fakeApi();
    const update = api.update;
    api.update = vi.fn(async (id: string, input: Partial<Thing>, options: { ifMatch: string | null }) => {
      if (options.ifMatch === '"stale"') throw preconditionFailed();
      return update(id, input);
    });
    const store = createVersionedEntityStore<Thing, Partial<Thing>, Partial<Thing>>({
      noun: 'thing', nounPlural: 'things', api: () => api,
    })();
    bump();

    const updated = await store.update('urn:thing:1', { name: 'Mine' }, '"stale"');

    expect(updated.name).toBe('Mine');
    expect(api.get).toHaveBeenCalledWith('urn:thing:1');
    expect(api.update).toHaveBeenLastCalledWith('urn:thing:1', { name: 'Mine' }, { ifMatch: '"r2"' });
  });

  it('names the record when the race is lost twice, rather than surfacing a bare 412', async () => {
    const { api } = fakeApi({ update: vi.fn(async () => { throw preconditionFailed(); }) });
    const store = createVersionedEntityStore<Thing, Partial<Thing>, Partial<Thing>>({
      noun: 'thing', nounPlural: 'things', api: () => api,
    })();

    const failure = store.update('urn:thing:1', { name: 'Mine' });
    await expect(failure).rejects.toBeInstanceOf(EntityConflictError);
    await expect(failure).rejects.toMatchObject({ statusCode: 412, id: 'urn:thing:1' });
    expect(api.update).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failure that is not a lost race', async () => {
    const refused = Object.assign(new Error('Bad Request'), { statusCode: 400 });
    const { api } = fakeApi({ update: vi.fn(async () => { throw refused; }) });
    const store = createVersionedEntityStore<Thing, Partial<Thing>, Partial<Thing>>({
      noun: 'thing', nounPlural: 'things', api: () => api,
    })();

    await expect(store.update('urn:thing:1', { name: 'x' })).rejects.toBe(refused);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('falls back to the store\'s local items when the list fails', async () => {
    const { api } = fakeApi({ list: vi.fn(async () => { throw new Error('offline'); }) });
    const store = createVersionedEntityStore<Thing, Partial<Thing>, Partial<Thing>>({
      noun: 'thing',
      nounPlural: 'things',
      api: () => api,
      fallbackItems: () => [{ id: 'urn:local:1', name: 'Local' }],
    })();

    await store.load();
    expect(store.error.value).toBe('offline');
    expect(store.items.value.map((item) => item.id)).toEqual(['urn:local:1']);
  });

  it('derives a token from the record when the response carries no ETag', () => {
    expect(deriveIfMatchToken(null, { dateModified: '2026-10-02T00:00:00Z' })).toBe('2026-10-02T00:00:00Z');
    expect(deriveIfMatchToken('  ', { dateCreated: 'c' })).toBe('c');
    expect(deriveIfMatchToken('"e"', { dateModified: 'm' })).toBe('"e"');
  });
});
