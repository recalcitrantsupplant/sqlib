/**
 * Browser defaults: what this app selects when a callable opens.
 *
 * A query and a query group may name a default argument set; a query group and
 * a rule set may name a default data graph for each data graph input. They are
 * stored on the server, so everyone using the library gets them, and only this
 * app applies them: `/execute` and MCP never do. See
 * `docs/proposals/browser-defaults.md`.
 *
 * The order a screen opens with is the same everywhere, and the same as
 * `lib/backendDefaults.ts`: a URL parameter, then this browser's draft, then
 * the browser default, then nothing. This module owns the third step only.
 *
 * One cache, keyed by entity, so the screen that applies a default and the
 * control that sets one never disagree about what it is.
 */
import { reactive } from 'vue';
import { useApiClient, type BrowserDefaultsKind } from './useApiClient';
import type { useArgumentSets } from './useArgumentSets';


export interface BrowserDefaults {
  argumentSet: string | null;
  /** By data graph input: entry N is the default for input N, or `null`. */
  dataGraphs: Array<string | null>;
}

/** The tooltip every "Browser default" label carries. */
export const BROWSER_DEFAULT_HINT = 'Selected when this opens in the web app. API and MCP calls ignore it.';

const EMPTY: BrowserDefaults = { argumentSet: null, dataGraphs: [] };

const cache = reactive(new Map<string, BrowserDefaults>());
/** Loads in flight, so a screen and its control opening together ask once. */
const pending = new Map<string, Promise<BrowserDefaults>>();
const keyOf = (kind: BrowserDefaultsKind, id: string) => `${kind}:${id}`;

/** A version id, by the IRI prefix the server mints. */
const isVersionIri = (id: string) => /-version:/.test(id);

/** Two lists of picks name the same graphs, ignoring trailing holes. */
export function sameDataGraphs(a: Array<string | null>, b: Array<string | null>): boolean {
  const trim = (list: Array<string | null>) => {
    const next = list.map((entry) => entry || null);
    while (next.length && next[next.length - 1] === null) next.pop();
    return next;
  };
  const left = trim(a);
  const right = trim(b);
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function useBrowserDefaults() {
  const apiClient = useApiClient();

  /** The cached value, or `null` before the first load. Reactive. */
  function get(kind: BrowserDefaultsKind, id: string | null | undefined): BrowserDefaults | null {
    if (!id) return null;
    return cache.get(keyOf(kind, id)) ?? null;
  }

  /**
   * Fetch an entity's defaults.
   *
   * A failure reads as "no default": a starting selection is a convenience,
   * and a screen must open the same way whether or not it could be read.
   */
  async function load(kind: BrowserDefaultsKind, id: string | null | undefined): Promise<BrowserDefaults> {
    if (!id) return EMPTY;
    const key = keyOf(kind, id);
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const request = (async () => {
      try {
        const value = await apiClient.getBrowserDefaults(kind, id);
        cache.set(key, value);
        return value;
      } catch {
        return EMPTY;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, request);
    return request;
  }

  /** Replace one field, keeping the other. Throws on refusal, for a toast. */
  async function save(
    kind: BrowserDefaultsKind,
    id: string,
    patch: Partial<BrowserDefaults>,
  ): Promise<BrowserDefaults> {
    const current = get(kind, id) ?? (await load(kind, id));
    const next = await apiClient.putBrowserDefaults(kind, id, { ...current, ...patch });
    cache.set(keyOf(kind, id), next);
    return next;
  }

  /**
   * The `DataGraphVersion` each default names, by input.
   *
   * A pin is itself. A float resolves to its graph's current version now, so
   * the picker shows the version a run will send. One that cannot be resolved
   * leaves its input open rather than failing the screen.
   */
  async function resolveDataGraphs(dataGraphs: Array<string | null>): Promise<Array<string | null>> {
    return Promise.all(dataGraphs.map(async (id) => {
      if (!id) return null;
      if (isVersionIri(id)) return id;
      try {
        const { data } = await apiClient.getDataGraph(id);
        return data.currentVersion ?? null;
      } catch {
        return null;
      }
    }));
  }

  /**
   * Open a callable's default argument set, when nothing is open yet.
   *
   * Only a set this screen can list: a deleted or unreadable default selects
   * nothing, and says nothing, because a starting selection that failed is not
   * an error the person did anything to cause. A set that no longer fits is
   * still opened, and the Arguments tab says why, as it does for any set.
   */
  async function applyArgumentSet(
    kind: 'query' | 'queryGroup',
    id: string | null | undefined,
    args: ReturnType<typeof useArgumentSets>,
  ): Promise<boolean> {
    if (!id) return false;
    const { argumentSet } = await load(kind, id);
    if (!argumentSet) return false;
    await args.loadArgumentSets();
    if (args.selection.value.kind !== 'none') return false;
    if (!args.argumentSets.value.some((set) => set.id === argumentSet)) return false;
    await args.selectSet(argumentSet);
    return args.selectedSetId.value === argumentSet;
  }

  return { get, load, save, resolveDataGraphs, applyArgumentSet };
}

/** For tests, which must not inherit a previous file's cache. */
export function resetBrowserDefaultsCache(): void {
  cache.clear();
  pending.clear();
}
