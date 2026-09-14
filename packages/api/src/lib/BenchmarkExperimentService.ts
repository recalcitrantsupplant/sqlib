import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { mintId } from './id.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitBenchmarkExperiment } from '../persistence/schemas/BenchmarkExperimentSchema.js';
import type { LdkitBenchmarkExperimentVersion } from '../persistence/schemas/BenchmarkExperimentVersionSchema.js';
import type { LdkitArgumentSet } from '../persistence/schemas/ArgumentSetSchema.js';
import type { LdkitArgumentSetVersion } from '../persistence/schemas/ArgumentSetVersionSchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import { BENCHMARK_NO_ARGUMENTS_IRI, BENCHMARK_NOT_APPLICABLE_BACKEND_IRI } from '../constants/benchmarks.js';
import { EPHEMERAL_BACKEND_ID, LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';

export type BenchmarkSubjectSpec = {
  subject: string;
  /**
   * The tabular input axis: argument sets for a query or query group, tuple
   * sets for a rule set.
   *
   * One axis rather than two fields, because it is one concept — a named,
   * versioned library object supplying a run's rows. The subject kind decides
   * which entity type is legal here, and `assertBenchmarkVersionDependencies`
   * refuses the other.
   */
  inputs?: string[];
  backends?: string[];
  /**
   * The graph axis: the base graph a rule set runs over, as `DataGraph` or
   * `DataGraphVersion` references.
   *
   * Rule-set subjects only. A data graph on a query subject would be a hermetic
   * *test* input, which is a different question from the one a benchmark asks,
   * so it is refused rather than ignored (§2 of the same doc).
   */
  dataGraphs?: string[];
};

export type BenchmarkExperimentPayload = {
  id?: string;
  name: string;
  description?: string | null;
  status?: string | null;
};

export type BenchmarkExperimentVersionPayload = {
  subjectSpecs: BenchmarkSubjectSpec[];
  repeats?: number | null;
  executionStrategy?: string | null;
  timeWindow?: string | null;
  maxConcurrency?: number | null;
  warmupRuns?: number | null;
  cooldownMs?: number | null;
  timeoutMs?: number | null;
  retryCount?: number | null;
  retryDelayMs?: number | null;
  randomizeOrder?: boolean | null;
  abortOnError?: boolean | null;
  immutable?: boolean | null;
};

export type BenchmarkExperimentDetail = {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  currentVersion?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
};

export type BenchmarkExperimentVersionDetail = {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  subjectSpecs: BenchmarkSubjectSpec[];
  repeats?: number | null;
  executionStrategy?: string | null;
  timeWindow?: string | null;
  maxConcurrency?: number | null;
  warmupRuns?: number | null;
  cooldownMs?: number | null;
  timeoutMs?: number | null;
  retryCount?: number | null;
  retryDelayMs?: number | null;
  randomizeOrder?: boolean | null;
  abortOnError?: boolean | null;
  dateCreated?: string | null;
  dateModified?: string | null;
};

const EMPTY_SUBJECT_SPECS_JSON = '[]';

function serializeSubjectSpecs(subjectSpecs: BenchmarkSubjectSpec[]): string {
  return JSON.stringify(subjectSpecs ?? []);
}

function parseSubjectSpecs(raw: string | BenchmarkSubjectSpec[] | null | undefined): BenchmarkSubjectSpec[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function toExperimentDetail(entity: LdkitBenchmarkExperiment): BenchmarkExperimentDetail {
  return toRestApi(entity) as BenchmarkExperimentDetail;
}

function toExperimentVersionDetail(entity: LdkitBenchmarkExperimentVersion): BenchmarkExperimentVersionDetail {
  const rest = toRestApi(entity) as BenchmarkExperimentVersionDetail;
  return {
    ...rest,
    subjectSpecs: parseSubjectSpecs(entity.subjectSpecs),
  };
}

export class BenchmarkExperimentService {
  listExperiments(): BenchmarkExperimentDetail[] {
    const cacheCoordinator = getCacheCoordinator();
    const items = cacheCoordinator.list('BenchmarkExperiment') as LdkitBenchmarkExperiment[];
    return items.map(toExperimentDetail);
  }

  getExperiment(id: string): BenchmarkExperimentDetail | null {
    const entity = getCacheCoordinator().get(id) as LdkitBenchmarkExperiment | null;
    if (!entity || entity['@type'] !== 'BenchmarkExperiment') return null;
    return toExperimentDetail(entity);
  }

  async createExperiment(payload: BenchmarkExperimentPayload): Promise<BenchmarkExperimentDetail> {
    const id = payload.id ?? mintId('benchmarkExperiment');
    const toCreate: Partial<LdkitBenchmarkExperiment> & { $id: string } = {
      $id: id,
      name: payload.name,
      description: payload.description ?? null,
      status: payload.status ?? null,
    };
    const created = await getCacheCoordinator().create('BenchmarkExperiment', toCreate);
    return toExperimentDetail(created);
  }

  async updateExperiment(id: string, payload: Partial<BenchmarkExperimentPayload> & { currentVersion?: string | null }): Promise<BenchmarkExperimentDetail | null> {
    const updates: Partial<LdkitBenchmarkExperiment> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.description !== undefined) updates.description = payload.description;
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.currentVersion !== undefined) updates.currentVersion = payload.currentVersion;
    const updated = await getCacheCoordinator().update('BenchmarkExperiment', id, updates);
    return updated ? toExperimentDetail(updated) : null;
  }

  async deleteExperiment(id: string): Promise<boolean> {
    const cacheCoordinator = getCacheCoordinator();
    const existing = cacheCoordinator.get(id) as LdkitBenchmarkExperiment | null;
    if (!existing || existing['@type'] !== 'BenchmarkExperiment') {
      return false;
    }

    const versions = cacheCoordinator.list('BenchmarkExperimentVersion') as LdkitBenchmarkExperimentVersion[];
    for (const version of versions.filter(v => v.isPartOf === id)) {
      await cacheCoordinator.delete('BenchmarkExperimentVersion', version.$id);
    }

    await cacheCoordinator.delete('BenchmarkExperiment', id);
    return true;
  }

  listVersions(experimentId: string): BenchmarkExperimentVersionDetail[] {
    const versions = getCacheCoordinator().list('BenchmarkExperimentVersion') as LdkitBenchmarkExperimentVersion[];
    return versions
      .filter(version => version.isPartOf === experimentId)
      .map(toExperimentVersionDetail)
      .sort((a, b) => a.version - b.version);
  }

  getVersion(experimentId: string, version: number): BenchmarkExperimentVersionDetail | null {
    const versions = getCacheCoordinator().list('BenchmarkExperimentVersion') as LdkitBenchmarkExperimentVersion[];
    const entity = versions.find(item => item.isPartOf === experimentId && item.version === version);
    return entity ? toExperimentVersionDetail(entity) : null;
  }

  getVersionById(versionId: string): BenchmarkExperimentVersionDetail | null {
    const entity = getCacheCoordinator().get(versionId) as LdkitBenchmarkExperimentVersion | null;
    if (!entity || entity['@type'] !== 'BenchmarkExperimentVersion') return null;
    return toExperimentVersionDetail(entity);
  }

  async createVersion(experimentId: string, payload: BenchmarkExperimentVersionPayload): Promise<BenchmarkExperimentVersionDetail> {
    const subjectSpecsJson = serializeSubjectSpecs(payload.subjectSpecs);
    const cacheCoordinator = getCacheCoordinator();
    const versions = cacheCoordinator.list('BenchmarkExperimentVersion') as LdkitBenchmarkExperimentVersion[];
    const existingVersions = versions.filter(item => item.isPartOf === experimentId);
    const nextVersion = existingVersions.length
      ? Math.max(...existingVersions.map(v => v.version)) + 1
      : 1;

    const id = mintId('benchmarkExperimentVersion');
    const toCreate: Partial<LdkitBenchmarkExperimentVersion> & { $id: string } = {
      $id: id,
      isPartOf: experimentId,
      version: nextVersion,
      subjectSpecs: subjectSpecsJson,
      repeats: payload.repeats ?? null,
      executionStrategy: payload.executionStrategy ?? null,
      timeWindow: payload.timeWindow ?? null,
      maxConcurrency: payload.maxConcurrency ?? null,
      warmupRuns: payload.warmupRuns ?? null,
      cooldownMs: payload.cooldownMs ?? null,
      timeoutMs: payload.timeoutMs ?? null,
      retryCount: payload.retryCount ?? null,
      retryDelayMs: payload.retryDelayMs ?? null,
      randomizeOrder: payload.randomizeOrder ?? null,
      abortOnError: payload.abortOnError ?? null,
      immutable: payload.immutable ?? null,
    };

    const created = await cacheCoordinator.create('BenchmarkExperimentVersion', toCreate);
    await cacheCoordinator.update('BenchmarkExperiment', experimentId, { currentVersion: created.$id });
    return toExperimentVersionDetail(created);
  }

  async updateVersion(experimentId: string, version: number, payload: Partial<BenchmarkExperimentVersionPayload>): Promise<BenchmarkExperimentVersionDetail | null> {
    const cacheCoordinator = getCacheCoordinator();
    const versions = cacheCoordinator.list('BenchmarkExperimentVersion') as LdkitBenchmarkExperimentVersion[];
    const entity = versions.find(item => item.isPartOf === experimentId && item.version === version);
    if (!entity) return null;

    const isImmutablePayloadOnly = payload.immutable === true && Object.keys(payload).every((key) => key === 'immutable');
    if (isFrozenVersion(entity)) {
      if (isImmutablePayloadOnly) {
        return toExperimentVersionDetail(entity);
      }
      throw new Error(`Benchmark experiment version ${entity.$id} is immutable`);
    }

    if (payload.immutable === false) {
      throw new Error(`Benchmark experiment version ${entity.$id} cannot be unfrozen`);
    }

    if (payload.immutable === true) {
      const subjectSpecs = payload.subjectSpecs ?? parseSubjectSpecs(entity.subjectSpecs);
      assertBenchmarkVersionDependencies(entity.$id, subjectSpecs);
    }

    const updates: Partial<LdkitBenchmarkExperimentVersion> = {};
    if (payload.subjectSpecs !== undefined) updates.subjectSpecs = serializeSubjectSpecs(payload.subjectSpecs);
    if (payload.repeats !== undefined) updates.repeats = payload.repeats;
    if (payload.executionStrategy !== undefined) updates.executionStrategy = payload.executionStrategy;
    if (payload.timeWindow !== undefined) updates.timeWindow = payload.timeWindow;
    if (payload.maxConcurrency !== undefined) updates.maxConcurrency = payload.maxConcurrency;
    if (payload.warmupRuns !== undefined) updates.warmupRuns = payload.warmupRuns;
    if (payload.cooldownMs !== undefined) updates.cooldownMs = payload.cooldownMs;
    if (payload.timeoutMs !== undefined) updates.timeoutMs = payload.timeoutMs;
    if (payload.retryCount !== undefined) updates.retryCount = payload.retryCount;
    if (payload.retryDelayMs !== undefined) updates.retryDelayMs = payload.retryDelayMs;
    if (payload.randomizeOrder !== undefined) updates.randomizeOrder = payload.randomizeOrder;
    if (payload.abortOnError !== undefined) updates.abortOnError = payload.abortOnError;
    if (payload.immutable !== undefined) updates.immutable = payload.immutable;

    const updated = await cacheCoordinator.update('BenchmarkExperimentVersion', entity.$id, updates);
    return updated ? toExperimentVersionDetail(updated) : null;
  }
}

function isFrozenVersion(entity: { immutable?: boolean | null } | null | undefined): boolean {
  const value = (entity as { immutable?: boolean | string | null } | null | undefined)?.immutable;
  return value === true || value === 'true' || value === '1';
}

export function assertBenchmarkVersionDependencies(
  versionId: string,
  subjectSpecsRaw: BenchmarkSubjectSpec[] | string | null | undefined,
): void {
  const subjectSpecs = Array.isArray(subjectSpecsRaw)
    ? subjectSpecsRaw
    : parseSubjectSpecs(subjectSpecsRaw ?? null);
  const cacheCoordinator = getCacheCoordinator();
  const issues: string[] = [];

  for (const spec of subjectSpecs) {
    if (!spec?.subject) {
      issues.push('Benchmark subject is missing');
      continue;
    }
    const subjectEntity = cacheCoordinator.get(spec.subject) as LdkitQueryVersion | LdkitQueryGroupVersion | LdkitRuleSetVersion | null;
    if (!subjectEntity) {
      issues.push(`Benchmark subject ${spec.subject} not found`);
      continue;
    }
    const subjectType = subjectEntity['@type'];
    if (subjectType !== 'QueryVersion' && subjectType !== 'QueryGroupVersion' && subjectType !== 'RuleSetVersion') {
      issues.push(`Benchmark subject ${spec.subject} must be a QueryVersion, QueryGroupVersion or RuleSetVersion`);
      continue;
    }
    if (!isFrozenVersion(subjectEntity)) {
      issues.push(`Benchmark subject ${spec.subject} must be frozen`);
    }

    if (subjectType === 'QueryVersion') {
      const backends = spec.backends ?? [];
      if (!backends.length) {
        issues.push(`Benchmark subject ${spec.subject} requires at least one backend`);
      }
      for (const backendId of backends) {
        if (backendId === BENCHMARK_NOT_APPLICABLE_BACKEND_IRI) {
          issues.push(`Backend ${backendId} is not valid for QueryVersion subjects`);
          continue;
        }
        if (backendId === EPHEMERAL_BACKEND_ID || backendId === LIBRARY_STORAGE_BACKEND_ID) {
          continue;
        }
        const backendEntity = cacheCoordinator.get(backendId) as { '@type'?: string } | null;
        if (!backendEntity || backendEntity['@type'] !== 'Backend') {
          issues.push(`Backend ${backendId} not found`);
        }
      }
    }

    if (subjectType === 'RuleSetVersion') {
      /*
       * The store axis is collapsed for a rule set, which evaluates in-process
       * against an ephemeral store. Spelled as a refusal rather than an absent
       * field so that selectable in-memory/on-disk stores can un-collapse it
       * later without a shape change.
       */
      if ((spec.backends ?? []).length) {
        issues.push(`Benchmark subject ${spec.subject} is a rule set and takes no backends`);
      }
    } else if ((spec.dataGraphs ?? []).length) {
      issues.push(`Benchmark subject ${spec.subject} takes no data graphs; only a rule set has a graph axis`);
    }

    for (const dataGraphId of spec.dataGraphs ?? []) {
      checkAxisReference(cacheCoordinator, issues, dataGraphId, 'DataGraph', 'DataGraphVersion');
    }

    const inputs = spec.inputs ?? [];
    for (const inputId of inputs) {
      if (inputId === BENCHMARK_NO_ARGUMENTS_IRI) continue;
      // A rule set's tabular input is tuple seeds, supplied by a tuple set —
      // the same relationship an argument set has to a query (§1 of the doc
      // above), so it travels on the same axis with a different member type.
      if (subjectType === 'RuleSetVersion') {
        checkAxisReference(cacheCoordinator, issues, inputId, 'TupleSet', 'TupleSetVersion');
        continue;
      }
      const inputEntity = cacheCoordinator.get(inputId) as LdkitArgumentSet | LdkitArgumentSetVersion | null;
      if (!inputEntity) {
        issues.push(`Argument set ${inputId} not found`);
        continue;
      }
      // No frozen check for ArgumentSetVersion: it is immutable by construction
      // (issue #210) rather than by a stored flag, so every version reachable
      // here already satisfies it — the type check above is what there is left
      // to fail.
      if (inputEntity['@type'] === 'ArgumentSetVersion') {
        continue;
      }
      if (inputEntity['@type'] === 'ArgumentSet') {
        const currentVersionId = (inputEntity as LdkitArgumentSet).currentVersion;
        if (!currentVersionId) {
          issues.push(`ArgumentSet ${inputId} has no current version`);
          continue;
        }
        const versionEntity = cacheCoordinator.get(currentVersionId) as LdkitArgumentSetVersion | null;
        if (!versionEntity || versionEntity['@type'] !== 'ArgumentSetVersion') {
          issues.push(`ArgumentSetVersion ${currentVersionId} not found`);
          continue;
        }
        continue;
      }
      issues.push(`Argument set ${inputId} must be an ArgumentSetVersion`);
    }
  }

  if (issues.length) {
    throw new Error(`BenchmarkExperimentVersion ${versionId} has non-frozen dependencies: ${issues.join('; ')}`);
  }
}

/**
 * Check one axis member that may be named either way round.
 *
 * Every axis in a plan names a library object that floats (`TupleSet`,
 * `DataGraph`) or the version it would resolve to, and the two are equally
 * legal — what a run actually used is recorded on the observation, not fixed in
 * the plan. Both version types here are immutable by construction, so, as with
 * `ArgumentSetVersion`, there is no frozen flag left to check once the type is
 * right.
 */
function checkAxisReference(
  cacheCoordinator: ReturnType<typeof getCacheCoordinator>,
  issues: string[],
  id: string,
  parentType: string,
  versionType: string,
): void {
  const entity = cacheCoordinator.get(id) as { '@type'?: string; currentVersion?: string | null } | null;
  if (!entity) {
    issues.push(`${parentType} ${id} not found`);
    return;
  }
  if (entity['@type'] === versionType) return;
  if (entity['@type'] !== parentType) {
    issues.push(`${id} must be a ${parentType} or ${versionType}`);
    return;
  }
  const currentVersionId = entity.currentVersion;
  if (!currentVersionId) {
    issues.push(`${parentType} ${id} has no current version`);
    return;
  }
  const version = cacheCoordinator.get(currentVersionId) as { '@type'?: string } | null;
  if (!version || version['@type'] !== versionType) {
    issues.push(`${versionType} ${currentVersionId} not found`);
  }
}

export { parseSubjectSpecs };
