/**
 * entity utilities for LimitParameter entities
 */

import { LimitParameterSchema, type PersistedLimitParameter } from '../schemas/LimitParameterSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toPersisted } from './id-adapter.js';
import { log } from '../../lib/log.js';

export const LimitParameters = createRepositoryLens(LimitParameterSchema);

/**
 * Find LimitParameter by ID
 */
export async function findLimitParameterById(id: string): Promise<PersistedLimitParameter | null> {
  try {
    const parameter = await LimitParameters.findByIri(id);
    return parameter ? (parameter as PersistedLimitParameter) : null;
  } catch (error) {
    log.warn({ err: error, id }, 'Failed to find LimitParameter');
    return null;
  }
}

/**
 * Find LimitParameter by name
 */
export async function findLimitParameterByName(name: string): Promise<PersistedLimitParameter | null> {
  const allParams = await LimitParameters.find();
  const result = allParams.find(param => param.name === name);
  return result ? (result as PersistedLimitParameter) : null;
}

/**
 * Load LimitParameter entities by IDs
 */
export async function loadLimitParametersByIds(ids: string[]): Promise<PersistedLimitParameter[]> {
  const parameters: PersistedLimitParameter[] = [];
  
  for (const id of ids) {
    const parameter = await findLimitParameterById(id);
    if (parameter) {
      parameters.push(parameter);
    }
  }
  
  return parameters;
}

/**
 * Create a LimitParameter with validation
 */
type FlexibleParameterInput = Omit<PersistedLimitParameter, '$id'> & { 
  '@id'?: string; 
  $id?: string; 
};

export async function createLimitParameter(data: FlexibleParameterInput): Promise<PersistedLimitParameter> {
  // Validate required fields
  if (!data.name) {
    throw new Error('LimitParameter requires name');
  }

  const limitParameter = toPersisted<PersistedLimitParameter>({ ...(data), '@type': 'LimitParameter' });

  await LimitParameters.insert(limitParameter);
  const createdParameter = await LimitParameters.findByIri(limitParameter.$id);
  if (!createdParameter) {
    throw new Error('Failed to retrieve LimitParameter after creation');
  }
  return createdParameter as PersistedLimitParameter;
}

/**
 * Update a LimitParameter
 */
export async function updateLimitParameter(id: string, updates: Partial<Omit<PersistedLimitParameter, '$id'>>): Promise<PersistedLimitParameter | null> {
  await LimitParameters.update({ $id: id, ...updates });
  const result = await LimitParameters.findByIri(id);
  if (!result) return null;
  
  return result as PersistedLimitParameter;
}

/**
 * Delete a LimitParameter
 */
export async function deleteLimitParameter(id: string): Promise<void> {
  try {
    await LimitParameters.delete(id);
  } catch (error) {
    log.error({ err: error, id }, 'Failed to delete LimitParameter');
    throw error;
  }
}