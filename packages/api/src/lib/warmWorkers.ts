/**
 * Worker threads with their modules already loaded.
 *
 * A worker that imports the executor and Oxigraph takes about 0.5 s to start.
 * `take()` hands out a waiting spare and starts the next one, so only the
 * first call on a server pays the start-up. A spare is unref'd: it never keeps
 * the process alive.
 */
import { Worker } from 'node:worker_threads';

export class WarmWorkers {
  private spare: Worker | null = null;

  constructor(private readonly spawn: () => Worker) {}

  take(): Worker {
    const worker = this.spare ?? this.spawn();
    this.spare = null;
    worker.ref();
    setImmediate(() => this.refill());
    return worker;
  }

  private refill(): void {
    if (this.spare) return;
    const next = this.spawn();
    next.unref();
    next.once('exit', () => {
      if (this.spare === next) this.spare = null;
    });
    this.spare = next;
  }
}

/**
 * The heap each worker may grow to. A query or rule run that builds a larger
 * result fails, with the worker, instead of taking the container's memory.
 */
export const WORKER_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 256 } as const;

/**
 * The URL and loader flags to start a worker from a sibling module.
 *
 * Under `tsx` and vitest the caller is TypeScript source and the worker needs
 * the same loader; the built server runs the compiled `.js` file. The caller
 * passes both URLs as literals, so `scripts/check-orphans.mjs` sees the worker.
 */
export function workerSource(callerUrl: string, ts: URL, js: URL): { url: URL; execArgv: string[] } {
  return callerUrl.endsWith('.ts') ? { url: ts, execArgv: ['--import', 'tsx'] } : { url: js, execArgv: [] };
}
