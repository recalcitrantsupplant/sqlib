/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) and the 401 challenge that
 * points at it (design/auth-architecture.md, "What changes in sqlib", item 1).
 *
 * This is how an MCP client finds the authorization server without manual
 * configuration: the tokenless request gets a 401 whose `WWW-Authenticate`
 * names this document, and the document names the issuers. The SPA reads the
 * same document to find its issuer. sqlib stays a resource server: the
 * document only says who issues tokens for it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from './config.js';

export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/** Whether a registered route pattern is one of the metadata routes. */
export function isProtectedResourceMetadataRoute(path: string): boolean {
  return path === PROTECTED_RESOURCE_METADATA_PATH || path.startsWith(`${PROTECTED_RESOURCE_METADATA_PATH}/`);
}

function absoluteUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function requestOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

/**
 * The resource identifier: `SQLIB_AUTH_RESOURCE`, else the audience. With
 * neither (an unchecked audience), the canonical URL of this host's `/mcp`,
 * because the document has to name something and that is what an MCP client
 * asks a token for.
 */
export function resourceIdentifier(config: AuthConfig, request: FastifyRequest): string {
  return config.resource ?? `${requestOrigin(request)}/mcp`;
}

/**
 * Where the document lives, as RFC 9728 §3.1 builds it: the well-known path
 * inserted between the resource's origin and its path. A resource that is not
 * a URL (an audience such as `sqlib-api`) gives no origin to build from, so
 * the request's origin and the unsuffixed path are used.
 */
export function protectedResourceMetadataUrl(config: AuthConfig, request: FastifyRequest): string {
  const resource = absoluteUrl(config.resource);
  if (!resource) return `${requestOrigin(request)}${PROTECTED_RESOURCE_METADATA_PATH}`;
  const path = resource.pathname.replace(/\/+$/, '');
  return `${resource.origin}${PROTECTED_RESOURCE_METADATA_PATH}${path}`;
}

/** The `WWW-Authenticate` value for a 401. `error` is absent when no token was sent (RFC 6750 §3.1). */
export function bearerChallenge(
  config: AuthConfig,
  request: FastifyRequest,
  error?: { code: string; description: string }
): string {
  const params: string[] = [];
  if (error) {
    params.push(`error="${error.code}"`, `error_description="${error.description}"`);
  }
  params.push(`resource_metadata="${protectedResourceMetadataUrl(config, request)}"`);
  if (config.scopes.length > 0) params.push(`scope="${config.scopes.join(' ')}"`);
  return `Bearer ${params.join(', ')}`;
}

export function protectedResourceMetadata(config: AuthConfig, request: FastifyRequest) {
  return {
    resource: resourceIdentifier(config, request),
    authorization_servers: config.issuers.map(entry => entry.issuer),
    bearer_methods_supported: ['header'],
    ...(config.scopes.length > 0 ? { scopes_supported: config.scopes } : {}),
  };
}

/**
 * `GET /.well-known/oauth-protected-resource`, plus every path-suffixed form
 * (`…/mcp`, `…/<base path>`), at the root of the instance; and, when the API
 * is mounted under a base path, the unsuffixed form under it too, which is
 * where the SPA looks. One document for all of them: the deployment is one
 * resource. A 404 when no issuer is configured, since there is then nothing to
 * say. Public in every mode; `plugin.ts` exempts these routes.
 */
export function registerProtectedResourceMetadataRoutes(
  app: FastifyInstance,
  config: AuthConfig,
  basePath: string
): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (config.issuers.length === 0) {
      return reply.code(404).send({ error: 'No authorization server is configured.' });
    }
    return reply.header('cache-control', 'public, max-age=300').send(protectedResourceMetadata(config, request));
  };

  const schema = { hide: true };
  app.get(PROTECTED_RESOURCE_METADATA_PATH, { schema }, handler);
  app.get(`${PROTECTED_RESOURCE_METADATA_PATH}/*`, { schema }, handler);
  if (basePath) {
    app.get(`${basePath}${PROTECTED_RESOURCE_METADATA_PATH}`, { schema }, handler);
  }
}
