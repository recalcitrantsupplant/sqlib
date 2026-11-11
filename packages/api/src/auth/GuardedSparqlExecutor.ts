/**
 * An executor that runs for one caller on one backend.
 *
 * Every caller's executor is wrapped in this, by `ExecutorFactory` and by
 * `/sparql`, so the two checks below happen at the one place every query and
 * update passes, rather than in each route:
 *
 * 1. **The backend mode for the operation.** A read needs `query`, an update
 *    needs `update`, at the `saved` or `adhoc` level the scope says. The
 *    operation is known only when a method is called: a query group or an ETL
 *    job may read through the same executor it later writes through.
 * 2. **The backend's graph policy, on reads.** The policy dataset is
 *    intersected with the dataset the call asked for, so a read sees only the
 *    graphs the policy allows (`graphPolicy.ts`). The `WHERE` clause of an
 *    update is a read too, and is narrowed the same way, through the update's
 *    dataset (`lib/updateDataset.ts`). The policy does not limit the graphs
 *    an update writes to.
 *
 * Streams get the same treatment as parsed reads.
 */
import type { Dispatcher } from 'undici';
import type { FastifyRequest } from 'fastify';
import type {
  ISparqlExecutor,
  SparqlExecutionResult,
  SparqlQueryOptions,
  SparqlSelectJsonOutput,
  SparqlDataset,
  SparqlUpdateOptions,
} from '../server/ISparqlExecutor.js';
import { intersectDatasets } from '../lib/dataset.js';
import { updateDatasetShape } from '../lib/updateDataset.js';
import { auditDecision } from './audit.js';
import { authOf, requireBackendMode } from './enforce.js';
import { GraphPolicyError, clearGraphPolicyCache, graphPolicyDataset, isAuthBackend, mentionsService } from './graphPolicy.js';
import { backendModeFor, isEnforcingMode, type QueryTextSource } from './types.js';

export const SERVICE_UNDER_POLICY_WARNING =
  'This query uses SERVICE. The graph policy on this backend does not apply inside a SERVICE pattern.';

/**
 * Refused: a graph policy applies to the caller, and the update names the
 * graphs its `WHERE` clause reads with `USING` or `WITH`. The protocol does not
 * let a dataset be given with those clauses, so the policy cannot narrow it.
 */
export class GraphPolicyUpdateError extends Error {
  readonly statusCode = 403;

  constructor(readonly backendId: string) {
    super(
      `A graph policy limits what you can read on backend ${backendId}, and this update names its graphs `
      + 'with USING, USING NAMED or WITH. Remove those clauses and give the graphs as defaultGraphs and namedGraphs.',
    );
    this.name = 'GraphPolicyUpdateError';
  }
}

export interface ExecutorGuard {
  request: FastifyRequest;
  backendId: string;
  /** `adhoc` for text the caller wrote; `saved` (the default) for saved text. */
  source?: QueryTextSource;
  /** The route already checked the mode for this exact operation. */
  modeChecked?: boolean;
  /** Called with a warning the caller should see, such as SERVICE under a policy. */
  onWarning?: (message: string) => void;
}

export class GuardedSparqlExecutor implements ISparqlExecutor {
  constructor(
    private readonly inner: ISparqlExecutor,
    private readonly guard: ExecutorGuard,
  ) {}

  /** The executor being guarded. */
  get delegate(): ISparqlExecutor {
    return this.inner;
  }

  private checkMode(operation: 'query' | 'update'): void {
    if (this.guard.modeChecked) return;
    requireBackendMode(this.guard.request, this.guard.backendId, backendModeFor(operation, this.guard.source ?? 'saved'));
  }

  /** The options a read runs with: the mode checked, and the dataset narrowed. */
  private async readOptions(query: string, options?: SparqlQueryOptions): Promise<SparqlQueryOptions | undefined> {
    this.checkMode('query');
    const narrowed = await this.policyDataset(query, options?.dataset);
    return narrowed === undefined ? options : { ...options, dataset: narrowed };
  }

  /**
   * The dataset a read runs over under the caller's graph policy, or
   * `undefined` when no policy narrows it and the asked-for dataset stands.
   */
  private async policyDataset(query: string, dataset: SparqlDataset | undefined): Promise<SparqlDataset | undefined> {
    const { request, backendId } = this.guard;
    const context = authOf(request);
    // Server identity and administrators are not policed, as grants do not
    // bind them. `Test as` shows an administrator what a caller would see.
    if (context.fullAccess || context.grants.admin) return undefined;

    let policy;
    try {
      policy = await graphPolicyDataset(backendId, context);
    } catch (error) {
      request.log?.warn({ err: error instanceof GraphPolicyError ? error.cause : error, backendId }, 'Graph policy failed');
      if (!isEnforcingMode(context.mode)) {
        auditDecision(request, context, {
          decision: 'would-deny',
          resource: backendId,
          resourceKind: 'backend',
          mode: 'graph-policy',
          matchedGrant: null,
          detail: 'The graph policy could not be evaluated.',
        });
        return undefined;
      }
      throw error instanceof GraphPolicyError ? error : new GraphPolicyError(backendId, error);
    }
    if (!policy) return undefined;

    if (mentionsService(query)) this.guard.onWarning?.(SERVICE_UNDER_POLICY_WARNING);

    if (!isEnforcingMode(context.mode)) {
      // dry-run: say what the policy would have allowed, and run unnarrowed.
      auditDecision(request, context, {
        decision: 'would-deny',
        resource: backendId,
        resourceKind: 'backend',
        mode: 'graph-policy',
        matchedGrant: null,
        detail: `A graph policy would narrow this read to ${policy.defaultGraphs.length} default and ${policy.namedGraphs.length} named graphs.`,
      });
      return undefined;
    }

    return intersectDatasets(policy, dataset);
  }

  async selectQueryParsed(
    sparqlQuery: string,
    options?: SparqlQueryOptions,
  ): Promise<SparqlExecutionResult<SparqlSelectJsonOutput | string>> {
    return this.inner.selectQueryParsed(sparqlQuery, await this.readOptions(sparqlQuery, options));
  }

  async constructQueryParsed(sparqlQuery: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<string>> {
    return this.inner.constructQueryParsed(sparqlQuery, await this.readOptions(sparqlQuery, options));
  }

  async selectQueryStream(sparqlQuery: string, options?: SparqlQueryOptions): Promise<Dispatcher.ResponseData> {
    return this.inner.selectQueryStream(sparqlQuery, await this.readOptions(sparqlQuery, options));
  }

  async constructQueryStream(sparqlQuery: string, options?: SparqlQueryOptions): Promise<Dispatcher.ResponseData> {
    return this.inner.constructQueryStream(sparqlQuery, await this.readOptions(sparqlQuery, options));
  }

  async askQuery(sparqlAskQuery: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<boolean | string>> {
    return this.inner.askQuery(sparqlAskQuery, await this.readOptions(sparqlAskQuery, options));
  }

  async update(sparqlUpdateQuery: string, options?: SparqlUpdateOptions): Promise<SparqlExecutionResult<void>> {
    this.checkMode('update');
    // Only an update with a WHERE clause reads, so only it is narrowed: a
    // dataset on INSERT DATA or a graph-management operation means nothing.
    const shape = updateDatasetShape(sparqlUpdateQuery);
    const narrowed = shape?.reads ? await this.policyDataset(sparqlUpdateQuery, options?.dataset) : undefined;
    if (narrowed !== undefined && shape?.namesDataset) throw new GraphPolicyUpdateError(this.guard.backendId);
    const result = await this.inner.update(
      sparqlUpdateQuery,
      narrowed === undefined ? options : { ...options, dataset: narrowed },
    );
    // An update to an auth backend may change what a policy answers. When
    // that cannot be told, clearing costs only a policy run.
    let touchesPolicyData = true;
    try {
      touchesPolicyData = isAuthBackend(this.guard.backendId);
    } catch {
      // Left true.
    }
    if (touchesPolicyData) clearGraphPolicyCache();
    return result;
  }
}
