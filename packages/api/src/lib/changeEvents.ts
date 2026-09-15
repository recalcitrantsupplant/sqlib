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
import { resolveOwningLibrary } from '../auth/enforce.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';

/** A write happened. What it was, not what it now contains. */
export interface ChangeEvent {
  type: 'changed';
  /** `query`, `queryGroup`, `library`, … — the kind of thing that changed. */
  entity: string;
  /** The entity's IRI, when the route or its response revealed one. */
  id: string | null;
  /** The library it belongs to, when resolvable. Used to scope subscriptions. */
  libraryId: string | null;
  /**
   * True when the entity was found and names no container at all — the guard's
   * "unowned by design" case (`BenchmarkExperiment` has no `isPartOf`).
   *
   * `libraryId: null` used to mean two things a subscriber had no way to tell
   * apart: an entity with no library, and one whose library simply was not
   * looked up. `events.ts` has to distinguish them, because the first is
   * readable by any authenticated principal today and the second must not be
   * broadcast to everyone. Same split `entityGuard.ts` makes with
   * `danglingContainer`, and for the same reason.
   */
  unowned: boolean;
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
 * Body properties that name an entity's container.
 *
 * The same four `entityGuard.ts` reads, deliberately: a frame's library is the
 * same question the guard answers about the same request, and answering it two
 * different ways is how they came to disagree. This module used to look for
 * `libraryId` alone — a field no entity response carries (stored entities use
 * `isPartOf`; `libraryId` is an argument-set input and an assistant session
 * field), so resolution missed on essentially every real write.
 */
const CONTAINER_BODY_KEYS = ['isPartOf', 'targetEntity', 'library', 'libraryId'] as const;

/** What the containment resolution found, and which kind of "nothing" it was. */
interface Containment {
  libraryId: string | null;
  unowned: boolean;
}

const UNRESOLVED: Containment = { libraryId: null, unowned: false };

/**
 * Where the pre-handler stashes what it resolved.
 *
 * A delete is why this exists. `onSend` runs after the handler, and by then the
 * entity is out of the cache — so the one frame that most wants scoping is the
 * one that can no longer be scoped after the fact. The guard resolves the same
 * entity in a `preHandler`, while it is still there; this does too.
 */
const RESOLVED_CONTAINMENT = Symbol('sqlib.changeFeed.containment');

/**
 * What the pre-handler resolved, if it resolved anything.
 *
 * A miss is deliberately *not* returned: a create has no path id before its
 * handler runs, so the pre-handler often finds nothing while `onSend` — with
 * the new entity in the cache and its id in the response — finds the answer.
 * Only a hit short-circuits, which is exactly the delete case this is for.
 */
function stashed(request: FastifyRequest): Containment | null {
  const found = (request as unknown as Record<symbol, Containment | undefined>)[
    RESOLVED_CONTAINMENT
  ];
  if (!found) return null;
  return found.libraryId !== null || found.unowned ? found : null;
}

function containerRefsFrom(...sources: Array<Record<string, unknown> | null>): string[] {
  const refs: string[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const key of CONTAINER_BODY_KEYS) {
      const value = source[key];
      if (typeof value === 'string' && value) refs.push(value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item) refs.push(item);
        }
      }
    }
  }
  return refs;
}

/**
 * The library a frame belongs to, resolved the way the guard resolves it.
 *
 * Order matches `entityGuard.ts`: the entity named by the path first, then the
 * containment reference a create carries in its body.
 *
 * The last step keeps a raw reference that the cache cannot resolve. That is
 * the pre-existing behaviour for creates whose container is not in this
 * process's cache, and it is not a way in: the value comes from the *writer*,
 * while the frame is filtered by the *subscriber's* grant on whatever it names.
 * Naming a library the subscriber cannot read hides the frame; naming one they
 * can read tells them an id they already chose.
 */
function resolveContainment(
  entityKind: string,
  id: string | null,
  request: FastifyRequest,
  responseBody: Record<string, unknown> | null
): Containment {
  // A library is its own container, and needs no lookup to say so.
  if (entityKind === 'library' && id) return { libraryId: id, unowned: false };

  const refs = containerRefsFrom(responseBody, asRecord(request.body), asRecord(request.query));

  /*
   * Every cache read is best-effort.
   *
   * The store is not always there — a unit test mounting one route module, the
   * window before the coordinator is built — and a feed that cannot resolve
   * must degrade to "unresolved" rather than to a thrown hook. The raw
   * reference below is what keeps those callers working as they did.
   */
  try {
    const cache = getCacheCoordinator();

    if (id) {
      const entity = cache.get(id);
      if (entity) {
        const library = resolveOwningLibrary(entity);
        if (library) return { libraryId: library, unowned: false };
        // Found, but names nothing to resolve: unowned by design.
        const names = containerRefsFrom(asRecord(entity));
        return { libraryId: null, unowned: names.length === 0 };
      }
    }

    for (const ref of refs) {
      const referenced = cache.get(ref);
      if (!referenced) continue;
      const library = resolveOwningLibrary(referenced);
      if (library) return { libraryId: library, unowned: false };
    }
  } catch {
    // Fall through to the raw reference.
  }

  return refs.length > 0 ? { libraryId: refs[0]!, unowned: false } : UNRESOLVED;
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

  const responseBody = parsePayload(payload);

  // A create has no id in its URL; the response it just sent does.
  const id = target.id ?? stringField(responseBody, 'id');

  // What the pre-handler resolved while the entity still existed wins: a
  // delete has nothing left to look up by the time this runs.
  const containment =
    stashed(request) ?? resolveContainment(target.entity, id, request, responseBody);

  const origin = request.headers['x-sqlib-client-id'];

  return {
    type: 'changed',
    entity: target.entity,
    id,
    libraryId: containment.libraryId,
    unowned: containment.unowned,
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
  /*
   * Resolve the entity's library before the handler can remove it.
   *
   * `preHandler` rather than `onRequest` for the same reason the guard uses it:
   * `params` and the parsed body are both there by then. Only mutating requests
   * are worth the lookup, and a failure here must never reach the response —
   * the frame simply goes unresolved, which the feed treats as "withhold".
   */
  app.addHook('preHandler', async request => {
    if (!MUTATING_METHODS.has(request.method)) return;
    try {
      const target = describeRoute(request.url);
      if (!target) return;
      (request as unknown as Record<symbol, Containment>)[RESOLVED_CONTAINMENT] =
        resolveContainment(target.entity, target.id, request, null);
    } catch (error) {
      request.log.debug({ err: error }, 'Change feed containment lookup failed');
    }
  });

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
