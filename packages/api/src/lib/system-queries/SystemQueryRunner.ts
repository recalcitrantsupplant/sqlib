import type { Dispatcher } from 'undici';
import { SparqlQueryParser } from '../parser.js';
import { getCacheCoordinator } from '../CacheCoordinatorProvider.js';
import type { LdkitQuery } from '../../persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../../persistence/schemas/QueryVersionSchema.js';
import { ExecutorFactory } from '../orchestration/ExecutorFactory.js';
import { SystemQueryCatalog, type SystemQueryKey } from './SystemQueryCatalog.js';
import { isGraphQueryType, isResultSetQueryType } from '../queryTypes.js';
import { QueryTypeIri } from '../../constants/queryTypes.js';
import type { ArgumentSet } from '../query-chaining.js';
import type { QueryTypeValue } from '../../constants/queryTypes.js';
import { LIBRARY_STORAGE_BACKEND_ID, type SparqlBindingValue } from '@sparql-query-lib/types';
import type { ResolvedNode } from '../orchestration/types.js';

type BindingRow = Record<string, SparqlBindingValue>;

export interface ParameterBindingSet {
  vars: string[];
  bindings: BindingRow[];
}

export interface SystemQueryRunnerOptions {
  acceptHeader?: string;
  parameterBindings?: ParameterBindingSet[];
  argumentSets?: ArgumentSet[];
  limitParameters?: Array<{ name: string; value: number }>;
  offsetParameters?: Array<{ name: string; value: number }>;
}

export interface SystemQueryRunnerResult {
  mode: 'stream' | 'parsed';
  stream?: Dispatcher.ResponseData;
  result?: unknown;
  contentType?: string;
  queryType?: QueryTypeValue | null;
}

export class SystemQueryRunner {
  private readonly parser = new SparqlQueryParser();
  private readonly executorFactory = new ExecutorFactory();

  async execute(key: SystemQueryKey, options: SystemQueryRunnerOptions = {}): Promise<SystemQueryRunnerResult> {
    const definition = SystemQueryCatalog.getDefinition(key);
    const queryEntity = getCacheCoordinator().get(definition.queryId) as LdkitQuery | null;
    if (!queryEntity) {
      throw new Error(`System query not loaded in cache: ${definition.queryId}`);
    }
    const versionId = queryEntity.currentVersion || definition.versionId;
    if (!versionId) {
      throw new Error(`System query ${definition.queryId} does not have a current version.`);
    }
    const versionEntity = getCacheCoordinator().get(versionId) as LdkitQueryVersion | null;
    if (!versionEntity) {
      throw new Error(`System query version not found for ${versionId}`);
    }

    let queryString = versionEntity.queryString;
    const argumentSets: ArgumentSet[] = [];

    if (options.parameterBindings?.length) {
      for (const binding of options.parameterBindings) {
        if (!binding.vars || binding.vars.length === 0) {
          throw new Error(`Invalid parameter binding declaration for system query ${definition.queryId}`);
        }
        argumentSets.push({
          head: { vars: binding.vars },
          arguments: { bindings: binding.bindings as unknown as ArgumentSet['arguments']['bindings'] },
        });
      }
    }

    if (options.argumentSets?.length) {
      argumentSets.push(...options.argumentSets);
    }

    if (argumentSets.length > 0) {
      queryString = this.parser.applyArguments(queryString, argumentSets);
    }

    if ((options.limitParameters?.length) || (options.offsetParameters?.length)) {
      queryString = this.parser.applyLimitOffsetParameters(
        queryString,
        options.limitParameters ?? [],
        options.offsetParameters ?? [],
      );
    }

    const resolvedNode: ResolvedNode = {
      id: `system-query:${key}`,
      raw: {},
      backendId: LIBRARY_STORAGE_BACKEND_ID,
      queryVersionId: versionId,
      queryVersion: versionEntity,
      queryString,
      queryType: versionEntity.queryType,
      inputTupleIds: [],
      outputTupleIds: [],
    };

    const executor = await this.executorFactory.getExecutorForNode(resolvedNode);
    const queryType = versionEntity.queryType || null;

    if (queryType && isGraphQueryType(queryType)) {
      const stream = await executor.constructQueryStream(queryString, {
        acceptHeader: options.acceptHeader,
      });
      const resolvedContentType = stream.headers?.['content-type']?.toString();
      return {
        mode: 'stream',
        stream,
        contentType: resolvedContentType || options.acceptHeader,
        queryType,
      };
    }

    if (queryType === QueryTypeIri.ask) {
      const { result, contentType } = await executor.askQuery(queryString, {
        acceptHeader: options.acceptHeader,
      });
      return { mode: 'parsed', result, contentType, queryType };
    }

    if (queryType && isResultSetQueryType(queryType)) {
      const { result, contentType } = await executor.selectQueryParsed(queryString, {
        acceptHeader: options.acceptHeader,
      });
      return { mode: 'parsed', result, contentType, queryType };
    }

    throw new Error(`Unsupported system query type for ${definition.queryId}: ${queryType ?? 'unknown'}`);
  }
}
