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
 *    graphs the policy allows (`graphPolicy.ts`).
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
} from '../server/ISparqlExecutor.js';
import { intersectDatasets } from '../lib/dataset.js';
import { auditDecision } from './audit.js';
import { authOf, requireBackendMode } from './enforce.js';
import { GraphPolicyError, clearGraphPolicyCache, graphPolicyDataset, isAuthBackend, mentionsService } from './graphPolicy.js';
import { backendModeFor, type QueryTextSource } from './types.js';

export const SERVICE_UNDER_POLICY_WARNING =
  'This query uses SERVICE. The graph policy on this backend does not apply inside a SERVICE pattern.';

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

    const { request, backendId } = this.guard;
    const context = authOf(request);
    // Server identity and administrators are not policed, as grants do not
    // bind them. `Test as` shows an administrator what a caller would see.
    if (context.fullAccess || context.grants.admin) return options;

    let policy;
    try {
      policy = await graphPolicyDataset(backendId, context);
    } catch (error) {
      request.log?.warn({ err: error instanceof GraphPolicyError ? error.cause : error, backendId }, 'Graph policy failed');
      if (context.mode !== 'required') {
        auditDecision(request, context, {
          decision: 'would-deny',
          resource: backendId,
          resourceKind: 'backend',
          mode: 'graph-policy',
          matchedGrant: null,
          detail: 'The graph policy could not be evaluated.',
        });
        return options;
      }
      throw error instanceof GraphPolicyError ? error : new GraphPolicyError(backendId, error);
    }
    if (!policy) return options;

    if (mentionsService(query)) this.guard.onWarning?.(SERVICE_UNDER_POLICY_WARNING);

    if (context.mode !== 'required') {
      // dry-run: say what the policy would have allowed, and run unnarrowed.
      auditDecision(request, context, {
        decision: 'would-deny',
        resource: backendId,
        resourceKind: 'backend',
        mode: 'graph-policy',
        matchedGrant: null,
        detail: `A graph policy would narrow this read to ${policy.defaultGraphs.length} default and ${policy.namedGraphs.length} named graphs.`,
      });
      return options;
    }

    return { ...options, dataset: intersectDatasets(policy, options?.dataset) };
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

  async update(sparqlUpdateQuery: string): Promise<SparqlExecutionResult<void>> {
    this.checkMode('update');
    const result = await this.inner.update(sparqlUpdateQuery);
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
