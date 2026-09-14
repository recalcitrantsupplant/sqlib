/**
 * The change-feed subscription, over a scripted stream.
 *
 * What is worth pinning down here is the behaviour a stale screen depends on:
 * a burst of frames becomes one refresh, the open entity is refetched so its
 * concurrency token is fresh, and leaving the view actually closes the socket —
 * a stream that never ends is a Playwright teardown that never finishes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effectScope, ref, nextTick } from 'vue';

const refreshEntities = vi.fn(async () => undefined);

vi.mock('@/composables/useAuth', () => ({
  useAuth: () => ({ accessToken: async () => null }),
}));

vi.mock('@/composables/useLibraryRefresh', () => ({
  useLibraryRefresh: () => ({ refreshEntities }),
}));

import { useLibraryEvents } from '@/composables/useLibraryEvents';

function frame(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** A response whose body this test pushes frames into on demand. */
function scriptedStream() {
  let push!: (chunk: Uint8Array) => void;
  let close!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => controller.enqueue(chunk);
      close = () => controller.close();
    },
  });
  return { body, push, close };
}

/** Let the microtask queue and the batch timer drain. */
async function settle(ms = 300) {
  await vi.advanceTimersByTimeAsync(ms);
  await nextTick();
}

describe('useLibraryEvents', () => {
  beforeEach(() => {
    refreshEntities.mockClear();
    vi.useFakeTimers();
  });

  it('turns a burst of frames into one refresh, including the open entity', async () => {
    const stream = scriptedStream();
    const fetchMock = vi.fn(async () => new Response(stream.body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const scope = effectScope();
    scope.run(() =>
      useLibraryEvents({
        libraryId: ref('urn:library:1'),
        openEntityId: ref('urn:query:open'),
      })
    );

    await settle(0);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('http://api.test/events?');
    expect(url).toContain('libraryId=urn%3Alibrary%3A1');
    expect(url).toContain('clientId=');

    stream.push(frame({ type: 'changed', entity: 'query', id: 'urn:query:1', at: 'now' }));
    stream.push(frame({ type: 'changed', entity: 'query', id: 'urn:query:2', at: 'now' }));
    await settle();

    expect(refreshEntities).toHaveBeenCalledTimes(1);
    expect(refreshEntities).toHaveBeenCalledWith({
      changedIds: ['urn:query:1', 'urn:query:2'],
      openEntityId: 'urn:query:open',
    });

    scope.stop();
  });

  it('reports live while connected and drops to offline when the stream ends', async () => {
    const stream = scriptedStream();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream.body, { status: 200 })));

    const scope = effectScope();
    const feed = scope.run(() => useLibraryEvents({ libraryId: ref('urn:library:1') }))!;

    await settle(0);
    expect(feed.status.value).toBe('live');

    stream.close();
    await settle(0);
    expect(feed.status.value).toBe('offline');

    scope.stop();
  });

  it('refreshes after a reconnect, because nothing is replayed', async () => {
    const streams = [scriptedStream(), scriptedStream()];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(streams[call++]!.body, { status: 200 }))
    );

    const scope = effectScope();
    scope.run(() => useLibraryEvents({ libraryId: ref('urn:library:1') }));
    await settle(0);

    // The first connect refreshes nothing: the view has just loaded.
    expect(refreshEntities).not.toHaveBeenCalled();

    streams[0]!.close();
    await settle(2_000);

    expect(refreshEntities).toHaveBeenCalledTimes(1);
    expect(refreshEntities).toHaveBeenCalledWith({ changedIds: [], openEntityId: null });

    scope.stop();
  });

  it('closes the connection when the view goes away', async () => {
    const stream = scriptedStream();
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const signal = init.signal!;
      signal.addEventListener('abort', () => stream.close());
      return new Response(stream.body, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const scope = effectScope();
    scope.run(() => useLibraryEvents({ libraryId: ref('urn:library:1') }));
    await settle(0);

    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);

    scope.stop();
    expect(signal.aborted).toBe(true);

    // And nothing reconnects afterwards.
    await settle(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stays shut when the caller has it disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const scope = effectScope();
    scope.run(() =>
      useLibraryEvents({ libraryId: ref('urn:library:1'), enabled: ref(false) })
    );
    await settle(0);

    expect(fetchMock).not.toHaveBeenCalled();
    scope.stop();
  });
});
