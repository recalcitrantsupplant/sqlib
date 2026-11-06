/**
 * `MCP_CATALOGUE`: which of sqlib's two surfaces a server offers.
 *
 * - **`both`** (the default): the catalogue for building a library — `/mcp`'s
 *   built-in tools and every API route — and every library's published tools.
 * - **`catalogue`**: the catalogue only. `/mcp/{slug}` and `/tools/…` are 404.
 * - **`published`**: the published tools only, for a production deployment of
 *   an application. Every authoring route is 404, and `POST /execute` and
 *   `POST /rule-sets/{id}/execute` run only the pinned versions of published
 *   tools, whatever a caller's grants would otherwise allow.
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
 * `/execute` stays because every published query and group runs through it,
 * from either door, and `/rule-sets/:id/execute` because every published rule
 * set does; the hook below narrows both to the pinned versions. `/auth` stays
 * because who may call the tools is still decided by grants, and
 * `/.well-known` because a client signs in through it.
 */
const RULE_SET_EXECUTE_ROUTE = '/rule-sets/:id/execute';

export function routeServedWhenPublished(routeUrl: string): boolean {
  const path = normalizeRouteUrl(routeUrl);
  return (
    path === '/execute'
    || path === RULE_SET_EXECUTE_ROUTE
    || path === '/mcp'
    || path === '/mcp/:slug'
    || path === '/health'
    || path === '/metrics'
    || path === '/telemetry'
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
    if (!routeUrl) return;
    const path = normalizeRouteUrl(withinBase(routeUrl));
    if (path === RULE_SET_EXECUTE_ROUTE) {
      if (pinnedRuleSetCall(request)) return;
      reply.code(403).send({
        error: 'This server runs only its published tools. The rule set call is not the pinned version of a published tool, '
          + 'or names data the tool does not run on.',
      });
      return reply;
    }
    if (path !== '/execute') return;
    const body = request.body as { targetId?: unknown; dataGraphs?: unknown } | undefined;
    const targetId = body?.targetId;
    const pinned = getPublishedCatalogue().specs.some(spec => spec.targetId === targetId);
    // A published tool's `data` is RDF sent with the call; a stored graph named
    // by id is another entity, which the tool never reads.
    const onlyPostedData = body?.dataGraphs == null
      || (Array.isArray(body.dataGraphs) && body.dataGraphs.every(entry =>
        entry !== null && typeof entry === 'object'
        && Object.keys(entry).every(key => key === 'dataGraphInline' || key === 'dataGraphInlineFormat')));
    if (pinned && onlyPostedData) return;
    reply.code(403).send({
      error: 'This server runs only its published tools. The target is not the pinned version of a published tool, '
        + 'or the call names a stored data graph.',
    });
    return reply;
  });
}

/**
 * Whether a rule set call is one a published rule set tool makes: its pinned
 * version, and either the caller's own RDF or the tool's pinned data graph,
 * never another stored graph and never tuple seeds.
 */
function pinnedRuleSetCall(request: FastifyRequest): boolean {
  const id = (request.params as { id?: unknown } | undefined)?.id;
  const body = (request.body ?? {}) as {
    version?: unknown;
    dataGraphVersionId?: unknown;
    dataGraphId?: unknown;
    tuples?: unknown;
  };
  if (body.dataGraphId != null || body.tuples != null) return false;
  return getPublishedCatalogue().specs.some(({ targetKind, ruleSet }) =>
    targetKind === 'ruleSet'
    && ruleSet !== undefined
    && ruleSet.id === id
    && ruleSet.version === body.version
    && (body.dataGraphVersionId == null || body.dataGraphVersionId === ruleSet.dataGraphVersionId));
}
