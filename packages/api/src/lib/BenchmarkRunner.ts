import { ArgumentSetService } from './ArgumentSetService.js';
import type { BenchmarkSubjectSpec } from './BenchmarkExperimentService.js';
import { assertBenchmarkVersionDependencies, parseSubjectSpecs } from './BenchmarkExperimentService.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { mintId } from './id.js';
import { SparqlQueryParser } from './parser.js';
import { ExecutorFactory } from './orchestration/ExecutorFactory.js';
import { ExecutionEngine, type ExecutionHooks } from './orchestration/ExecutionEngine.js';
import { GraphBuilder } from './orchestration/GraphBuilder.js';
import type { NodeResult, ResolvedNode } from './orchestration/types.js';
import type { LdkitBenchmarkExperimentVersion } from '../persistence/schemas/BenchmarkExperimentVersionSchema.js';
import type { LdkitBenchmarkObservation } from '../persistence/schemas/BenchmarkObservationSchema.js';
import type { LdkitBenchmarkNodeObservation } from '../persistence/schemas/BenchmarkNodeObservationSchema.js';
import type { LdkitBenchmarkIterationObservation } from '../persistence/schemas/BenchmarkIterationObservationSchema.js';
import type { LdkitBenchmarkIterationRun } from '../persistence/schemas/BenchmarkIterationRunSchema.js';
import type { LdkitBenchmarkRun } from '../persistence/schemas/BenchmarkRunSchema.js';
import type { LdkitBenchmarkNodeRun } from '../persistence/schemas/BenchmarkNodeRunSchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';
import { RuleSetExecutor, type IterationRecord } from './RuleSetExecutor.js';
import { resolveTupleSeedInput } from './tupleSeedInput.js';
import { DEFAULT_DATA_GRAPH_FORMAT, storeManagerFormat, type DataGraphFormat } from './dataGraphContent.js';
import { BenchmarkObservations } from '../persistence/utils/BenchmarkObservationUtils.js';
import { BenchmarkNodeObservations } from '../persistence/utils/BenchmarkNodeObservationUtils.js';
import { BenchmarkIterationObservations } from '../persistence/utils/BenchmarkIterationObservationUtils.js';
import { BenchmarkIterationRuns, updateBenchmarkIterationRun } from '../persistence/utils/BenchmarkIterationRunUtils.js';
import { BenchmarkRuns, updateBenchmarkRun } from '../persistence/utils/BenchmarkRunUtils.js';
import { BenchmarkNodeRuns, updateBenchmarkNodeRun } from '../persistence/utils/BenchmarkNodeRunUtils.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { toQueryTypeIri } from './queryTypes.js';
import {
  BENCHMARK_ITERATION_OBSERVATION_DSD_IRI,
  BENCHMARK_NODE_OBSERVATION_DSD_IRI,
  BENCHMARK_NOT_APPLICABLE_BACKEND_IRI,
  BENCHMARK_NO_ARGUMENTS_IRI,
  BENCHMARK_OBSERVATION_DSD_IRI,
  DEFAULT_BENCHMARK_EXECUTION_STRATEGY,
  DEFAULT_BENCHMARK_REPEATS,
} from '../constants/benchmarks.js';
import { EPHEMERAL_BACKEND_ID, LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import { oxigraphStoreManager } from './OxigraphStoreManager.js';
import crypto from 'node:crypto';

type BenchmarkTask = {
  subjectId: string;
  subjectType: 'QueryVersion' | 'QueryGroupVersion' | 'RuleSetVersion';
  backendId: string;
  /**
   * The reference the plan named on the tabular axis — an argument set, a tuple
   * set for a rule-set subject, or the no-arguments sentinel.
   */
  argumentSetId: string;
  /**
   * What `argumentSetId` resolved to when the run was planned, or null for the
   * no-arguments sentinel.
   *
   * Resolved once for the whole run and then used for execution as well as for
   * the record, so a version published while the run is in flight cannot make
   * the first half of a run and the second half execute different values
   * (issue #246).
   */
  argumentSetVersionId: string | null;
  /**
   * The graph axis, which only a rule-set subject has: the reference the plan
   * named, and what it resolved to when the run was planned.
   *
   * Pinned for the same reason the argument axis is (issue #246): a data graph
   * published between two repeats would otherwise make one half of a run read a
   * different graph from the other while the observations claim one.
   */
  dataGraphId: string | null;
  dataGraphVersionId: string | null;
  runIndex: number;
};

type BenchmarkRunResult = {
  run: LdkitBenchmarkRun;
  nodeRun?: LdkitBenchmarkNodeRun | null;
  iterationRun?: LdkitBenchmarkIterationRun | null;
  observations: LdkitBenchmarkObservation[];
  nodeObservations: LdkitBenchmarkNodeObservation[];
  iterationObservations: LdkitBenchmarkIterationObservation[];
};

/**
 * What one attempt at a task reports back.
 *
 * Named rather than written inline because `runWithRetries` states it three
 * times over — parameter, return and local — and a second-level table added to
 * one of the three and not the others is a silent drop.
 */
type BenchmarkTaskOutcome = {
  success: boolean;
  resultCount: number;
  durationMs: number;
  errorMessage?: string;
  errorType?: string;
  nodeObservationDrafts?: LdkitBenchmarkNodeObservation[];
  iterationObservationDrafts?: LdkitBenchmarkIterationObservation[];
};

function sleep(ms: number): Promise<void> {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDurationToMs(duration?: string | null): number | null {
  if (!duration) return null;
  const match = duration.match(/^P(T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)$/);
  if (!match) return null;
  const hours = Number.parseFloat(match[2] || '0');
  const minutes = Number.parseFloat(match[3] || '0');
  const seconds = Number.parseFloat(match[4] || '0');
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * The argument reference a task actually executes.
 *
 * The pinned version where there is one, so every repeat of a task runs the
 * values the run resolved at the start — not whatever `currentVersion` points
 * at by the time the repeat comes round. Falls back to the reference itself,
 * which is the no-arguments sentinel and resolves to nothing.
 */
function executionArgumentId(task: BenchmarkTask): string {
  return task.argumentSetVersionId ?? task.argumentSetId;
}

/**
 * The version an axis member names, whether it named the version or the object.
 *
 * The tuple-set and data-graph counterpart of
 * `ArgumentSetService.resolveVersionIdForId`: a plan may name either, and what
 * a run resolved is recorded on its observations rather than fixed in the
 * plan.
 */
function resolveCurrentVersionId(id: string, parentType: string, versionType: string): string {
  const entity = getCacheCoordinator().get(id) as { '@type'?: string; currentVersion?: string | null } | null;
  if (!entity) {
    throw new Error(`${parentType} ${id} not found`);
  }
  if (entity['@type'] === versionType) return id;
  if (entity['@type'] !== parentType) {
    throw new Error(`${id} must be a ${parentType} or ${versionType}`);
  }
  const currentVersionId = entity.currentVersion;
  if (!currentVersionId) {
    throw new Error(`${parentType} ${id} has no current version`);
  }
  const version = getCacheCoordinator().get(currentVersionId) as { '@type'?: string } | null;
  if (!version || version['@type'] !== versionType) {
    throw new Error(`${versionType} ${currentVersionId} not found`);
  }
  return currentVersionId;
}

/** A data graph version's content, ready to seed a rules run's base graph. */
function readDataGraphVersion(dataGraphVersionId: string): { content: string; format: string } {
  const version = getCacheCoordinator().get(dataGraphVersionId) as LdkitDataGraphVersion | null;
  if (!version || version['@type'] !== 'DataGraphVersion') {
    throw new Error(`DataGraphVersion ${dataGraphVersionId} not found`);
  }
  const format = (version.contentFormat || DEFAULT_DATA_GRAPH_FORMAT) as DataGraphFormat;
  return { content: version.contentString ?? '', format: storeManagerFormat(format) };
}

/**
 * One row per pass of the fixpoint loop, for one rule-set request.
 *
 * `subjectObservation` is left empty here and filled once the request's own
 * observation has an id, exactly as the node drafts are: a pass belongs to the
 * request that ran it, and the request is not recorded until it finishes.
 *
 * A pass's `resultCount` is its delta rather than the graph's size, because
 * that is what `resultCount` means everywhere else in the cube — what this row
 * produced. The running total sits beside it in `tripleCount`.
 */
function buildIterationObservationDrafts(
  iterationRunId: string,
  runIndex: number,
  iterations: IterationRecord[],
): LdkitBenchmarkIterationObservation[] {
  const timestamp = new Date().toISOString();
  return iterations.map(iteration => ({
    $id: mintId('benchmarkIterationObservation'),
    '@type': 'BenchmarkIterationObservation',
    dataSet: iterationRunId,
    subjectObservation: '',
    runIndex,
    iterationIndex: iteration.index,
    stratum: iteration.stratum ?? null,
    durationMs: iteration.durationMs,
    resultCount: iteration.delta,
    tripleCount: iteration.tripleCount,
    tupleCount: iteration.tupleCount,
    rulesEvaluated: iteration.rules.length,
    timestamp,
  }));
}

function countResults(result: NodeResult): number {
  if (typeof result === 'boolean') return result ? 1 : 0;
  if (typeof result === 'string') {
    return result
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0).length;
  }
  if (result && typeof result === 'object') {
    const maybe = result as {
      boolean?: boolean;
      results?: { bindings?: unknown[] };
      success?: boolean;
    };
    if (typeof maybe.boolean === 'boolean') return maybe.boolean ? 1 : 0;
    const bindings = maybe?.results?.bindings;
    if (Array.isArray(bindings)) return bindings.length;
    if (typeof maybe.success === 'boolean') return 0;
  }
  return 0;
}

async function runWithConcurrency<T>(
  tasks: T[],
  limit: number,
  handler: (task: T, index: number) => Promise<void>,
  abortSignal: { aborted: boolean }
): Promise<void> {
  const concurrency = Math.max(1, limit || 1);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => (async () => {
    while (true) {
      if (abortSignal.aborted) return;
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      await handler(tasks[index], index);
    }
  })());
  await Promise.all(workers);
}

export class BenchmarkRunner {
  constructor(
    private readonly argumentSetService = new ArgumentSetService(),
    private readonly executorFactory = new ExecutorFactory(),
    private readonly parser = new SparqlQueryParser(),
    private readonly graphBuilder = new GraphBuilder(),
    /*
     * A factory rather than an instance: `RuleSetExecutor` holds per-run state
     * (a validator and the store it builds), and benchmark tasks run
     * concurrently under `maxConcurrency`. One per request is what every other
     * caller does too.
     */
    private readonly ruleSetExecutorFactory: () => RuleSetExecutor = () => new RuleSetExecutor(),
  ) {}

  async runExperimentVersion(versionId: string): Promise<BenchmarkRunResult> {
    const versionEntity = getCacheCoordinator().get(versionId) as LdkitBenchmarkExperimentVersion | null;
    if (!versionEntity || versionEntity['@type'] !== 'BenchmarkExperimentVersion') {
      throw new Error(`BenchmarkExperimentVersion ${versionId} not found`);
    }
    if (!versionEntity.immutable) {
      throw new Error(`BenchmarkExperimentVersion ${versionId} must be frozen before execution`);
    }

    const version = versionEntity;
    assertBenchmarkVersionDependencies(versionId, version.subjectSpecs);
    const subjectSpecs = parseSubjectSpecs(version.subjectSpecs);
    const tasks = this.buildTasks(subjectSpecs, version.repeats ?? DEFAULT_BENCHMARK_REPEATS);
    const orderedTasks = version.randomizeOrder ? shuffle(tasks) : tasks;

    const runId = mintId('benchmarkRun');
    const nowIso = new Date().toISOString();
    const run: LdkitBenchmarkRun = {
      $id: runId,
      '@type': 'BenchmarkRun',
      structure: BENCHMARK_OBSERVATION_DSD_IRI,
      definedBy: versionId,
      runStatus: 'Running',
      tasksTotal: orderedTasks.length,
      tasksCompleted: 0,
      startedAt: nowIso,
      dateCreated: nowIso,
      dateModified: nowIso,
    };
    await BenchmarkRuns.insert({ ...run } as unknown as Parameters<typeof BenchmarkRuns.insert>[0]);

    let nodeRun: { $id: string; endedAt?: string | null } | null = null;
    let iterationRun: { $id: string; endedAt?: string | null } | null = null;
    const observations: LdkitBenchmarkObservation[] = [];
    const nodeObservations: LdkitBenchmarkNodeObservation[] = [];
    const iterationObservations: LdkitBenchmarkIterationObservation[] = [];
    const warmupRuns = Math.max(0, version.warmupRuns ?? 0);
    const warmupTracker = new Map<string, Promise<void>>();

    const abortSignal = { aborted: false };
    const strategy = version.executionStrategy ?? DEFAULT_BENCHMARK_EXECUTION_STRATEGY;
    const timeWindowMs = parseDurationToMs(version.timeWindow ?? null);
    const scheduleStart = Date.now();

    const executeOnce = async (task: BenchmarkTask, index: number): Promise<BenchmarkTaskOutcome> => {
      if (abortSignal.aborted) {
        return {
          success: false,
          resultCount: 0,
          durationMs: 0,
          nodeObservationDrafts: [],
          iterationObservationDrafts: [],
        };
      }

      if (strategy === 'Spread' && timeWindowMs && orderedTasks.length > 1) {
        const scheduledOffset = Math.floor((timeWindowMs * index) / (orderedTasks.length - 1));
        const targetStart = scheduleStart + scheduledOffset;
        const delay = targetStart - Date.now();
        if (delay > 0) {
          await sleep(delay);
        }
      }

      const subjectStart = performance.now();
      let resultCount = 0;
      const nodeObservationDrafts: LdkitBenchmarkNodeObservation[] = [];
      let iterationObservationDrafts: LdkitBenchmarkIterationObservation[] = [];

      try {
        if (task.subjectType === 'QueryVersion') {
          const result = await this.executeQueryVersion(task.subjectId, task.backendId, executionArgumentId(task));
          resultCount = countResults(result);
        } else if (task.subjectType === 'RuleSetVersion') {
          const { result, iterations } = await this.executeRuleSetVersion(task, version.timeoutMs);
          resultCount = countResults(result);
          if (iterations.length) {
            /*
             * Created on the first pass there is to record, not on the first
             * rule-set task: a plan whose rule sets all fail records no passes,
             * and an empty dataset is a `qb:DataSet` claiming observations it
             * has none of.
             *
             * Assigned before the insert is awaited, so a second rule-set task
             * running concurrently sees the dataset rather than minting a rival
             * one — the same order `nodeRun` is written in below.
             */
            if (!iterationRun) {
              const createdIterationRun: LdkitBenchmarkIterationRun = {
                $id: mintId('benchmarkIterationRun'),
                '@type': 'BenchmarkIterationRun',
                structure: BENCHMARK_ITERATION_OBSERVATION_DSD_IRI,
                definedBy: versionId,
                isPartOf: runId,
                startedAt: new Date().toISOString(),
                dateCreated: new Date().toISOString(),
              };
              iterationRun = createdIterationRun;
              await BenchmarkIterationRuns.insert(createdIterationRun as unknown as Parameters<typeof BenchmarkIterationRuns.insert>[0]);
            }
            iterationObservationDrafts = buildIterationObservationDrafts(iterationRun.$id, task.runIndex, iterations);
          }
        } else {
          if (!nodeRun) {
            const createdNodeRun: LdkitBenchmarkNodeRun = {
              $id: mintId('benchmarkNodeRun'),
              '@type': 'BenchmarkNodeRun',
              structure: BENCHMARK_NODE_OBSERVATION_DSD_IRI,
              definedBy: versionId,
              isPartOf: runId,
              startedAt: new Date().toISOString(),
              dateCreated: new Date().toISOString(),
            };
            nodeRun = createdNodeRun;
            await BenchmarkNodeRuns.insert(createdNodeRun as unknown as Parameters<typeof BenchmarkNodeRuns.insert>[0]);
          }

          const hooks = this.buildNodeHooks(nodeRun.$id, task.runIndex, nodeObservationDrafts);
          const result = await this.executeQueryGroupVersion(task.subjectId, executionArgumentId(task), hooks);
          resultCount = countResults(result);
        }
        return { success: true, resultCount, durationMs: performance.now() - subjectStart, nodeObservationDrafts, iterationObservationDrafts };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorType = error instanceof Error ? error.name : 'Error';
        return {
          success: false,
          resultCount: 0,
          durationMs: performance.now() - subjectStart,
          errorMessage,
          errorType,
          nodeObservationDrafts,
          iterationObservationDrafts,
        };
      }
    };

    const executeWarmup = async (task: BenchmarkTask) => {
      if (task.subjectType === 'QueryVersion') {
        await this.executeQueryVersion(task.subjectId, task.backendId, executionArgumentId(task));
        return;
      }
      if (task.subjectType === 'RuleSetVersion') {
        await this.executeRuleSetVersion(task, version.timeoutMs);
        return;
      }
      const noopHooks: ExecutionHooks = {
        onNodeFinish: () => {},
        onNodeError: () => {},
      };
      await this.executeQueryGroupVersion(task.subjectId, executionArgumentId(task), noopHooks);
    };

    const ensureWarmup = async (task: BenchmarkTask) => {
      if (!warmupRuns) return;
      const key = `${task.subjectId}::${task.backendId}::${task.argumentSetId}::${task.dataGraphId ?? ''}`;
      const existing = warmupTracker.get(key);
      if (existing) {
        await existing;
        return;
      }
      const warmupPromise = (async () => {
        for (let i = 0; i < warmupRuns; i += 1) {
          await executeWarmup(task);
        }
      })();
      warmupTracker.set(
        key,
        warmupPromise.catch((error) => {
          warmupTracker.delete(key);
          throw error;
        }),
      );
      await warmupTracker.get(key);
    };

    let tasksCompleted = 0;
    let hasFailures = false;

    await runWithConcurrency(orderedTasks, version.maxConcurrency ?? 1, async (task, index) => {
      if (abortSignal.aborted) return;
      const outcome = await this.runWithRetries(task, index, version.retryCount, version.retryDelayMs, version.timeoutMs, async (runTask, runIndex) => {
        await ensureWarmup(runTask);
        return executeOnce(runTask, runIndex);
      });
      const subjectObservationId = mintId('benchmarkObservation');
      const observation: LdkitBenchmarkObservation = {
        $id: subjectObservationId,
        '@type': 'BenchmarkObservation',
        dataSet: runId,
        subject: task.subjectId,
        backend: task.backendId,
        argumentSet: task.argumentSetId,
        // Left off entirely rather than written as null: this one is an IRI, and
        // the sentinel case genuinely has no version to name.
        argumentSetVersion: task.argumentSetVersionId ?? undefined,
        // Both left off entirely rather than written as null, for the reason
        // above: they are IRIs, and only a rule-set request has a graph axis.
        dataGraph: task.dataGraphId ?? undefined,
        dataGraphVersion: task.dataGraphVersionId ?? undefined,
        runIndex: task.runIndex,
        durationMs: outcome.durationMs,
        resultCount: outcome.resultCount,
        success: outcome.success,
        errorMessage: outcome.errorMessage ?? null,
        errorType: outcome.errorType ?? null,
        timestamp: new Date().toISOString(),
      };
      observations.push(observation);
      await BenchmarkObservations.insert(observation as unknown as Parameters<typeof BenchmarkObservations.insert>[0]);

      for (const nodeObservation of outcome.nodeObservationDrafts ?? []) {
        const finalized: LdkitBenchmarkNodeObservation = {
          ...nodeObservation,
          groupObservation: subjectObservationId,
        };
        nodeObservations.push(finalized);
        await BenchmarkNodeObservations.insert(finalized as unknown as Parameters<typeof BenchmarkNodeObservations.insert>[0]);
      }

      for (const iterationObservation of outcome.iterationObservationDrafts ?? []) {
        const finalized: LdkitBenchmarkIterationObservation = {
          ...iterationObservation,
          subjectObservation: subjectObservationId,
        };
        iterationObservations.push(finalized);
        await BenchmarkIterationObservations.insert(finalized as unknown as Parameters<typeof BenchmarkIterationObservations.insert>[0]);
      }

      tasksCompleted += 1;
      if (!outcome.success) {
        hasFailures = true;
      }
      await updateBenchmarkRun(runId, {
        tasksCompleted,
        dateModified: new Date().toISOString(),
      });

      if (!outcome.success && version.abortOnError) {
        abortSignal.aborted = true;
      }

      if (version.cooldownMs) {
        await sleep(version.cooldownMs);
      }
    }, abortSignal);

    const endedAt = new Date().toISOString();
    const finalStatus = hasFailures ? 'Failed' : 'Completed';
    await updateBenchmarkRun(runId, {
      endedAt,
      runStatus: finalStatus,
      tasksCompleted,
      dateModified: endedAt,
    });
    run.endedAt = endedAt;
    run.runStatus = finalStatus;
    run.tasksCompleted = tasksCompleted;
    run.dateModified = endedAt;

    const finalizedNodeRun = nodeRun as LdkitBenchmarkNodeRun | null;
    if (finalizedNodeRun) {
      await updateBenchmarkNodeRun(finalizedNodeRun.$id, { endedAt });
      finalizedNodeRun.endedAt = endedAt;
    }

    const finalizedIterationRun = iterationRun as LdkitBenchmarkIterationRun | null;
    if (finalizedIterationRun) {
      await updateBenchmarkIterationRun(finalizedIterationRun.$id, { endedAt });
      finalizedIterationRun.endedAt = endedAt;
    }

    return {
      run,
      nodeRun: finalizedNodeRun,
      iterationRun: finalizedIterationRun,
      observations,
      nodeObservations,
      iterationObservations,
    };
  }

  private buildTasks(subjectSpecs: BenchmarkSubjectSpec[], repeats: number): BenchmarkTask[] {
    const tasks: BenchmarkTask[] = [];
    const runs = Math.max(1, repeats || DEFAULT_BENCHMARK_REPEATS);

    /*
     * One resolution per distinct argument reference, for the whole run.
     *
     * The memo is the guarantee, not an optimisation: every task naming a set
     * must be pinned to the same version, or a publish landing between two
     * repeats would make one run execute two different sets of values while
     * the observations claim one (issue #246).
     */
    const pinned = new Map<string, string | null>();
    // Keyed by axis as well as id: the same memo now serves three kinds of
    // reference, and an id means whatever the axis it sits on says it means.
    const pin = (axis: string, input: string, resolve: (id: string) => string): string | null => {
      const key = `${axis}::${input}`;
      if (!pinned.has(key)) {
        pinned.set(key, input === BENCHMARK_NO_ARGUMENTS_IRI ? null : resolve(input));
      }
      return pinned.get(key) ?? null;
    };
    const pinArgumentSet = (input: string) => pin('argumentSet', input, id => this.argumentSetService.resolveVersionIdForId(id));
    const pinTupleSet = (input: string) => pin('tupleSet', input, id => resolveCurrentVersionId(id, 'TupleSet', 'TupleSetVersion'));
    const pinDataGraph = (input: string) => pin('dataGraph', input, id => resolveCurrentVersionId(id, 'DataGraph', 'DataGraphVersion'));

    for (const spec of subjectSpecs) {
      if (!spec?.subject) continue;
      const subjectEntity = getCacheCoordinator().get(spec.subject);
      if (!subjectEntity) {
        throw new Error(`Benchmark subject ${spec.subject} not found`);
      }
      const subjectType = subjectEntity['@type'];
      if (subjectType !== 'QueryVersion' && subjectType !== 'QueryGroupVersion' && subjectType !== 'RuleSetVersion') {
        throw new Error(`Unsupported benchmark subject type ${subjectType} for ${spec.subject}`);
      }

      const inputs = (spec.inputs && spec.inputs.length > 0)
        ? spec.inputs
        : [BENCHMARK_NO_ARGUMENTS_IRI];

      const backends = subjectType === 'QueryVersion'
        ? (spec.backends && spec.backends.length > 0 ? spec.backends : [])
        : [BENCHMARK_NOT_APPLICABLE_BACKEND_IRI];

      if (subjectType === 'QueryVersion' && backends.length === 0) {
        throw new Error(`Benchmark subject ${spec.subject} requires at least one backend`);
      }

      /*
       * The graph axis multiplies alongside the tabular one rather than pairing
       * with it: three graphs and two seed sets is six runs. A rule set with no
       * graph named runs against an empty base graph — the null member — which
       * is what a rule set whose DATA blocks are its whole input wants.
       */
      const dataGraphs = subjectType === 'RuleSetVersion'
        ? ((spec.dataGraphs && spec.dataGraphs.length > 0) ? spec.dataGraphs : [null])
        : [null];

      for (const backend of backends) {
        for (const dataGraph of dataGraphs) {
          for (const input of inputs) {
            const argumentSetVersionId = subjectType === 'RuleSetVersion' ? pinTupleSet(input) : pinArgumentSet(input);
            const dataGraphVersionId = dataGraph ? pinDataGraph(dataGraph) : null;
            for (let i = 1; i <= runs; i += 1) {
              tasks.push({
                subjectId: spec.subject,
                subjectType,
                backendId: subjectType === 'QueryVersion' ? backend : BENCHMARK_NOT_APPLICABLE_BACKEND_IRI,
                argumentSetId: input,
                argumentSetVersionId,
                dataGraphId: dataGraph,
                dataGraphVersionId,
                runIndex: i,
              });
            }
          }
        }
      }
    }

    return tasks;
  }

  private buildNodeHooks(nodeRunId: string, runIndex: number, sink: LdkitBenchmarkNodeObservation[]): ExecutionHooks {
    return {
      onNodeFinish: (node, result, durationMs, orderIndex) => {
        sink.push({
          $id: mintId('benchmarkNodeObservation'),
          '@type': 'BenchmarkNodeObservation',
          dataSet: nodeRunId,
          groupObservation: '',
          node: node.id,
          backend: node.backendId ?? BENCHMARK_NOT_APPLICABLE_BACKEND_IRI,
          runIndex,
          nodeIndex: orderIndex + 1,
          durationMs,
          resultCount: countResults(result),
          success: true,
          timestamp: new Date().toISOString(),
        });
      },
      onNodeError: (node, error, durationMs, orderIndex) => {
        sink.push({
          $id: mintId('benchmarkNodeObservation'),
          '@type': 'BenchmarkNodeObservation',
          dataSet: nodeRunId,
          groupObservation: '',
          node: node.id,
          backend: node.backendId ?? BENCHMARK_NOT_APPLICABLE_BACKEND_IRI,
          runIndex,
          nodeIndex: orderIndex + 1,
          durationMs,
          resultCount: 0,
          success: false,
          errorMessage: error.message,
          errorType: error.name,
          timestamp: new Date().toISOString(),
        });
      },
    };
  }

  private async runWithRetries(
    task: BenchmarkTask,
    index: number,
    retryCount: number | null | undefined,
    retryDelayMs: number | null | undefined,
    timeoutMs: number | null | undefined,
    handler: (task: BenchmarkTask, index: number) => Promise<BenchmarkTaskOutcome>
  ): Promise<BenchmarkTaskOutcome> {
    const attempts = Math.max(0, retryCount ?? 0) + 1;
    let lastError: Error | null = null;
    let lastOutcome: BenchmarkTaskOutcome | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        if (timeoutMs && timeoutMs > 0) {
          lastOutcome = await Promise.race([
            handler(task, index),
            new Promise<Awaited<ReturnType<typeof handler>>>((_, reject) =>
              setTimeout(() => reject(new Error('Benchmark task timed out')), timeoutMs),
            ),
          ]);
        } else {
          lastOutcome = await handler(task, index);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        lastOutcome = null;
      }

      if (lastOutcome && lastOutcome.success) {
        return lastOutcome;
      }

      if (attempt < attempts && retryDelayMs && retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }

    if (!lastOutcome && lastError) {
      return {
        success: false,
        resultCount: 0,
        durationMs: 0,
        errorMessage: lastError.message,
        errorType: lastError.name,
        nodeObservationDrafts: [],
        iterationObservationDrafts: [],
      };
    }
    if (!lastOutcome) {
      return { success: false, resultCount: 0, durationMs: 0, nodeObservationDrafts: [], iterationObservationDrafts: [] };
    }
    return lastOutcome;
  }

  private async executeQueryVersion(subjectId: string, backendId: string, argumentSetId: string): Promise<NodeResult> {
    const versionEntity = getCacheCoordinator().get(subjectId) as LdkitQueryVersion | null;
    if (!versionEntity || versionEntity['@type'] !== 'QueryVersion') {
      throw new Error(`QueryVersion ${subjectId} not found`);
    }

    let queryString = versionEntity.queryString;
    if (argumentSetId !== BENCHMARK_NO_ARGUMENTS_IRI) {
      const runtimePayload = await this.argumentSetService.exportRuntimePayload([argumentSetId]);
      if (runtimePayload.limits.length > 0 || runtimePayload.offsets.length > 0) {
        queryString = this.parser.applyLimitOffsetParameters(queryString, runtimePayload.limits, runtimePayload.offsets);
      }
      if (runtimePayload.tupleList.length > 0) {
        queryString = this.parser.applyArguments(queryString, runtimePayload.tupleList);
      }
    }

    const queryType = toQueryTypeIri(versionEntity.queryType) || QueryTypeIri.select;
    const executor = await this.resolveExecutorForBackend(backendId);

    if (queryType === QueryTypeIri.ask) {
      const { result } = await executor.askQuery(queryString);
      return result;
    }
    if (queryType === QueryTypeIri.update) {
      await executor.update(queryString);
      return { success: true };
    }
    if (queryType === QueryTypeIri.construct || queryType === QueryTypeIri.describe) {
      const { result } = await executor.constructQueryParsed(queryString);
      return result;
    }
    const { result } = await executor.selectQueryParsed(queryString);
    return result;
  }

  /**
   * One rule-set request: a single run to fixpoint.
   *
   * The two axes reach the executor through the seams that already exist for
   * them — the base graph as `initialGraph`, the tuple set as `tupleSeeds`
   * (`lib/tupleSeedInput.ts`) — so nothing about what a rule-set version stores
   * changes to be benchmarked.
   *
   * What comes back is the inference graph as N-Quads, which `countResults`
   * counts by line: the triples the run produced, the honest analogue of a
   * query's row count. The executor's per-iteration records come back beside
   * it — the second-level table the subject-level row does not replace.
   *
   * A failed run contributes no passes, because the throw below happens first:
   * whatever ran before the failing rule measured a run that did not finish,
   * and a timing table is only meaningful over runs that did.
   */
  private async executeRuleSetVersion(
    task: BenchmarkTask,
    timeoutMs?: number | null,
  ): Promise<{ result: NodeResult; iterations: IterationRecord[] }> {
    const versionEntity = getCacheCoordinator().get(task.subjectId) as LdkitRuleSetVersion | null;
    if (!versionEntity || versionEntity['@type'] !== 'RuleSetVersion') {
      throw new Error(`RuleSetVersion ${task.subjectId} not found`);
    }

    const dataGraph = task.dataGraphVersionId ? readDataGraphVersion(task.dataGraphVersionId) : null;
    const tupleSeeds = task.argumentSetVersionId
      ? resolveTupleSeedInput({ tupleSetVersionId: task.argumentSetVersionId })
      : null;

    const executed = await this.ruleSetExecutorFactory().execute(
      // The axis member overrides the version's stored seeds for this run, the
      // same override a test case makes.
      tupleSeeds ? { ...versionEntity, tupleSeeds } : versionEntity,
      {
        initialGraph: dataGraph?.content ?? null,
        initialGraphFormat: dataGraph?.format ?? null,
        /*
         * The version's task timeout, handed to the executor as well as raced
         * against by `runWithRetries`. The race abandons a slow task but cannot
         * stop it: a fixpoint loop left running would go on burning the box the
         * rest of the benchmark is being measured on.
         */
        timeoutMs: timeoutMs ?? undefined,
      },
    );

    if (executed.status === 'failed') {
      // The executor's own sentence rather than a restatement of the status:
      // "RuleSet contains invalid RuleVersions: …" names what went wrong, where
      // "execution failed" only repeats that the observation is red.
      throw new Error(executed.error ?? 'Rule set execution failed');
    }
    return { result: executed.finalGraphNQuads ?? '', iterations: executed.iterations ?? [] };
  }

  private async executeQueryGroupVersion(subjectId: string, argumentSetId: string, hooks: ExecutionHooks): Promise<NodeResult> {
    const versionEntity = getCacheCoordinator().get(subjectId) as LdkitQueryGroupVersion | null;
    if (!versionEntity || versionEntity['@type'] !== 'QueryGroupVersion') {
      throw new Error(`QueryGroupVersion ${subjectId} not found`);
    }

    const initialArgs = argumentSetId === BENCHMARK_NO_ARGUMENTS_IRI
      ? []
      : (await this.argumentSetService.exportRuntimePayload([argumentSetId])).tupleList;

    const graph = this.graphBuilder.buildFromGroupVersion(versionEntity);
    const engine = new ExecutionEngine();
    const { result } = await engine.execute(graph, initialArgs, hooks);
    return result;
  }

  private async resolveExecutorForBackend(backendId: string) {
    if (backendId === LIBRARY_STORAGE_BACKEND_ID) {
      const fakeNode = this.buildBackendNode(backendId);
      return this.executorFactory.getExecutorForNode(fakeNode);
    }

    if (backendId === EPHEMERAL_BACKEND_ID) {
      const storeId = `benchmark-ephemeral-${crypto.randomUUID()}`;
      const store = oxigraphStoreManager.createEphemeralStore(storeId);
      return new OxigraphSparqlExecutor(store);
    }

    const fakeNode = this.buildBackendNode(backendId);
    return this.executorFactory.getExecutorForNode(fakeNode);
  }

  private buildBackendNode(backendId: string): ResolvedNode {
    return {
      id: `benchmark-backend:${backendId}`,
      raw: {},
      backendId,
      queryVersionId: undefined,
      queryVersion: undefined,
      queryString: undefined,
      queryType: undefined,
      inputTupleIds: [],
      outputTupleIds: [],
    };
  }
}
