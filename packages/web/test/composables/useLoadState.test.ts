/**
 * `useLoadState` tells a first load from a reload, per subject.
 *
 * A view renders loading text on `initialLoading` only, so a reload of data
 * already on screen must report `initialLoading: false`. A load for another
 * subject must report `true`, so the previous subject's rows do not show under
 * the new subject's name.
 */
import { describe, it, expect, vi } from 'vitest';
import { useLoadState } from '@/composables/useLoadState';
import { createVersionedEntityStore } from '@/composables/createVersionedEntityStore';

/** A promise and the call that settles it. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useLoadState', () => {
  it('reports the first load as initial and a reload as not initial', async () => {
    const state = useLoadState();
    const first = deferred();
    const load = state.track(() => first.promise);
    expect(state.loading.value).toBe(true);
    expect(state.initialLoading.value).toBe(true);
    first.resolve();
    await load;
    expect(state.loaded.value).toBe(true);
    expect(state.loading.value).toBe(false);

    const second = deferred();
    const reload = state.track(() => second.promise);
    expect(state.loading.value).toBe(true);
    expect(state.initialLoading.value).toBe(false);
    second.resolve();
    await reload;
  });

  it('reports a load for a new key as initial', async () => {
    const state = useLoadState();
    await state.track(async () => undefined, 'urn:library:a');

    const next = deferred();
    const load = state.track(() => next.promise, 'urn:library:b');
    expect(state.initialLoading.value).toBe(true);
    next.resolve();
    await load;

    const again = deferred();
    const reload = state.track(() => again.promise, 'urn:library:b');
    expect(state.initialLoading.value).toBe(false);
    again.resolve();
    await reload;
  });

  it('does not mark the current key when a slower load for an earlier key lands', async () => {
    const state = useLoadState();
    const slow = deferred();
    const fast = deferred();
    const a = state.track(() => slow.promise, 'a');
    const b = state.track(() => fast.promise, 'b');
    slow.resolve();
    await a;
    // The load for `b` still runs and nothing for `b` has arrived.
    expect(state.loading.value).toBe(true);
    expect(state.initialLoading.value).toBe(true);
    fast.resolve();
    await b;
    expect(state.loaded.value).toBe(true);
  });

  it('keeps a failed first load initial for the next attempt', async () => {
    const state = useLoadState();
    await expect(state.track(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(state.loaded.value).toBe(false);

    const retry = deferred();
    const load = state.track(() => retry.promise);
    expect(state.initialLoading.value).toBe(true);
    retry.resolve();
    await load;
  });

  it('makes the next load initial after reset', async () => {
    const state = useLoadState();
    await state.track(async () => undefined);
    state.reset();
    const next = deferred();
    const load = state.track(() => next.promise);
    expect(state.initialLoading.value).toBe(true);
    next.resolve();
    await load;
  });

  it('ends a load started with start, once', () => {
    const state = useLoadState();
    const end = state.start('x');
    expect(state.initialLoading.value).toBe(true);
    end();
    end();
    expect(state.loading.value).toBe(false);
    expect(state.loaded.value).toBe(true);
  });
});

describe('a versioned entity store', () => {
  it('keeps initialLoading false while it reloads after a save', async () => {
    const list = deferred<Array<{ id: string; name: string }>>();
    let calls = 0;
    const store = createVersionedEntityStore<{ id: string; name: string }, never, { name: string }>({
      noun: 'thing',
      nounPlural: 'things',
      api: () => ({
        list: () => (calls++ === 0 ? Promise.resolve([{ id: 'urn:thing:1', name: 'One' }]) : list.promise),
        get: async (id: string) => ({ data: { id, name: 'One' }, etag: null, lastModified: null, status: 200 }),
        update: async (id: string, input: { name: string }) =>
          ({ data: { id, name: input.name }, etag: null, lastModified: null, status: 200 }),
      }),
    })();

    await store.load();
    expect(store.initialLoading.value).toBe(false);

    // `update` reloads the list, as every saved edit does.
    const saving = store.update('urn:thing:1', { name: 'Two' });
    await vi.waitFor(() => expect(store.loading.value).toBe(true));
    expect(store.initialLoading.value).toBe(false);
    expect(store.items.value).toHaveLength(1);

    list.resolve([{ id: 'urn:thing:1', name: 'Two' }]);
    await saving;
    expect(store.items.value[0].name).toBe('Two');
  });
});
