/**
 * Which browser origins may read the API's responses.
 *
 * `SQLIB_CORS_ORIGINS` is a comma-separated origin list, or `*`. Unset, it is
 * the SPA's dev server under `NODE_ENV=development` and nothing otherwise; set
 * to the empty string, it is nothing even in development. A listed origin is
 * echoed back with `access-control-allow-credentials: true`; `*` answers every
 * origin and never with credentials; any other origin gets no CORS headers at
 * all, so the browser withholds the response from the page.
 *
 * **The same variable, read the same way, as `/mcp`.** In `dual-http` and
 * `streamable-http` modes this plugin and the MCP transport share one Fastify
 * instance, and two readings of one variable would answer the same origin
 * differently depending on the path. `packages/mcp-server/src/http-server.ts`
 * (`resolveCorsPolicy`) is the other reader; the parsing is repeated rather
 * than imported because the MCP server depends on this package, not the other
 * way round. `test/config/cors.test.ts` pins the cases both must agree on.
 *
 * **Credentials only for a named origin.** `*` with credentials is what a
 * browser refuses anyway, and reflecting any origin with credentials — the
 * usual workaround — lets every site on the internet make authenticated calls
 * as the visitor. Naming an origin is the decision that it may.
 */

import type { FastifyCorsOptions } from '@fastify/cors';
import type { FastifyRequest } from 'fastify';

/**
 * `any` is the literal `*`. `origins` is the explicit list, normalised.
 * Structurally the MCP server's `CorsPolicy`, so either can be handed to the
 * other's tests.
 */
export type CorsPolicy = { any: boolean; origins: ReadonlySet<string> };

/** The SPA's dev server (`packages/web/nuxt.config.ts`, `devServer.port`). */
export const DEV_CORS_ORIGINS: readonly string[] = ['http://localhost:3001', 'http://127.0.0.1:3001'];

const normaliseOrigin = (origin: string) => origin.trim().replace(/\/+$/, '');

export function resolveCorsPolicy(env: NodeJS.ProcessEnv = process.env): CorsPolicy {
  const raw = env.SQLIB_CORS_ORIGINS;
  const entries =
    raw === undefined
      ? env.NODE_ENV === 'development'
        ? [...DEV_CORS_ORIGINS]
        : []
      : raw.split(',').map(normaliseOrigin).filter(Boolean);
  const any = entries.includes('*');
  return { any, origins: new Set(entries.filter((entry) => entry !== '*')) };
}

/**
 * Routes that answer CORS themselves.
 *
 * `/mcp` sets its own headers and registers its own `OPTIONS /mcp`, with the
 * headers the MCP transport needs (`mcp-protocol-version`, `Last-Event-ID`)
 * rather than the API's. This plugin answers a preflight in `onRequest`, before
 * any route runs, so left to itself it would answer `/mcp`'s preflights with
 * the wrong header list and the MCP route would never see them.
 */
export const SELF_MANAGED_CORS_ROUTES: readonly string[] = ['/mcp'];

const API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/*
 * `Accept` is listed because the SPA negotiates a report format with it:
 * `POST /tests/:id/run` with `Accept: application/rdf+xml` returns EARL
 * rather than JSON. The header is only CORS-safelisted for a handful of
 * values, so any other media type preflights — and a preflight that does
 * not list it fails the whole request, which is why exporting a run failed
 * from the browser while every other call succeeded.
 */
const API_ALLOWED_HEADERS = ['Accept', 'Content-Type', 'Authorization', 'If-Match', 'mcp-session-id', 'X-Sqlib-Client-Id'];
const API_EXPOSED_HEADERS = ['ETag', 'Last-Modified', 'Server-Timing', 'mcp-session-id'];

/**
 * The `@fastify/cors` registration for a policy.
 *
 * A per-request delegator rather than a static `origin` array, because the
 * plugin's `credentials` is otherwise one value for every request: with `*`
 * and a named origin both configured, one of them would get the wrong answer.
 * Returning `origin: false` for an origin not on the list sends no CORS
 * headers, and a preflight from it falls through to the plugin's catch-all
 * `OPTIONS` route, which answers 404.
 */
export function buildCorsOptions(policy: CorsPolicy): FastifyCorsOptions {
  const shared: FastifyCorsOptions = {
    methods: API_METHODS,
    allowedHeaders: API_ALLOWED_HEADERS,
    exposedHeaders: API_EXPOSED_HEADERS,
  };

  const optionsFor = (request: FastifyRequest): FastifyCorsOptions => {
    const routeUrl = request.routeOptions?.url;
    if (routeUrl && SELF_MANAGED_CORS_ROUTES.includes(routeUrl)) return { origin: false };

    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    if (!origin) return { origin: false };
    if (policy.origins.has(normaliseOrigin(origin))) {
      return { ...shared, origin, credentials: true };
    }
    if (policy.any) return { ...shared, origin: '*', credentials: false };
    return { origin: false };
  };

  return {
    delegator: (request, callback) => callback(null, optionsFor(request)),
  };
}
