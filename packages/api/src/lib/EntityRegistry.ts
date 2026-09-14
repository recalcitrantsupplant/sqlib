import type { LdkitArgumentScalarBinding } from '../persistence/schemas/ArgumentScalarBindingSchema.js';
import type { LdkitArgumentGraphBinding } from '../persistence/schemas/ArgumentGraphBindingSchema.js';
import type { LdkitArgumentSet } from '../persistence/schemas/ArgumentSetSchema.js';
import type { LdkitArgumentSetVersion } from '../persistence/schemas/ArgumentSetVersionSchema.js';
import type { LdkitArgumentTupleBinding } from '../persistence/schemas/ArgumentTupleBindingSchema.js';
import type { LdkitBackend } from '../persistence/schemas/BackendSchema.js';
import type { LdkitBenchmarkExperiment } from '../persistence/schemas/BenchmarkExperimentSchema.js';
import type { LdkitBenchmarkExperimentVersion } from '../persistence/schemas/BenchmarkExperimentVersionSchema.js';
import type { LdkitBooleanIO } from '../persistence/schemas/BooleanIOSchema.js';
import type { LdkitDataBlock } from '../persistence/schemas/DataBlockSchema.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import type { LdkitDataGraph } from '../persistence/schemas/DataGraphSchema.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';
import type { LdkitTest } from '../persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../persistence/schemas/TestVersionSchema.js';
import type { LdkitTestCase } from '../persistence/schemas/TestCaseSchema.js';
import type { LdkitTestCaseDataGraph } from '../persistence/schemas/TestCaseDataGraphSchema.js';
import type { LdkitTag } from '../persistence/schemas/TagSchema.js';
import type { LdkitPatch } from '../persistence/schemas/PatchSchema.js';
import type { LdkitTupleSet } from '../persistence/schemas/TupleSetSchema.js';
import type { LdkitTupleSetVersion } from '../persistence/schemas/TupleSetVersionSchema.js';
import type { LdkitDuckDbEtlNode } from '../persistence/schemas/DuckDbEtlNodeSchema.js';
import type { LdkitDynamicQueryNode } from '../persistence/schemas/DynamicQueryNodeSchema.js';
import type { LdkitEndNode } from '../persistence/schemas/EndNodeSchema.js';
import type { LdkitEtlColumnMapping } from '../persistence/schemas/EtlColumnMappingSchema.js';
import type { LdkitEtlColumnMappingVersion } from '../persistence/schemas/EtlColumnMappingVersionSchema.js';
import type { LdkitEtlExecution } from '../persistence/schemas/EtlExecutionSchema.js';
import type { LdkitEtlJob } from '../persistence/schemas/EtlJobSchema.js';
import type { LdkitEtlJobVersion } from '../persistence/schemas/EtlJobVersionSchema.js';
import type { LdkitLibrary } from '../persistence/schemas/LibrarySchema.js';
import type { LdkitLimitParameter } from '../persistence/schemas/LimitParameterSchema.js';
import type { LdkitOffsetParameter } from '../persistence/schemas/OffsetParameterSchema.js';
import type { LdkitQuery } from '../persistence/schemas/QuerySchema.js';
import type { LdkitQueryEdge } from '../persistence/schemas/QueryEdgeSchema.js';
import type { LdkitQueryGroup } from '../persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitQueryIdInput } from '../persistence/schemas/QueryIdInputSchema.js';
import type { LdkitQueryInputTuple } from '../persistence/schemas/QueryInputTupleSchema.js';
import type { LdkitQueryInputVariable } from '../persistence/schemas/QueryInputVariableSchema.js';
import type { LdkitQueryNode } from '../persistence/schemas/QueryNodeSchema.js';
import type { LdkitQueryOutputTuple } from '../persistence/schemas/QueryOutputTupleSchema.js';
import type { LdkitQueryOutputVariable } from '../persistence/schemas/QueryOutputVariableSchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitRule } from '../persistence/schemas/RuleSchema.js';
import type { LdkitRuleSet } from '../persistence/schemas/RuleSetSchema.js';
import type { LdkitRuleSetNode } from '../persistence/schemas/RuleSetNodeSchema.js';
import type { LdkitPatchNode } from '../persistence/schemas/PatchNodeSchema.js';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import type { LdkitStartNode } from '../persistence/schemas/StartNodeSchema.js';
import type { LdkitTriplesQuadsIO } from '../persistence/schemas/TriplesQuadsIOSchema.js';
import type { LdkitTupleMember } from '../persistence/schemas/TupleMemberSchema.js';
import { Backends } from '../persistence/utils/BackendUtils.js';
import { Libraries } from '../persistence/utils/LibraryUtils.js';
import { Queries } from '../persistence/utils/QueryUtils.js';
import { QueryVersions } from '../persistence/utils/QueryVersionUtils.js';
import { Rules } from '../persistence/utils/RuleUtils.js';
import { RuleVersions } from '../persistence/utils/RuleVersionUtils.js';
import { DataBlocks } from '../persistence/utils/DataBlockUtils.js';
import { DataBlockVersions } from '../persistence/utils/DataBlockVersionUtils.js';
import { RuleSets } from '../persistence/utils/RuleSetUtils.js';
import { RuleSetVersions } from '../persistence/utils/RuleSetVersionUtils.js';
import { QueryGroups } from '../persistence/utils/QueryGroupUtils.js';
import { QueryGroupVersions } from '../persistence/utils/QueryGroupVersionUtils.js';
import { QueryNodes } from '../persistence/utils/QueryNodeUtils.js';
import { RuleSetNodes } from '../persistence/utils/RuleSetNodeUtils.js';
import { PatchNodes } from '../persistence/utils/PatchNodeUtils.js';
import { QueryEdges } from '../persistence/utils/QueryEdgeUtils.js';
import { DynamicQueryNodes } from '../persistence/utils/DynamicQueryNodeUtils.js';
import { StartNodes } from '../persistence/utils/StartNodeUtils.js';
import { EndNodes } from '../persistence/utils/EndNodeUtils.js';
import { LimitParameters } from '../persistence/utils/LimitParameterUtils.js';
import { OffsetParameters } from '../persistence/utils/OffsetParameterUtils.js';
import { QueryInputVariables } from '../persistence/utils/QueryInputVariableUtils.js';
import { QueryOutputVariables } from '../persistence/utils/QueryOutputVariableUtils.js';
import { QueryInputTuples } from '../persistence/utils/QueryInputTupleUtils.js';
import { QueryOutputTuples } from '../persistence/utils/QueryOutputTupleUtils.js';
import { TupleMembers } from '../persistence/utils/TupleMemberUtils.js';
import { TriplesQuadsIOs } from '../persistence/utils/TriplesQuadsIOUtils.js';
import { BooleanIOs } from '../persistence/utils/BooleanIOUtils.js';
import { QueryIdInputs } from '../persistence/utils/QueryIdInputUtils.js';
import {
  ArgumentSets,
  ArgumentSetVersions,
  ArgumentTupleBindings,
  ArgumentScalarBindings,
  ArgumentGraphBindings,
} from '../persistence/utils/ArgumentSetUtils.js';
import {
  EtlJobs,
  EtlJobVersions,
  EtlColumnMappings,
  EtlColumnMappingVersions,
  EtlExecutions,
  DuckDbEtlNodes,
} from '../persistence/utils/EtlUtils.js';
import { BenchmarkExperiments } from '../persistence/utils/BenchmarkExperimentUtils.js';
import { BenchmarkExperimentVersions } from '../persistence/utils/BenchmarkExperimentVersionUtils.js';
import { DataGraphs } from '../persistence/utils/DataGraphUtils.js';
import { DataGraphVersions } from '../persistence/utils/DataGraphVersionUtils.js';
import { Tests, TestVersions } from '../persistence/utils/TestUtils.js';
import { TestCases } from '../persistence/utils/TestCaseUtils.js';
import { TestCaseDataGraphs } from '../persistence/utils/TestCaseDataGraphUtils.js';
import { Tags } from '../persistence/utils/TagUtils.js';
import { Patches } from '../persistence/utils/PatchUtils.js';
import { TupleSets, TupleSetVersions } from '../persistence/utils/TupleSetUtils.js';
import type { EntityTypeName } from '../persistence/entityTypeNames.js';

export const LENS_BY_TYPE = {
  Backend: Backends,
  Library: Libraries,
  Query: Queries,
  QueryVersion: QueryVersions,
  Rule: Rules,
  RuleVersion: RuleVersions,
  DataBlock: DataBlocks,
  DataBlockVersion: DataBlockVersions,
  RuleSet: RuleSets,
  RuleSetVersion: RuleSetVersions,
  QueryGroup: QueryGroups,
  QueryGroupVersion: QueryGroupVersions,
  QueryNode: QueryNodes,
  RuleSetNode: RuleSetNodes,
  PatchNode: PatchNodes,
  QueryEdge: QueryEdges,
  DynamicQueryNode: DynamicQueryNodes,
  StartNode: StartNodes,
  EndNode: EndNodes,
  LimitParameter: LimitParameters,
  OffsetParameter: OffsetParameters,
  QueryInputVariable: QueryInputVariables,
  QueryOutputVariable: QueryOutputVariables,
  QueryInputTuple: QueryInputTuples,
  QueryOutputTuple: QueryOutputTuples,
  TupleMember: TupleMembers,
  TriplesQuadsIO: TriplesQuadsIOs,
  BooleanIO: BooleanIOs,
  QueryIdInput: QueryIdInputs,
  ArgumentSet: ArgumentSets,
  ArgumentSetVersion: ArgumentSetVersions,
  ArgumentTupleBinding: ArgumentTupleBindings,
  ArgumentScalarBinding: ArgumentScalarBindings,
  ArgumentGraphBinding: ArgumentGraphBindings,
  EtlJob: EtlJobs,
  EtlJobVersion: EtlJobVersions,
  EtlColumnMapping: EtlColumnMappings,
  EtlColumnMappingVersion: EtlColumnMappingVersions,
  EtlExecution: EtlExecutions,
  DuckDbEtlNode: DuckDbEtlNodes,
  BenchmarkExperiment: BenchmarkExperiments,
  BenchmarkExperimentVersion: BenchmarkExperimentVersions,
  DataGraph: DataGraphs,
  DataGraphVersion: DataGraphVersions,
  Test: Tests,
  TestVersion: TestVersions,
  TestCase: TestCases,
  TestCaseDataGraph: TestCaseDataGraphs,
  Tag: Tags,
  Patch: Patches,
  TupleSet: TupleSets,
  TupleSetVersion: TupleSetVersions,
} as const satisfies Record<EntityTypeName, unknown>;

export type EntityType = keyof typeof LENS_BY_TYPE;

export type EntityByType = {
  Backend: LdkitBackend;
  Library: LdkitLibrary;
  Query: LdkitQuery;
  QueryVersion: LdkitQueryVersion;
  Rule: LdkitRule;
  RuleVersion: LdkitRuleVersion;
  DataBlock: LdkitDataBlock;
  DataBlockVersion: LdkitDataBlockVersion;
  RuleSet: LdkitRuleSet;
  RuleSetVersion: LdkitRuleSetVersion;
  QueryGroup: LdkitQueryGroup;
  QueryGroupVersion: LdkitQueryGroupVersion;
  QueryNode: LdkitQueryNode;
  RuleSetNode: LdkitRuleSetNode;
  PatchNode: LdkitPatchNode;
  QueryEdge: LdkitQueryEdge;
  DynamicQueryNode: LdkitDynamicQueryNode;
  StartNode: LdkitStartNode;
  EndNode: LdkitEndNode;
  LimitParameter: LdkitLimitParameter;
  OffsetParameter: LdkitOffsetParameter;
  QueryInputVariable: LdkitQueryInputVariable;
  QueryOutputVariable: LdkitQueryOutputVariable;
  QueryInputTuple: LdkitQueryInputTuple;
  QueryOutputTuple: LdkitQueryOutputTuple;
  TupleMember: LdkitTupleMember;
  TriplesQuadsIO: LdkitTriplesQuadsIO;
  BooleanIO: LdkitBooleanIO;
  QueryIdInput: LdkitQueryIdInput;
  ArgumentSet: LdkitArgumentSet;
  ArgumentSetVersion: LdkitArgumentSetVersion;
  ArgumentTupleBinding: LdkitArgumentTupleBinding;
  ArgumentScalarBinding: LdkitArgumentScalarBinding;
  ArgumentGraphBinding: LdkitArgumentGraphBinding;
  EtlJob: LdkitEtlJob;
  EtlJobVersion: LdkitEtlJobVersion;
  EtlColumnMapping: LdkitEtlColumnMapping;
  EtlColumnMappingVersion: LdkitEtlColumnMappingVersion;
  EtlExecution: LdkitEtlExecution;
  DuckDbEtlNode: LdkitDuckDbEtlNode;
  BenchmarkExperiment: LdkitBenchmarkExperiment;
  BenchmarkExperimentVersion: LdkitBenchmarkExperimentVersion;
  DataGraph: LdkitDataGraph;
  DataGraphVersion: LdkitDataGraphVersion;
  Test: LdkitTest;
  TestVersion: LdkitTestVersion;
  TestCase: LdkitTestCase;
  TestCaseDataGraph: LdkitTestCaseDataGraph;
  Tag: LdkitTag;
  Patch: LdkitPatch;
  TupleSet: LdkitTupleSet;
  TupleSetVersion: LdkitTupleSetVersion;
};

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

export interface CommonLens<T> {
  find(): Promise<T[]>;
  findByIri(id: string): Promise<T | null>;
  insert(entity: T): Promise<void>;
  update(entity: Partial<T>): Promise<void>;
  delete(id: string): Promise<void>;
}

export function getLensForType<T extends EntityType>(type: T): CommonLens<EntityByType[T]> {
  const lens = LENS_BY_TYPE[type];
  if (!lens) {
    throw new Error(`Unknown entity type: ${type}`);
  }
  return lens as unknown as CommonLens<EntityByType[T]>;
}
