/**
 * Backend probing — "is this store answering, how fast, and what is it?"
 *
 * A probe is a **service-description request**, not a query (backends UI doc,
 * §Rules): a plain GET on the endpoint asking for RDF. That is the cheapest
 * thing a SPARQL endpoint will answer, it needs no dataset, and its response
 * carries the product name we want. Stores that refuse a bare GET fall back to
 * `ASK {}`, which every endpoint answers and which still costs nothing.
 *
 * Results live in memory, keyed by backend id. They are observations, not
 * state: nothing here is persisted, and a restart legitimately means "never
 * probed" again rather than a stale dot pretending to be current.
 */
import { backendAuthHeaders } from './backendAuth.js';
import { detectPrefixCapability, type PrefixCapability } from './prefixService.js';
import type { BackendTypeKey } from '../persistence/schemas/BackendSchema.js';

export type BackendHealth = 'healthy' | 'slow' | 'unreachable';

export interface BackendProbeResult {
  backendId: string;
  health: BackendHealth;
  latencyMs: number | null;
  /** Service description's product, e.g. `Blazegraph 2.1.6`. Null when the store says nothing useful. */
  product: string | null;
  probedAt: string;
  error: string | null;
  /** The status the endpoint answered with, when it answered at all. */
  httpStatus: number | null;
  /**
   * Whether this store exposes its own prefix map, and whether we may write it.
   *
   * Carried on the probe rather than fetched separately so the prefix manager
   * can grey out "Sync with endpoint" for a backend without a prefix service
   * using the results the sidebar has already loaded. Null means "not
   * established" — an unreachable store, an in-process one, or detection
   * switched off — which is not the same as `{ read: null }`, which means we
   * asked and there is nothing there.
   */
  prefixes: PrefixCapability | null;
}

/**
 * The slow line. 250 ms is the mockup's number and is openly provisional (doc
 * §Open) — hence the env override, so an operator can move it without a
 * release while the real number is being argued about.
 */
export function slowThresholdMs(): number {
  const raw = Number(process.env.SQLIB_BACKEND_SLOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 250;
}

/**
 * Prefix detection costs up to two extra requests per backend, which `Probe
 * all` multiplies. Operators who do not use the feature can switch it off
 * rather than pay for it on every sweep.
 */
function prefixDetectionEnabled(): boolean {
  return (process.env.SQLIB_PREFIX_DETECT ?? '').toLowerCase() !== 'off';
}

function probeTimeoutMs(): number {
  const raw = Number(process.env.SQLIB_BACKEND_PROBE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}

const results = new Map<string, BackendProbeResult>();

/**
 * The last few results per backend, newest first.
 *
 * `Probe history` in the record's health card reads this. It is deliberately a
 * short in-memory ring rather than a stored series: a probe is an observation,
 * and the question the button answers is "has this been flapping in the last
 * hour or is it newly broken?", which twenty entries answer well enough.
 */
const HISTORY_LIMIT = 20;
const history = new Map<string, BackendProbeResult[]>();

export function listProbeHistory(backendId: string): BackendProbeResult[] {
  return history.get(backendId) ?? [];
}

export function getProbeResult(backendId: string): BackendProbeResult | null {
  return results.get(backendId) ?? null;
}

export function listProbeResults(backendIds?: string[]): BackendProbeResult[] {
  if (!backendIds) return [...results.values()];
  return backendIds
    .map((id) => results.get(id))
    .filter((result): result is BackendProbeResult => result !== undefined);
}

/** Test seam, and what a delete calls so a re-created id does not inherit a dot. */
export function forgetProbeResult(backendId: string): void {
  results.delete(backendId);
  history.delete(backendId);
}

export function clearProbeResults(): void {
  results.clear();
  history.clear();
}

export interface ProbeTarget {
  id: string;
  backendType: BackendTypeKey;
  endpoint?: string | null;
  authEnvKey?: string | null;
}

/**
 * Pull a product name out of whatever the endpoint answered with.
 *
 * Order is deliberate: `Server` is the store's own claim about itself and is
 * the only one that carries a version in practice; the service description's
 * `sd:name` comes next; `X-Powered-By` last, because proxies write it.
 */
export function parseProduct(headers: Headers, body: string): string | null {
  const server = headers.get('server');
  if (server && !/^(nginx|apache|cloudflare|envoy|caddy)/i.test(server)) {
    return server.trim().slice(0, 80);
  }
  const sdName = body.match(/sd:name\s+"([^"]{2,80})"/)
    ?? body.match(/<http:\/\/www\.w3\.org\/ns\/sparql-service-description#name>\s+"([^"]{2,80})"/);
  if (sdName) {
    return sdName[1].trim();
  }
  const poweredBy = headers.get('x-powered-by');
  // A proxy's Server header is not the store's product, and printing it under
  // "Reported product" would name the wrong piece of software.
  return poweredBy ? poweredBy.trim().slice(0, 80) : null;
}

function classify(latencyMs: number): BackendHealth {
  return latencyMs > slowThresholdMs() ? 'slow' : 'healthy';
}

function record(result: BackendProbeResult): BackendProbeResult {
  results.set(result.backendId, result);
  const previous = history.get(result.backendId) ?? [];
  history.set(result.backendId, [result, ...previous].slice(0, HISTORY_LIMIT));
  return result;
}

/**
 * Probe one backend and cache the result.
 *
 * An in-process oxigraph store has no endpoint to reach and no service
 * description to read, so it is reported healthy without a request — saying
 * "unreachable" about a store living in this process would be a lie.
 */
export async function probeBackend(target: ProbeTarget): Promise<BackendProbeResult> {
  const probedAt = new Date().toISOString();

  if (target.backendType !== 'http') {
    return record({
      backendId: target.id,
      health: 'healthy',
      latencyMs: 0,
      product: 'Oxigraph (in-process)',
      probedAt,
      error: null,
      httpStatus: null,
      prefixes: null,
    });
  }

  const endpoint = (target.endpoint ?? '').trim();
  if (!endpoint) {
    return record({
      backendId: target.id,
      health: 'unreachable',
      latencyMs: null,
      product: null,
      probedAt,
      error: 'No endpoint URL configured',
      httpStatus: null,
      prefixes: null,
    });
  }

  const headers = {
    accept: 'text/turtle, application/ld+json;q=0.9, application/rdf+xml;q=0.8, */*;q=0.1',
    ...backendAuthHeaders(target.authEnvKey),
  };
  const started = Date.now();

  const attempt = async (url: string, accept?: string) => {
    const response = await fetch(url, {
      method: 'GET',
      headers: accept ? { ...headers, accept } : headers,
      signal: AbortSignal.timeout(probeTimeoutMs()),
    });
    return response;
  };

  try {
    let response = await attempt(endpoint);
    if (!response.ok) {
      // Plenty of stores answer a bare GET with 400 ("no query") rather than a
      // service description. `ASK {}` is the smallest thing they all accept,
      // and it answers the only question the dot is asking.
      const askUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}query=${encodeURIComponent('ASK {}')}`;
      response = await attempt(askUrl, 'application/sparql-results+json, */*;q=0.1');
    }
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      return record({
        backendId: target.id,
        health: 'unreachable',
        latencyMs,
        product: null,
        probedAt,
        error: `HTTP ${response.status} ${response.statusText}`.trim(),
        httpStatus: response.status,
        prefixes: null,
      });
    }

    const body = await response.text().catch(() => '');
    /*
     * Detection runs only once the store has answered, and its cost stays out
     * of `latencyMs` — the dot is reporting how fast this endpoint answers a
     * query, and folding two prefix lookups into that number would make a
     * healthy store look slow for a reason that has nothing to do with it.
     */
    const prefixes = prefixDetectionEnabled()
      ? await detectPrefixCapability({ endpoint, authEnvKey: target.authEnvKey }).catch(() => null)
      : null;

    return record({
      backendId: target.id,
      health: classify(latencyMs),
      latencyMs,
      product: parseProduct(response.headers, body),
      probedAt,
      error: null,
      httpStatus: response.status,
      prefixes,
    });
  } catch (error: unknown) {
    const message = error instanceof Error
      ? (error.name === 'TimeoutError' ? `No answer within ${probeTimeoutMs()} ms` : error.message)
      : 'Probe failed';
    return record({
      backendId: target.id,
      health: 'unreachable',
      latencyMs: null,
      product: null,
      probedAt,
      error: message,
      httpStatus: null,
      prefixes: null,
    });
  }
}

/** `Probe all`. Bounded concurrency so a page of backends is not a thundering herd. */
export async function probeBackends(targets: ProbeTarget[], concurrency = 6): Promise<BackendProbeResult[]> {
  const queue = [...targets];
  const collected: BackendProbeResult[] = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      collected.push(await probeBackend(next));
    }
  });
  await Promise.all(workers);
  return collected;
}
