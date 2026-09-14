/**
 * Centralized ID adapter utilities to bridge API JSON-LD shapes ('@id')
 * and LDKit entity shapes ('$id').
 */

type AnyRecord = Record<string, any>;

/**
 * Extracts the canonical ID from an internal object that must contain '$id'.
 * Throws if $id is not present or is falsy.
 */
export function normalizeId(obj: AnyRecord): string {
  const id = obj?.['$id'];
  if (!id || typeof id !== 'string') {
    throw new Error("normalizeId: object must contain a '$id' string");
  }
  return id;
}

/**
 * Extracts ID from an API object that may have '@id' or '$id'.
 * For API boundary handling only - internal operations should use normalizeId.
 */
function normalizeApiId(obj: AnyRecord): string {
  const id = obj?.['@id'] ?? obj?.['$id'];
  if (!id || typeof id !== 'string') {
    throw new Error("normalizeApiId: object must contain an '@id' or '$id' string");
  }
  return id;
}

/**
 * Converts an API-shaped entity into an LDKit-shaped entity.
 * - Ensures both '$id' and '@id' are present and equal.
 * - Leaves the rest of the properties intact.
 */
export function toLdkit<T extends AnyRecord>(apiEntity: AnyRecord): T {
  const id = normalizeApiId(apiEntity);
  const merged: AnyRecord = { ...apiEntity, id: undefined, '@id': id, $id: id };
  return merged as unknown as T;
}

/**
 * Converts an LDKit-shaped entity into an API JSON-LD shape.
 * - Ensures '@id' is present.
 * - Removes '$id'.
 */
export function toApi<T extends AnyRecord>(ldkitEntity: AnyRecord): T {
  const id = normalizeId(ldkitEntity);
  const { $id: _dropDollar, ...rest } = ldkitEntity;
  const out: AnyRecord = { '@id': id, ...rest };
  return out as unknown as T;
}

/**
 * Converts an LDKit-shaped entity into a simplified API shape.
 * - Ensures '@id' is present.
 * - Removes '$id' and '@type' (implicit from REST endpoint).
 */
export function toSimpleApi<T extends AnyRecord>(ldkitEntity: AnyRecord): T {
  const id = normalizeId(ldkitEntity);
  const { $id: _dropDollar, ...rest } = ldkitEntity;
  const out: AnyRecord = { '@id': id, ...rest };
  return out as unknown as T;
}

/**
 * Converts an LDKit-shaped entity into a REST API shape for major release.
 * - Uses plain 'id' field instead of '@id'.
 * - Removes '$id', '@id', '@type', and any existing 'id' (which may be undefined from toLdkit).
 */
export function toRestApi<T extends AnyRecord>(ldkitEntity: AnyRecord): T {
  if (!ldkitEntity) {
    console.error('toRestApi called with null/undefined entity');
    return { id: undefined } as unknown as T;
  }

  const entityId = normalizeId(ldkitEntity);

  // Exclude $id, @id, @type, AND id (which toLdkit sets to undefined)
  const { $id: _dropDollar, '@id': _dropAt, '@type': _dropType, id: _dropId, ...rest } = ldkitEntity;

  // Explicitly remove @type if still present (destructuring may not always work with quoted keys)
  delete rest['@type'];

  // Normalize boolean-like fields that may arrive as strings from LDKit
  if (Object.prototype.hasOwnProperty.call(rest, 'immutable')) {
    const val = (rest as AnyRecord).immutable;
    if (val === 'true') (rest as AnyRecord).immutable = true;
    if (val === 'false') (rest as AnyRecord).immutable = false;
  }

  const out: AnyRecord = { id: entityId, ...rest };

  return out as unknown as T;
}

/**
 * Normalize an ID reference that may be a string or an object with 'id'.
 * Returns the string ID or undefined if not resolvable.
 */
export function normalizeRef(ref: unknown): string | undefined {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object') {
    if ('@id' in (ref as AnyRecord)) {
      const id = (ref as AnyRecord)['@id'];
      return typeof id === 'string' ? id : undefined;
    }
    if ('id' in (ref as AnyRecord)) {
      const id = (ref as AnyRecord)['id'];
      return typeof id === 'string' ? id : undefined;
    }
  }
  return undefined;
}

/**
 * Maps an array (or single value) of references (string | { 'id': string })
 * to a normalized array of string IRIs.
 */
export function normalizeRefArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .map(normalizeRef)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}
