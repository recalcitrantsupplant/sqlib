/**
 * Reads an LDKit schema object into a neutral field description.
 *
 * The schemas in `persistence/schemas/` are the IR that outlives LDKit
 * (plan §0), but their shape is LDKit's: a `@type` class IRI plus one entry per
 * property carrying `@id` (predicate), an optional `@type` (datatype IRI or
 * `ldkit:IRI`), and the `@array` / `@optional` flags. Everything downstream of
 * this module — query generation, entity assembly — works from `EntityField`
 * rather than reaching into schema objects directly, so taking ownership of the
 * format later (consolidation Phase B) touches only this file.
 *
 * The schemas are flat by convention: properties are literals or IRI references,
 * never nested anonymous nodes. That is what makes generation tractable, so it is
 * asserted here rather than assumed silently.
 */

import { type EntityTypeName, isEntityTypeName } from './entityTypeNames.js';
import { SCHEMA_BY_TYPE } from './schemaRegistry.js';

export const LDKIT_IRI_TYPE = 'https://ldkit.io/ontology/IRI';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * The datatype marking a property whose object is a JSON document.
 *
 * The counterpart of `LDKIT_IRI_TYPE`: both are markers saying "this object is
 * not a plain literal". Without it a structured value reached the serialiser's
 * string fallback and was stored as `String(value)` — the literal
 * `"[object Object]"` — which read back as a string and silently emptied every
 * ephemeral backend config on the next cache rebuild (issue #305).
 */
export const RDF_JSON_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON';

/** How a stored RDF term is materialised into a JavaScript value. */
export type FieldKind = 'iri' | 'string' | 'integer' | 'decimal' | 'boolean' | 'dateTime' | 'json';

export interface EntityField {
  /** Property name on the entity object, e.g. `dateModified`. */
  name: string;
  /** Predicate IRI the value is stored under. */
  predicate: string;
  /**
   * How the stored term becomes a JavaScript value. Several datatypes share a
   * kind — `xsd:anyURI` and `xsd:duration` both decode to strings — so this does
   * *not* determine how the value is written back; `datatype` does.
   */
  kind: FieldKind;
  /**
   * The RDF datatype to write literals with, or `null` for an IRI reference or a
   * plain literal. Keeping this separate from `kind` matters: writing
   * `xsd:duration` as a plain literal round-trips through the assembler perfectly
   * well but is not the triple LDKit writes, and a store that validates typed
   * literals treats the two very differently.
   */
  datatype: string | null;
  /**
   * The permitted values as `API token -> stored RDF value`, or `null` where the
   * property admits any value of its datatype. Assembly reads a stored value
   * regardless of the vocabulary — it is the contract emission that narrows to
   * these tokens — so this is carried, not enforced, here.
   */
  values: Readonly<Record<string, string>> | null;
  /**
   * What this IRI may resolve to, or `null` where the model has no opinion.
   * Carried, not enforced: resolving a reference needs the store, which this
   * module has no business knowing about.
   */
  references: ReferenceDeclaration | null;
  /** A regex every value must match, or `null`. See `Property['@pattern']`. */
  pattern: string | null;
  /**
   * The name of this JSON property's declared document shape, or `null`.
   *
   * Carried, not enforced: at the persistence layer a JSON document is a JSON
   * document. It is the contract generator that turns the name into a schema.
   */
  jsonShape: string | null;
  /**
   * A value to surface on read by following this IRI, or `null`. Carried, not
   * resolved: following the reference needs the store, which this module has
   * no business knowing about — the same division `references` keeps.
   */
  projects: ProjectionDeclaration | null;
  isArray: boolean;
  isOptional: boolean;
}

/** A property's declared read-time projection. See `Property['@projects']`. */
export interface ProjectionDeclaration {
  /** Field name on the reading entity. */
  as: string;
  /** Property read from the referenced entity. */
  property: string;
  /** The single entity type the reference resolves to. */
  targetType: EntityTypeName;
}

/** A property's declared reference targets. See `Property['@references']`. */
export interface ReferenceDeclaration {
  types: readonly EntityTypeName[];
  /** For an array property: the type that must appear exactly once. */
  exactlyOne: EntityTypeName | null;
}

export interface EntitySchemaInfo {
  /** The `rdf:type` IRI every instance carries. */
  classIri: string;
  fields: EntityField[];
  fieldByPredicate: Map<string, EntityField>;
  /**
   * Projections, keyed by the synthetic predicate the read query tags them
   * with. They are not stored triples — nothing in the graph carries this
   * predicate — it exists so a projected value can travel in the same
   * `?id ?p ?o` shape as everything else and be recognised on the way back.
   */
  projectionByPredicate: Map<string, ProjectedField>;
}

/** A projection, resolved against both the property declaring it and its target. */
export interface ProjectedField {
  /** Field name the value lands on. */
  name: string;
  /** Predicate to follow from the entity. */
  via: string;
  /** Predicate to read on the far side. */
  targetPredicate: string;
  /** How the far-side value decodes — the target property's own kind. */
  kind: FieldKind;
  /** The entity type the reference resolves to. */
  targetType: EntityTypeName;
}

/**
 * The synthetic predicate a projected value is tagged with in a read query.
 *
 * Deliberately in a `urn:sqlib:projection:` space that no entity schema
 * declares, so it can never collide with a real predicate and can never be
 * mistaken for one if it leaks into a store.
 */
export function projectionPredicate(entityClassIri: string, fieldName: string): string {
  return `urn:sqlib:projection:${encodeURIComponent(entityClassIri)}:${fieldName}`;
}

/**
 * LDKit writes `ldkit:IRI` for references; everything else is an xsd datatype,
 * and an absent `@type` means a plain string literal.
 */
function resolveKind(rawType: string | undefined, property: string, classIri: string): FieldKind {
  if (rawType === undefined) return 'string';
  if (rawType === LDKIT_IRI_TYPE) return 'iri';
  if (rawType === RDF_JSON_TYPE) return 'json';

  if (!rawType.startsWith(XSD)) {
    throw new Error(
      `Unsupported datatype "${rawType}" on ${classIri}.${property}. ` +
        `Only xsd datatypes, ldkit:IRI and rdf:JSON are supported — see packages/api/src/persistence/schemaIntrospection.ts.`,
    );
  }

  switch (rawType.slice(XSD.length)) {
    case 'string':
      return 'string';
    case 'integer':
    case 'int':
    case 'long':
      return 'integer';
    case 'decimal':
    case 'double':
    case 'float':
      return 'decimal';
    case 'boolean':
      return 'boolean';
    case 'dateTime':
      return 'dateTime';
    // `anyURI` and `duration` are *literal* datatypes, unlike `ldkit:IRI` which
    // makes the object an IRI node. LDKit converts only numerics, booleans and
    // dates; everything else keeps its lexical form, and both are declared
    // `string` by the entity interfaces. Verified against a live lens.
    case 'anyURI':
    case 'duration':
      return 'string';
    default:
      throw new Error(
        `Unsupported xsd datatype "${rawType}" on ${classIri}.${property}. ` +
          `Add it to resolveKind() in packages/api/src/persistence/schemaIntrospection.ts if it is genuinely needed.`,
      );
  }
}

/**
 * The datatype literals are written with, or `null` for a plain literal / IRI.
 *
 * `xsd:string` maps to `null` because LDKit writes those as plain literals, and
 * RDF 1.1 makes the two the same term regardless.
 */
function resolveDatatype(rawType: string | undefined): string | null {
  if (rawType === undefined || rawType === LDKIT_IRI_TYPE || rawType === `${XSD}string`) {
    return null;
  }
  return rawType;
}

type RawSchemaProperty = {
  '@id': string;
  '@type'?: string;
  '@array'?: boolean;
  '@optional'?: boolean;
  '@values'?: Record<string, string>;
  '@references'?: unknown;
  '@pattern'?: unknown;
  '@projects'?: unknown;
  '@jsonShape'?: unknown;
};

/**
 * A JSON property's declared shape name.
 *
 * Only the name is resolved here; what the shape *is* lives in `jsonShapes.ts`
 * and is read by the contract generator. A shape on a non-JSON property is an
 * error rather than an ignored key — it would otherwise read as a constraint
 * that is silently doing nothing.
 */
function resolveJsonShape(
  raw: unknown,
  property: string,
  classIri: string,
  isJson: boolean,
): string | null {
  if (raw === undefined) return null;

  const where = `Property "${property}" on ${classIri}`;
  if (!isJson) {
    throw new Error(
      `${where} declares "@jsonShape" but is not an rdf:JSON property; there is no document to shape.`,
    );
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`${where} declares "@jsonShape" that is not a non-empty name.`);
  }
  return raw;
}

/**
 * A property's declared value vocabulary, as `API token -> stored RDF value`.
 *
 * Assembly does not use it — a vocabulary constrains which values are legal,
 * not how a legal one decodes — but this is the one module that reads the schema
 * format, so it is where a malformed declaration is caught rather than silently
 * emitting an empty `enum` into the published contract.
 */
function resolveValues(
  raw: unknown,
  property: string,
  classIri: string,
): Readonly<Record<string, string>> | null {
  if (raw === undefined) return null;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(
      `Property "${property}" on ${classIri} declares "@values" that is not an object of token -> value.`,
    );
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error(`Property "${property}" on ${classIri} declares an empty "@values" vocabulary.`);
  }

  const seen = new Map<string, string>();
  for (const [token, value] of entries) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `Property "${property}" on ${classIri} maps "@values" token "${token}" to a non-string value.`,
      );
    }
    const clash = seen.get(value);
    if (clash !== undefined) {
      throw new Error(
        `Property "${property}" on ${classIri} maps tokens "${clash}" and "${token}" to the same value ${value}; ` +
          `a stored value could not be translated back to one token.`,
      );
    }
    seen.set(value, token);
  }

  return raw as Readonly<Record<string, string>>;
}

/**
 * A property's declared reference targets.
 *
 * The type names are checked against `ENTITY_TYPE_NAMES` here rather than left
 * to TypeScript alone: the schema objects are read as plain data by the
 * generators, and a name that no longer exists would otherwise turn into a
 * reference rule that can never match — the permissive failure the hand-written
 * table had.
 */
/**
 * A projection is only meaningful where there is something to follow and one
 * schema to follow it into, so both are errors at the schema rather than
 * surprises at read time: a non-IRI property has no target, and two possible
 * targets give two answers to "what type is this field?".
 *
 * Arrays are rejected for the same reason — projecting many values into one
 * field has no obvious meaning, and no caller has asked for it.
 */
function resolveProjection(
  raw: unknown,
  property: string,
  classIri: string,
  isIri: boolean,
  isArray: boolean,
  references: ReferenceDeclaration | null,
): ProjectionDeclaration | null {
  if (raw === undefined) return null;

  const where = `Property "${property}" on ${classIri}`;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${where} declares "@projects" that is not an object.`);
  }
  if (!isIri) {
    throw new Error(
      `${where} declares "@projects" but is not an IRI property; there is nothing to follow.`,
    );
  }
  if (isArray) {
    throw new Error(
      `${where} declares "@projects" on an array property; projecting many values into one field has no defined meaning.`,
    );
  }
  if (!references || references.types.length !== 1) {
    throw new Error(
      `${where} declares "@projects" without "@references" naming exactly one type; ` +
        `the target's schema is what says whether the projected property exists.`,
    );
  }

  const { as, property: targetProperty } = raw as { as?: unknown; property?: unknown };
  if (typeof as !== 'string' || as.length === 0) {
    throw new Error(`${where} declares "@projects" without a non-empty "as" field name.`);
  }
  if (typeof targetProperty !== 'string' || targetProperty.length === 0) {
    throw new Error(`${where} declares "@projects" without a non-empty "property" to read.`);
  }

  return { as, property: targetProperty, targetType: references.types[0]! };
}

function resolveReferences(
  raw: unknown,
  property: string,
  classIri: string,
  isIri: boolean,
  isArray: boolean,
): ReferenceDeclaration | null {
  if (raw === undefined) return null;

  const where = `Property "${property}" on ${classIri}`;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${where} declares "@references" that is not an object.`);
  }
  if (!isIri) {
    throw new Error(
      `${where} declares "@references" but is not an IRI property; only "@type": ldkit.IRI values resolve to entities.`,
    );
  }

  const { types, exactlyOne } = raw as { types?: unknown; exactlyOne?: unknown };

  if (!Array.isArray(types) || types.length === 0) {
    throw new Error(`${where} declares "@references" without a non-empty "types" list.`);
  }
  const seen = new Set<string>();
  for (const type of types) {
    if (!isEntityTypeName(type)) {
      throw new Error(
        `${where} declares "@references" to "${String(type)}", which is not an entity type.`,
      );
    }
    if (seen.has(type)) {
      throw new Error(`${where} lists "${type}" twice in "@references".`);
    }
    seen.add(type);
  }

  if (exactlyOne !== undefined) {
    if (!isEntityTypeName(exactlyOne) || !seen.has(exactlyOne)) {
      throw new Error(
        `${where} declares "exactlyOne": "${String(exactlyOne)}", which is not among its reference types.`,
      );
    }
    if (!isArray) {
      throw new Error(
        `${where} declares "exactlyOne" on a scalar property; a single value is already exactly one.`,
      );
    }
  }

  return {
    types: types as readonly EntityTypeName[],
    exactlyOne: (exactlyOne as EntityTypeName | undefined) ?? null,
  };
}

/**
 * A property's declared pattern.
 *
 * Compiled here so an unparseable regex fails at the schema rather than being
 * emitted into the published contract, where ajv would reject every value and
 * the failure would read as a bad request.
 */
function resolvePattern(raw: unknown, property: string, classIri: string): string | null {
  if (raw === undefined) return null;

  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`Property "${property}" on ${classIri} declares a "@pattern" that is not a string.`);
  }
  try {
    new RegExp(raw);
  } catch (error) {
    throw new Error(
      `Property "${property}" on ${classIri} declares "@pattern" ${raw}, which is not a valid regular expression: ${(error as Error).message}`,
    );
  }
  return raw;
}

export function describeSchema(schema: Record<string, unknown>): EntitySchemaInfo {
  const classIri = schema['@type'];
  if (typeof classIri !== 'string') {
    throw new Error('Entity schema is missing its "@type" class IRI.');
  }

  const fields: EntityField[] = [];
  for (const [name, raw] of Object.entries(schema)) {
    if (name === '@type') continue;

    // A bare `predicate: 'iri'` shorthand is legal LDKit but unused here; rejecting
    // it keeps one code path rather than two that can drift.
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(
        `Property "${name}" on ${classIri} is not an object. ` +
          `Shorthand property definitions are not supported by the self-hosted mapper.`,
      );
    }

    const property = raw as RawSchemaProperty;
    if (typeof property['@id'] !== 'string') {
      throw new Error(`Property "${name}" on ${classIri} is missing its "@id" predicate IRI.`);
    }
    // A nested schema object (a property whose own value has an `@type` class and
    // sub-properties) would need recursive assembly. The corpus has none; fail loudly
    // rather than silently mis-assembling if one appears.
    if ('@schema' in property || '@context' in property) {
      throw new Error(
        `Property "${name}" on ${classIri} declares a nested schema. ` +
          `The self-hosted mapper assumes flat entities with IRI references (plan §1).`,
      );
    }

    const kind = resolveKind(property['@type'], name, classIri);
    const isArray = property['@array'] === true;
    const references = resolveReferences(property['@references'], name, classIri, kind === 'iri', isArray);
    fields.push({
      name,
      predicate: property['@id'],
      kind,
      datatype: resolveDatatype(property['@type']),
      values: resolveValues(property['@values'], name, classIri),
      references,
      pattern: resolvePattern(property['@pattern'], name, classIri),
      jsonShape: resolveJsonShape(property['@jsonShape'], name, classIri, kind === 'json'),
      projects: resolveProjection(property['@projects'], name, classIri, kind === 'iri', isArray, references),
      isArray,
      isOptional: property['@optional'] === true,
    });
  }

  const fieldByPredicate = new Map<string, EntityField>();
  for (const field of fields) {
    const clash = fieldByPredicate.get(field.predicate);
    if (clash) {
      throw new Error(
        `Properties "${clash.name}" and "${field.name}" on ${classIri} share predicate ${field.predicate}; ` +
          `assembly could not tell their values apart.`,
      );
    }
    fieldByPredicate.set(field.predicate, field);
  }

  /*
   * Resolved against the target's schema, so the far-side predicate and
   * datatype are stated once — on the property being projected — rather than
   * repeated in the declaration and left to drift from it.
   */
  const projectionByPredicate = new Map<string, ProjectedField>();
  for (const field of fields) {
    if (!field.projects) continue;
    const { as, property: targetProperty, targetType } = field.projects;

    const targetSchema = SCHEMA_BY_TYPE[targetType as keyof typeof SCHEMA_BY_TYPE] as
      | Record<string, unknown>
      | undefined;
    if (!targetSchema) {
      throw new Error(`${classIri}.${field.name} projects from ${targetType}, which has no schema.`);
    }

    const rawTarget = targetSchema[targetProperty];
    if (typeof rawTarget !== 'object' || rawTarget === null || Array.isArray(rawTarget)) {
      throw new Error(
        `${classIri}.${field.name} projects "${targetProperty}", which ${targetType} does not have.`,
      );
    }

    const target = rawTarget as RawSchemaProperty;
    projectionByPredicate.set(projectionPredicate(classIri, as), {
      name: as,
      via: field.predicate,
      targetPredicate: target['@id'],
      kind: resolveKind(target['@type'], targetProperty, targetType),
      targetType,
    });
  }

  return { classIri, fields, fieldByPredicate, projectionByPredicate };
}
