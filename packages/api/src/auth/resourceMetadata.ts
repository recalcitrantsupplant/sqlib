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
import { publicOrigin, publicOriginSetting } from '../config/publicUrl.js';

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

/**
 * The resource identifier: `SQLIB_AUTH_RESOURCE`, else the audience. With
 * neither (an unchecked audience), the public URL of this server's `/mcp`,
 * because the document has to name something and that is what an MCP client
 * asks a token for.
 *
 * The public URL carries the public base path, because `/mcp` is served under
 * it. An MCP client compares the resource with the URL it connects to, and
 * refuses a document that names another path or another origin (#175).
 */
export function resourceIdentifier(config: AuthConfig, request: FastifyRequest, publicBasePath = ''): string {
  return config.resource ?? `${publicOrigin(request)}${publicBasePath}/mcp`;
}

/**
 * Where the 401 challenge says the document lives.
 *
 * With no base path, RFC 9728 §3.1 builds it: the well-known path inserted
 * between the resource's origin and its path. A resource that is not a URL (an
 * audience such as `sqlib-api`) gives no origin to build from, so the public
 * origin and the unsuffixed path are used.
 *
 * Under a base path, the challenge names the copy under that path. A reverse
 * proxy that routes only the base path to sqlib does not route the root
 * `/.well-known/…` of the origin, and a client that reads the challenge
 * fetches the URL in it and no other (RFC 9728 §5.1 allows any URL there).
 *
 * The origin is `SQLIB_PUBLIC_ORIGIN` when set, else the origin of a URL
 * resource, else the origin of the request.
 */
export function protectedResourceMetadataUrl(
  config: AuthConfig,
  request: FastifyRequest,
  publicBasePath = ''
): string {
  const resource = absoluteUrl(config.resource);
  const origin = publicOriginSetting() ?? resource?.origin ?? publicOrigin(request);
  if (publicBasePath) return `${origin}${publicBasePath}${PROTECTED_RESOURCE_METADATA_PATH}`;
  if (!resource) return `${origin}${PROTECTED_RESOURCE_METADATA_PATH}`;
  const path = resource.pathname.replace(/\/+$/, '');
  return `${origin}${PROTECTED_RESOURCE_METADATA_PATH}${path}`;
}

/** The `WWW-Authenticate` value for a 401. `error` is absent when no token was sent (RFC 6750 §3.1). */
export function bearerChallenge(
  config: AuthConfig,
  request: FastifyRequest,
  error?: { code: string; description: string },
  publicBasePath = ''
): string {
  const params: string[] = [];
  if (error) {
    params.push(`error="${error.code}"`, `error_description="${error.description}"`);
  }
  params.push(`resource_metadata="${protectedResourceMetadataUrl(config, request, publicBasePath)}"`);
  if (config.scopes.length > 0) params.push(`scope="${config.scopes.join(' ')}"`);
  return `Bearer ${params.join(', ')}`;
}

export function protectedResourceMetadata(config: AuthConfig, request: FastifyRequest, publicBasePath = '') {
  return {
    resource: resourceIdentifier(config, request, publicBasePath),
    authorization_servers: config.issuers.map(entry => entry.issuer),
    bearer_methods_supported: ['header'],
    ...(config.scopes.length > 0 ? { scopes_supported: config.scopes } : {}),
  };
}

/**
 * `GET /.well-known/oauth-protected-resource`, plus every path-suffixed form
 * (`…/mcp`, `…/<base path>`), at the root of the instance; and, when the API
 * is mounted under a base path, the unsuffixed form under it too, which is
 * where the SPA looks and where the 401 challenge points. One document for all of them: the deployment is one
 * resource. A 404 when no issuer is configured, since there is then nothing to
 * say. Public in every mode; `plugin.ts` exempts these routes.
 */
export function registerProtectedResourceMetadataRoutes(
  app: FastifyInstance,
  config: AuthConfig,
  basePath: string,
  publicBasePath: string = basePath
): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (config.issuers.length === 0) {
      return reply.code(404).send({ error: 'No authorization server is configured.' });
    }
    return reply.header('cache-control', 'public, max-age=300').send(protectedResourceMetadata(config, request, publicBasePath));
  };

  const schema = { hide: true };
  app.get(PROTECTED_RESOURCE_METADATA_PATH, { schema }, handler);
  app.get(`${PROTECTED_RESOURCE_METADATA_PATH}/*`, { schema }, handler);
  if (basePath) {
    app.get(`${basePath}${PROTECTED_RESOURCE_METADATA_PATH}`, { schema }, handler);
  }
}
