import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import type { FromSchema, JSONSchema } from 'json-schema-to-ts';
import type { CacheCoordinator } from '../lib/CacheCoordinator.js';
import type { EntityRepositories } from '../lib/EntityRepositories.js';
import { getCacheCoordinator, getEntityRepositories } from '../lib/CacheCoordinatorProvider.js';

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

export function getIfMatchValue(request: FastifyRequest): string | null {
  const rawHeader = request.headers['if-match'];
  if (!rawHeader) return null;
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '*') return '*';
  return trimmed.replace(/^"|"$/g, '');
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

  console.error('[normalizeDateModified] Unexpected dateModified type:', {
    type: typeof dateModified,
    value: dateModified
  });
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
  const ifMatch = getIfMatchValue(request);

  // If no If-Match header, validation passes
  if (!ifMatch || ifMatch === '*') {
    return { valid: true, currentTag: null, ifMatch };
  }

  // Normalize the entity's dateModified (handle Date objects from LDKit)
  const dateModified = (entity.dateModified as string | Date | null | undefined);
  const currentTag = normalizeDateModified(dateModified);

  // Validation fails if no current tag or mismatch
  const valid = !!currentTag && currentTag === ifMatch;

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
  entity: { dateModified?: string | Date | null } | null | undefined
): void {
  if (!entity) {
    return;
  }
  
  // Get dateModified and convert to string if needed
  let dateModifiedStr: string | null = null;
  
  if (entity.dateModified !== undefined && entity.dateModified !== null) {
    if (typeof entity.dateModified === 'string') {
      dateModifiedStr = entity.dateModified;
    } else if (entity.dateModified instanceof Date) {
      dateModifiedStr = entity.dateModified.toISOString();
    } else {
      const diag = entity as { '@type'?: unknown; '$id'?: unknown; id?: unknown };
      console.error('[setEntityConcurrencyHeaders] dateModified is not a string or Date:', {
        type: typeof entity.dateModified,
        value: entity.dateModified,
        entityType: diag['@type'],
        entityId: diag['$id'] || diag.id
      });
      return;
    }
  } else {
    return;
  }
  
  reply.header('ETag', formatEtag(dateModifiedStr));
  const lastModified = formatLastModified(dateModifiedStr);
  if (lastModified) {
    reply.header('Last-Modified', lastModified);
  }
}

export function withCacheHandler<TResult>(
  handler: RouteHandler<TResult>
): (request: FastifyRequest, reply: FastifyReply) => Promise<Awaited<TResult> | void> {
  return async (request, reply): Promise<Awaited<TResult> | void> => {
    try {
      const cache = getCacheCoordinator();
      const result = await handler({ request, reply, cache });
      return result as Awaited<TResult>;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Enhanced error logging with request context
      request.log.error({
        err: error,
        route: `${request.method} ${request.url}`,
        requestId: request.id,
        statusCode: (error as { statusCode?: number }).statusCode,
        errorType: error.constructor.name
      }, 'Route handler failure');
      console.error('withCacheHandler error', {
        env: process.env.NODE_ENV,
        route: `${request.method} ${request.url}`,
        message: error.message,
        stack: error.stack,
      });

      if (!reply.sent) {
        const statusCode = (error as { statusCode?: number }).statusCode ?? 500;

        // Preserve original error messages instead of generic ones
        let message = error.message || 'Request failed';
        let details: unknown = undefined;

        // In development, include more error details
        if (process.env.NODE_ENV === 'development') {
          details = {
            stack: error.stack,
            type: error.constructor.name,
            originalError: String(err)
          };
        }

        // For client errors (4xx), always show the original message
        // For server errors (5xx), show original message in development, generic in production
        if (statusCode >= 500 && process.env.NODE_ENV !== 'development') {
          message = 'Internal Server Error';
        }

        const errorResponse: { error: string; route: string; timestamp: string; details?: unknown } = {
          error: message,
          route: `${request.method} ${request.url}`,
          timestamp: new Date().toISOString()
        };

        if (details) {
          errorResponse.details = details;
        }

        reply.status(statusCode).send(errorResponse);
      }
      return; // explicitly return void in error case
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
      const result = await handler({ request, reply, repos });
      return result as Awaited<TResult>;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      request.log.error({
        err: error,
        route: `${request.method} ${request.url}`,
        requestId: request.id,
        statusCode: (error as { statusCode?: number }).statusCode,
        errorType: error.constructor.name
      }, 'Route handler failure');
      console.error('withReposHandler error', {
        env: process.env.NODE_ENV,
        route: `${request.method} ${request.url}`,
        message: error.message,
        stack: error.stack,
      });

      if (!reply.sent) {
        const statusCode = (error as { statusCode?: number }).statusCode ?? 500;

        let message = error.message || 'Request failed';
        let details: unknown = undefined;

        if (process.env.NODE_ENV === 'development') {
          details = {
            stack: error.stack,
            type: error.constructor.name,
            originalError: String(err)
          };
        }

        if (statusCode >= 500 && process.env.NODE_ENV !== 'development') {
          message = 'Internal Server Error';
        }

        const errorResponse: { error: string; route: string; timestamp: string; details?: unknown } = {
          error: message,
          route: `${request.method} ${request.url}`,
          timestamp: new Date().toISOString()
        };

        if (details) {
          errorResponse.details = details;
        }

        reply.status(statusCode).send(errorResponse);
      }
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
