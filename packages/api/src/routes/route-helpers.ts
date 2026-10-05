import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import type { FromSchema, JSONSchema } from 'json-schema-to-ts';
import type { CacheCoordinator } from '../lib/CacheCoordinator.js';
import type { EntityRepositories } from '../lib/EntityRepositories.js';
import { getCacheCoordinator, getEntityRepositories } from '../lib/CacheCoordinatorProvider.js';
import { log } from '../lib/log.js';

type RouteHandlerContext = {
  request: FastifyRequest;
  reply: FastifyReply;
  cache: CacheCoordinator;
};

type RouteReposHandlerContext = {
  request: FastifyRequest;
  reply: FastifyReply;
  repos: EntityRepositories;
};

type RouteHandler<TResult> = (
  ctx: RouteHandlerContext
) => TResult | Promise<TResult>;

type RouteReposHandler<TResult> = (
  ctx: RouteReposHandlerContext
) => TResult | Promise<TResult>;

/** One entity-tag from an `If-Match` list. */
export interface EntityTag {
  tag: string;
  weak: boolean;
}

/**
 * The `If-Match` header as RFC 9110 §13.1.1 has it: `*`, or a comma-separated
 * list of entity-tags, each `"opaque"` or weak `W/"opaque"`. Null when absent
 * or blank.
 *
 * A bare, unquoted token is accepted as a strong tag too. It is not RFC
 * syntax, but it is what clients of this API have always sent — the
 * `dateModified` value itself — and refusing it would turn every one of their
 * writes into a 412.
 */
export function parseIfMatch(request: FastifyRequest): '*' | EntityTag[] | null {
  const rawHeader = request.headers['if-match'];
  const raw = Array.isArray(rawHeader) ? rawHeader.join(',') : rawHeader;
  if (!raw || !raw.trim()) return null;
  if (raw.trim() === '*') return '*';

  const tags: EntityTag[] = [];
  // An opaque tag may not contain a double quote, so a comma inside quotes
  // cannot occur in a valid header; splitting on quoted spans is enough.
  const pattern = /\s*(W\/)?(?:"([^"]*)"|([^,\s]+))\s*(?:,|$)/gy;
  let match: RegExpExecArray | null;
  while (pattern.lastIndex < raw.length && (match = pattern.exec(raw)) !== null) {
    const tag = match[2] ?? match[3] ?? '';
    if (tag) tags.push({ tag, weak: Boolean(match[1]) });
  }
  return tags.length > 0 ? tags : null;
}

/**
 * The first tag a client sent, for logging and the 412 body. Kept for callers
 * that want one value; `validateIfMatch` reads the whole list.
 */
export function getIfMatchValue(request: FastifyRequest): string | null {
  const parsed = parseIfMatch(request);
  if (parsed === null) return null;
  if (parsed === '*') return '*';
  return parsed[0]?.tag ?? null;
}

/**
 * Normalizes a dateModified value (which may be a Date object or string due to LDKit deserialization)
 * to an ISO string for comparison with If-Match headers.
 *
 * @param dateModified - The dateModified value from an entity
 * @returns ISO string representation or null
 */
export function normalizeDateModified(dateModified: string | Date | null | undefined): string | null {
  if (!dateModified) return null;

  if (dateModified instanceof Date) {
    return dateModified.toISOString();
  }

  if (typeof dateModified === 'string') {
    return dateModified;
  }

  log.error(
    { type: typeof dateModified, value: dateModified },
    'normalizeDateModified: unexpected dateModified type',
  );
  return null;
}

/**
 * Validates If-Match precondition for optimistic concurrency control.
 * Handles the fact that LDKit deserializes xsd:dateTime as Date objects at runtime,
 * despite TypeScript interfaces declaring them as strings.
 *
 * @param request - Fastify request object
 * @param entity - Entity with dateModified field
 * @returns Object with validation result and normalized current tag
 */
export function validateIfMatch(
  request: FastifyRequest,
  entity: { dateModified?: string | Date | null | undefined }
): { valid: boolean; currentTag: string | null; ifMatch: string | null } {
  const parsed = parseIfMatch(request);
  const ifMatch = parsed === null ? null : parsed === '*' ? '*' : parsed[0]!.tag;

  // No header: the write is unconditional. `*` matches every current
  // representation, and the entity exists or the route would have answered 404.
  if (parsed === null || parsed === '*') {
    return { valid: true, currentTag: null, ifMatch };
  }

  // Normalize the entity's dateModified (handle Date objects from LDKit)
  const currentTag = normalizeDateModified(entity.dateModified);

  // Strong comparison (RFC 9110 §8.8.3.2): a weak tag never matches, because
  // `If-Match` guards a write and a weak tag only promises equivalence. Every
  // tag this server sends is strong, so a client holding a weak one got it
  // from something in between that weakened it.
  const valid = !!currentTag && parsed.some(entry => !entry.weak && entry.tag === currentTag);

  return { valid, currentTag, ifMatch };
}

function formatEtag(tag: string): string {
  if (typeof tag !== 'string') {
    throw new Error(`formatEtag expects a string, got ${typeof tag}: ${JSON.stringify(tag)}`);
  }
  const normalized = tag.replace(/"/g, '');
  return `"${normalized}"`;
}

function formatLastModified(tag: string): string | null {
  if (typeof tag !== 'string') {
    return null;
  }
  const date = new Date(tag);
  if (Number.isNaN(date.getTime())) return null;
  return date.toUTCString();
}

export function setEntityConcurrencyHeaders(
  reply: FastifyReply,
  entity: { dateModified?: string | null } | null | undefined
): void {
  const dateModifiedStr = entity?.dateModified;
  if (typeof dateModifiedStr !== 'string' || !dateModifiedStr) {
    return;
  }

  reply.header('ETag', formatEtag(dateModifiedStr));
  const lastModified = formatLastModified(dateModifiedStr);
  if (lastModified) {
    reply.header('Last-Modified', lastModified);
  }
}

/**
 * A refusal a handler (or a hook it calls) has already worded.
 *
 * Thrown rather than sent so that code below the handler — a versioned-entity
 * hook, a shared check — can end the request without being handed the reply.
 * The body is sent as given, with its status; nothing is masked, because the
 * thrower chose what the caller should read.
 */
export class RouteError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: { error: string; [key: string]: unknown },
  ) {
    super(body.error);
    this.name = 'RouteError';
  }
}

/**
 * The one answer to an error a route did not handle itself.
 *
 * This was written out three times — once in each wrapper below and once in
 * the global error handler in `index.ts` — and the copies were verbatim. The
 * status comes from the error (`AuthorizationError` 403, `EntityExistsError`
 * and `ImmutableEntityError` 409, `ValidationError` 400) or is 500. A client
 * error keeps its message; a server error is masked outside development,
 * because the message of an error nobody anticipated is whatever the layer
 * that threw it chose to say.
 */
export function errorResponseFor(
  request: FastifyRequest,
  err: unknown,
): { statusCode: number; body: Record<string, unknown> } {
  if (err instanceof RouteError) {
    return { statusCode: err.statusCode, body: err.body };
  }
  const error = err instanceof Error ? err : new Error(String(err));
  const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
  const development = process.env.NODE_ENV === 'development';

  let message = error.message || 'Request failed';
  if (statusCode >= 500 && !development) {
    message = 'Internal Server Error';
  }

  const body: Record<string, unknown> = {
    error: message,
    route: `${request.method} ${request.url}`,
    requestId: request.id,
    timestamp: new Date().toISOString(),
  };
  if (development) {
    body.details = {
      stack: error.stack,
      type: error.constructor.name,
      originalError: String(err),
    };
  }
  return { statusCode, body };
}

/** Log and answer an error a route did not handle; a no-op once the reply is sent. */
export function sendRouteError(request: FastifyRequest, reply: FastifyReply, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  if (!(err instanceof RouteError)) {
    request.log.error({
      err: error,
      route: `${request.method} ${request.url}`,
      requestId: request.id,
      statusCode: (error as { statusCode?: number }).statusCode,
      errorType: error.constructor.name,
    }, 'Route handler failure');
  }
  if (reply.sent) return;
  const { statusCode, body } = errorResponseFor(request, err);
  reply.status(statusCode).send(body);
}

export function withCacheHandler<TResult>(
  handler: RouteHandler<TResult>
): (request: FastifyRequest, reply: FastifyReply) => Promise<Awaited<TResult> | void> {
  return async (request, reply): Promise<Awaited<TResult> | void> => {
    try {
      const cache = getCacheCoordinator();
      return await handler({ request, reply, cache }) as Awaited<TResult>;
    } catch (err) {
      sendRouteError(request, reply, err);
      return;
    }
  };
}

/**
 * Request typing derived from a route's JSON Schema.
 *
 * Fastify's type provider can only infer through a handler passed inline, and
 * every route here goes through `withCacheHandler`/`withReposHandler` — so the
 * schema is handed to the helper instead and the request type is computed from
 * it directly. Response typing is deliberately out of scope: the generated
 * response schemas use `$ref` across the fastify schema registry, which
 * `FromSchema` cannot resolve.
 */
type RouteSchemaPart = 'params' | 'body' | 'querystring';

type InferredPart<TSchema, TPart extends RouteSchemaPart> = TSchema extends {
  [P in TPart]: infer TValue;
}
  ? (TValue extends JSONSchema ? FromSchema<TValue> : unknown)
  : unknown;

export type TypedRequest<TSchema> = FastifyRequest<{
  Params: InferredPart<TSchema, 'params'>;
  Body: InferredPart<TSchema, 'body'>;
  Querystring: InferredPart<TSchema, 'querystring'>;
}>;

// The handler's own parameters are typed loosely so the tuple composes with a
// route that still declares its own generics (several modules pin `Reply`).
// The types the handler actually sees come from the schema, above.
type TypedRouteRegistration = [
  RouteShorthandOptions,
  (request: FastifyRequest<any>, reply: FastifyReply<any>) => Promise<any>,
];

/**
 * Spread into a route registration: `fastify.get('/:id', ...reposRoute(schema, handler))`.
 * Runtime behaviour is unchanged — the schema is registered exactly as before and
 * the handler still runs inside `withReposHandler`'s error handling.
 */
export function reposRoute<const TSchema extends object, TResult>(
  schema: TSchema,
  handler: (ctx: {
    request: TypedRequest<TSchema>;
    reply: FastifyReply;
    repos: EntityRepositories;
  }) => TResult | Promise<TResult>
): TypedRouteRegistration {
  return [
    { schema: schema as RouteShorthandOptions['schema'] },
    withReposHandler(handler as RouteReposHandler<TResult>),
  ];
}

/**
 * `reposRoute` for routes that register a plain fastify handler (their own
 * try/catch rather than one of the wrappers). Pass-through — it only types.
 */
export function typedRoute<const TSchema extends object, TResult>(
  schema: TSchema,
  handler: (
    request: TypedRequest<TSchema>,
    reply: FastifyReply
  ) => TResult | Promise<TResult>
): TypedRouteRegistration {
  return [
    { schema: schema as RouteShorthandOptions['schema'] },
    handler as TypedRouteRegistration[1],
  ];
}

/** `reposRoute`, for handlers that need the coordinator rather than the repositories. */
export function cacheRoute<const TSchema extends object, TResult>(
  schema: TSchema,
  handler: (ctx: {
    request: TypedRequest<TSchema>;
    reply: FastifyReply;
    cache: CacheCoordinator;
  }) => TResult | Promise<TResult>
): TypedRouteRegistration {
  return [
    { schema: schema as RouteShorthandOptions['schema'] },
    withCacheHandler(handler as RouteHandler<TResult>),
  ];
}

export function withReposHandler<TResult>(
  handler: RouteReposHandler<TResult>
): (request: FastifyRequest, reply: FastifyReply) => Promise<Awaited<TResult> | void> {
  return async (request, reply): Promise<Awaited<TResult> | void> => {
    try {
      const repos = getEntityRepositories();
      return await handler({ request, reply, repos }) as Awaited<TResult>;
    } catch (err) {
      sendRouteError(request, reply, err);
      return;
    }
  };
}

/**
 * A version of a parent entity, looked up by its number.
 *
 * "Parse `:version`, reject a non-number, find the version belonging to this
 * parent, 404 if it is not there" appeared fifteen times across five route
 * files — three times each in rules, rule-sets, data-blocks, data-graphs and
 * tests, once per GET/PUT/DELETE. Every copy was the same six lines with a
 * different noun in the error message, which is the shape worth naming.
 *
 * It returns a discriminated result rather than sending the reply itself, so
 * the caller keeps its own `reply.status(...).send(...)` and stays greppable —
 * a helper that writes to the response makes the route's failure modes
 * invisible at the call site.
 */
export type VersionLookup<TVersion> =
  | { ok: true; version: TVersion }
  | { ok: false; status: 400 | 404; error: string };

export function findVersionByNumber<TVersion extends { isPartOf?: string; version?: number }>(
  versions: TVersion[],
  parentId: string,
  rawVersion: string,
  /** Lower-case singular for the message: "data graph" -> "Data graph version not found". */
  noun: string,
): VersionLookup<TVersion> {
  const targetVersion = Number.parseInt(rawVersion, 10);
  if (Number.isNaN(targetVersion)) {
    return { ok: false, status: 400, error: 'Version must be a number' };
  }

  const match = versions.find(
    version => version.isPartOf === parentId && Number(version.version) === targetVersion,
  );
  if (!match) {
    const capitalised = noun.charAt(0).toUpperCase() + noun.slice(1);
    return { ok: false, status: 404, error: `${capitalised} version not found` };
  }

  return { ok: true, version: match };
}
