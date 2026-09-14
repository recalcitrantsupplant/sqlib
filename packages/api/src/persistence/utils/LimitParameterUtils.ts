/**
 * LDKit utilities for LimitParameter entities
 */

import { LimitParameterSchema, type LdkitLimitParameter } from '../schemas/LimitParameterSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toLdkit } from './id-adapter.js';

export const LimitParameters = createRepositoryLens(LimitParameterSchema);

/**
 * Find LimitParameter by ID
 */
export async function findLimitParameterById(id: string): Promise<LdkitLimitParameter | null> {
  try {
    const parameter = await LimitParameters.findByIri(id);
    return parameter ? (parameter as LdkitLimitParameter) : null;
  } catch (error) {
    console.warn(`Failed to find LimitParameter ${id}:`, error);
    return null;
  }
}

/**
 * Find LimitParameter by name
 */
export async function findLimitParameterByName(name: string): Promise<LdkitLimitParameter | null> {
  const allParams = await LimitParameters.find();
  const result = allParams.find(param => param.name === name);
  return result ? (result as LdkitLimitParameter) : null;
}

/**
 * Load LimitParameter entities by IDs
 */
export async function loadLimitParametersByIds(ids: string[]): Promise<LdkitLimitParameter[]> {
  const parameters: LdkitLimitParameter[] = [];
  
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
type FlexibleParameterInput = Omit<LdkitLimitParameter, '$id'> & { 
  '@id'?: string; 
  $id?: string; 
};

export async function createLimitParameter(data: FlexibleParameterInput): Promise<LdkitLimitParameter> {
  // Validate required fields
  if (!data.name) {
    throw new Error('LimitParameter requires name');
  }

  const limitParameter = toLdkit<LdkitLimitParameter>({ ...(data), '@type': 'LimitParameter' });

  await LimitParameters.insert(limitParameter);
  const createdParameter = await LimitParameters.findByIri(limitParameter.$id);
  if (!createdParameter) {
    throw new Error('Failed to retrieve LimitParameter after creation');
  }
  return createdParameter as LdkitLimitParameter;
}

/**
 * Update a LimitParameter
 */
export async function updateLimitParameter(id: string, updates: Partial<Omit<LdkitLimitParameter, '$id'>>): Promise<LdkitLimitParameter | null> {
  await LimitParameters.update({ $id: id, ...updates });
  const result = await LimitParameters.findByIri(id);
  if (!result) return null;
  
  return result as LdkitLimitParameter;
}

/**
 * Delete a LimitParameter
 */
export async function deleteLimitParameter(id: string): Promise<void> {
  try {
    await LimitParameters.delete(id);
  } catch (error) {
    console.error(`Failed to delete LimitParameter ${id}:`, error);
    throw error;
  }
}