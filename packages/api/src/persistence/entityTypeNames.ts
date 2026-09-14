/**
 * The names of the entity types, as one list nothing else derives from.
 *
 * `LENS_BY_TYPE` and `SCHEMA_BY_TYPE` describe the same set of types by two
 * routes, and until this existed the only thing holding them together was a
 * test comparing their key sets. Both are now checked against this list by
 * `satisfies Record<EntityTypeName, …>`, so a type added to one and not the
 * other is a compile error at the registry rather than a red test.
 *
 * The reason it is a *standalone* leaf module rather than `keyof typeof
 * LENS_BY_TYPE`: `schema.ts` needs the union to type a property's
 * `@references`, and the registries are inferred from the lens and schema
 * modules, which transitively depend on `schema.ts`. Naming the list here
 * breaks that circularity — it is a leaf, importing nothing.
 */

export const ENTITY_TYPE_NAMES = [
  'Backend',
  'Library',
  'Query',
  'QueryVersion',
  'Rule',
  'RuleVersion',
  'DataBlock',
  'DataBlockVersion',
  'RuleSet',
  'RuleSetVersion',
  'QueryGroup',
  'QueryGroupVersion',
  'QueryNode',
  'RuleSetNode',
  'PatchNode',
  'QueryEdge',
  'DynamicQueryNode',
  'StartNode',
  'EndNode',
  'LimitParameter',
  'OffsetParameter',
  'QueryInputVariable',
  'QueryOutputVariable',
  'QueryInputTuple',
  'QueryOutputTuple',
  'TupleMember',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput',
  'ArgumentSet',
  'ArgumentSetVersion',
  'ArgumentTupleBinding',
  'ArgumentScalarBinding',
  'ArgumentGraphBinding',
  'EtlJob',
  'EtlJobVersion',
  'EtlColumnMapping',
  'EtlColumnMappingVersion',
  'EtlExecution',
  'DuckDbEtlNode',
  'BenchmarkExperiment',
  'BenchmarkExperimentVersion',
  'DataGraph',
  'DataGraphVersion',
  'Test',
  'TestVersion',
  'TestCase',
  'TestCaseDataGraph',
  'Tag',
  'Patch',
  'TupleSet',
  'TupleSetVersion',
] as const;

/** One of the entity types the system stores and resolves. */
export type EntityTypeName = (typeof ENTITY_TYPE_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(ENTITY_TYPE_NAMES);

export function isEntityTypeName(value: unknown): value is EntityTypeName {
  return typeof value === 'string' && NAME_SET.has(value);
}
