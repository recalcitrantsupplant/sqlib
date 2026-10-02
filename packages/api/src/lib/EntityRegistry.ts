/**
 * What the cache needs to know per entity type: the stored shape of each, and
 * how long a cached copy stays fresh.
 *
 * The set of types is `ENTITY_TYPE_NAMES`; nothing here derives it. This module
 * used to also map every type to its repository module, which pulled ~50
 * `*Utils` modules into everything that needed a TTL or a type name and closed
 * an import cycle through `EntityStore`. Reads and writes go through
 * `CacheCoordinator` and the `PersistenceAdapter`, keyed by schema, so nothing
 * here needs a repository.
 */
import type { ArgumentScalarBindingEntity } from '../persistence/schemas/ArgumentScalarBindingSchema.js';
import type { ArgumentGraphBindingEntity } from '../persistence/schemas/ArgumentGraphBindingSchema.js';
import type { ArgumentSetEntity } from '../persistence/schemas/ArgumentSetSchema.js';
import type { ArgumentSetVersionEntity } from '../persistence/schemas/ArgumentSetVersionSchema.js';
import type { ArgumentTupleBindingEntity } from '../persistence/schemas/ArgumentTupleBindingSchema.js';
import type { BackendEntity } from '../persistence/schemas/BackendSchema.js';
import type { BenchmarkExperimentEntity } from '../persistence/schemas/BenchmarkExperimentSchema.js';
import type { BenchmarkExperimentVersionEntity } from '../persistence/schemas/BenchmarkExperimentVersionSchema.js';
import type { BooleanIOEntity } from '../persistence/schemas/BooleanIOSchema.js';
import type { DataBlockEntity } from '../persistence/schemas/DataBlockSchema.js';
import type { DataBlockVersionEntity } from '../persistence/schemas/DataBlockVersionSchema.js';
import type { DataGraphEntity } from '../persistence/schemas/DataGraphSchema.js';
import type { DataGraphVersionEntity } from '../persistence/schemas/DataGraphVersionSchema.js';
import type { TestEntity } from '../persistence/schemas/TestSchema.js';
import type { TestVersionEntity } from '../persistence/schemas/TestVersionSchema.js';
import type { TestCaseEntity } from '../persistence/schemas/TestCaseSchema.js';
import type { TestCaseDataGraphEntity } from '../persistence/schemas/TestCaseDataGraphSchema.js';
import type { TagEntity } from '../persistence/schemas/TagSchema.js';
import type { PatchEntity } from '../persistence/schemas/PatchSchema.js';
import type { TupleSetEntity } from '../persistence/schemas/TupleSetSchema.js';
import type { TupleSetVersionEntity } from '../persistence/schemas/TupleSetVersionSchema.js';
import type { DuckDbEtlNodeEntity } from '../persistence/schemas/DuckDbEtlNodeSchema.js';
import type { DynamicQueryNodeEntity } from '../persistence/schemas/DynamicQueryNodeSchema.js';
import type { EndNodeEntity } from '../persistence/schemas/EndNodeSchema.js';
import type { EtlColumnMappingEntity } from '../persistence/schemas/EtlColumnMappingSchema.js';
import type { EtlColumnMappingVersionEntity } from '../persistence/schemas/EtlColumnMappingVersionSchema.js';
import type { EtlExecutionEntity } from '../persistence/schemas/EtlExecutionSchema.js';
import type { EtlJobEntity } from '../persistence/schemas/EtlJobSchema.js';
import type { EtlJobVersionEntity } from '../persistence/schemas/EtlJobVersionSchema.js';
import type { LibraryEntity } from '../persistence/schemas/LibrarySchema.js';
import type { LimitParameterEntity } from '../persistence/schemas/LimitParameterSchema.js';
import type { OffsetParameterEntity } from '../persistence/schemas/OffsetParameterSchema.js';
import type { QueryEntity } from '../persistence/schemas/QuerySchema.js';
import type { QueryEdgeEntity } from '../persistence/schemas/QueryEdgeSchema.js';
import type { QueryGroupEntity } from '../persistence/schemas/QueryGroupSchema.js';
import type { QueryGroupVersionEntity } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { QueryIdInputEntity } from '../persistence/schemas/QueryIdInputSchema.js';
import type { QueryInputTupleEntity } from '../persistence/schemas/QueryInputTupleSchema.js';
import type { QueryInputVariableEntity } from '../persistence/schemas/QueryInputVariableSchema.js';
import type { QueryNodeEntity } from '../persistence/schemas/QueryNodeSchema.js';
import type { QueryOutputTupleEntity } from '../persistence/schemas/QueryOutputTupleSchema.js';
import type { QueryOutputVariableEntity } from '../persistence/schemas/QueryOutputVariableSchema.js';
import type { QueryVersionEntity } from '../persistence/schemas/QueryVersionSchema.js';
import type { RuleEntity } from '../persistence/schemas/RuleSchema.js';
import type { RuleSetEntity } from '../persistence/schemas/RuleSetSchema.js';
import type { RuleSetNodeEntity } from '../persistence/schemas/RuleSetNodeSchema.js';
import type { PatchNodeEntity } from '../persistence/schemas/PatchNodeSchema.js';
import type { RuleSetVersionEntity } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { RuleVersionEntity } from '../persistence/schemas/RuleVersionSchema.js';
import type { StartNodeEntity } from '../persistence/schemas/StartNodeSchema.js';
import type { TriplesQuadsIOEntity } from '../persistence/schemas/TriplesQuadsIOSchema.js';
import type { TupleMemberEntity } from '../persistence/schemas/TupleMemberSchema.js';
import type { EntityTypeName } from '../persistence/entityTypeNames.js';

/** One of the entity types the cache stores and resolves. */
export type EntityType = EntityTypeName;

export type EntityByType = {
  Backend: BackendEntity;
  Library: LibraryEntity;
  Query: QueryEntity;
  QueryVersion: QueryVersionEntity;
  Rule: RuleEntity;
  RuleVersion: RuleVersionEntity;
  DataBlock: DataBlockEntity;
  DataBlockVersion: DataBlockVersionEntity;
  RuleSet: RuleSetEntity;
  RuleSetVersion: RuleSetVersionEntity;
  QueryGroup: QueryGroupEntity;
  QueryGroupVersion: QueryGroupVersionEntity;
  QueryNode: QueryNodeEntity;
  RuleSetNode: RuleSetNodeEntity;
  PatchNode: PatchNodeEntity;
  QueryEdge: QueryEdgeEntity;
  DynamicQueryNode: DynamicQueryNodeEntity;
  StartNode: StartNodeEntity;
  EndNode: EndNodeEntity;
  LimitParameter: LimitParameterEntity;
  OffsetParameter: OffsetParameterEntity;
  QueryInputVariable: QueryInputVariableEntity;
  QueryOutputVariable: QueryOutputVariableEntity;
  QueryInputTuple: QueryInputTupleEntity;
  QueryOutputTuple: QueryOutputTupleEntity;
  TupleMember: TupleMemberEntity;
  TriplesQuadsIO: TriplesQuadsIOEntity;
  BooleanIO: BooleanIOEntity;
  QueryIdInput: QueryIdInputEntity;
  ArgumentSet: ArgumentSetEntity;
  ArgumentSetVersion: ArgumentSetVersionEntity;
  ArgumentTupleBinding: ArgumentTupleBindingEntity;
  ArgumentScalarBinding: ArgumentScalarBindingEntity;
  ArgumentGraphBinding: ArgumentGraphBindingEntity;
  EtlJob: EtlJobEntity;
  EtlJobVersion: EtlJobVersionEntity;
  EtlColumnMapping: EtlColumnMappingEntity;
  EtlColumnMappingVersion: EtlColumnMappingVersionEntity;
  EtlExecution: EtlExecutionEntity;
  DuckDbEtlNode: DuckDbEtlNodeEntity;
  BenchmarkExperiment: BenchmarkExperimentEntity;
  BenchmarkExperimentVersion: BenchmarkExperimentVersionEntity;
  DataGraph: DataGraphEntity;
  DataGraphVersion: DataGraphVersionEntity;
  Test: TestEntity;
  TestVersion: TestVersionEntity;
  TestCase: TestCaseEntity;
  TestCaseDataGraph: TestCaseDataGraphEntity;
  Tag: TagEntity;
  Patch: PatchEntity;
  TupleSet: TupleSetEntity;
  TupleSetVersion: TupleSetVersionEntity;
};

// Every name in `ENTITY_TYPE_NAMES` has a shape above, and nothing else does.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _entityByTypeCoversEveryName: Exact<keyof EntityByType, EntityTypeName> = true;
void _entityByTypeCoversEveryName;

export const TTL_MS: Partial<Record<EntityType, number>> = {
  Backend: 180_000,
  Library: 120_000,
  Query: 15_000,
  QueryVersion: Number.POSITIVE_INFINITY,
  Rule: 15_000,
  RuleVersion: Number.POSITIVE_INFINITY,
  DataBlock: 15_000,
  DataBlockVersion: Number.POSITIVE_INFINITY,
  RuleSet: 15_000,
  RuleSetVersion: Number.POSITIVE_INFINITY,
  QueryGroup: 30_000,
  QueryGroupVersion: Number.POSITIVE_INFINITY,
  RuleSetNode: Number.POSITIVE_INFINITY,
  PatchNode: Number.POSITIVE_INFINITY,
  ArgumentSetVersion: Number.POSITIVE_INFINITY,
  BenchmarkExperiment: 60_000,
  BenchmarkExperimentVersion: Number.POSITIVE_INFINITY,
  DataGraph: 15_000,
  DataGraphVersion: Number.POSITIVE_INFINITY,
  Test: 15_000,
  TestVersion: Number.POSITIVE_INFINITY,
  TestCase: Number.POSITIVE_INFINITY,
  TestCaseDataGraph: Number.POSITIVE_INFINITY,
  // Long, like Library: tags are named once and then read on every list
  // request that draws a filter row.
  Tag: 120_000,
  TupleSet: 15_000,
  TupleSetVersion: Number.POSITIVE_INFINITY,
  // A patch is an event: once written, only its status ever changes, and that
  // happens through this process. Long, like the other write-once types — but
  // not infinite, because a revert elsewhere would otherwise never be seen.
  Patch: 120_000,
};

export function getTtlForType(type: EntityType): number {
  return TTL_MS[type] ?? 60_000;
}
