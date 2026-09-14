/**
 * The change feed: "something in the library changed", broadcast in-process.
 *
 * Every write reaches the API through a Fastify route handler — the web app
 * calls them over HTTP, the in-app assistant and any external MCP client reach
 * the same handlers through `app.inject` (`injectCaller` in
 * `packages/mcp-server/src/index.ts`). One `onSend` hook on mutating responses
 * therefore covers all three writers, and nothing else in the codebase has to
 * remember to announce itself.
 *
 * Frames carry a notification, never the entity. "Query X changed" sends the
 * subscriber back through its normal fetch path, which is the path that also
 * refreshes concurrency tokens — see `useLibraryRefresh` in the web app for why
 * that matters (a bypassed store update leaves a stale etag and the user's next
 * save fails with a 412 they did nothing to earn).
 *
 * Scope, stated plainly: this is a module-level emitter, so it reaches
 * subscribers *in the same process*. The `dual-http` topology puts the API and
 * the MCP endpoint on one Fastify instance and that is exactly what this needs.
 * Under `stdio` the MCP server boots its own API instance in its own process,
 * so a write there emits into that process and the browser's subscription —
 * attached to a different process — never hears it. The fix if it is ever
 * needed is a store-backed cursor, not a bigger emitter.
 */
import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** A write happened. What it was, not what it now contains. */
export interface ChangeEvent {
  type: 'changed';
  /** `query`, `queryGroup`, `library`, … — the kind of thing that changed. */
  entity: string;
  /** The entity's IRI, when the route or its response revealed one. */
  id: string | null;
  /** The library it belongs to, when resolvable. Used to scope subscriptions. */
  libraryId: string | null;
  /** The HTTP method that caused it, so a subscriber can tell a delete apart. */
  method: string;
  /**
   * The `x-sqlib-client-id` of the writer, when it sent one. A tab that caused
   * the write skips its own echo rather than refetching what it just wrote.
   */
  origin: string | null;
  at: string;
}

/**
 * Backend *data* changed — a patch was applied or reverted.
 *
 * A sibling of `changed` rather than a variant of it, because the two answer
 * different questions and are governed by different grants: `changed` says a
 * library entity was written and is scoped by library read access; this says
 * triples in a backend moved and is scoped by access to that backend. Same
 * discipline in both: the frame says what changed, never what it now contains,
 * so a subscriber that cares fetches the patch.
 *
 * Published explicitly by the patch service rather than derived from a route by
 * the `onSend` hook below. The hook reads URLs, and the URL that changed a
 * backend's data is `/patches/apply` — which names no backend at all.
 */
export interface DataChangeEvent {
  type: 'data-changed';
  backendId: string;
  patchId: string;
  origin: string | null;
  at: string;
}

/** Anything the feed carries. */
export type FeedEvent = ChangeEvent | DataChangeEvent;

export type ChangeListener = (event: FeedEvent) => void;

const CHANGE = 'change';

/**
 * One emitter per process, deliberately module-level: routes are registered
 * per-instance and the MCP dual-HTTP server builds its own Fastify, so an
 * instance-decorated bus would not be shared between them.
 */
const emitter = new EventEmitter();
// One listener per open SSE connection; the default cap of 10 would warn on the
// eleventh browser tab, which is not a leak.
emitter.setMaxListeners(0);

export function publishChange(event: FeedEvent): void {
  emitter.emit(CHANGE, event);
}

/** Announce that a patch moved triples in a backend. */
export function publishDataChange(event: Omit<DataChangeEvent, 'type' | 'at'>): void {
  publishChange({ ...event, type: 'data-changed', at: new Date().toISOString() });
}

export function subscribeChanges(listener: ChangeListener): () => void {
  emitter.on(CHANGE, listener);
  return () => emitter.off(CHANGE, listener);
}

/** Open subscriptions. Exposed for tests and for the metrics payload. */
export function changeSubscriberCount(): number {
  return emitter.listenerCount(CHANGE);
}

/** Drop every subscriber. Tests only — a live server unsubscribes on close. */
export function resetChangeSubscribers(): void {
  emitter.removeAllListeners(CHANGE);
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * URL prefix → entity name.
 *
 * An allowlist rather than a "camelCase whatever the first segment is": the API
 * also carries `/execute`, `/sparql`, `/playground` and `/assistant`, whose
 * POSTs are reads, runs and conversations. Announcing those as library changes
 * would have every subscriber refetch the world on every query execution.
 */
const ENTITY_BY_SEGMENT: Record<string, string> = {
  queries: 'query',
  'query-groups': 'queryGroup',
  libraries: 'library',
  backends: 'backend',
  rules: 'rule',
  'rule-sets': 'ruleSet',
  'data-blocks': 'dataBlock',
  'data-graphs': 'dataGraph',
  'tests': 'test',
  'argument-sets': 'argumentSet',
  'benchmark-experiments': 'benchmarkExperiment',
  'etl-jobs': 'etlJob',
};

/** Response bodies above this are not worth parsing to find an id. */
const MAX_PAYLOAD_SCAN_BYTES = 256 * 1024;

interface RouteTarget {
  entity: string;
  id: string | null;
}

/**
 * What a URL says about the entity it wrote.
 *
 * Path shapes are `/queries`, `/queries/:id`, `/queries/:id/v/:version` and the
 * like, optionally behind a public base path — so the segments are scanned for
 * the first known collection rather than assuming it is the first one.
 */
export function describeRoute(url: string): RouteTarget | null {
  const path = url.split('?')[0] ?? '';
  const segments = path.split('/').filter(Boolean);

  for (let index = 0; index < segments.length; index += 1) {
    const entity = ENTITY_BY_SEGMENT[segments[index]!];
    if (!entity) continue;
    const next = segments[index + 1];
    const id = next ? safeDecode(next) : null;
    return { entity, id };
  }

  return null;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(source: Record<string, unknown> | null, field: string): string | null {
  const value = source?.[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A response body, parsed only far enough to find an `id`/`libraryId`. */
function parsePayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'string' || payload.length === 0) return null;
  if (payload.length > MAX_PAYLOAD_SCAN_BYTES) return null;
  const first = payload.trimStart()[0];
  if (first !== '{') return null;
  try {
    return asRecord(JSON.parse(payload));
  } catch {
    return null;
  }
}

/**
 * Build the frame for one mutating response, or `null` if it is not a change
 * worth announcing.
 *
 * Exported for the unit tests, which is cheaper than driving every branch
 * through a live socket.
 */
export function changeEventFor(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown
): ChangeEvent | null {
  if (!MUTATING_METHODS.has(request.method)) return null;
  if (reply.statusCode < 200 || reply.statusCode >= 300) return null;

  const target = describeRoute(request.url);
  if (!target) return null;

  const body = asRecord(request.body);
  const responseBody = parsePayload(payload);
  const query = asRecord(request.query);

  // A create has no id in its URL; the response it just sent does.
  const id = target.id ?? stringField(responseBody, 'id');

  const libraryId =
    target.entity === 'library'
      ? id
      : stringField(responseBody, 'libraryId') ??
        stringField(body, 'libraryId') ??
        stringField(query, 'libraryId');

  const origin = request.headers['x-sqlib-client-id'];

  return {
    type: 'changed',
    entity: target.entity,
    id,
    libraryId,
    method: request.method,
    origin: typeof origin === 'string' && origin.length > 0 ? origin : null,
    at: new Date().toISOString(),
  };
}

/**
 * Announce mutating 2xx responses.
 *
 * `onSend` rather than `onResponse` because a create returns the new entity's
 * id in its body and nowhere else — by `onResponse` the payload is gone, and a
 * frame with a null id would force every subscriber into a full reload.
 */
export function registerChangeFeedHook(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    // Never let the feed break a response: a write that succeeded must still
    // look like it succeeded, whatever happens here.
    try {
      const event = changeEventFor(request, reply, payload);
      if (event) publishChange(event);
    } catch (error) {
      request.log.debug({ err: error }, 'Change feed hook failed');
    }
    return payload;
  });
}
