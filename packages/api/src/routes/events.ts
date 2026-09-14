/**
 * `GET /events` — the library change feed as Server-Sent Events.
 *
 * Same hand-rolled streaming as the assistant's turn route: `writeSseHead` on
 * `reply.raw`, a frame per event, cleanup on `close`. SSE rather than a socket
 * because the traffic is strictly one-directional and plain HTTP needs no
 * upgrade, no dependency and no sticky sessions.
 *
 * What the stream does *not* carry is the changed entity. Subscribers refetch
 * through their normal path, which is the only path that also refreshes
 * concurrency tokens.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { canBackend, canLibrary } from '../auth/enforce.js';
import { subscribeChanges, type FeedEvent } from '../lib/changeEvents.js';
import { writeSseHead } from '../lib/sse.js';

/**
 * Idle proxies and load balancers reap a quiet connection in 30–60s, so a
 * comment goes out well inside that.
 */
const HEARTBEAT_MS = 20_000;

interface EventsQuery {
  /** Only frames for this library. Omit for everything the caller may read. */
  libraryId?: string;
  /** This client's id, so it does not react to its own writes. */
  clientId?: string;
}

function writeFrame(reply: FastifyReply, event: FeedEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export default async function eventRoutes(fastify: FastifyInstance) {
  /**
   * Every open stream, so server shutdown does not wait on connections that by
   * design never end — which is also what stops Playwright teardown hanging.
   */
  const open = new Set<() => void>();

  fastify.addHook('onClose', async () => {
    for (const close of [...open]) close();
  });

  fastify.get(
    '/',
    {
      schema: {
        // Untagged on purpose: the swagger UI renders a stream that never
        // finishes as a request that never finishes.
        hide: true,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { libraryId: libraryFilter, clientId } = (request.query ?? {}) as EventsQuery;

      // Replays the staged headers, CORS included; see `lib/sse.ts`. Without
      // that a cross-origin tab — the dev web server is not the API's origin —
      // drops the stream unread.
      writeSseHead(reply);

      // Tell the client it is connected before anything has changed, so a
      // "live" indicator does not sit on "connecting" through a quiet hour.
      reply.raw.write(': connected\n\n');

      const unsubscribe = subscribeChanges((event) => {
        // The tab that made the write already knows. Echoing it back only
        // costs it a refetch of what it just sent.
        if (clientId && event.origin === clientId) return;

        // A data-changed frame names a backend, not a library, so the grant
        // that governs the backend governs hearing about it. A library filter
        // does not apply: the same backend serves several libraries, and
        // dropping the frame for all of them would be worse than sending it.
        if (event.type === 'data-changed') {
          if (canBackend(request, event.backendId, 'use')) {
            try {
              writeFrame(reply, event);
            } catch {
              // Same as below: a socket that died mid-write is not an error.
            }
          }
          return;
        }

        if (libraryFilter && event.libraryId && event.libraryId !== libraryFilter) return;
        // Frames name entities, so the same read grant that governs the entity
        // governs hearing about it. An unresolved library stays visible: it
        // carries no more than "something changed".
        if (event.libraryId && !canLibrary(request, event.libraryId, 'read')) return;

        try {
          writeFrame(reply, event);
        } catch {
          // A socket that died between `close` and this write is not an error
          // worth logging; the close handler is about to clean up anyway.
        }
      });

      const heartbeat = setInterval(() => {
        reply.raw.write(': ping\n\n');
      }, HEARTBEAT_MS);
      // A stream nobody is reading must not be what keeps the process alive.
      heartbeat.unref?.();

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        open.delete(close);
        reply.raw.end();
      };

      open.add(close);
      request.raw.on('close', close);

      // Fastify must not try to send a reply of its own on top of the stream.
      reply.hijack();
    }
  );
}
