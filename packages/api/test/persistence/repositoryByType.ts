/**
 * Entity type -> the `*Utils` repository that stores it, for `lensBackedAdapter`.
 *
 * Test-only. Production reads and writes go through `SelfHostedAdapter`, keyed
 * by schema, and no longer need a per-type repository map. The suites using the
 * double stub individual `*Utils` modules and assert on their repositories, so
 * the double has to reach exactly those objects.
 */
import type { EntityTypeName } from '../../src/persistence/entityTypeNames.js';
import { Backends } from '../../src/persistence/utils/BackendUtils.js';
import { Libraries } from '../../src/persistence/utils/LibraryUtils.js';
import { Queries } from '../../src/persistence/utils/QueryUtils.js';
import { QueryVersions } from '../../src/persistence/utils/QueryVersionUtils.js';
import { Rules } from '../../src/persistence/utils/RuleUtils.js';
import { RuleVersions } from '../../src/persistence/utils/RuleVersionUtils.js';
import { DataBlocks } from '../../src/persistence/utils/DataBlockUtils.js';
import { DataBlockVersions } from '../../src/persistence/utils/DataBlockVersionUtils.js';
import { RuleSets } from '../../src/persistence/utils/RuleSetUtils.js';
import { RuleSetVersions } from '../../src/persistence/utils/RuleSetVersionUtils.js';
import { QueryGroups } from '../../src/persistence/utils/QueryGroupUtils.js';
import { QueryGroupVersions } from '../../src/persistence/utils/QueryGroupVersionUtils.js';
import { QueryNodes } from '../../src/persistence/utils/QueryNodeUtils.js';
import { RuleSetNodes } from '../../src/persistence/utils/RuleSetNodeUtils.js';
import { PatchNodes } from '../../src/persistence/utils/PatchNodeUtils.js';
import { QueryEdges } from '../../src/persistence/utils/QueryEdgeUtils.js';
import { DynamicQueryNodes } from '../../src/persistence/utils/DynamicQueryNodeUtils.js';
import { StartNodes } from '../../src/persistence/utils/StartNodeUtils.js';
import { EndNodes } from '../../src/persistence/utils/EndNodeUtils.js';
import { LimitParameters } from '../../src/persistence/utils/LimitParameterUtils.js';
import { OffsetParameters } from '../../src/persistence/utils/OffsetParameterUtils.js';
import { QueryInputVariables } from '../../src/persistence/utils/QueryInputVariableUtils.js';
import { QueryOutputVariables } from '../../src/persistence/utils/QueryOutputVariableUtils.js';
import { QueryInputTuples } from '../../src/persistence/utils/QueryInputTupleUtils.js';
import { QueryOutputTuples } from '../../src/persistence/utils/QueryOutputTupleUtils.js';
import { TupleMembers } from '../../src/persistence/utils/TupleMemberUtils.js';
import { TriplesQuadsIOs } from '../../src/persistence/utils/TriplesQuadsIOUtils.js';
import { BooleanIOs } from '../../src/persistence/utils/BooleanIOUtils.js';
import { QueryIdInputs } from '../../src/persistence/utils/QueryIdInputUtils.js';
import {
  ArgumentSets,
  ArgumentSetVersions,
  ArgumentTupleBindings,
  ArgumentScalarBindings,
  ArgumentGraphBindings,
} from '../../src/persistence/utils/ArgumentSetUtils.js';
import {
  EtlJobs,
  EtlJobVersions,
  EtlColumnMappings,
  EtlColumnMappingVersions,
  EtlExecutions,
  DuckDbEtlNodes,
} from '../../src/persistence/utils/EtlUtils.js';
import { BenchmarkExperiments } from '../../src/persistence/utils/BenchmarkExperimentUtils.js';
import { BenchmarkExperimentVersions } from '../../src/persistence/utils/BenchmarkExperimentVersionUtils.js';
import { DataGraphs } from '../../src/persistence/utils/DataGraphUtils.js';
import { DataGraphVersions } from '../../src/persistence/utils/DataGraphVersionUtils.js';
import { Tests, TestVersions } from '../../src/persistence/utils/TestUtils.js';
import { TestCases } from '../../src/persistence/utils/TestCaseUtils.js';
import { TestCaseDataGraphs } from '../../src/persistence/utils/TestCaseDataGraphUtils.js';
import { Tags } from '../../src/persistence/utils/TagUtils.js';
import { Patches } from '../../src/persistence/utils/PatchUtils.js';
import { TupleSets, TupleSetVersions } from '../../src/persistence/utils/TupleSetUtils.js';

export const REPOSITORY_BY_TYPE = {
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
