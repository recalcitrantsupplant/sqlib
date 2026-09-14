/**
 * LDKit utilities for OffsetParameter entities
 */

import { OffsetParameterSchema, type LdkitOffsetParameter } from '../schemas/OffsetParameterSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toLdkit } from './id-adapter.js';

export const OffsetParameters = createRepositoryLens(OffsetParameterSchema);

/**
 * Find OffsetParameter by ID
 */
export async function findOffsetParameterById(id: string): Promise<LdkitOffsetParameter | null> {
  try {
    const parameter = await OffsetParameters.findByIri(id);
    return parameter ? (parameter as LdkitOffsetParameter) : null;
  } catch (error) {
    console.warn(`Failed to find OffsetParameter ${id}:`, error);
    return null;
  }
}

/**
 * Find OffsetParameter by identifier
 */
export async function findOffsetParameterByName(name: string): Promise<LdkitOffsetParameter | null> {
  const allParams = await OffsetParameters.find();
  const result = allParams.find(param => param.name === name);
  return result ? (result as LdkitOffsetParameter) : null;
}

/**
 * Load OffsetParameter entities by IDs
 */
export async function loadOffsetParametersByIds(ids: string[]): Promise<LdkitOffsetParameter[]> {
  const parameters: LdkitOffsetParameter[] = [];
  
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
type FlexibleParameterInput = Omit<LdkitOffsetParameter, '$id'> & { 
  '@id'?: string; 
  $id?: string; 
};

export async function createOffsetParameter(data: FlexibleParameterInput): Promise<LdkitOffsetParameter> {
  // Validate required fields
  if (!data.name) {
    throw new Error('OffsetParameter requires name');
  }

  const offsetParameter = toLdkit<LdkitOffsetParameter>({ ...(data), '@type': 'OffsetParameter' });

  await OffsetParameters.insert(offsetParameter);
  const createdParameter = await OffsetParameters.findByIri(offsetParameter.$id);
  if (!createdParameter) {
    throw new Error('Failed to retrieve OffsetParameter after creation');
  }
  return createdParameter as LdkitOffsetParameter;
}

/**
 * Update an OffsetParameter
 */
export async function updateOffsetParameter(id: string, updates: Partial<Omit<LdkitOffsetParameter, '$id'>>): Promise<LdkitOffsetParameter | null> {
  await OffsetParameters.update({ $id: id, ...updates });
  const result = await OffsetParameters.findByIri(id);
  if (!result) return null;
  
  return result as LdkitOffsetParameter;
}

/**
 * Delete an OffsetParameter
 */
export async function deleteOffsetParameter(id: string): Promise<void> {
  try {
    await OffsetParameters.delete(id);
  } catch (error) {
    console.error(`Failed to delete OffsetParameter ${id}:`, error);
    throw error;
  }
}