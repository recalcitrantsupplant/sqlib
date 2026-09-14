/**
 * Opening a hand-streamed Server-Sent Events response.
 *
 * Writing to `reply.raw` bypasses the reply lifecycle, and with it every header
 * a plugin staged via `reply.header()` — most importantly the CORS headers,
 * which only reach the socket when `reply.send()` flushes them. A hand-streamed
 * SSE response never calls `send`, so the browser sees a 200 with no
 * `Access-Control-Allow-Origin` and drops it. Replaying the staged headers here
 * keeps one CORS policy (the plugin's) rather than hardcoding a second one that
 * would drift from it.
 *
 * Every SSE route goes through this, so the next one does not have to
 * rediscover that on its own.
 */
import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyReply } from 'fastify';

export function writeSseHead(reply: FastifyReply): void {
  const headers: OutgoingHttpHeaders = {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Nginx and friends buffer SSE into uselessness without this.
    'x-accel-buffering': 'no',
  };
  /*
   * Copied key by key rather than spread: fastify types a staged header value
   * as `string | number | string[]`, and node's `OutgoingHttpHeaders` narrows
   * the well-known names it knows about to strings, so the two disagree on
   * `accept` and friends. Going through the index signature carries the number
   * case (`content-length`) without either a cast or a lie.
   */
  for (const [key, value] of Object.entries(reply.getHeaders())) {
    // The SSE headers above win: they are what makes this response a stream.
    if (value !== undefined && !(key in headers)) headers[key] = value;
  }
  reply.raw.writeHead(200, headers);
}
