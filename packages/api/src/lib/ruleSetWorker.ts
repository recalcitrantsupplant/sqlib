/**
 * The worker-thread side of `lib/isolatedRuleSet.ts`.
 *
 * Runs one rule set on its own in-memory Oxigraph store and posts the result
 * back. The main thread can stop this thread at any point, which it cannot do
 * to a synchronous Oxigraph query on its own event loop.
 */
import { parentPort } from 'node:worker_threads';
import { RuleSetExecutor } from './RuleSetExecutor.js';
import type { RuleSetWorkerJob, RuleSetWorkerReply } from './isolatedRuleSet.js';

if (parentPort) {
  const port = parentPort;
  port.once('message', async (job: RuleSetWorkerJob) => {
    let reply: RuleSetWorkerReply;
    try {
      const result = await new RuleSetExecutor().execute(job.ruleSetVersion, {
        ...job.options,
        entities: new Map(job.entities.map(entity => [entity.$id, entity])),
      });
      reply = { ok: true, result };
    } catch (error) {
      reply = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(reply);
  });
}
