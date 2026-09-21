/**
 * Backends registered in the visitor's own browser.
 *
 * A read-only deployment (`SQLIB_READ_ONLY=true`, see the API's
 * `config/readOnly.ts`) serves a catalogue nobody can edit, which would
 * otherwise leave a visitor with nothing to point a query at but the endpoints
 * the operator happened to seed. A browser backend is the answer: the visitor
 * names an endpoint, it is kept here, and it is still there when they come
 * back. It is the old inline-endpoint field with a memory.
 *
 * **Why not a `CallableDraft`.** The scratch machinery in `useCallableDrafts`
 * looks like the obvious home — same storage, same lifecycle, same "never went
 * to the server" — but a `CallableDraft` is query-shaped: `resultKind`,
 * `inputTuples`, `outputs`, a `CallableType`. A backend has none of those, and
 * a record carrying invented values for four fields is a record that lies to
 * every consumer that reads them. Same mechanism, own shape.
 *
 * **The id is the discriminator.** `Backend` from the contracts is a `strict()`
 * zod object, so there is nowhere to hang an `isBrowserLocal` flag without
 * loosening a schema the server shares. An id under `BROWSER_BACKEND_PREFIX`
 * carries it instead: `isBrowserBackendId` is the one test, every consumer asks
 * it rather than guessing, and a projected record still validates as a
 * `Backend` wherever one is expected.
 *
 * **Credentials stay here.** Any header the visitor attaches is written to
 * their own `localStorage` and read only by the client-side executor. That is
 * not a compromise forced by read-only mode: it is better than the server-side
 * path, where a key travels to sqlib and lands in whatever its logs keep.
 */
import { computed, reactive } from 'vue';
import type { Backend } from '@sparql-query-lib/contracts';

const STORAGE_KEY = 'sparql-query-lib-browser-backends';

/**
 * Ids live under a `urn:` namespace of their own so they cannot collide with a
 * server-minted id, and so a stored query naming one is recognisably pointed at
 * something this browser holds rather than something the server lost.
 */
export const BROWSER_BACKEND_PREFIX = 'urn:sqlib:browser-backend:';

export interface BrowserBackend {
  id: string;
  name: string;
  description: string | null;
  /** Where queries go. The reason the record exists. */
  endpoint: string;
  /** `null` leaves the choice to the executor's length heuristic. */
  queryMethod: 'post' | 'get' | null;
  /** Extra request headers — an API key, say. Never sent to the sqlib server. */
  headers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type BrowserBackendInput = Omit<BrowserBackend, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<BrowserBackend, 'id' | 'createdAt' | 'updatedAt'>>;

export function isBrowserBackendId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(BROWSER_BACKEND_PREFIX);
}

function newId(): string {
  // Mirrors `useScratchItems`: `crypto.randomUUID` is absent in some test
  // environments, and a backend nobody can name is worse than a shorter id.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${BROWSER_BACKEND_PREFIX}${crypto.randomUUID()}`;
  }
  return `${BROWSER_BACKEND_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Drop anything that is not a string→string pair, rather than trusting the blob. */
function normalizeHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' && key.trim()) headers[key] = raw;
  }
  return headers;
}

/**
 * A stored blob is whatever a previous build of the SPA wrote, so every field
 * is re-checked. A record without an endpoint is dropped: it can never execute,
 * and keeping it would put a row in the picker that fails on click.
 */
function normalize(value: unknown): BrowserBackend | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' && value.id ? value.id : null;
  const endpoint = typeof value.endpoint === 'string' ? value.endpoint.trim() : '';
  if (!id || !endpoint) return null;
  const now = new Date().toISOString();
  const queryMethod = value.queryMethod === 'post' || value.queryMethod === 'get' ? value.queryMethod : null;
  return {
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : endpoint,
    description: typeof value.description === 'string' ? value.description : null,
    endpoint,
    queryMethod,
    headers: normalizeHeaders(value.headers),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

function read(): BrowserBackend[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((item): item is BrowserBackend => item !== null);
  } catch {
    // A blocked or corrupt store costs the remembered endpoints, not the screen.
    return [];
  }
}

function write(items: BrowserBackend[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota or a private window. The in-memory list stands for this session.
  }
}

const state = reactive<{ items: BrowserBackend[]; loaded: boolean }>({ items: [], loaded: false });

function ensureLoaded(): void {
  if (state.loaded) return;
  state.items = read();
  state.loaded = true;
}

/**
 * The `Backend` shape the rest of the SPA already knows.
 *
 * `backendType: 'http'` is the truth about it — it is an HTTP SPARQL endpoint —
 * and it keeps every existing consumer working without learning a new type.
 * What marks it as browser-local is the id, and `isBrowserBackendId` is how to
 * ask. Headers are deliberately not projected: nothing server-facing should
 * ever receive them.
 */
export function toBackend(record: BrowserBackend): Backend {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    backendType: 'http',
    endpoint: record.endpoint,
    authEnvKey: null,
    queryMethod: record.queryMethod,
    dateCreated: record.createdAt,
    dateModified: record.updatedAt,
    oxigraphConfig: null,
  };
}

export function useBrowserBackends() {
  ensureLoaded();

  const records = computed<BrowserBackend[]>(() => state.items);
  const asBackends = computed<Backend[]>(() => state.items.map(toBackend));

  function get(id: string | null | undefined): BrowserBackend | null {
    if (!id) return null;
    ensureLoaded();
    return state.items.find(item => item.id === id) ?? null;
  }

  /** Create or replace. Returns the stored record, so a caller can select it. */
  function save(input: BrowserBackendInput): BrowserBackend {
    ensureLoaded();
    const now = new Date().toISOString();
    const existing = input.id ? state.items.find(item => item.id === input.id) ?? null : null;
    const record: BrowserBackend = {
      id: input.id ?? newId(),
      name: input.name.trim() || input.endpoint.trim(),
      description: input.description ?? null,
      endpoint: input.endpoint.trim(),
      queryMethod: input.queryMethod ?? null,
      headers: normalizeHeaders(input.headers),
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    state.items = [...state.items.filter(item => item.id !== record.id), record];
    write(state.items);
    return record;
  }

  function remove(id: string): void {
    ensureLoaded();
    state.items = state.items.filter(item => item.id !== id);
    write(state.items);
  }

  /** Re-read the store. For tests, and for a tab that slept through a change. */
  function reload(): void {
    state.items = read();
    state.loaded = true;
  }

  return { records, asBackends, get, save, remove, reload, isBrowserBackendId, toBackend };
}
