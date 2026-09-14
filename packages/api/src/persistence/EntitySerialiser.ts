/**
 * Turns a typed entity into the triples that represent it — the inverse of
 * `EntityAssembler`, and the half of the mapper that templates cannot express
 * (plan §1: a nested/array-valued entity is structurally variable).
 *
 * Behaviours reproduced from a live lens, and the one that is not:
 * - `xsd:string` is written as a *plain* literal, with no datatype. LDKit does
 *   the same, and in RDF 1.1 the two are the same term regardless.
 * - `null`/`undefined` produce no triple. This is where the sanitising insert
 *   wrapper’s null-stripping belongs: at the point values
 *   become triples, rather than as a pre-pass over the object graph.
 * - Properties the schema does not declare are ignored, as are `$id`/`@id`/`@type`.
 * - **Divergence:** a `Date` value for an `xsd:dateTime` property is serialised.
 *   LDKit silently writes *no triple* for one — which matters because reads
 *   return `Date`, so a read-modify-write round-trip through LDKit drops the
 *   field. Preserving that would mean reproducing data loss; `EntitySerialiser`
 *   writes it, and `createParity` documents the divergence with a test.
 */
import { describeSchema, type EntityField } from './schemaIntrospection.js';
import { iri, literal, RDF_TYPE } from './sparqlTerms.js';

/** A single triple, already serialised to N-Triples terms. */
export type SerialisedTriple = { subject: string; predicate: string; object: string };

function serialiseValue(value: unknown, { kind, datatype }: EntityField, field: string, id: string): string {
  if (kind === 'iri') {
    if (typeof value !== 'string') {
      throw new Error(`Expected an IRI string for ${field} on ${id} but received ${typeof value}.`);
    }
    return iri(value);
  }

  if (kind === 'dateTime') {
    // A string is passed through verbatim rather than round-tripped through
    // `Date`: that would rewrite the offset to UTC, and the stored lexical form
    // is what write-parity compares.
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new Error(`Refusing to serialise an invalid Date for ${field} on ${id}.`);
      }
      return literal(value.toISOString(), datatype);
    }
    if (typeof value !== 'string') {
      throw new Error(`Expected an xsd:dateTime string or Date for ${field} on ${id} but received ${typeof value}.`);
    }
    return literal(value, datatype);
  }

  if (kind === 'json') {
    // Without this case a structured value fell through to the string default
    // below and `String(value)` stored the literal `"[object Object]"`, which
    // read back as a string and silently emptied the property (issue #305).
    // `undefined` never arrives — `serialiseField` drops it before here — so
    // `JSON.stringify` cannot return `undefined`.
    try {
      return literal(JSON.stringify(value), datatype);
    } catch (error) {
      throw new Error(
        `Could not serialise ${field} on ${id} as JSON: ${(error as Error).message}`,
      );
    }
  }

  if (kind === 'boolean') {
    return literal(value === true || value === 'true' ? 'true' : 'false', datatype);
  }

  if (kind === 'integer' || kind === 'decimal') {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Expected a number for ${field} on ${id} but received ${JSON.stringify(value)}.`);
    }
    if (kind === 'integer' && !Number.isInteger(numeric)) {
      throw new Error(`Expected an integer for ${field} on ${id} but received ${numeric}.`);
    }
    return literal(String(numeric), datatype);
  }

  return literal(typeof value === 'string' ? value : String(value), datatype);
}

/**
 * Serialises an entity to triples, including its `rdf:type`.
 *
 * No required-property check happens here: the store, not the serialiser, is the
 * authority on what a valid entity is, and enforcing minimums at write time is
 * exactly the "minimum data at creation" workaround this phase removes.
 */
export function serialiseEntity(
  schema: Record<string, unknown>,
  entity: Record<string, unknown>,
): SerialisedTriple[] {
  const info = describeSchema(schema);
  const id = entity.$id ?? entity['@id'];
  if (typeof id !== 'string' || !id) {
    throw new Error('Cannot serialise an entity without a $id.');
  }

  const subject = iri(id);
  const triples: SerialisedTriple[] = [
    { subject, predicate: iri(RDF_TYPE), object: iri(info.classIri) },
  ];

  for (const field of info.fields) {
    triples.push(...serialiseField(field, entity[field.name], id));
  }

  return triples;
}

/**
 * The object terms one property contributes. Shared with update generation, which
 * needs a property's triples without the surrounding entity.
 *
 * `null`/`undefined` produce nothing — including inside arrays, which is where the
 * sanitising insert wrapper's filtering ends up.
 */
export function serialiseField(
  field: EntityField,
  value: unknown,
  id: string,
): SerialisedTriple[] {
  if (value === null || value === undefined) return [];

  const subject = iri(id);
  const values = field.isArray ? (Array.isArray(value) ? value : [value]) : [value];

  return values
    .filter((item) => item !== null && item !== undefined)
    .map((item) => ({
      subject,
      predicate: iri(field.predicate),
      object: serialiseValue(item, field, field.name, id),
    }));
}

/** Renders triples as N-Triples lines. */
export function toNTriples(triples: SerialisedTriple[]): string {
  return triples.map(({ subject, predicate, object }) => `${subject} ${predicate} ${object} .`).join('\n');
}
