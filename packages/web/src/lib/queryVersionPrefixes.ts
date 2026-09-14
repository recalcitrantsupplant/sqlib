/**
 * Learn the prefixes a query declares, wherever the query came from.
 *
 * Discovery is already a property of every editor (`usePrefixDiscovery`), so
 * text on screen teaches the prefix manager. That leaves out every query the
 * app *reads* without ever putting in an editor: the version list behind the
 * history dropdown, the query a group node previews, the version a test or an
 * argument set resolves, the two sides of a version diff. Those are queries
 * this person wrote, carrying the namespaces they work in, and until they were
 * opened one at a time they taught the app nothing.
 *
 * So discovery is attached to the API client's query-version calls instead of
 * to any one screen: whatever route a query version reaches the app by, its
 * PREFIX block is registered against the query it belongs to. Re-registering a
 * mapping already held is a no-op, so the repeated reads a list makes cost
 * nothing beyond the scan.
 */
import { usePrefixManager } from '@/composables/usePrefixManager';
import { prefixSourceToken } from '@/lib/prefixSources';

/**
 * The query text of one payload, in every shape a version endpoint answers
 * with: `GET .../v` returns bare versions, while the single-version routes nest
 * the same record under `queryVersion` alongside its parameters. Both are read
 * here rather than at each call site, so a caller passes the payload it has.
 */
function queryStringOf(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const direct = record.queryString;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const nested = record.queryVersion;
  if (nested && typeof nested === 'object') {
    const inner = (nested as Record<string, unknown>).queryString;
    if (typeof inner === 'string' && inner.trim()) return inner;
  }
  return null;
}

/** The query text carried by one payload or an array of them. */
export function queryStringsFrom(payload: unknown): string[] {
  const entries = Array.isArray(payload) ? payload : [payload];
  const found: string[] = [];
  for (const entry of entries) {
    const queryString = queryStringOf(entry);
    if (queryString) found.push(queryString);
  }
  return found;
}

/**
 * Register the declarations of every query version in `payload`.
 *
 * Provenance is the query, not the version: the Prefix Manager links a
 * discovered mapping back to something a person can open, and a version number
 * is not that — the same choice `useQueryVersions` already makes when a version
 * is loaded into the editor.
 *
 * The scan runs over the raw text rather than through the SPARQL parser: a
 * version list is many documents at once, and the declarations are the part of
 * a query a regular expression reads exactly.
 */
export function discoverQueryVersionPrefixes(payload: unknown, queryId: string | null | undefined): void {
  // Nothing to store into during SSR — the manager's settings are localStorage.
  if (typeof window === 'undefined') return;
  const texts = queryStringsFrom(payload);
  if (!texts.length) return;
  const source = prefixSourceToken('query', queryId);
  const { autoDiscoverFromText } = usePrefixManager();
  for (const text of texts) {
    autoDiscoverFromText(text, source);
  }
}
