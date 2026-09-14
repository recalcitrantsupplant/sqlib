/**
 * Reading and writing a store's own prefix map.
 *
 * Jena Fuseki exposes a dataset's prefix map as a named endpoint — the
 * Prefixes Service — in a read-only and a read-write flavour:
 *
 *   GET    {dataset}/prefixes            → `[{"prefix":…,"uri":…}, …]`
 *   GET    {dataset}/prefixes?prefix=p   → one URI, as a bare string
 *   POST   {dataset}/prefixes-rw?prefix=p&uri=u
 *   DELETE {dataset}/prefixes-rw?prefix=p
 *
 * Two things about that shape drive everything here. It is **off unless the
 * dataset's assembler declares it**, and the endpoint's name is chosen by
 * whoever wrote the config — so the endpoint is discovered, never assumed. And
 * write lives on a *different* endpoint from read, so read capability says
 * nothing about whether we may push.
 *
 * Stores that are not Jena have no prefix API at all. They do serialize their
 * prefix map at the top of a Turtle document, though, so there is a
 * pull-only, best-effort fallback: ask the Graph Store Protocol endpoint for
 * Turtle and read the prefix preamble. It is labelled `turtle-scrape`
 * everywhere it surfaces, because it is a scrape and not an API. Jena keeps
 * the prefixes of data loaded into a dataset, and writes them back out on a
 * GSP read, so this returns a real prefix map from a store with no prefix
 * service at all — verified against Fuseki 5.6.0.
 *
 * See `docs/guides/prefixes.md`.
 */
import { backendAuthHeaders } from './backendAuth.js';

/** How a prefix map was obtained. `turtle-scrape` is read-only by nature. */
export type PrefixReadSource = 'jena-prefixes' | 'turtle-scrape';

export interface PrefixPair {
  prefix: string;
  namespace: string;
}

export interface PrefixCapability {
  read: PrefixReadSource | null;
  /** Only Jena's read-write endpoint can be written to. Null means "pull only". */
  write: 'jena-prefixes' | null;
  readEndpoint: string | null;
  writeEndpoint: string | null;
  /** Pairs seen during detection, so the UI can say "42 prefixes" without a second call. */
  count: number | null;
}

export interface PrefixTarget {
  endpoint: string;
  authEnvKey?: string | null;
  /** Explicit endpoints, when the dataset's config names them something we would not guess. */
  readEndpoint?: string | null;
  writeEndpoint?: string | null;
}

export interface PrefixBatch {
  upserts: PrefixPair[];
  deletes: string[];
}

export interface PrefixWriteResult {
  prefix: string;
  action: 'upsert' | 'delete';
  status: 'ok' | 'failed';
  error?: string;
}

/**
 * A push is N calls, not one — Fuseki gives us no batch operation. The cap is
 * there so a mirror of a runaway local set cannot turn into a thousand-request
 * storm against someone's dataset.
 */
export const PREFIX_BATCH_LIMIT = 500;

/** Turtle prefixes live at the top of the document; we never read past this. */
const SCRAPE_BYTE_LIMIT = 64 * 1024;

export class PrefixServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PrefixServiceError';
    this.status = status;
  }
}

function timeoutMs(): number {
  const raw = Number(process.env.SQLIB_PREFIX_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}

/**
 * A prefix we will accept *from* a store.
 *
 * The empty prefix (`@prefix : <…>`) is legal Turtle and a Jena dataset really
 * does report one when data carrying it has been loaded, so reading is
 * permissive — a pull that silently dropped `:` would lose data the store
 * genuinely has. Writing one is a different matter: see `isPushablePrefix`.
 */
export function isValidPrefix(prefix: string): boolean {
  return prefix === '' || /^[A-Za-z_][A-Za-z0-9_.\-]*$/.test(prefix);
}

/**
 * A prefix Fuseki's prefix service will accept on a write.
 *
 * `POST ?prefix=&uri=…` is answered with a bare 400 by Fuseki 5.6, so the
 * empty prefix is refused here instead — the same outcome, with a reason
 * attached to it. Verified against Fuseki 5.6.0.
 */
export function isPushablePrefix(prefix: string): boolean {
  return prefix !== '' && isValidPrefix(prefix);
}

export function isAbsoluteIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.\-]*:/.test(value) && !value.includes(' ');
}

/**
 * The dataset a SPARQL endpoint belongs to.
 *
 * `http://host/ds/sparql` → `http://host/ds`. The service endpoints Fuseki
 * publishes are siblings of the query endpoint, so the last segment is dropped
 * when it names one of the standard services and kept otherwise (a dataset
 * served at `http://host/ds` with no service segment is common too).
 */
export function datasetBaseOf(endpoint: string): string | null {
  const trimmed = (endpoint ?? '').trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  url.search = '';
  url.hash = '';

  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1]?.toLowerCase();
  if (last && ['sparql', 'query', 'update', 'data', 'get', 'upload'].includes(last)) {
    segments.pop();
  }
  url.pathname = segments.length ? `/${segments.join('/')}` : '/';
  return url.toString().replace(/\/$/, '');
}

/**
 * Where the prefix endpoints plausibly are.
 *
 * `prefixes` and `prefixes-rw` are the names the Jena documentation uses and
 * what a config copied from it will have. They are candidates, not knowledge:
 * nothing acts on one until a request to it has answered.
 */
export function candidatePrefixEndpoints(endpoint: string): { read: string[]; write: string[] } {
  const base = datasetBaseOf(endpoint);
  if (!base) return { read: [], write: [] };
  return {
    read: [`${base}/prefixes`, `${base}/prefixes-rw`],
    write: [`${base}/prefixes-rw`],
  };
}

/** The Graph Store Protocol candidates the Turtle fallback reads from. */
function candidateGraphEndpoints(endpoint: string): string[] {
  const base = datasetBaseOf(endpoint);
  if (!base) return [];
  return [`${base}/data?default`, `${base}?default`];
}

/**
 * Read whatever shape the prefix endpoint answered with.
 *
 * Jena's own answer is a JSON object of prefix → URI, but a `{prefix, uri}`
 * array is just as plausible a reading of "all prefix-URI pairs" and costs
 * nothing to accept, so both are taken rather than having the feature hinge on
 * one Jena version's serialization.
 */
export function parsePrefixPairs(body: string): PrefixPair[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PrefixServiceError('Prefix endpoint did not answer with JSON', 502);
  }

  const pairs: PrefixPair[] = [];
  const push = (prefix: unknown, namespace: unknown) => {
    if (typeof prefix !== 'string' || typeof namespace !== 'string') return;
    if (!isValidPrefix(prefix) || !isAbsoluteIri(namespace)) return;
    pairs.push({ prefix, namespace });
  };

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      push(record.prefix, record.uri ?? record.namespace);
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [prefix, namespace] of Object.entries(parsed as Record<string, unknown>)) {
      push(prefix, namespace);
    }
  }

  return dedupe(pairs);
}

/**
 * The `@prefix` preamble of a Turtle document.
 *
 * Both spellings are read: `@prefix p: <ns> .` as a serializer writes it, and
 * the SPARQL-style `PREFIX p: <ns>` that some writers emit instead.
 */
export function scrapePrefixPreamble(text: string): PrefixPair[] {
  const pattern = /(?:^|\n)\s*(?:@prefix|PREFIX)\s+([^\s:]*):\s*<([^>]*)>/gi;
  const pairs: PrefixPair[] = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [, prefix, namespace] = match;
    if (isValidPrefix(prefix) && isAbsoluteIri(namespace)) {
      pairs.push({ prefix, namespace });
    }
  }
  return dedupe(pairs);
}

/** Last definition of a prefix wins, which is what a serializer's own reader would do. */
function dedupe(pairs: PrefixPair[]): PrefixPair[] {
  const byPrefix = new Map<string, string>();
  for (const pair of pairs) byPrefix.set(pair.prefix, pair.namespace);
  return [...byPrefix.entries()]
    .map(([prefix, namespace]) => ({ prefix, namespace }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

function headersFor(target: PrefixTarget, accept: string): Record<string, string> {
  return { accept, ...backendAuthHeaders(target.authEnvKey) };
}

async function request(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs()) });
}

/** Stop reading once the prefixes are certainly behind us — the graph may be enormous. */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const stream = response.body;
  if (!stream) return (await response.text()).slice(0, maxBytes);

  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJenaPrefixes(url: string, target: PrefixTarget): Promise<PrefixPair[] | null> {
  let response: Response;
  try {
    response = await request(url, { method: 'GET', headers: headersFor(target, 'application/json, */*;q=0.1') });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const body = await response.text().catch(() => '');
  try {
    return parsePrefixPairs(body);
  } catch {
    // A dataset can serve something else entirely at this path. That is a
    // "no prefix service here", not an error worth failing detection over.
    return null;
  }
}

/**
 * What this backend can do about prefixes, established by asking rather than by
 * reading a product string.
 *
 * The read-write endpoint answers reads too, so a successful `GET` on it is
 * what establishes write capability — nothing here writes to a dataset in
 * order to find out whether it may. A push that turns out to be refused
 * reports that per item, which is the honest place for it.
 */
export async function detectPrefixCapability(target: PrefixTarget): Promise<PrefixCapability> {
  const none: PrefixCapability = { read: null, write: null, readEndpoint: null, writeEndpoint: null, count: null };

  const candidates = candidatePrefixEndpoints(target.endpoint);
  const readCandidates = target.readEndpoint ? [target.readEndpoint] : candidates.read;
  const writeCandidates = target.writeEndpoint ? [target.writeEndpoint] : candidates.write;
  if (!readCandidates.length && !writeCandidates.length) return none;

  const urls = [...new Set([...readCandidates, ...writeCandidates])];
  const answers = await Promise.all(urls.map(async (url) => ({ url, pairs: await readJenaPrefixes(url, target) })));

  const writable = new Set(writeCandidates);
  const answered = answers.filter((answer) => answer.pairs !== null);
  if (!answered.length) return none;

  const write = answered.find((answer) => writable.has(answer.url)) ?? null;
  const read = answered.find((answer) => !writable.has(answer.url)) ?? write;

  return {
    read: 'jena-prefixes',
    write: write ? 'jena-prefixes' : null,
    readEndpoint: read?.url ?? null,
    writeEndpoint: write?.url ?? null,
    count: read?.pairs?.length ?? null,
  };
}

export interface RemotePrefixes {
  mappings: PrefixPair[];
  source: PrefixReadSource;
  readOnly: boolean;
  endpoint: string | null;
}

/**
 * The prefix map a backend is actually holding.
 *
 * Jena's service first; failing that, the Turtle preamble of the default
 * graph. The fallback is deliberately still offered when detection found no
 * prefix service, because "your store has no prefix API" is not the same
 * answer as "there are no prefixes to show you".
 */
export async function fetchRemotePrefixes(
  target: PrefixTarget,
  known?: PrefixCapability
): Promise<RemotePrefixes> {
  const capability = known ?? (await detectPrefixCapability(target));

  if (capability.read === 'jena-prefixes' && capability.readEndpoint) {
    const pairs = await readJenaPrefixes(capability.readEndpoint, target);
    if (pairs) {
      return {
        mappings: pairs,
        source: 'jena-prefixes',
        readOnly: capability.write === null,
        endpoint: capability.readEndpoint,
      };
    }
  }

  for (const url of candidateGraphEndpoints(target.endpoint)) {
    let response: Response;
    try {
      response = await request(url, { method: 'GET', headers: headersFor(target, 'text/turtle, */*;q=0.1') });
    } catch {
      continue;
    }
    if (!response.ok) continue;

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('turtle') && !contentType.includes('trig')) continue;

    const text = await readBounded(response, SCRAPE_BYTE_LIMIT);
    return { mappings: scrapePrefixPreamble(text), source: 'turtle-scrape', readOnly: true, endpoint: url };
  }

  throw new PrefixServiceError('This backend exposes no prefix map we can read', 502);
}

function withParams(endpoint: string, params: Record<string, string>): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * Apply a batch, one call per prefix, reporting each on its own.
 *
 * Fuseki has no batch operation and no transaction across these calls, so a
 * partial failure is the normal outcome to design for rather than an
 * exception: every item carries its own status and the caller re-reads the
 * remote map instead of assuming the batch landed whole. Sequential on
 * purpose — the ordering makes the report readable, and a prefix map is not
 * something worth racing.
 */
export async function pushPrefixes(
  target: PrefixTarget,
  batch: PrefixBatch,
  known?: PrefixCapability
): Promise<PrefixWriteResult[]> {
  const total = batch.upserts.length + batch.deletes.length;
  if (total === 0) return [];
  if (total > PREFIX_BATCH_LIMIT) {
    throw new PrefixServiceError(`Too many prefixes in one push (${total}); the limit is ${PREFIX_BATCH_LIMIT}`, 400);
  }

  const capability = known ?? (await detectPrefixCapability(target));
  if (capability.write !== 'jena-prefixes' || !capability.writeEndpoint) {
    throw new PrefixServiceError(
      'This backend has no writable prefix endpoint. Fuseki needs a read-write prefixes endpoint '
        + '(fuseki:name "prefixes-rw") declared on the dataset before prefixes can be pushed to it.',
      409
    );
  }
  const endpoint = capability.writeEndpoint;

  const results: PrefixWriteResult[] = [];

  for (const pair of batch.upserts) {
    const reason = !isPushablePrefix(pair.prefix)
      ? (pair.prefix === '' ? 'Fuseki will not store the empty prefix' : 'Invalid prefix')
      : (!isAbsoluteIri(pair.namespace) ? 'Namespace is not an absolute IRI' : null);
    if (reason) {
      results.push({ prefix: pair.prefix, action: 'upsert', status: 'failed', error: reason });
      continue;
    }
    results.push(await call(endpoint, target, 'POST', { prefix: pair.prefix, uri: pair.namespace }, 'upsert'));
  }

  /*
   * Deleting a prefix the store does not have answers 200, so a delete that
   * "succeeded" is not evidence the prefix was ever there. That is the right
   * outcome for a sync — the caller wanted it gone — and it is worth knowing
   * that the count of applied deletes is not a count of removed prefixes.
   */
  for (const prefix of batch.deletes) {
    if (!isPushablePrefix(prefix)) {
      results.push({ prefix, action: 'delete', status: 'failed', error: 'Invalid prefix' });
      continue;
    }
    results.push(await call(endpoint, target, 'DELETE', { prefix }, 'delete'));
  }

  return results;
}

async function call(
  endpoint: string,
  target: PrefixTarget,
  method: 'POST' | 'DELETE',
  params: Record<string, string>,
  action: PrefixWriteResult['action']
): Promise<PrefixWriteResult> {
  try {
    const response = await request(withParams(endpoint, params), {
      method,
      headers: headersFor(target, '*/*'),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).trim().slice(0, 200);
      return {
        prefix: params.prefix,
        action,
        status: 'failed',
        error: detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }
    return { prefix: params.prefix, action, status: 'ok' };
  } catch (error: unknown) {
    const message = error instanceof Error
      ? (error.name === 'TimeoutError' ? `No answer within ${timeoutMs()} ms` : error.message)
      : 'Request failed';
    return { prefix: params.prefix, action, status: 'failed', error: message };
  }
}
