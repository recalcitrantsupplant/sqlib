/**
 * Entity type -> LDKit schema object, for runtime use.
 *
 * `EntityRegistry.LENS_BY_TYPE` maps types to *lenses*; the self-hosted mapper
 * needs the schemas those lenses were built from, so it can generate queries and
 * assemble results without LDKit in the path. Both maps are keyed by
 * `ENTITY_TYPE_NAMES`, so a type present in one and missing from the other is a
 * compile error here rather than a runtime gap.
 */
import { BackendSchema } from '../persistence/schemas/BackendSchema.js';
import { LibrarySchema } from '../persistence/schemas/LibrarySchema.js';
import { QuerySchema } from '../persistence/schemas/QuerySchema.js';
import { QueryVersionSchema } from '../persistence/schemas/QueryVersionSchema.js';
import { RuleSchema } from '../persistence/schemas/RuleSchema.js';
import { RuleVersionSchema } from '../persistence/schemas/RuleVersionSchema.js';
import { DataBlockSchema } from '../persistence/schemas/DataBlockSchema.js';
import { DataBlockVersionSchema } from '../persistence/schemas/DataBlockVersionSchema.js';
import { RuleSetSchema } from '../persistence/schemas/RuleSetSchema.js';
import { RuleSetVersionSchema } from '../persistence/schemas/RuleSetVersionSchema.js';
import { QueryGroupSchema } from '../persistence/schemas/QueryGroupSchema.js';
import { QueryGroupVersionSchema } from '../persistence/schemas/QueryGroupVersionSchema.js';
import { QueryNodeSchema } from '../persistence/schemas/QueryNodeSchema.js';
import { RuleSetNodeSchema } from '../persistence/schemas/RuleSetNodeSchema.js';
import { PatchNodeSchema } from '../persistence/schemas/PatchNodeSchema.js';
import { QueryEdgeSchema } from '../persistence/schemas/QueryEdgeSchema.js';
import { DynamicQueryNodeSchema } from '../persistence/schemas/DynamicQueryNodeSchema.js';
import { StartNodeSchema } from '../persistence/schemas/StartNodeSchema.js';
import { EndNodeSchema } from '../persistence/schemas/EndNodeSchema.js';
import { LimitParameterSchema } from '../persistence/schemas/LimitParameterSchema.js';
import { OffsetParameterSchema } from '../persistence/schemas/OffsetParameterSchema.js';
import { QueryInputVariableSchema } from '../persistence/schemas/QueryInputVariableSchema.js';
import { QueryOutputVariableSchema } from '../persistence/schemas/QueryOutputVariableSchema.js';
import { QueryInputTupleSchema } from '../persistence/schemas/QueryInputTupleSchema.js';
import { QueryOutputTupleSchema } from '../persistence/schemas/QueryOutputTupleSchema.js';
import { TupleMemberSchema } from '../persistence/schemas/TupleMemberSchema.js';
import { TriplesQuadsIOSchema } from '../persistence/schemas/TriplesQuadsIOSchema.js';
import { BooleanIOSchema } from '../persistence/schemas/BooleanIOSchema.js';
import { QueryIdInputSchema } from '../persistence/schemas/QueryIdInputSchema.js';
import { ArgumentSetSchema } from '../persistence/schemas/ArgumentSetSchema.js';
import { ArgumentSetVersionSchema } from '../persistence/schemas/ArgumentSetVersionSchema.js';
import { ArgumentTupleBindingSchema } from '../persistence/schemas/ArgumentTupleBindingSchema.js';
import { ArgumentScalarBindingSchema } from '../persistence/schemas/ArgumentScalarBindingSchema.js';
import { ArgumentGraphBindingSchema } from '../persistence/schemas/ArgumentGraphBindingSchema.js';
import { EtlJobSchema } from '../persistence/schemas/EtlJobSchema.js';
import { EtlJobVersionSchema } from '../persistence/schemas/EtlJobVersionSchema.js';
import { EtlColumnMappingSchema } from '../persistence/schemas/EtlColumnMappingSchema.js';
import { EtlColumnMappingVersionSchema } from '../persistence/schemas/EtlColumnMappingVersionSchema.js';
import { EtlExecutionSchema } from '../persistence/schemas/EtlExecutionSchema.js';
import { DuckDbEtlNodeSchema } from '../persistence/schemas/DuckDbEtlNodeSchema.js';
import { BenchmarkExperimentSchema } from '../persistence/schemas/BenchmarkExperimentSchema.js';
import { BenchmarkExperimentVersionSchema } from '../persistence/schemas/BenchmarkExperimentVersionSchema.js';
import { DataGraphSchema } from '../persistence/schemas/DataGraphSchema.js';
import { DataGraphVersionSchema } from '../persistence/schemas/DataGraphVersionSchema.js';
import { TestSchema } from '../persistence/schemas/TestSchema.js';
import { TestVersionSchema } from '../persistence/schemas/TestVersionSchema.js';
import { TestCaseSchema } from '../persistence/schemas/TestCaseSchema.js';
import { TestCaseDataGraphSchema } from '../persistence/schemas/TestCaseDataGraphSchema.js';
import { TagSchema } from '../persistence/schemas/TagSchema.js';
import { PatchSchema } from '../persistence/schemas/PatchSchema.js';
import { TupleSetSchema } from '../persistence/schemas/TupleSetSchema.js';
import { TupleSetVersionSchema } from '../persistence/schemas/TupleSetVersionSchema.js';

import type { EntityTypeName } from './entityTypeNames.js';

export const SCHEMA_BY_TYPE = {
  Backend: BackendSchema,
  Library: LibrarySchema,
  Query: QuerySchema,
  QueryVersion: QueryVersionSchema,
  Rule: RuleSchema,
  RuleVersion: RuleVersionSchema,
  DataBlock: DataBlockSchema,
  DataBlockVersion: DataBlockVersionSchema,
  RuleSet: RuleSetSchema,
  RuleSetVersion: RuleSetVersionSchema,
  QueryGroup: QueryGroupSchema,
  QueryGroupVersion: QueryGroupVersionSchema,
  QueryNode: QueryNodeSchema,
  RuleSetNode: RuleSetNodeSchema,
  PatchNode: PatchNodeSchema,
  QueryEdge: QueryEdgeSchema,
  DynamicQueryNode: DynamicQueryNodeSchema,
  StartNode: StartNodeSchema,
  EndNode: EndNodeSchema,
  LimitParameter: LimitParameterSchema,
  OffsetParameter: OffsetParameterSchema,
  QueryInputVariable: QueryInputVariableSchema,
  QueryOutputVariable: QueryOutputVariableSchema,
  QueryInputTuple: QueryInputTupleSchema,
  QueryOutputTuple: QueryOutputTupleSchema,
  TupleMember: TupleMemberSchema,
  TriplesQuadsIO: TriplesQuadsIOSchema,
  BooleanIO: BooleanIOSchema,
  QueryIdInput: QueryIdInputSchema,
  ArgumentSet: ArgumentSetSchema,
  ArgumentSetVersion: ArgumentSetVersionSchema,
  ArgumentTupleBinding: ArgumentTupleBindingSchema,
  ArgumentScalarBinding: ArgumentScalarBindingSchema,
  ArgumentGraphBinding: ArgumentGraphBindingSchema,
  EtlJob: EtlJobSchema,
  EtlJobVersion: EtlJobVersionSchema,
  EtlColumnMapping: EtlColumnMappingSchema,
  EtlColumnMappingVersion: EtlColumnMappingVersionSchema,
  EtlExecution: EtlExecutionSchema,
  DuckDbEtlNode: DuckDbEtlNodeSchema,
  BenchmarkExperiment: BenchmarkExperimentSchema,
  BenchmarkExperimentVersion: BenchmarkExperimentVersionSchema,
  DataGraph: DataGraphSchema,
  DataGraphVersion: DataGraphVersionSchema,
  Test: TestSchema,
  TestVersion: TestVersionSchema,
  TestCase: TestCaseSchema,
  TestCaseDataGraph: TestCaseDataGraphSchema,
  Tag: TagSchema,
  Patch: PatchSchema,
  TupleSet: TupleSetSchema,
  TupleSetVersion: TupleSetVersionSchema,
} as const satisfies Record<EntityTypeName, { '@type': string }>;
