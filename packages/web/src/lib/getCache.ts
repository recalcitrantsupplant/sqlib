/**
 * One GET request for each URL, shared by every caller on the page.
 *
 * Several stores and screens read the same lists as a page loads: the rail,
 * the home screen counts and the library picker each ask for `/queries`,
 * `/backends` and the rest. Each request to the hosted demo costs a round
 * trip of 300 ms or more, so this module sends one request for each key and
 * gives every caller its own copy of the response.
 *
 * - A request in flight is shared with every caller that asks for the same key.
 * - A successful response is kept for `GET_CACHE_TTL_MS` after it arrives.
 * - `invalidateGetCache` drops every entry. The API client calls it when it
 *   sends a write, and the change feed calls it when another client writes.
 * - A response that arrives after an invalidation is given to its callers but
 *   is not kept, because it can be older than the write.
 */

export const GET_CACHE_TTL_MS = 5000;

interface Entry {
  response: Promise<Response>;
  /** When the response arrived, or null while it is in flight. */
  settledAt: number | null;
}

const entries = new Map<string, Entry>();
let generation = 0;

/** Every entry is dropped. A request in flight still answers its callers. */
export function invalidateGetCache(): void {
  generation += 1;
  entries.clear();
}

/**
 * The response for `key`, from a request in flight, a fresh entry, or a new
 * request made with `send`. Each caller gets a clone, so each can read the body.
 */
export async function sharedGet(key: string, send: () => Promise<Response>, now: () => number = Date.now): Promise<Response> {
  const held = entries.get(key);
  if (held && (held.settledAt === null || now() - held.settledAt < GET_CACHE_TTL_MS)) {
    return (await held.response).clone();
  }

  const started = generation;
  const entry: Entry = { response: send(), settledAt: null };
  entries.set(key, entry);
  try {
    const response = await entry.response;
    if (response.ok && started === generation && entries.get(key) === entry) {
      entry.settledAt = now();
    } else if (entries.get(key) === entry) {
      entries.delete(key);
    }
    return response.clone();
  } catch (error) {
    if (entries.get(key) === entry) entries.delete(key);
    throw error;
  }
}
