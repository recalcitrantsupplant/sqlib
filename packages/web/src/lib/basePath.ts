/**
 * Where this build is served from, and how to name a file beside it.
 *
 * Nuxt rewrites what it generates — the router, `_nuxt/` chunks, anything a
 * component imports — against `app.baseURL`, so almost nothing in this app has
 * to know. What it cannot rewrite is a path written as a string: a `<link>`
 * href in `app.head`, a `fetch` of a file dropped into `public/`. Those are
 * site-absolute, and under a base path they point outside the app at whatever
 * else is hosted there.
 *
 * So the handful of places that name such a file join it here instead. A
 * deployment sets `NUXT_APP_BASE_URL` at build time and they follow; the
 * default of `/` leaves every URL exactly as it was.
 *
 * Build time, not run time: `ssr: false` means these are baked into the HTML
 * the generate step writes, and a base path is a property of where the files
 * were put, not of who is asking for them.
 */

/**
 * A base with one leading and one trailing slash, however it was written.
 *
 * `NUXT_APP_BASE_URL` is typed by hand into a Dockerfile or a CI variable, so
 * `/sqlib`, `sqlib/` and `/sqlib/` all reach this and all mean the same place.
 * Nuxt itself is strict about the trailing slash, which is the one an author is
 * most likely to leave off.
 */
export function normaliseBase(base: string | undefined | null): string {
  const trimmed = (base ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * A site-absolute path, rewritten to sit under the base.
 *
 * `withBase('/favicon.svg', '/sqlib/')` is `/sqlib/favicon.svg`. An absolute
 * URL is returned untouched — a font or an icon served from elsewhere is not
 * this app's to move.
 */
export function withBase(path: string, base: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path;
  const normalised = normaliseBase(base);
  if (normalised === '/') return path.startsWith('/') ? path : `/${path}`;
  return `${normalised}${path.replace(/^\/+/, '')}`;
}
