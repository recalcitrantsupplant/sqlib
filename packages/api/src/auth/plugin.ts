/**
 * The auth plugin: token validation and AuthContext construction (design §3).
 *
 * Registered before any route, as an `onRequest` hook. In `disabled` mode it
 * decorates a full-access context and does nothing else, and in `anonymous`
 * mode a context for the one anonymous principal, so the request path is
 * identical in shape in every mode.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeRouteUrl } from '../config/readOnly.js';
import { DEMO_PERSON_HEADER, demoPerson, isDemoMode } from '../config/demoMode.js';
import { getAuthStore } from './AuthStore.js';
import { getAuthConfig, type AuthConfig } from './config.js';
import { resolveEffectiveGrants } from './grants.js';
import { derivePrincipals, isGroupPrincipal, type DerivedPrincipals } from './principals.js';
import { TrustedHeaderError, hasTrustedSecret, readTrustedIdentity, type TrustedHeaderConfig } from './trustedHeader.js';
import {
  bearerChallenge,
  isProtectedResourceMetadataRoute,
  registerProtectedResourceMetadataRoutes,
} from './resourceMetadata.js';
import { TokenError, TokenVerifier, getTokenVerifier } from './tokenVerifier.js';
import {
  PRINCIPAL_ANONYMOUS,
  readsBearerTokens,
  servesGuests,
  createAnonymousContext,
  createDemoPersonContext,
  createFullAccessContext,
  type AuthContext,
} from './types.js';
import { demoPrincipalsOf } from './demoPeople.js';
import { registerWriteActorHooks } from './writeActor.js';

/**
 * Routes that never require a token, regardless of mode: `/` (a redirect to the
 * docs), `/health` for load balancers and the SPA's boot probe, the
 * protected-resource metadata, which is what a tokenless client reads to find
 * out where to get a token, and — unless
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
  // The metadata routes are mounted at the root of the instance whatever the
  // base path, because RFC 9728 puts them at the root of the origin.
  if (isProtectedResourceMetadataRoute(url)) return true;
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

  if (path === '/' || path === '/health' || isProtectedResourceMetadataRoute(path)) return true;
  if (!config.protectDocs && (path === '/docs' || path.startsWith('/docs/'))) return true;
  return false;
}

/** One header value, trimmed; null when absent or empty. */
function headerValue(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

  return contextFor(request, config, derived, verified.issuerConfig.issuer, verified.claims);
}

/**
 * The context of a signed-in caller, from principals a token or a proxy
 * header gave. Records the principals for the share dialog and the People list.
 */
function contextFor(
  request: FastifyRequest,
  config: AuthConfig,
  derived: DerivedPrincipals,
  issuer: string,
  claims: Record<string, unknown>
): AuthContext {
  const store = getAuthStore();

  // Record principals so admins can find them in the share dialog. Best effort:
  // a failure here must never turn into a failed request.
  for (const [iri, rawClaim] of derived.rawByPrincipal) {
    const kind = iri.includes(':group:') ? 'group' : derived.tokenType;
    const names = iri === derived.subject ? { label: derived.label, displayName: derived.displayName } : {};
    store.recordPrincipal(iri, rawClaim, kind, names).catch((error: unknown) => {
      request.log.debug({ err: error, principal: iri }, 'Failed to record principal');
    });
  }

  // The time of this request, for the administrator's People list. Best effort, as above.
  store.recordSeen(derived.subject).catch((error: unknown) => {
    request.log.debug({ err: error, principal: derived.subject }, 'Failed to record last seen');
  });

  // The groups this caller carried, kept for `Test as`. Best effort, as above.
  store
    .recordGroups(derived.subject, derived.principals.filter(isGroupPrincipal))
    .catch((error: unknown) => {
      request.log.debug({ err: error, principal: derived.subject }, 'Failed to record groups');
    });

  // Where guests are served, a signed-in caller also holds what a guest
  // holds, so signing in never shows less than the public view.
  const principals = servesGuests(config.mode) ? [...derived.principals, PRINCIPAL_ANONYMOUS] : derived.principals;

  return {
    subject: derived.subject,
    principals,
    issuer,
    tokenType: derived.tokenType,
    grants: resolveEffectiveGrants(principals, store),
    claims,
    fullAccess: false,
    mode: config.mode,
  };
}

/**
 * `trusted-header` mode: refuse a request without the proxy's secret, serve
 * one without an identity header as a guest, and otherwise the caller the
 * header names. Returns false when it has replied.
 */
function applyTrustedHeader(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AuthConfig,
  trusted: TrustedHeaderConfig,
  basePath: string
): boolean {
  const guest = () =>
    createAnonymousContext(resolveEffectiveGrants([PRINCIPAL_ANONYMOUS], getAuthStore()), 'trusted-header');

  if (!hasTrustedSecret(request.headers, trusted)) {
    // A load balancer's probe reaches `/health` without the proxy.
    if (isPublicRoute(request.routeOptions?.url, config, basePath)) {
      request.authContext = guest();
      return true;
    }
    request.log.warn({ audit: true, authError: 'trusted-secret', requestId: request.id }, 'Request without the proxy secret');
    reply.code(403).send({ error: 'Request did not come through the sign-in proxy.' });
    return false;
  }

  let identity;
  try {
    identity = readTrustedIdentity(request.headers, trusted);
  } catch (error) {
    const message = error instanceof TrustedHeaderError ? error.message : 'The identity header could not be read.';
    request.log.warn({ audit: true, authError: 'trusted-header', requestId: request.id }, message);
    reply.code(400).send({ error: message });
    return false;
  }

  if (!identity) {
    request.authContext = guest();
    return true;
  }

  const derived = derivePrincipals({
    issuer: trusted.issuer,
    subject: identity.subject,
    claims: identity.claims,
    claimGroups: 'groups',
    // No client credentials reach sqlib through a proxy session.
    claimClientId: '',
  });
  request.authContext = contextFor(request, config, derived, trusted.issuer, identity.claims);
  return true;
}

export interface AuthPluginOptions {
  /** `APP_BASE_PATH`, normalised (`''` or `/prefix`), under which the routes are mounted. */
  basePath?: string;
  /**
   * `APP_PUBLIC_BASE_PATH`, normalised, else `basePath`: the path prefix that
   * a client sees. It goes into the URLs that the 401 challenge and the
   * protected-resource metadata advertise.
   */
  publicBasePath?: string;
}

export async function registerAuthPlugin(
  app: FastifyInstance,
  options: AuthPluginOptions = {}
): Promise<void> {
  const config = getAuthConfig();
  const basePath = options.basePath ?? '';
  const publicBasePath = options.publicBasePath ?? basePath;

  app.decorateRequest('authContext', undefined);

  // First, so the auth hook below and every handler run inside the request's
  // write scope: what a request saves is stamped with its caller.
  registerWriteActorHooks(app);

  registerProtectedResourceMetadataRoutes(app, config, basePath, publicBasePath);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (config.mode === 'disabled') {
      request.authContext = createFullAccessContext('disabled');
      return;
    }

    // A public deployment: nobody signs in, and a bearer header, if one is
    // sent, is ignored rather than verified — there is no issuer to verify it
    // against. Every caller holds exactly the grants on the anonymous
    // principal, resolved per request so a grant change applies at once.
    if (config.mode === 'anonymous') {
      // Demo mode (`config/demoMode.ts`): a visitor may act as one of the
      // people in the operator's file. The header names the person; it cannot
      // describe one, so a name the file lacks is refused rather than read as
      // a guest, and a broken switch shows as an error.
      const personId = isDemoMode() ? headerValue(request.headers[DEMO_PERSON_HEADER]) : null;
      if (personId) {
        const person = demoPerson(personId);
        if (!person) {
          reply.code(401).send({ error: `No demo person "${personId}". Switch to another person or to Guest.` });
          return reply;
        }
        const principals = demoPrincipalsOf(person);
        request.authContext = createDemoPersonContext(
          principals.user,
          principals.all,
          resolveEffectiveGrants(principals.all, getAuthStore())
        );
        return;
      }
      request.authContext = createAnonymousContext(
        resolveEffectiveGrants([PRINCIPAL_ANONYMOUS], getAuthStore())
      );
      return;
    }

    if (config.mode === 'trusted-header' && config.trustedHeader) {
      if (!applyTrustedHeader(request, reply, config, config.trustedHeader, basePath)) return reply;
      return;
    }

    const token = TokenVerifier.extractBearer(request.headers.authorization);

    // `optional`: a caller with no token is a guest, as in `anonymous`.
    if (!token && config.mode === 'optional') {
      request.authContext = createAnonymousContext(
        resolveEffectiveGrants([PRINCIPAL_ANONYMOUS], getAuthStore()),
        'optional'
      );
      return;
    }

    if (!token) {
      if (config.mode === 'required' && !isPublicRoute(request.routeOptions?.url, config, basePath)) {
        reply
          .header('WWW-Authenticate', bearerChallenge(config, request, undefined, publicBasePath))
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

      // `optional` refuses a bad token as `required` does. Serving it as a
      // guest would hide the expiry from the client, and show a signed-in
      // person the public view without saying why.
      if (config.mode === 'required' || config.mode === 'optional') {
        const status = tokenError.statusCode;
        if (status === 401) {
          reply.header(
            'WWW-Authenticate',
            bearerChallenge(config, request, { code: 'invalid_token', description: tokenError.kind }, publicBasePath)
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

  const readsTokens = readsBearerTokens(config.mode);

  if (readsTokens && config.audienceUnchecked) {
    const unscoped = config.issuers.filter(entry => !entry.audience).map(entry => entry.issuer);
    if (unscoped.length > 0) {
      app.log.warn(
        { issuers: unscoped },
        'SQLIB_AUTH_AUDIENCE_UNCHECKED=true: accepting tokens for any audience from these issuers'
      );
    }
  }

  if (readsTokens && config.resource && !config.audienceUnchecked) {
    const audiences = config.issuers.map(entry => entry.audience);
    if (!audiences.includes(config.resource)) {
      app.log.warn(
        { resource: config.resource, audiences },
        'SQLIB_AUTH_RESOURCE matches no issuer audience: a token a client asks for this resource will be refused'
      );
    }
  }

  app.log.info({ authMode: config.mode, issuers: config.issuers.map(i => i.issuer) }, 'Auth plugin registered');
}
