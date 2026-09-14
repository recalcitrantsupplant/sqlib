/**
 * LDKit utilities for Backend entities
 * Generated using EntityUtils for standardized CRUD operations
 */

import { BackendSchema, backendTypeIriToKey, backendTypeKeyToIri, queryMethodKeyToIri, queryMethodIriToKey, type LdkitBackend } from '../schemas/BackendSchema.js';
import { createEntityUtilsWithFields } from './EntityUtils.js';

// Create standardized Backend utilities
// The `requiredFields` override is gone (issue #65). It required an `endpoint`
// of every backend, although `BackendSchema` marks it `@optional` precisely
// because an `oxigraphEphemeral` backend has none, and the route contract
// requires one only when `backendType` is `http`. Three statements of one rule,
// and this was the only one that disagreed with the other two.
//
// Dropping it leaves the derived set — `name`, `backendType` — so creating an
// ephemeral backend without an endpoint now succeeds on this path, as it always
// has through the endpoint. The conditional rule still lives in the contract's
// `superRefine`, which is where a conditional can be expressed.
const BackendUtils = createEntityUtilsWithFields<LdkitBackend>(BackendSchema, 'Backend');

// Export the repository for direct access if needed
export const Backends = BackendUtils.Repository;

// Export CRUD operations (kept for backwards compatibility or non-cache usage)
// Note: Routes now use MemoryCacheManager directly for better performance
export function createBackend(data: Parameters<typeof BackendUtils.create>[0]): ReturnType<typeof BackendUtils.create> {
  const backendTypeValue = data.backendType;
  if (typeof backendTypeValue !== 'string') {
    // Narrows the type before the key lookup below. The message matches the one
    // `EntityUtils` derives from the schema — it named `endpoint` too until the
    // `requiredFields` override came off, which made it a fourth statement of a
    // rule the other three had already stopped agreeing on.
    throw new Error('Backend requires name and backendType');
  }
  const backendTypeKey = backendTypeIriToKey(backendTypeValue);
  if (!backendTypeKey) {
    throw new Error(`Unsupported backend type: ${backendTypeValue}`);
  }

  let payload: Parameters<typeof BackendUtils.create>[0] = { ...data, backendType: backendTypeKeyToIri(backendTypeKey) } as Parameters<typeof BackendUtils.create>[0];

  // Convert queryMethod key to IRI if provided
  if (data.queryMethod && typeof data.queryMethod === 'string') {
    const queryMethodKey = data.queryMethod as 'post' | 'get';
    payload.queryMethod = queryMethodKeyToIri(queryMethodKey);
  }

  return BackendUtils.create(payload);
}

export function updateBackend(id: Parameters<typeof BackendUtils.update>[0], updates: Parameters<typeof BackendUtils.update>[1]): ReturnType<typeof BackendUtils.update> {
  let payload: Parameters<typeof BackendUtils.update>[1] = updates;

  // Convert backendType key to IRI if provided
  if (updates && typeof updates.backendType === 'string') {
    const backendTypeKey = backendTypeIriToKey(updates.backendType);
    if (!backendTypeKey) {
      throw new Error(`Unsupported backend type: ${updates.backendType}`);
    }
    payload = { ...(updates), backendType: backendTypeKeyToIri(backendTypeKey) };
  }

  // Convert queryMethod key to IRI if provided
  if (updates && updates.queryMethod && typeof updates.queryMethod === 'string') {
    const queryMethodKey = updates.queryMethod as 'post' | 'get';
    payload = { ...payload, queryMethod: queryMethodKeyToIri(queryMethodKey) };
  }

  return BackendUtils.update(id, payload);
}

// Export convenience methods for specific Backend operations
export async function findBackendByName(name: string): Promise<LdkitBackend | null> {
  const backends = await BackendUtils.findBy('name', name);
  return backends[0] || null;
}

export async function findBackendsByType(backendType: string): Promise<LdkitBackend[]> {
  const backendTypeKey = backendTypeIriToKey(backendType);
  if (!backendTypeKey) {
    return BackendUtils.findBy('backendType', backendType);
  }
  return BackendUtils.findBy('backendType', backendTypeKeyToIri(backendTypeKey));
}
