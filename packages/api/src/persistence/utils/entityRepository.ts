/**
 * Entity repositories: the per-type read/write handles the rest of the codebase
 * uses (`Backends.insert(...)`, `QueryNodes.findByIri(...)`, and so on).
 *
 * These were LDKit lenses. LDKit is gone (plan §3 Phase 5) and they are now thin
 * bindings onto `EntityStore`, which generates SPARQL from the same schema objects
 * and runs it through the standard executor. The shape is unchanged, so every call
 * site is unaffected; what changed is that there is one persistence implementation
 * instead of two behind a flag.
 *
 * Null-stripping that used to happen in a wrapper around `lens.insert` now lives
 * in `EntitySerialiser`, where it belongs: absent values simply produce no triple.
 */
import {
  deleteByIri,
  findAllBySchema,
  findByIriBySchema,
  insertBySchema,
  loadAllEntities,
  updateBySchema,
  type EntitySchema,
} from '../EntityStore.js';
import { SCHEMA_BY_TYPE } from '../schemaRegistry.js';
import type { Schema } from '../schema.js';

/** The handle a repository exposes. Named `Lens` for continuity with the call sites. */
export interface Lens<T = any> {
  find(): Promise<T[]>;
  findByIri(id: string): Promise<T | null>;
  insert(entity: T): Promise<void>;
  update(entity: Partial<T> & { $id: string }): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Binds a repository to one entity schema.
 *
 * Goes straight to `EntityStore` rather than through the type-keyed
 * `PersistenceAdapter`, because a repository already knows its schema and four
 * benchmark types have repositories without being registered as cache types. The
 * adapter is the same engine with a type lookup in front, so both routes generate
 * the same SPARQL.
 */
export function createRepositoryLens<S extends Schema>(schema: S): Lens<any> {
  const entitySchema = schema as unknown as EntitySchema;
  return {
    find: () => findAllBySchema(entitySchema),
    findByIri: (id: string) => findByIriBySchema(entitySchema, id),
    insert: (entity) => insertBySchema(entitySchema, entity as Record<string, unknown>),
    // Call sites pass the patch with `$id` embedded, as the lens did.
    update: ({ $id, ...patch }) => updateBySchema(entitySchema, $id, patch as Record<string, unknown>),
    delete: (id: string) => deleteByIri(id),
  };
}

/**
 * Entity shapes live in the backend-neutral `persistence/` module; re-exported
 * here for the existing import sites.
 */
import type { BaseEntity, LDKitEntity } from '../EntityTypes.js';

export type { BaseEntity, LDKitEntity };

/**
 * Boot load: every entity in the store, keyed by IRI.
 *
 * Goes straight to `EntityStore`, deliberately *not* through the adapter: the
 * adapter's own `loadAll` is the same call, so routing through it would let a
 * test that substitutes an adapter built on this function recurse forever.
 *
 * The previous implementation walked a hand-maintained list of repositories that
 * had drifted — it listed Rule and RuleVersion twice and omitted BooleanIO,
 * QueryIdInput and the ETL types entirely, so those never made it into the boot
 * cache. Deriving the list from `SCHEMA_BY_TYPE` is what fixes that, and
 * `entityTypeCoverage.test.ts` keeps it honest.
 */
export async function loadAllSystemEntities(): Promise<Map<string, LDKitEntity>> {
  return (await loadAllEntities(SCHEMA_BY_TYPE as unknown as Record<string, EntitySchema>)) as Map<string, LDKitEntity>;
}

/**
 * Convert Schema.org SchemaValue types to simple primitive values for LDKit
 * Handles the common pattern of SchemaValue<T> which can be:
 * - A simple value (string, number, boolean)
 * - An object with @value property
 * - An IdReference with @id property 
 * - An array of any of the above
 */
export function extractSimpleValue(value: any): string | undefined {
  if (!value) return undefined;
  
  // Simple primitive value
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value.toString();
  
  // Object with @value property (Schema.org literal)
  if (typeof value === 'object' && '@value' in value) {
    return String(value['@value']);
  }
  
  // Object with @id property (IdReference) - return the IRI
  if (typeof value === 'object' && '@id' in value) {
    return String(value['@id']);
  }
  
  // Array - take first value
  if (Array.isArray(value) && value.length > 0) {
    return extractSimpleValue(value[0]);
  }
  
  return undefined;
}

/**
 * Convert Schema.org SchemaValue array to simple string array for LDKit
 */
export function extractSimpleArray(value: any): string[] {
  if (!value) return [];
  
  if (Array.isArray(value)) {
    return value.map(extractSimpleValue).filter(v => v !== undefined) as string[];
  }
  
  const singleValue = extractSimpleValue(value);
  return singleValue ? [singleValue] : [];
}

/**
 * Convert a Schema.org entity (from factories) to LDKit format
 * This handles the common conversion pattern from factory output to LDKit input
 */
export function convertSchemaToLdkit<T extends Record<string, any>>(
  schemaEntity: Record<string, any>,
  fieldMappings?: Record<string, string>
): Partial<T> {
  const result: Record<string, any> = {};
  
  // Handle @id -> $id conversion and preserve @id
  if (schemaEntity['@id']) {
    result['@id'] = schemaEntity['@id'];  // Preserve @id
    result.$id = schemaEntity['@id'];     // Also set $id
  }
  
  Object.entries(schemaEntity).forEach(([key, value]) => {
    if (key === '@id' || key === '@type') return; // Skip these since we handled @id above
    
    const targetKey = fieldMappings?.[key] || key;
    result[targetKey] = extractSimpleValue(value);
  });
  
  return result as Partial<T>;
}

/**
 * Convert an LDKit entity (with $id) to a JSON-LD style object (with @id).
 * This is used at the API boundary for JSON-LD compliance.
 */
export function toJsonLd<T>(entity: T): any {
  if (!entity || typeof entity !== 'object') return entity;
  
  const { $id, '@id': existingAtId, ...rest } = entity as { $id?: string; '@id'?: string; [key: string]: unknown };
  const id = $id || existingAtId;
  
  return id ? { '@id': id, ...rest } : rest;
}

/**
 * Convert an array of LDKit entities to JSON-LD format
 */
export function toJsonLdArray<T extends { $id?: string }>(entities: T[]): Array<Omit<T, '$id'> & { '@id'?: string }> {
  return Array.isArray(entities) ? entities.map(toJsonLd) : [];
}

/**
 * Convert a JSON-LD object (with @id) to LDKit entity format (with $id).
 * This is used when receiving data from API requests.
 */
export function fromJsonLd<T>(jsonLdObject: T): any {
  if (!jsonLdObject || typeof jsonLdObject !== 'object') return jsonLdObject;
  const { '@id': atId, ...rest } = jsonLdObject as { '@id'?: string; $id?: string; [key: string]: unknown };
  const existingDollarId = rest.$id;
  const id = atId || existingDollarId;
  return (id ? { $id: id, '@id': id, ...rest } : rest);
}

/**
 * Normalize a value that may be a string, an IdReference object { '@id': string },
 * an array of those, or undefined/null, into a string[] of IRIs.
 */
export function normalizeIriArray(value: any): string[] {
  if (!value) return [];
  const extract = (v: any): string | null => {
    if (!v) return null;
    if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('urn:'))) return v;
    if (typeof v === 'object' && typeof v['@id'] === 'string') return v['@id'];
    return null;
  };
  if (Array.isArray(value)) {
    return value.map(extract).filter((v): v is string => !!v);
  }
  const single = extract(value);
  return single ? [single] : [];
}

/**
 * Expand a string[] of IRIs into JSON-LD IdReference objects: { '@id': iri }
 */
export function expandIriArrayToIdRefs(values?: string[]): Array<{ '@id': string }> {
  return (values || []).map((id) => ({ '@id': id }));
}
