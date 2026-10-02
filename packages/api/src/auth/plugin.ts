/**
 * The auth plugin: token validation and AuthContext construction (design §3).
 *
 * Registered before any route, as an `onRequest` hook. In `disabled` mode it
 * decorates a full-access context and does nothing else, so the request path is
 * identical in shape across all three modes.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeRouteUrl } from '../config/readOnly.js';
import { getAuthStore } from './AuthStore.js';
import { getAuthConfig, type AuthConfig } from './config.js';
import { resolveEffectiveGrants } from './grants.js';
import { derivePrincipals } from './principals.js';
import { TokenError, TokenVerifier, getTokenVerifier } from './tokenVerifier.js';
import { createFullAccessContext, type AuthContext } from './types.js';

/**
 * Routes that never require a token, regardless of mode: `/` (a redirect to the
 * docs), `/health` for load balancers and the SPA's boot probe, and — unless
 * `SQLIB_AUTH_PROTECT_DOCS=true` — `/docs` and everything the swagger plugins
 * mount under it (`/docs/json`, `/docs/static/*`, …).
 *
 * Matched on `routeOptions.url`, the pattern Fastify registered, as
 * `config/readOnly.ts` does, never on the raw URL. The raw-URL version matched
 * `endsWith('/health')` and `includes('/docs/')`, which made
 * `/backends/:id/health` public, and would have done the same for any route a
 * plugin mounted under either name. A request no route claimed has no pattern
 * and is not public: it gets the 401 rather than a 404 that says what exists.
 */
function isPublicRoute(routeUrl: string | undefined, config: AuthConfig, basePath: string): boolean {
  if (!routeUrl) return false;
  const url = normalizeRouteUrl(routeUrl);
  // Everything the API serves sits under `APP_BASE_PATH` when one is set.
  let path: string;
  if (!basePath) {
    path = url;
  } else if (url === basePath) {
    path = '/';
  } else if (url.startsWith(`${basePath}/`)) {
    path = url.slice(basePath.length);
  } else {
    return false;
  }

  if (path === '/' || path === '/health') return true;
  if (!config.protectDocs && (path === '/docs' || path.startsWith('/docs/'))) return true;
  return false;
}

async function buildContext(
  request: FastifyRequest,
  config: AuthConfig,
  token: string
): Promise<AuthContext> {
  const verifier = getTokenVerifier(config);
  const verified = await verifier.verify(token);

  const derived = derivePrincipals({
    issuer: verified.issuerConfig.issuer,
    subject: verified.subject,
    claims: verified.claims,
    claimGroups: verified.issuerConfig.claimGroups,
    claimClientId: verified.issuerConfig.claimClientId,
  });

  const store = getAuthStore();

  // Record principals so admins can find them in the share dialog. Best effort:
  // a failure here must never turn into a failed request.
  for (const [iri, rawClaim] of derived.rawByPrincipal) {
    const kind = iri.includes(':group:') ? 'group' : derived.tokenType;
    store.recordPrincipal(iri, rawClaim, kind).catch((error: unknown) => {
      request.log.debug({ err: error, principal: iri }, 'Failed to record principal');
    });
  }

  return {
    subject: derived.subject,
    principals: derived.principals,
    issuer: verified.issuerConfig.issuer,
    tokenType: derived.tokenType,
    grants: resolveEffectiveGrants(derived.principals, store),
    claims: verified.claims,
    fullAccess: false,
    mode: config.mode,
  };
}

export interface AuthPluginOptions {
  /** `APP_BASE_PATH`, normalised (`''` or `/prefix`), under which the routes are mounted. */
  basePath?: string;
}

export async function registerAuthPlugin(
  app: FastifyInstance,
  options: AuthPluginOptions = {}
): Promise<void> {
  const config = getAuthConfig();
  const basePath = options.basePath ?? '';

  app.decorateRequest('authContext', undefined);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (config.mode === 'disabled') {
      request.authContext = createFullAccessContext('disabled');
      return;
    }

    const token = TokenVerifier.extractBearer(request.headers.authorization);

    if (!token) {
      if (config.mode === 'required' && !isPublicRoute(request.routeOptions?.url, config, basePath)) {
        reply
          .header('WWW-Authenticate', 'Bearer error="invalid_token"')
          .code(401)
          .send({ error: 'Authentication required.' });
        return reply;
      }
      // dry-run without a token: proceed as today, so an unconverted client
      // keeps working while the audit trail shows what would have happened.
      request.authContext = createFullAccessContext(config.mode);
      return;
    }

    try {
      request.authContext = await buildContext(request, config, token);
    } catch (error) {
      const tokenError =
        error instanceof TokenError ? error : new TokenError('invalid', (error as Error).message);

      request.log.warn(
        { audit: true, authError: tokenError.kind, requestId: request.id },
        'Bearer token rejected'
      );

      if (config.mode === 'required') {
        const status = tokenError.statusCode;
        if (status === 401) {
          reply.header(
            'WWW-Authenticate',
            `Bearer error="invalid_token", error_description="${tokenError.kind}"`
          );
        }
        reply.code(status).send({
          error: status === 503 ? 'Authorization service unavailable.' : 'Invalid bearer token.',
        });
        return reply;
      }

      request.authContext = createFullAccessContext(config.mode);
    }
  });

  if (config.mode !== 'disabled' && config.audienceUnchecked) {
    const unscoped = config.issuers.filter(entry => !entry.audience).map(entry => entry.issuer);
    if (unscoped.length > 0) {
      app.log.warn(
        { issuers: unscoped },
        'SQLIB_AUTH_AUDIENCE_UNCHECKED=true: accepting tokens for any audience from these issuers'
      );
    }
  }

  app.log.info({ authMode: config.mode, issuers: config.issuers.map(i => i.issuer) }, 'Auth plugin registered');
}
