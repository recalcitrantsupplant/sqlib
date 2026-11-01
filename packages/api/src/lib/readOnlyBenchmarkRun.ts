/**
 * A benchmark run on a read-only deployment (`config/readOnly.ts`).
 *
 * The visitor runs a version the operator seeded, as it was saved, and the
 * server keeps nothing: the runner's records go to `transientBenchmarkSink` and
 * come back in the response. That is the separation tests already draw —
 * running is compute, keeping the history is a write.
 *
 * What makes it safe to offer every visitor is the set of caps in
 * `config/executionLimits.ts`, checked here before any request goes out:
 *
 * - the version must already be frozen. Freezing writes, and a version that is
 *   not frozen is still being authored;
 * - the plan's requests (measured tasks plus warmups) must fit the request cap.
 *   A version over it is refused, not clamped — a clamped benchmark reports
 *   numbers for a plan nobody saved;
 * - concurrency is capped, and the whole run has a wall-clock deadline;
 * - only so many read-only runs may be in flight on the deployment at once.
 *   `disabled` auth gives no client identity to count per visitor, so the
 *   count is deployment-wide.
 */
import type { FastifyRequest } from 'fastify';
import { BenchmarkRunner, countPlannedRequests, transientBenchmarkSink } from './BenchmarkRunner.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import {
  readOnlyBenchConcurrentRuns,
  readOnlyBenchDeadlineMs,
  readOnlyBenchMaxConcurrency,
  readOnlyBenchMaxRequests,
} from '../config/executionLimits.js';
import type { PersistedBenchmarkExperimentVersion } from '../persistence/schemas/BenchmarkExperimentVersionSchema.js';

/** A refusal with the status the route should answer it with. */
export class ReadOnlyBenchmarkRefusal extends Error {
  constructor(
    readonly statusCode: 409 | 422 | 429,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ReadOnlyBenchmarkRefusal';
  }
}

let inFlight = 0;

/** For tests, which must not inherit a previous test's slot. */
export function resetReadOnlyBenchmarkSlots(): void {
  inFlight = 0;
}

export async function runBenchmarkReadOnly(
  request: FastifyRequest,
  versionId: string,
  /** A seam for tests; the route always runs as the request's caller. */
  makeRunner: () => BenchmarkRunner = () => new BenchmarkRunner({ request }),
) {
  const version = getCacheCoordinator().get(versionId) as PersistedBenchmarkExperimentVersion | null;
  if (!version || version['@type'] !== 'BenchmarkExperimentVersion') {
    throw new Error(`BenchmarkExperimentVersion ${versionId} not found`);
  }
  if (!version.immutable) {
    throw new ReadOnlyBenchmarkRefusal(
      409,
      'This deployment is read-only, so it runs only a benchmark version that was frozen before it was deployed. '
        + 'This version is not frozen.',
    );
  }

  const runner = makeRunner();
  const plan = runner.planExperimentVersion(versionId);
  const planned = countPlannedRequests(plan.tasks, plan.warmupRuns);
  const maxRequests = readOnlyBenchMaxRequests();
  if (planned > maxRequests) {
    throw new ReadOnlyBenchmarkRefusal(
      422,
      `This version sends ${planned} requests (${plan.tasks.length} measured, plus warmups); `
        + `this read-only deployment allows ${maxRequests} per run.`,
      { cap: 'benchMaxRequests', limit: maxRequests, planned },
    );
  }

  const slots = readOnlyBenchConcurrentRuns();
  if (inFlight >= slots) {
    throw new ReadOnlyBenchmarkRefusal(
      429,
      'Another benchmark is running on this deployment. Try again when it finishes.',
      { cap: 'benchConcurrentRuns', limit: slots },
    );
  }

  inFlight += 1;
  try {
    return await runner.runExperimentVersion(versionId, {
      sink: transientBenchmarkSink,
      maxConcurrency: readOnlyBenchMaxConcurrency(),
      deadlineMs: readOnlyBenchDeadlineMs(),
    });
  } finally {
    inFlight -= 1;
  }
}
