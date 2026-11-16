/**
 * Runs a rule set in a worker thread, and stops the thread at the deadline.
 *
 * `SQLIB_EXECUTION_TIMEOUT_MS` is checked between rules (`RuleSetExecutor`).
 * One rule over an in-memory Oxigraph store is a synchronous call, so a rule
 * with a large join holds the event loop until it ends, and every other
 * request waits. The rules playground runs text that any visitor types, so it
 * runs here: the main thread stays free, and `Worker.terminate()` stops the
 * rule where it is.
 *
 * The worker gets the run's versions by value, because it has no entity cache.
 */
import { Worker } from 'node:worker_threads';
import type { PersistedRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { PersistedRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import type { PersistedDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import type { RuleSetExecutionOptions, RuleSetExecutionResult } from './RuleSetExecutor.js';
import { executionDeadlineMs, playgroundRuleRuns } from '../config/executionLimits.js';

/** The options that cross to the worker. Callbacks and signals cannot. */
export type IsolatedRuleSetOptions = Pick<
  RuleSetExecutionOptions,
  'maxIterations' | 'inferenceFormat' | 'initialGraph' | 'initialGraphFormat' | 'tupleSeeds' | 'trace' | 'deadlineMs'
>;

export interface RuleSetWorkerJob {
  ruleSetVersion: PersistedRuleSetVersion;
  entities: Array<PersistedRuleVersion | PersistedDataBlockVersion>;
  options: IsolatedRuleSetOptions;
}

export type RuleSetWorkerReply =
  | { ok: true; result: RuleSetExecutionResult }
  | { ok: false; message: string };

/**
 * Time the worker gets after the deadline to stop by itself. Within it, the
 * executor's own check ends the run between rules and returns what it did.
 */
const GRACE_MS = 500;

/** Thrown when the run was stopped. `status` is the HTTP status to answer with. */
export class IsolatedRunStopped extends Error {
  constructor(message: string, readonly status: 503 | 504 | 499) {
    super(message);
    this.name = 'IsolatedRunStopped';
  }
}

let running = 0;

/**
 * A worker that has loaded its modules and waits for a job. Start-up takes
 * about 0.5 s (the executor's imports and Oxigraph), so each run takes the
 * spare and starts the next one. The first run on a server pays the start-up.
 * Each worker runs one job and ends, so no state passes between visitors.
 */
let spare: Worker | null = null;

function takeWorker(): Worker {
  const worker = spare ?? spawnWorker();
  spare = null;
  worker.ref();
  setImmediate(() => {
    if (spare) return;
    const next = spawnWorker();
    // A spare must not keep the process alive.
    next.unref();
    next.once('exit', () => {
      if (spare === next) spare = null;
    });
    spare = next;
  });
  return worker;
}

function spawnWorker(): Worker {
  const { url, execArgv } = workerUrl();
  return new Worker(url, { execArgv });
}

function workerUrl(): { url: URL; execArgv: string[] } {
  // Under `tsx` and vitest this module is TypeScript source, and the worker
  // needs the same loader. The built server runs the compiled `.js` file.
  // Each URL is a literal, so `scripts/check-orphans.mjs` sees the worker.
  if (import.meta.url.endsWith('.ts')) {
    return { url: new URL('./ruleSetWorker.ts', import.meta.url), execArgv: ['--import', 'tsx'] };
  }
  return { url: new URL('./ruleSetWorker.js', import.meta.url), execArgv: [] };
}

function seconds(ms: number): string {
  const value = ms / 1000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} s`;
}

export async function runRuleSetIsolated(
  job: RuleSetWorkerJob,
  { signal }: { signal?: AbortSignal } = {},
): Promise<RuleSetExecutionResult> {
  if (running >= playgroundRuleRuns()) {
    throw new IsolatedRunStopped('Too many rule runs at once. Try again in a few seconds.', 503);
  }
  const deadlineMs = job.options.deadlineMs ?? executionDeadlineMs();

  running += 1;
  const worker = takeWorker();
  try {
    return await new Promise<RuleSetExecutionResult>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        action();
      };
      const stop = (error: IsolatedRunStopped) => finish(() => reject(error));
      const onAbort = () => stop(new IsolatedRunStopped('The client disconnected.', 499));
      const timer = deadlineMs > 0
        ? setTimeout(
            () => stop(new IsolatedRunStopped(`The run took longer than ${seconds(deadlineMs)} and was stopped.`, 504)),
            deadlineMs + GRACE_MS,
          )
        : undefined;

      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.once('message', (reply: RuleSetWorkerReply) =>
        finish(() => (reply.ok ? resolve(reply.result) : reject(new Error(reply.message)))));
      worker.once('error', error => finish(() => reject(error)));
      worker.once('exit', code =>
        finish(() => reject(new Error(`The rule run stopped unexpectedly (worker exit ${code}).`))));
      worker.postMessage({ ...job, options: { ...job.options, deadlineMs } });
    });
  } finally {
    await worker.terminate();
    running -= 1;
  }
}
