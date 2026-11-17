/**
 * The worker-thread side of `lib/isolatedQuery.ts`.
 *
 * Holds a copy of one Oxigraph store, loaded once from N-Quads, and runs one
 * query at a time on it through the ordinary executor. The main thread stops
 * this thread when a query passes its deadline.
 */
import { parentPort } from 'node:worker_threads';
import * as oxigraph from 'oxigraph';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import type { QueryWorkerReply, QueryWorkerRequest } from './isolatedQuery.js';

if (parentPort) {
  const port = parentPort;
  let executor = new OxigraphSparqlExecutor(new oxigraph.Store());

  port.on('message', async (request: QueryWorkerRequest) => {
    let reply: QueryWorkerReply;
    try {
      if (request.type === 'load') {
        const store = new oxigraph.Store();
        if (request.nquads) store.load(request.nquads, { format: 'nq' });
        executor = new OxigraphSparqlExecutor(store);
        reply = { id: request.id, ok: true, result: null };
      } else {
        const result = await executor[request.method](request.query, request.options);
        reply = { id: request.id, ok: true, result };
      }
    } catch (error) {
      reply = { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(reply);
  });
}
