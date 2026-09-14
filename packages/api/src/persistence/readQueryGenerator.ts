/**
 * Emits the read queries the self-hosted adapter runs, one per entity type.
 *
 * These are the compiled-in system queries of plan §1: fixed-shape, immutable,
 * generated from the entity schema rather than stored as user-editable content.
 * The shape is `SELECT ?id ?p ?o` over the type's instances — SPARQL JSON already
 * carries each term's datatype, so assembly needs no RDF parser, and the executor
 * path exercised is the same one user SELECTs take.
 *
 * Only predicates the schema declares are selected. An entity carrying triples the
 * schema does not mention keeps them in the store untouched; they simply do not
 * materialise onto the object, which is LDKit's behaviour too.
 */
import {
  describeSchema,
  projectionPredicate,
  type EntitySchemaInfo,
} from './schemaIntrospection.js';
import { iri, RDF_TYPE } from './sparqlTerms.js';

/**
 * A property the schema declares without `@optional` is a *filter*, not just a
 * value: LDKit's `find()` requires it, so an entity missing one is not returned at
 * all. Reproducing that is what keeps the two adapters agreeing on which entities
 * exist, not merely on their contents.
 *
 * Those required patterns multiply rows when a required property holds several
 * values, so the projection is DISTINCT. RDF holds no duplicate triples, so this
 * cannot collapse a value a caller should have seen.
 */
function buildSelect(info: EntitySchemaInfo, subjectPattern: string): string {
  const required = info.fields.filter((field) => !field.isOptional);
  const anchor = [
    subjectPattern,
    ...required.map((field, index) => `?id ${iri(field.predicate)} ?required${index} .`),
  ].join('\n    ');

  const blocks = info.fields.map(
    (field) =>
      `  {\n` +
      `    ${anchor}\n` +
      `    ?id ${iri(field.predicate)} ?o .\n` +
      `    BIND(${iri(field.predicate)} AS ?p)\n` +
      `  }`,
  );

  /*
   * A declared `@projects` becomes one more block: follow the reference and
   * read a property on the far side, tagged with a synthetic predicate so the
   * value travels in the same `?id ?p ?o` shape as everything else.
   *
   * Doing it here rather than after the read is what makes the projection the
   * store's job. The alternative — resolving each reference against the entity
   * cache once the rows are assembled — only works while both the entity and
   * its target happen to be cached, and quietly yields nothing when they are
   * not. A join has no such condition.
   *
   * It is a block, not an OPTIONAL: this is a UNION of blocks and an entity
   * with no reference simply contributes no row for it, which is exactly what
   * `applyDefaults` turns back into null.
   */
  blocks.push(
    ...projectionBlocks(info, anchor),
  );

  // A type with no declared properties still needs its instances enumerated.
  if (blocks.length === 0) {
    return `SELECT DISTINCT ?id ?p ?o WHERE {\n  ${anchor}\n  BIND(${iri(RDF_TYPE)} AS ?p)\n  BIND(${iri(info.classIri)} AS ?o)\n}`;
  }

  return `SELECT DISTINCT ?id ?p ?o WHERE {\n${blocks.join('\n  UNION\n')}\n}`;
}

/**
 * One block per declared projection: follow the reference, read the far-side
 * predicate, tag the value so the assembler recognises it.
 *
 * The predicate and datatype come resolved from `describeSchema`, which reads
 * them off the property being projected — so they are stated once, on that
 * property, rather than repeated in the declaration.
 */
function projectionBlocks(info: EntitySchemaInfo, anchor: string): string[] {
  const blocks: string[] = [];

  for (const [predicate, projection] of info.projectionByPredicate) {
    blocks.push(
      `  {\n` +
        `    ${anchor}\n` +
        `    ?id ${iri(projection.via)} ?projected .\n` +
        `    ?projected ${iri(projection.targetPredicate)} ?o .\n` +
        `    BIND(${iri(predicate)} AS ?p)\n` +
        `  }`,
    );
  }

  return blocks;
}

/** Reads every stored instance of an entity type. */
export function generateFindAllQuery(schema: Record<string, unknown>): string {
  const info = describeSchema(schema);
  return buildSelect(info, `?id ${iri(RDF_TYPE)} ${iri(info.classIri)} .`);
}

/**
 * Reads one instance by IRI. The id is inlined as a bound subject rather than a
 * `VALUES` clause because these queries bypass argument substitution — they are
 * generated per call, not stored and parameterised.
 */
export function generateFindByIriQuery(schema: Record<string, unknown>, id: string): string {
  const info = describeSchema(schema);
  return buildSelect(info, `BIND(${iri(id)} AS ?id)\n    ?id ${iri(RDF_TYPE)} ${iri(info.classIri)} .`);
}
