import type { FastifyInstance } from 'fastify';

/**
 * Every response says how long it may be reused. None of them may.
 *
 * Entity reads carry `ETag` and `Last-Modified` — that is what `If-Match`
 * concurrency is built on — and a response carrying a validator but no
 * `Cache-Control` is exactly the shape RFC 9111 §4.2.2 lets a cache guess a
 * freshness lifetime for. Browsers take the invitation: Chromium's heuristic is
 * a tenth of the time since `Last-Modified`, so a query last edited a day ago
 * is served from the browser's own cache, without asking, for the next couple
 * of hours.
 *
 * What that cost: saving a new version made it current on the server and the
 * editor showed it, but the next `GET /queries/:id` — a reload, or reopening
 * the query — came back from the cache still naming the *previous* version as
 * current, and the editor loaded that version's body. The version list refreshed
 * (no validator, so nothing to guess a lifetime from) while the query it belongs
 * to did not, which is why the new version was visible and simply not current.
 *
 * `no-store` rather than `no-cache`: nothing here is worth a stored copy the
 * server would then have to revalidate, and the conditional-GET path that would
 * make revalidation cheap (`If-None-Match` → 304) is not implemented. The
 * validators stay on the response; they are for `If-Match`, not for caching.
 *
 * A route that has already set `Cache-Control` — SSE says `no-cache,
 * no-transform` on the raw socket — keeps what it set.
 */
export function registerNoStoreHook(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.getHeader('cache-control')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });
}
