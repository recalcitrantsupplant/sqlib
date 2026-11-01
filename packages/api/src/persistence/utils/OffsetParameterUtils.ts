/**
 * entity utilities for OffsetParameter entities
 */

import { OffsetParameterSchema, type PersistedOffsetParameter } from '../schemas/OffsetParameterSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toPersisted } from './id-adapter.js';
import { log } from '../../lib/log.js';

export const OffsetParameters = createRepositoryLens(OffsetParameterSchema);

/**
 * Find OffsetParameter by ID
 */
export async function findOffsetParameterById(id: string): Promise<PersistedOffsetParameter | null> {
  try {
    const parameter = await OffsetParameters.findByIri(id);
    return parameter ? (parameter as PersistedOffsetParameter) : null;
  } catch (error) {
    log.warn({ err: error, id }, 'Failed to find OffsetParameter');
    return null;
  }
}

/**
 * Find OffsetParameter by identifier
 */
export async function findOffsetParameterByName(name: string): Promise<PersistedOffsetParameter | null> {
  const allParams = await OffsetParameters.find();
  const result = allParams.find(param => param.name === name);
  return result ? (result as PersistedOffsetParameter) : null;
}

/**
 * Load OffsetParameter entities by IDs
 */
export async function loadOffsetParametersByIds(ids: string[]): Promise<PersistedOffsetParameter[]> {
  const parameters: PersistedOffsetParameter[] = [];
  
  for (const id of ids) {
    const parameter = await findOffsetParameterById(id);
    if (parameter) {
      parameters.push(parameter);
    }
  }
  
  return parameters;
}

/**
 * Create an OffsetParameter with validation
 */
type FlexibleParameterInput = Omit<PersistedOffsetParameter, '$id'> & { 
  '@id'?: string; 
  $id?: string; 
};

export async function createOffsetParameter(data: FlexibleParameterInput): Promise<PersistedOffsetParameter> {
  // Validate required fields
  if (!data.name) {
    throw new Error('OffsetParameter requires name');
  }

  const offsetParameter = toPersisted<PersistedOffsetParameter>({ ...(data), '@type': 'OffsetParameter' });

  await OffsetParameters.insert(offsetParameter);
  const createdParameter = await OffsetParameters.findByIri(offsetParameter.$id);
  if (!createdParameter) {
    throw new Error('Failed to retrieve OffsetParameter after creation');
  }
  return createdParameter as PersistedOffsetParameter;
}

/**
 * Update an OffsetParameter
 */
export async function updateOffsetParameter(id: string, updates: Partial<Omit<PersistedOffsetParameter, '$id'>>): Promise<PersistedOffsetParameter | null> {
  await OffsetParameters.update({ $id: id, ...updates });
  const result = await OffsetParameters.findByIri(id);
  if (!result) return null;
  
  return result as PersistedOffsetParameter;
}

/**
 * Delete an OffsetParameter
 */
export async function deleteOffsetParameter(id: string): Promise<void> {
  try {
    await OffsetParameters.delete(id);
  } catch (error) {
    log.error({ err: error, id }, 'Failed to delete OffsetParameter');
    throw error;
  }
}