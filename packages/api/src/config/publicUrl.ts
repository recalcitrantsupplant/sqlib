/**
 * The public address of this server, as a client behind a reverse proxy sees it.
 *
 * sqlib puts absolute URLs in three places: the OAuth protected-resource
 * metadata, the 401 challenge that points at it, and OGC API links. A proxy
 * that terminates TLS gives the server a request for `http://<internal host>`,
 * and a URL built from that request does not resolve for the client (#175).
 *
 * Two settings give the public address:
 *
 * - `SQLIB_PUBLIC_ORIGIN`: the scheme and host that clients use, such as
 *   `https://data.example.org`. It applies to every request.
 * - `SQLIB_TRUST_PROXY`: makes Fastify read `X-Forwarded-Proto` and
 *   `X-Forwarded-Host`. It is off by default, because a client that reaches
 *   the server directly can send those headers itself, and they would then
 *   set the URLs that sqlib advertises.
 *
 * The path is `APP_PUBLIC_BASE_PATH`, else `APP_BASE_PATH`.
 */
import type { FastifyRequest } from 'fastify';

/** `APP_BASE_PATH` as `''` or `/prefix`, with no trailing slash. */
export function normalizeBasePath(input: string | undefined): string {
  if (!input) {
    return '';
  }

  const trimmed = input.trim();
  if (trimmed === '' || trimmed === '/') {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailingSlashes = withLeadingSlash.replace(/\/+$/, '');

  return withoutTrailingSlashes === '/' ? '' : withoutTrailingSlashes;
}

/**
 * `SQLIB_PUBLIC_ORIGIN`, as `scheme://host[:port]`, or undefined when unset.
 *
 * A value with a path, a query or another scheme is an error. The path belongs
 * in `APP_PUBLIC_BASE_PATH`, and a wrong value here would put a URL that does
 * not resolve in every challenge.
 */
export function publicOriginSetting(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.SQLIB_PUBLIC_ORIGIN?.trim();
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid SQLIB_PUBLIC_ORIGIN "${raw}". Expected a URL such as https://data.example.org.`);
  }
  const isHttp = url.protocol === 'https:' || url.protocol === 'http:';
  const hasPath = url.pathname !== '/' && url.pathname !== '';
  if (!isHttp || hasPath || url.search || url.hash || url.username || url.password) {
    throw new Error(
      `Invalid SQLIB_PUBLIC_ORIGIN "${raw}". Expected a scheme and a host only, such as https://data.example.org. ` +
        'Put a path prefix in APP_PUBLIC_BASE_PATH.'
    );
  }
  return url.origin;
}

/**
 * `SQLIB_TRUST_PROXY`, as the value of Fastify's `trustProxy` option.
 *
 * - unset, empty or `false`: `false`. Forwarded headers are ignored.
 * - `true`: trust the forwarded headers of every sender.
 * - a whole number: trust that number of proxy hops.
 * - anything else: a comma-separated list of proxy addresses or CIDR ranges.
 */
export function trustProxySetting(
  env: NodeJS.ProcessEnv = process.env
): boolean | string | ((address: string, hop: number) => boolean) {
  const raw = env.SQLIB_TRUST_PROXY?.trim();
  if (!raw || raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(raw)) {
    // Fastify's types take no number, so the hop count is given as the
    // function that Fastify itself makes from a number.
    const hops = parseInt(raw, 10);
    return (_address, hop) => hop < hops;
  }
  return raw;
}

/**
 * The origin that a client uses for this server.
 *
 * `SQLIB_PUBLIC_ORIGIN` when set. Otherwise the origin of the request, which
 * is the forwarded one only when `SQLIB_TRUST_PROXY` is on.
 */
export function publicOrigin(request: FastifyRequest, env: NodeJS.ProcessEnv = process.env): string {
  return publicOriginSetting(env) ?? `${request.protocol}://${request.host}`;
}

/** The MCP streamable-HTTP routes, as registered at the root of the instance. */
export const MCP_ROUTES: readonly string[] = ['/mcp', '/mcp/:slug'];

/**
 * Every pattern the MCP routes are registered under: at the root, and under
 * `APP_BASE_PATH` when one is set. `packages/mcp-server/src/http-server.ts`
 * registers the same list.
 */
export function mcpRoutePatterns(basePath: string): string[] {
  return basePath ? [...MCP_ROUTES, ...MCP_ROUTES.map(route => `${basePath}${route}`)] : [...MCP_ROUTES];
}

/**
 * An MCP route registered under the base path, as its root pattern. Any other
 * route pattern is returned unchanged.
 */
export function mcpRouteWithinBase(routeUrl: string, basePath: string): string {
  if (!basePath || !routeUrl.startsWith(`${basePath}/`)) return routeUrl;
  const within = routeUrl.slice(basePath.length);
  return MCP_ROUTES.includes(within) ? within : routeUrl;
}
