/**
 * Deployment settings that this package reads for itself.
 *
 * They repeat `packages/api/src/config/publicUrl.ts`. This package loads the
 * API at run time, from source or from `dist`, so it has no static import to
 * share the code through. `http-server.ts` repeats the CORS settings for the
 * same reason. Keep the two files the same.
 */

/** `APP_BASE_PATH` as `''` or `/prefix`, with no trailing slash. */
export function basePathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = (env.APP_BASE_PATH ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailingSlashes = withLeadingSlash.replace(/\/+$/, '');
  return withoutTrailingSlashes === '/' ? '' : withoutTrailingSlashes;
}

/**
 * `SQLIB_TRUST_PROXY`, as the value of Fastify's `trustProxy` option: `false`
 * when unset, `true`, a number of proxy hops, or a comma-separated list of
 * proxy addresses.
 */
export function trustProxyFromEnv(
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

/** The MCP routes: at the root, and under `APP_BASE_PATH` when one is set. */
export function mcpRoutePaths(basePath: string = basePathFromEnv()): string[] {
  const routes = ['/mcp', '/mcp/:slug'];
  return basePath ? [...routes, ...routes.map(route => `${basePath}${route}`)] : routes;
}
