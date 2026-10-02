/**
 * The list, the per-record concurrency token, and the guarded write that every
 * saved-entity store keeps.
 *
 * Six stores carried their own copy of this — `deriveIfMatchToken` six times,
 * the load/fetch/create/update/delete quintet six times — and the copies had
 * begun to differ in how they reported a failed load and what they did with a
 * lost write race. Each store now builds on one, and keeps only what is its
 * own: form helpers, versions, the extra state a screen needs.
 *
 * **A lost race has one answer.** An update is sent with the record's token as
 * `If-Match`. A 412 means another writer got there first; the store re-reads
 * the record (which refreshes the token, the list row and anything watching
 * the store) and sends the same update once more. Updates are partial — only
 * the fields a control changed — so the replay cannot clobber what the other
 * writer touched. A second 412 is a record changing under a running save, and
 * is reported as an `EntityConflictError` naming the record rather than as a
 * bare status code. Three work areas had written this retry by hand, each a
 * little differently; they no longer need to.
 */
import { computed, reactive } from 'vue';
import type { ApiResult } from './useApiClient';

interface Tokened {
  id: string;
  dateModified?: string | null;
  dateCreated?: string | null;
}

/**
 * The token a guarded write is sent with: the response's ETag, else the
 * record's modification time, which is what the API derives its ETag from.
 */
export function deriveIfMatchToken(
  etag: string | null | undefined,
  entity: { dateModified?: string | null; dateCreated?: string | null } | null | undefined,
): string | null {
  if (etag && typeof etag === 'string' && etag.trim().length > 0) return etag;
  if (!entity) return null;
  return entity.dateModified ?? entity.dateCreated ?? null;
}

/** True for the API's answer to a stale `If-Match`. */
export function isPreconditionFailed(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } };
  return (err.statusCode ?? err.status ?? err.response?.status) === 412;
}

/** A write lost the race twice: the record is changing under the save. */
export class EntityConflictError extends Error {
  readonly statusCode = 412;
  constructor(readonly noun: string, readonly id: string, readonly cause: unknown) {
    super(`This ${noun} was changed elsewhere while it was being saved. Reload it to see the latest, then save again.`);
    this.name = 'EntityConflictError';
  }
}

/**
 * Send a guarded write, and answer a lost race the one way this app does.
 *
 * `token` is the record's known token. With `readFirst`, a missing token is
 * read before the write, so it is guarded rather than sent blind. On a 412 the
 * token is re-read and the write replayed once; a second 412 is an
 * `EntityConflictError`. Exported for the stores whose lists are not built on
 * `createVersionedEntityStore` (tests, ETL jobs, argument sets) but whose
 * writes should behave the same.
 */
export async function sendGuarded<T>(options: {
  noun: string;
  id: string;
  token: string | null;
  /** Read a token before writing when none is known. */
  readFirst?: boolean;
  readToken: () => Promise<string | null>;
  send: (ifMatch: string | null) => Promise<ApiResult<T>>;
  /** Told the token each successful write returns. */
  onToken: (token: string | null) => void;
}): Promise<T> {
  const attempt = async (ifMatch: string | null) => {
    const result = await options.send(ifMatch);
    options.onToken(deriveIfMatchToken(result.etag, result.data as Tokened | null));
    return result.data;
  };
  const token = options.token ?? (options.readFirst ? await options.readToken() : null);
  try {
    return await attempt(token);
  } catch (first: unknown) {
    if (!isPreconditionFailed(first)) throw first;
    // Lost a race: re-read, then replay the same partial update once.
    try {
      return await attempt(await options.readToken());
    } catch (second: unknown) {
      if (isPreconditionFailed(second)) throw new EntityConflictError(options.noun, options.id, second);
      throw second;
    }
  }
}

export interface EntityApi<T, C, U> {
  list: () => Promise<T[]>;
  get: (id: string) => Promise<ApiResult<T>>;
  create?: (input: C) => Promise<ApiResult<T>>;
  update?: (id: string, input: U, options: { ifMatch: string | null }) => Promise<ApiResult<T>>;
  remove?: (id: string) => Promise<unknown>;
}

export interface VersionedEntityStoreConfig<T, C, U> {
  /** Singular, for messages: "rule set". */
  noun: string;
  /** Plural, for messages: "rule sets". */
  nounPlural: string;
  /** Called per use, inside a component or composable, where the client can be built. */
  api: () => EntityApi<T, C, U>;
  /** What the list holds when the load fails. Empty unless a store has local items. */
  fallbackItems?: () => T[];
}

export function createVersionedEntityStore<T extends Tokened, C = never, U = never>(
  config: VersionedEntityStoreConfig<T, C, U>,
) {
  const state = reactive({
    items: [] as T[],
    loading: false,
    error: null as string | null,
    concurrency: {} as Record<string, string | null>,
  });

  return function useVersionedEntityStore() {
    const api = config.api();

    const items = computed(() => state.items as T[]);
    const loading = computed(() => state.loading);
    const error = computed(() => state.error);

    async function load() {
      state.loading = true;
      state.error = null;
      try {
        state.items = (await api.list()) as typeof state.items;
      } catch (err: unknown) {
        state.error = err instanceof Error ? err.message : `Failed to load ${config.nounPlural}`;
        state.items = (config.fallbackItems?.() ?? []) as typeof state.items;
      } finally {
        state.loading = false;
      }
    }

    /** Read one record, refreshing its token. */
    async function fetch(id: string): Promise<{ data: T; ifMatch: string | null }> {
      const result = await api.get(id);
      state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
      return { data: result.data, ifMatch: state.concurrency[id] };
    }

    async function create(input: C): Promise<T> {
      if (!api.create) throw new Error(`Creating a ${config.noun} is not supported here`);
      const result = await api.create(input);
      state.concurrency[result.data.id] = deriveIfMatchToken(result.etag, result.data);
      await load();
      return result.data;
    }

    async function update(id: string, input: U, explicitIfMatch?: string | null): Promise<T> {
      const send = api.update;
      if (!send) throw new Error(`Updating a ${config.noun} is not supported here`);
      const known = explicitIfMatch ?? state.concurrency[id] ?? null;
      const updated = await sendGuarded<T>({
        noun: config.noun,
        id,
        // A store that has never read the record sends unguarded, as it always
        // has; a 412 can only follow a guarded write.
        token: known,
        readToken: async () => (await fetch(id)).ifMatch,
        send: (ifMatch) => send(id, input, { ifMatch }),
        onToken: (token) => { state.concurrency[id] = token; },
      });
      await load();
      return updated;
    }

    async function remove(id: string) {
      if (!api.remove) throw new Error(`Deleting a ${config.noun} is not supported here`);
      await api.remove(id);
      delete state.concurrency[id];
      await load();
    }

    return {
      /** The reactive state, for a store that keeps its own fields beside it. */
      state,
      items,
      loading,
      error,
      concurrency: state.concurrency,
      load,
      fetch,
      create,
      update,
      remove,
    };
  };
}
