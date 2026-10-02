/**
 * The names of the entity types, as one list nothing else derives from.
 *
 * `SCHEMA_BY_TYPE`, `EntityRegistry`'s `EntityByType` and the repository map in
 * `EntityRepositories` are all checked against or built from this list, so a
 * type added to one and not the others is a compile error rather than a red
 * test or a type missing at runtime.
 *
 * It is a standalone leaf module, importing nothing, because `schema.ts` needs
 * the union to type a property's `@references`, and the schema registry is
 * built from the schema modules, which depend on `schema.ts`. Naming the list
 * here breaks that circularity.
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
