/**
 * Display names for the principal IRIs in `createdBy` and `modifiedBy`.
 *
 * A screen can show many people at once: one per version row, one per
 * environment pointer. Each chip asks for its own IRI, and the cache sends
 * every IRI asked for in the same tick as one `GET /auth/names` call. An
 * answer is kept for the session, so a name is fetched once.
 *
 * The server answers only for users it has a display name for. An IRI it
 * leaves out is stored as `null`, which the chip shows as an unknown person.
 */
import { reactive } from 'vue';

/** The server allows at most this many IRIs in one call (`MAX_NAME_LOOKUPS`). */
export const NAMES_PER_CALL = 100;

/** `undefined` while the name is not known yet; `null` when the server has none. */
export type PrincipalName = string | null | undefined;

export type FetchNames = (iris: string[]) => Promise<Array<{ iri: string; displayName: string }>>;

export interface PrincipalNameCache {
  /** The name for `iri`, and a request for it if nobody has asked yet. Reactive. */
  nameOf(iri: string): PrincipalName;
  /** Wait for the calls in flight. For tests. */
  settled(): Promise<void>;
}

export function createPrincipalNameCache(fetchNames: FetchNames): PrincipalNameCache {
  const names = reactive(new Map<string, string | null>());
  const queued = new Set<string>();
  const asked = new Set<string>();
  let flush: Promise<void> | null = null;

  const send = async (): Promise<void> => {
    // One tick, so every chip on the screen joins the same call.
    await Promise.resolve();
    const batch = [...queued];
    queued.clear();
    flush = null;
    for (let start = 0; start < batch.length; start += NAMES_PER_CALL) {
      const slice = batch.slice(start, start + NAMES_PER_CALL);
      let rows: Array<{ iri: string; displayName: string }> = [];
      try {
        rows = await fetchNames(slice);
      } catch {
        // A failed lookup shows the person as unknown for this session.
        // The page still works, and the date beside the chip is still right.
      }
      const found = new Map(rows.map((row) => [row.iri, row.displayName]));
      for (const iri of slice) names.set(iri, found.get(iri) ?? null);
    }
  };

  const pending: Promise<void>[] = [];

  return {
    nameOf(iri: string): PrincipalName {
      if (names.has(iri)) return names.get(iri);
      if (!asked.has(iri)) {
        asked.add(iri);
        queued.add(iri);
        if (!flush) {
          flush = send();
          pending.push(flush);
        }
      }
      return undefined;
    },
    async settled(): Promise<void> {
      while (pending.length) await pending.shift();
    },
  };
}
