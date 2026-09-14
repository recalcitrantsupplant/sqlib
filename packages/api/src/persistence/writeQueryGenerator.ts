/**
 * SPARQL Update generation for the self-hosted adapter.
 *
 * Phase 2 covers deletes (plan §3). Creates and partial updates land here in
 * phases 3-4, where the generation stops being a one-liner.
 */
import { serialiseEntity, serialiseField, toNTriples } from './EntitySerialiser.js';
import { describeSchema } from './schemaIntrospection.js';
import { iri, RDF_TYPE } from './sparqlTerms.js';

/**
 * Writes an entity's triples.
 *
 * `INSERT DATA` rather than `INSERT { } WHERE { }`: the triples are fully ground,
 * so there is nothing to match. It is additive — pre-existing triples for the same
 * subject survive, which is what `lens.insert` does too.
 */
export function generateInsertQuery(
  schema: Record<string, unknown>,
  entity: Record<string, unknown>,
): string {
  return `INSERT DATA {\n${toNTriples(serialiseEntity(schema, entity))}\n}`;
}

/**
 * Removes an entity's own triples, and only those.
 *
 * `lens.delete` leaves triples that *reference* the entity in place — verified
 * against a live lens — so a deleted entity's inbound references stay dangling.
 * That is deliberate at this layer: cascade semantics live above the adapter
 * (`CacheCoordinator` and the version-cascade paths), and widening the delete
 * here would silently change them.
 *
 * `DELETE WHERE` rather than `DELETE { } WHERE { }`: it deletes exactly the
 * triples the pattern matches, and is a no-op when the entity does not exist —
 * which is also what the lens does.
 */
export function generateDeleteQuery(id: string): string {
  return `DELETE WHERE { ${iri(id)} ?p ?o }`;
}

/**
 * Replaces the values of the patched properties, leaving every other property
 * alone. Returns `null` when the patch touches nothing the schema declares, so
 * callers can skip a pointless round trip.
 *
 * The shape is one `DELETE`/`INSERT`/`WHERE`, and two details in it are the whole
 * point of this phase:
 *
 * 1. **Every old-value pattern is wrapped in `OPTIONAL`.** LDKit did not do this,
 *    which is documented bug class #1: a required pattern for a property the entity
 *    does not have yet makes the WHERE match nothing, so the update silently
 *    becomes a no-op while still reporting success. Wrapping means an absent
 *    property is simply nothing to delete.
 * 2. **Scalars and arrays are generated identically** — delete whatever is there,
 *    insert whatever was given. Bug class #2 was a mixed scalar+array update
 *    failing; there is no "mixed" case here to get wrong, because no code path
 *    distinguishes them.
 *
 * The WHERE is anchored on `?id a <Class>`, deliberately *not* optional: an update
 * to an entity that does not exist must be a no-op, matching the lens. Without the
 * anchor an all-`OPTIONAL` WHERE matches the empty solution and the INSERT would
 * conjure an entity from a patch.
 *
 * Note the anchor plus several multi-valued properties yields a cross-product of
 * solutions. That is harmless — deleting a triple twice and inserting a ground
 * triple twice are both idempotent — and the alternative (one update per property)
 * loses atomicity, which is what bug class #2 was about.
 */
export function generateUpdateQuery(
  schema: Record<string, unknown>,
  id: string,
  patch: Record<string, unknown>,
): string | null {
  const info = describeSchema(schema);
  const subject = iri(id);

  const patched = info.fields.filter(
    // `undefined` means "not being patched" — verified against the lens, which
    // leaves such a property untouched rather than clearing it. An explicit
    // `null`, or an empty array, clears the property: there is a value in the
    // patch, and it has no triples.
    (field) => field.name in patch && patch[field.name] !== undefined,
  );
  if (patched.length === 0) return null;

  const deletes: string[] = [];
  const inserts: string[] = [];
  const wheres: string[] = [`  ${subject} ${iri(RDF_TYPE)} ${iri(info.classIri)} .`];

  patched.forEach((field, index) => {
    const variable = `?old${index}`;
    const pattern = `${subject} ${iri(field.predicate)} ${variable} .`;
    deletes.push(`  ${pattern}`);
    wheres.push(`  OPTIONAL { ${pattern} }`);

    for (const triple of serialiseField(field, patch[field.name], id)) {
      inserts.push(`  ${triple.subject} ${triple.predicate} ${triple.object} .`);
    }
  });

  const insertBlock = inserts.length ? `INSERT {\n${inserts.join('\n')}\n}\n` : '';
  return `DELETE {\n${deletes.join('\n')}\n}\n${insertBlock}WHERE {\n${wheres.join('\n')}\n}`;
}
