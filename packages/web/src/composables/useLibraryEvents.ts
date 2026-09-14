/**
 * Listening to the server's change feed, so the library view does not go stale
 * when someone else writes.
 *
 * The scenario this exists for: chat on the left in Claude Desktop or Claude
 * Code, sqlib on the right. The MCP client creates and edits queries through
 * the same API routes the browser uses, and until now the browser kept showing
 * what it fetched on mount.
 *
 * `fetch` rather than `EventSource` for the same reason `lib/sse.ts` exists:
 * `EventSource` cannot set an `Authorization` header, and the app authenticates
 * with a bearer token rather than a cookie. The cost is `EventSource`'s free
 * reconnect, which is the backoff loop below.
 *
 * One connection per tab, shared by every caller. Under HTTP/1.1 a browser
 * allows six connections per origin, and a stream that never ends holds one of
 * them for as long as the page is open; several of them would starve ordinary
 * fetches.
 */
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';
import { parseSseStream } from '../lib/sse';
import { clientId } from '../lib/clientId';
import { useAuth } from './useAuth';
import { useLibraryRefresh } from './useLibraryRefresh';

export type LibraryEventStatus = 'idle' | 'connecting' | 'live' | 'offline';

/** A frame off the feed. Notification only — never the entity itself. */
export interface LibraryChangeEvent {
  type: 'changed';
  entity: string;
  id: string | null;
  libraryId: string | null;
  method: string;
  origin: string | null;
  at: string;
}

export interface UseLibraryEventsOptions {
  /** Subscribe to one library's changes. Follows the picker when it changes. */
  libraryId: Ref<string | null>;
  /** The entity the user has open, so its concurrency token is refreshed too. */
  openEntityId?: Ref<string | null>;
  /**
   * Anything else the screen needs to reload — the Build screen's callable
   * list, say, which is not the queries store.
   */
  onChange?: (events: LibraryChangeEvent[]) => void | Promise<void>;
  /** Off by default in tests and anywhere a live socket is not wanted. */
  enabled?: Ref<boolean>;
}

/**
 * A burst of frames is one refresh. An MCP client writing a query and then its
 * version produces two frames milliseconds apart, and reacting to each would
 * mean two full reloads and a visible flicker for one logical change.
 */
const BATCH_MS = 200;

/** Reconnect backoff: quick first, then out of the way of a server restart. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * How long a stream has to stay up before it counts as a working connection
 * and the backoff is allowed to start from the bottom again.
 *
 * Resetting on `status = 'live'` alone made the backoff unreachable against a
 * server or proxy that accepts the request and then ends the stream at once:
 * every attempt "succeeded", so every retry waited the minimum, and the tab
 * reconnected once a second forever — each reconnect also forcing a full
 * refresh of the library, which on the Build screen is two requests per
 * callable. A connection that closes immediately is a failure however it is
 * spelled, so the reset is time-based.
 */
const STABLE_MS = 10_000;

export function useLibraryEvents(options: UseLibraryEventsOptions) {
  const auth = useAuth();
  const { refreshEntities } = useLibraryRefresh();
  const config = useRuntimeConfig();
  const baseUrl = String(config.public.apiBaseUrl ?? '').replace(/\/$/, '');

  const status = ref<LibraryEventStatus>('idle');
  const lastEventAt = ref<string | null>(null);
  const connected = computed(() => status.value === 'live');

  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = RECONNECT_MIN_MS;
  let pending: LibraryChangeEvent[] = [];
  let disposed = false;
  /** Set once a connection has dropped, so the next one refreshes what it missed. */
  let reconnected = false;
  /** Bumped on every (re)connect so a stream that outlives its turn stops. */
  let generation = 0;
  /** When the current stream started serving, or 0 when none is open. */
  let liveSince = 0;

  async function applyBatch({ force = false }: { force?: boolean } = {}) {
    const batch = pending;
    pending = [];
    if (batch.length === 0 && !force) return;

    const changedIds = batch.map((event) => event.id).filter((id): id is string => Boolean(id));

    await refreshEntities({
      changedIds,
      openEntityId: options.openEntityId?.value ?? null,
    }).catch(() => undefined);

    await Promise.resolve(options.onChange?.(batch)).catch(() => undefined);
  }

  function enqueue(event: LibraryChangeEvent) {
    lastEventAt.value = event.at;
    pending.push(event);
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      void applyBatch();
    }, BATCH_MS);
  }

  function scheduleReconnect(mine: number) {
    if (disposed || mine !== generation) return;
    status.value = 'offline';
    reconnected = true;

    // A stream that served for a while is proof the server is healthy; one that
    // dropped straight away is not, whatever status code it came with.
    if (liveSince > 0 && Date.now() - liveSince >= STABLE_MS) backoff = RECONNECT_MIN_MS;
    liveSince = 0;

    const delay = backoff;
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  async function connect() {
    if (disposed) return;
    if (options.enabled && !options.enabled.value) return;

    disconnect({ keepStatus: true });

    const mine = (generation += 1);
    controller = new AbortController();
    status.value = 'connecting';

    const params = new URLSearchParams({ clientId: clientId() });
    if (options.libraryId.value) params.set('libraryId', options.libraryId.value);

    try {
      const token = await auth.accessToken();
      const response = await fetch(`${baseUrl}/events?${params.toString()}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        scheduleReconnect(mine);
        return;
      }

      status.value = 'live';
      // The next failure decides what this connection was worth: one that ran
      // for STABLE_MS resets the backoff, one that ended at once does not.
      liveSince = Date.now();

      // Nothing is replayed, so a gap in the stream is a gap in what this tab
      // knows. Refreshing on *re*connect closes it; the first connect needs
      // nothing, because the view has just loaded everything.
      if (reconnected) {
        reconnected = false;
        void applyBatch({ force: true });
      }

      for await (const raw of parseSseStream(response.body)) {
        if (mine !== generation) return;
        const event = raw as unknown as LibraryChangeEvent;
        if (event.type === 'changed') enqueue(event);
      }

      // The server ended the stream — a restart, a proxy, a deploy.
      scheduleReconnect(mine);
    } catch {
      // Includes the abort from `disconnect`, which sets its own status and
      // bumps the generation, so the guard above swallows this.
      scheduleReconnect(mine);
    }
  }

  function disconnect({ keepStatus = false }: { keepStatus?: boolean } = {}) {
    generation += 1;
    controller?.abort();
    controller = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    pending = [];
    liveSince = 0;
    if (!keepStatus) status.value = 'idle';
  }

  // Follow the library picker: the subscription is scoped server-side, so a
  // change of library is a change of subscription.
  watch(
    [options.libraryId, () => options.enabled?.value ?? true],
    ([, enabled]) => {
      if (!enabled) {
        disconnect();
        return;
      }
      backoff = RECONNECT_MIN_MS;
      void connect();
    },
    { immediate: true }
  );

  // Unmounting the view must close the socket, or Playwright's teardown waits
  // on a connection that by design never ends.
  onScopeDispose(() => {
    disposed = true;
    disconnect();
  });

  return { status, connected, lastEventAt, connect, disconnect };
}
