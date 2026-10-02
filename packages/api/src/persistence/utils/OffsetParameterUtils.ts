/**
 * LDKit utilities for OffsetParameter entities
 */

import { OffsetParameterSchema, type OffsetParameterEntity } from '../schemas/OffsetParameterSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toEntity } from './id-adapter.js';

export const OffsetParameters = createRepositoryLens(OffsetParameterSchema);

/**
 * Find OffsetParameter by ID
 */
export async function findOffsetParameterById(id: string): Promise<OffsetParameterEntity | null> {
  try {
    const parameter = await OffsetParameters.findByIri(id);
    return parameter ? (parameter as OffsetParameterEntity) : null;
  } catch (error) {
    console.warn(`Failed to find OffsetParameter ${id}:`, error);
    return null;
  }
}

/**
 * Find OffsetParameter by identifier
 */
export async function findOffsetParameterByName(name: string): Promise<OffsetParameterEntity | null> {
  const allParams = await OffsetParameters.find();
  const result = allParams.find(param => param.name === name);
  return result ? (result as OffsetParameterEntity) : null;
}

/**
 * Load OffsetParameter entities by IDs
 */
export async function loadOffsetParametersByIds(ids: string[]): Promise<OffsetParameterEntity[]> {
  const parameters: OffsetParameterEntity[] = [];
  
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
type FlexibleParameterInput = Omit<OffsetParameterEntity, '$id'> & { 
  '@id'?: string; 
  $id?: string; 
};

export async function createOffsetParameter(data: FlexibleParameterInput): Promise<OffsetParameterEntity> {
  // Validate required fields
  if (!data.name) {
    throw new Error('OffsetParameter requires name');
  }

  const offsetParameter = toEntity<OffsetParameterEntity>({ ...(data), '@type': 'OffsetParameter' });

  await OffsetParameters.insert(offsetParameter);
  const createdParameter = await OffsetParameters.findByIri(offsetParameter.$id);
  if (!createdParameter) {
    throw new Error('Failed to retrieve OffsetParameter after creation');
  }
  return createdParameter as OffsetParameterEntity;
}

/**
 * Update an OffsetParameter
 */
export async function updateOffsetParameter(id: string, updates: Partial<Omit<OffsetParameterEntity, '$id'>>): Promise<OffsetParameterEntity | null> {
  await OffsetParameters.update({ $id: id, ...updates });
  const result = await OffsetParameters.findByIri(id);
  if (!result) return null;
  
  return result as OffsetParameterEntity;
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