/**
 * `MCP_CATALOGUE`: which of sqlib's two surfaces a server offers.
 *
 * - **`both`** (the default): the catalogue for building a library — `/mcp`'s
 *   built-in tools and every API route — and every library's published tools.
 * - **`catalogue`**: the catalogue only. `/mcp/{slug}` and `/tools/…` are 404.
 * - **`published`**: the published tools only, for a production deployment of
 *   an application. Every authoring route is 404, and `POST /execute` runs
 *   only the pinned versions of published tools, whatever a caller's grants
 *   would otherwise allow.
 *
 * It also decides what an invalid tool at startup costs: in `both` and
 * `catalogue` mode the server logs it and starts without it, so a person
 * designing queries keeps a working server; in `published` mode it refuses to
 * start, so a broken release fails when it is deployed rather than at a
 * client's first call. See `docs/guides/publishing-tools.md`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPublishedCatalogue, type PublishedCatalogue } from '../lib/publishedTools.js';
import { normalizeRouteUrl } from './readOnly.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The published tools collected at startup and the mode they are served
     * under. Set by `configureApp`; read by `packages/mcp-server`.
     */
    sqlibPublished?: { catalogue: PublishedCatalogue; mode: CatalogueMode };
  }
}

export const CATALOGUE_MODES = ['both', 'catalogue', 'published'] as const;
export type CatalogueMode = (typeof CATALOGUE_MODES)[number];

/** Read `MCP_CATALOGUE`. Unset is `both`; anything else unknown is refused rather than guessed. */
export function catalogueMode(env: NodeJS.ProcessEnv = process.env): CatalogueMode {
  const raw = (env.MCP_CATALOGUE ?? '').trim().toLowerCase();
  if (!raw) return 'both';
  if ((CATALOGUE_MODES as readonly string[]).includes(raw)) return raw as CatalogueMode;
  throw new Error(`MCP_CATALOGUE must be one of ${CATALOGUE_MODES.join(', ')}; got "${env.MCP_CATALOGUE}".`);
}

/** Whether the published tools are served: `/mcp/{slug}`, `/tools/…`, and on `/mcp`. */
export function publishedToolsServed(mode: CatalogueMode = catalogueMode()): boolean {
  return mode !== 'catalogue';
}

/** Whether the built-in catalogue is served: its MCP tools and the authoring routes. */
export function catalogueServed(mode: CatalogueMode = catalogueMode()): boolean {
  return mode !== 'published';
}

/**
 * The routes a `published` server keeps. Everything else is an authoring
 * route and answers 404, as though it were never registered.
 *
 * `/execute` stays because every published tool runs through it, from either
 * door; the hook below narrows it to the pinned versions. `/auth` stays
 * because who may call the tools is still decided by grants, and
 * `/.well-known` because a client signs in through it.
 */
export function routeServedWhenPublished(routeUrl: string): boolean {
  const path = normalizeRouteUrl(routeUrl);
  return (
    path === '/execute'
    || path === '/mcp'
    || path === '/mcp/:slug'
    || path === '/health'
    || path === '/metrics'
    || path === '/tools'
    || path.startsWith('/tools/')
    || path === '/auth'
    || path.startsWith('/auth/')
    || path.startsWith('/.well-known/')
  );
}

/**
 * Registered before any route. A no-op unless `MCP_CATALOGUE=published`.
 *
 * `onRequest`, by the matched route pattern rather than the raw URL, as the
 * read-only gate does (`config/readOnly.ts`), so no spelling of a URL reaches
 * a refused handler. The `/execute` check needs the body, so it is a
 * `preHandler`, and it applies to MCP calls as well: they reach `/execute`
 * through `app.inject` and pass the same hooks.
 */
export async function registerPublishedModePlugin(
  app: FastifyInstance,
  options: { basePath: string; mode?: CatalogueMode },
): Promise<void> {
  if ((options.mode ?? catalogueMode()) !== 'published') return;
  const { basePath } = options;
  const withinBase = (routeUrl: string) =>
    basePath && routeUrl.startsWith(basePath) ? routeUrl.slice(basePath.length) || '/' : routeUrl;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const routeUrl = request.routeOptions?.url;
    if (!routeUrl || request.method === 'OPTIONS') return;
    if (routeServedWhenPublished(withinBase(routeUrl))) return;
    reply.code(404).send({ error: 'Not Found' });
    return reply;
  });

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const routeUrl = request.routeOptions?.url;
    if (!routeUrl || normalizeRouteUrl(withinBase(routeUrl)) !== '/execute') return;
    const targetId = (request.body as { targetId?: unknown } | undefined)?.targetId;
    const pinned = getPublishedCatalogue().specs.some(spec => spec.targetId === targetId);
    if (pinned) return;
    reply.code(403).send({
      error: 'This server runs only its published tools. The target is not the pinned version of a published tool.',
    });
    return reply;
  });
}
