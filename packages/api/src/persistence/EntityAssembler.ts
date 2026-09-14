/**
 * Materialises `?id ?p ?o` rows into typed entity objects.
 *
 * This is the replacement for LDKit's decoder, and LDKit's observed output is the
 * specification — the parity harness (`test/persistence/readParity.test.ts`) diffs
 * the two against the same store, so any drift in datatype handling shows up as a
 * failing test rather than a subtly wrong entity.
 *
 * Conventions it reproduces, each confirmed by probing a real lens rather than
 * read off the schema types (the entity interfaces disagree with the runtime in
 * one important place — see `dateTime` below):
 * - identity is `$id` alone. The lens emits no `@id`/`@type`; `loadAll` adds them
 *   afterwards, so that normalisation lives in the adapter, not here.
 * - `@array` properties are *always* an array, `[]` when nothing is stored,
 *   whether or not they are also `@optional`.
 * - an absent `@optional` scalar materialises as `null`, not as a missing key.
 * - `xsd:dateTime` materialises as a **`Date`**, despite the entity interfaces
 *   declaring `string` — they are only honest after JSON serialisation.
 * - a non-array property with several stored values keeps the first row seen, which
 *   is what LDKit does; the store is not supposed to contain them.
 */
import type { SparqlBindingValue } from '@sparql-query-lib/types';
import { describeSchema, type EntityField, type FieldKind } from './schemaIntrospection.js';

export type BindingRow = Record<string, SparqlBindingValue | undefined>;

function coerceLiteral(raw: string, kind: FieldKind, field: string, id: string): unknown {
  switch (kind) {
    case 'iri':
    case 'string':
      return raw;
    case 'dateTime': {
      // A `Date`, not a string — matching the lens. An unparseable stored value
      // would otherwise become `Invalid Date` and travel silently into the cache.
      const value = new Date(raw);
      if (Number.isNaN(value.getTime())) {
        throw new Error(`Expected an xsd:dateTime for ${field} on ${id} but stored value was ${JSON.stringify(raw)}.`);
      }
      return value;
    }
    case 'integer': {
      const value = Number.parseInt(raw, 10);
      if (Number.isNaN(value)) {
        throw new Error(`Expected an integer for ${field} on ${id} but stored value was ${JSON.stringify(raw)}.`);
      }
      return value;
    }
    case 'decimal': {
      const value = Number.parseFloat(raw);
      if (Number.isNaN(value)) {
        throw new Error(`Expected a decimal for ${field} on ${id} but stored value was ${JSON.stringify(raw)}.`);
      }
      return value;
    }
    case 'boolean':
      // xsd:boolean permits the lexical forms "1" and "0" as well as true/false.
      return raw === 'true' || raw === '1';
    case 'json':
      return coerceJson(raw, field, id);
  }
}

/**
 * A JSON property's stored document, or `null` where it cannot be read as one.
 *
 * Unparseable is *not* thrown on, which is the one place this decoder is
 * deliberately lenient. Stores written before `rdf:JSON` existed hold the
 * literal `"[object Object]"` for these properties (issue #305), and they are
 * read by `loadAll` at startup — throwing would turn one mangled node into an
 * API that cannot boot. `null` is the same value an absent property has, so
 * the node arrives with no config and the graph builder rejects it with the
 * error that names the real problem, while the warning here says which entity
 * needs repairing.
 */
function coerceJson(raw: string, field: string, id: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(
      `[Persistence] ${field} on ${id} is not readable as JSON (stored value: ${JSON.stringify(raw)}); ` +
        `treating it as absent. A value written before this property became rdf:JSON needs rewriting.`,
    );
    return null;
  }
}

function readTerm(term: SparqlBindingValue): string {
  if (typeof term === 'string') return term;
  const value = (term as { value?: unknown }).value;
  return typeof value === 'string' ? value : String(value ?? '');
}

/**
 * Folds rows into entities. Rows for one entity need not be contiguous, so the
 * whole result set is grouped before any entity is finalised.
 */
export function assembleEntities(
  schema: Record<string, unknown>,
  rows: BindingRow[],
): Array<Record<string, unknown>> {
  const info = describeSchema(schema);
  const byId = new Map<string, Record<string, unknown>>();
  const seenScalar = new Map<string, Set<string>>();

  for (const row of rows) {
    const idTerm = row.id;
    const predicateTerm = row.p;
    const objectTerm = row.o;
    if (idTerm === undefined || predicateTerm === undefined || objectTerm === undefined) continue;

    const id = readTerm(idTerm);
    if (!id) continue;

    let entity = byId.get(id);
    if (!entity) {
      entity = { $id: id };
      byId.set(id, entity);
      seenScalar.set(id, new Set());
    }

    const predicate = readTerm(predicateTerm);

    /*
     * A projected value arrives tagged with a synthetic predicate rather than a
     * stored one. It is read-only and always scalar, so it lands directly and
     * takes the first value it sees — the same first-wins rule the scalar path
     * below uses.
     */
    const projection = info.projectionByPredicate.get(predicate);
    if (projection) {
      if (!(projection.name in entity)) {
        entity[projection.name] = coerceLiteral(
          readTerm(objectTerm),
          projection.kind,
          projection.name,
          id,
        );
      }
      continue;
    }

    const field = info.fieldByPredicate.get(predicate);
    // Predicates the schema does not declare are left in the store and ignored here.
    if (!field) continue;

    const value = coerceLiteral(readTerm(objectTerm), field.kind, field.name, id);

    if (field.isArray) {
      const existing = entity[field.name];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        entity[field.name] = [value];
      }
      continue;
    }

    const scalars = seenScalar.get(id)!;
    if (scalars.has(field.name)) continue;
    scalars.add(field.name);
    entity[field.name] = value;
  }

  for (const entity of byId.values()) {
    applyDefaults(info.fields, entity);
  }

  return [...byId.values()];
}

/**
 * Fills in what the lens would emit for properties with nothing stored: `[]` for
 * any array, `null` for an optional scalar. A required scalar is left missing —
 * the read query only matches entities that have one, so its absence here means
 * the row set was hand-built rather than queried.
 */
function applyDefaults(fields: EntityField[], entity: Record<string, unknown>): void {
  for (const field of fields) {
    if (field.name in entity) continue;
    if (field.isArray) {
      entity[field.name] = [];
    } else if (field.isOptional) {
      entity[field.name] = null;
    }
    // A projection contributes no row when the reference is absent or dangles,
    // which is the same absence an optional scalar has, and reads the same way.
    if (field.projects && !(field.projects.as in entity)) {
      entity[field.projects.as] = null;
    }
  }
}

/** Convenience for the single-entity read path. */
export function assembleEntity(
  schema: Record<string, unknown>,
  rows: BindingRow[],
): Record<string, unknown> | null {
  return assembleEntities(schema, rows)[0] ?? null;
}
