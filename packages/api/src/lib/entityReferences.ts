/**
 * Reading a property's `@references` declaration, and checking a payload's IRIs
 * against it.
 *
 * "This `isPartOf` entry has to be a `Library`" was written out eight times in
 * the route handlers — four creates and four updates, across data blocks,
 * queries, rules and rule sets — as an inline `entity['@type'] === 'Library'`
 * filter. The rule now lives on the property (issue #65 Phase B3) and this
 * module is what the handlers read it through.
 *
 * `analyse` deliberately returns findings rather than a verdict. The handlers
 * do not phrase the same failure the same way ("must be part of exactly one
 * library" vs "must belong to exactly one library") and do not check in the
 * same order, and collapsing *those* differences is a wording change, not a
 * consolidation. What is shared is the rule; the message stays where the
 * endpoint is.
 */

import {
  describeSchema,
  type EntityField,
  type ReferenceDeclaration,
} from '../persistence/schemaIntrospection.js';
import { SCHEMA_BY_TYPE } from '../persistence/schemaRegistry.js';
import type { EntityType } from './EntityRegistry.js';

const FIELDS_BY_TYPE = new Map<EntityType, Map<string, EntityField>>();

function fieldsFor(type: EntityType): Map<string, EntityField> {
  let fields = FIELDS_BY_TYPE.get(type);
  if (!fields) {
    const info = describeSchema(SCHEMA_BY_TYPE[type] as unknown as Record<string, unknown>);
    fields = new Map(info.fields.map(field => [field.name, field]));
    FIELDS_BY_TYPE.set(type, fields);
  }
  return fields;
}

/** The declaration for one property, or `null` where the model has no opinion. */
export function referencesFor(type: EntityType, property: string): ReferenceDeclaration | null {
  return fieldsFor(type).get(property)?.references ?? null;
}

/**
 * The declaration for one property, or a throw.
 *
 * For call sites whose whole purpose is to enforce the rule: a handler that
 * silently stopped checking because a declaration was renamed away is exactly
 * the permissive failure this replaces.
 */
export function requireReferences(type: EntityType, property: string): ReferenceDeclaration {
  const declaration = referencesFor(type, property);
  if (!declaration) {
    throw new Error(
      `${type}.${property} has no "@references" declaration; add one to its entity schema.`,
    );
  }
  return declaration;
}

/** Every property name on an entity's schema, `@type` aside. */
export type SchemaProperty<T extends EntityType> = Exclude<
  keyof (typeof SCHEMA_BY_TYPE)[T],
  '@type'
> &
  string;

/**
 * The types a property's IRI may resolve to.
 *
 * Typed on the property name, so a rule naming a field that the entity does not
 * have — or that stopped being a reference — fails to compile rather than
 * quietly matching nothing.
 */
export function referenceTypesOf<T extends EntityType>(
  type: T,
  property: SchemaProperty<T>,
): readonly EntityType[] {
  return requireReferences(type, property).types;
}

/** What a resolver hands back for an IRI: the entity, or nothing. */
export type EntityLookup = (iri: string) => { '@type'?: unknown } | null | undefined;

export interface ReferenceFindings {
  /** IRIs nothing resolved, in input order. */
  missing: string[];
  /** IRIs that resolved to a type the declaration does not permit. */
  wrongType: { reference: string; type: string; allowed: readonly string[] }[];
  /**
   * How many values resolved to the declaration's `exactlyOne` type — the
   * library among a query's parents. `null` when the property declares none.
   */
  exactlyOneCount: number | null;
}

/**
 * Check a property's values against its declaration.
 *
 * Everything is accumulated: a payload with two bad parents should say so in
 * one round trip, and the handler picks which finding it reports first.
 */
export function analyseReferences(
  type: EntityType,
  property: string,
  values: readonly string[],
  lookup: EntityLookup,
): ReferenceFindings {
  const declaration = requireReferences(type, property);
  const allowed = new Set<string>(declaration.types);

  const findings: ReferenceFindings = {
    missing: [],
    wrongType: [],
    exactlyOneCount: declaration.exactlyOne ? 0 : null,
  };

  for (const reference of values) {
    const entity = lookup(reference);
    if (!entity) {
      findings.missing.push(reference);
      continue;
    }

    const resolvedType = entity['@type'];
    if (typeof resolvedType !== 'string' || !allowed.has(resolvedType)) {
      findings.wrongType.push({
        reference,
        type: typeof resolvedType === 'string' ? resolvedType : 'unknown',
        allowed: declaration.types,
      });
      continue;
    }

    if (resolvedType === declaration.exactlyOne) {
      findings.exactlyOneCount = (findings.exactlyOneCount ?? 0) + 1;
    }
  }

  return findings;
}

/** `parent is a Backend, expected Library or QueryGroup` — one wrong-type finding, in prose. */
export function describeWrongType(finding: ReferenceFindings['wrongType'][number]): string {
  return `Referenced entity ${finding.reference} is a ${finding.type}, expected ${finding.allowed.join(' or ')}`;
}
