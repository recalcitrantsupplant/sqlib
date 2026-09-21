/**
 * Read-only deployments: sqlib as a compute service rather than a store.
 *
 * `SQLIB_READ_ONLY=true` is for a public site — a seeded catalogue nobody can
 * edit, with authoring done in the visitor's own browser. The server still
 * parses, validates, formats and executes; what it stops doing is keeping
 * anything a visitor sends it.
 *
 * **It is deliberately not an auth mode.** An auth mode answers "who is this,
 * and what may they reach", which needs principals, grants and an issuer. This
 * answers "may this deployment's own state change at all", which needs none of
 * them and gives every caller the same answer. The two compose rather than
 * overlap: the public site runs `SQLIB_AUTH_MODE=disabled` beside this, and the
 * full-access context that mode mints still cannot write, because nothing here
 * consults a context. That is the point — a gate that cannot be reasoned around
 * is worth more on a public site than one that is precise about principals.
 *
 * **Deny by default.** The gate refuses every mutating method and then names
 * the exceptions. Listing what to refuse instead would silently admit every
 * write route added afterwards, which is the failure this exists to prevent.
 *
 * **What it does not do is refuse SPARQL.** `POST /sparql` passes through
 * untouched, UPDATEs included. Whether a store accepts a write is the store's
 * answer and not this flag's: sqlib's own read-only backends refuse through
 * `ReadOnlySparqlExecutor`, and somebody else's endpoint refuses, or does not,
 * on its own terms. A gate here would be sqlib inventing a policy for a
 * database it does not own, and refusing an update a visitor is entitled to
 * make against their own triplestore. What it does refuse is `?record=patch`,
 * because recording a patch writes sqlib's state — see `routes/sparql.ts`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Methods the gate refuses unless the route is named below. */
export const MUTATING_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Mutating routes that compute an answer and write nothing of sqlib's own.
 *
 * Every entry is a route whose handler was read and found to persist nothing:
 * parse, validate, format, and the execution routes, which run a *seeded*
 * artifact and write only wherever the backend puts it. Membership is a claim
 * about a handler, so `readOnly.routes.test.ts` fails on an entry naming no
 * registered route — a renamed route must be re-examined, not silently dropped
 * to "refused" where nobody would notice the demo had stopped working.
 *
 * Absent on purpose, though each is arguably "just compute":
 *
 * - `POST /backends/probes` takes a URL and fetches it, which on a public site
 *   is a request forgery primitive pointed at whatever the host can reach.
 * - `POST /etl-jobs/preview` and `POST /playground/etl/execute` take arbitrary
 *   DuckDB SQL, a host filesystem read primitive. Their own flags default off;
 *   this makes turning a flag on insufficient to expose them here too.
 * - `POST /tests/:id/run` and the benchmark runs record what they did.
 */
export const STATELESS_ROUTES: readonly string[] = [
  '/detect-inputs',
  '/detect-outputs',
  '/validate',
  '/validate-rule-data',
  '/format',
  '/substitute',
  '/execute',
  '/sparql',
  '/playground/rules/execute',
  '/rules/preview/normalize',
  '/rules/:id/execute',
  '/rule-sets/srl/compile',
  '/rule-sets/srl/analyze',
  '/rule-sets/srl/from-sparql',
  '/rule-sets/:id/srl/preview',
  '/rule-sets/:id/execute',
  '/rule-sets/:id/execute/stream',
  '/tuple-sets/detect-format',
  '/tuple-sets/preview',
];

const allowed = new Set(STATELESS_ROUTES);

/**
 * Fastify registers a plugin's `'/'` route under both `/prefix` and
 * `/prefix/` (`prefixTrailingSlash` defaults to `'both'`), so a route URL
 * reaches the hook in either spelling. One spelling in the allowlist, then.
 */
export function normalizeRouteUrl(url: string): string {
  const path = url.split('?')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

/** Whether a read-only deployment refuses this route. */
export function isRefusedWhenReadOnly(method: string, routeUrl: string): boolean {
  if (!MUTATING_METHODS.includes(method.toUpperCase())) return false;
  return !allowed.has(normalizeRouteUrl(routeUrl));
}

function parse(raw: string | undefined): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

let current: boolean = parse(process.env.SQLIB_READ_ONLY);

export function isReadOnlyDeployment(): boolean {
  return current;
}

/** Re-resolve from an environment, so tests can point the module at another. */
export function resetReadOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  current = parse(env.SQLIB_READ_ONLY);
  return current;
}

/**
 * Registered after the auth plugin and before any route.
 *
 * `onRequest` is early enough that a refused write never reaches body parsing,
 * a schema, or a handler — the request is understood and declined, which is
 * what 405 says. The check reads `routeOptions.url`, the pattern Fastify
 * matched, rather than the raw URL: `/queries/%2e%2e` and a mis-decoded path
 * both reach the hook as whatever route actually claimed them, so there is no
 * spelling of a URL that matches an allowlist entry and then runs another
 * handler.
 */
export async function registerReadOnlyPlugin(app: FastifyInstance): Promise<void> {
  if (!isReadOnlyDeployment()) return;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const routeUrl = request.routeOptions?.url;
    // No matched route is a 404 the router is about to send; refusing it here
    // would answer 405 for every typo, and say that a write route exists.
    if (!routeUrl) return;

    if (isRefusedWhenReadOnly(request.method, routeUrl)) {
      request.log.info(
        { readOnly: true, route: `${request.method} ${routeUrl}` },
        'Refused a write on a read-only deployment'
      );
      reply.code(405).send({
        error:
          'This sqlib deployment is read-only. Its catalogue changes by redeployment, ' +
          'and anything you author is kept in your browser rather than on the server.',
      });
      return reply;
    }
  });
}
