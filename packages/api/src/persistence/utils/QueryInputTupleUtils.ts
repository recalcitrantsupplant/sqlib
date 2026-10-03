/**
 * LDKit utilities for QueryInputTuple entities
 */

import { QueryInputTupleSchema, type QueryInputTupleEntity } from '../schemas/QueryInputTupleSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toEntity } from './id-adapter.js';

export const QueryInputTuples = createRepositoryLens(QueryInputTupleSchema);

/**
 * Find QueryInputTuple by ID
 */
export async function findQueryInputTupleById(id: string): Promise<QueryInputTupleEntity | null> {
  try {
    const tuple = await QueryInputTuples.findByIri(id);
    return tuple ? (tuple as QueryInputTupleEntity) : null;
  } catch (error) {
    console.warn(`Failed to find QueryInputTuple ${id}:`, error);
    return null;
  }
}

/**
 * Load QueryInputTuple entities by IDs
 */
export async function loadQueryInputTuplesByIds(ids: string[]): Promise<QueryInputTupleEntity[]> {
  const tuples: QueryInputTupleEntity[] = [];
  
  for (const id of ids) {
    const tuple = await findQueryInputTupleById(id);
    if (tuple) {
      tuples.push(tuple);
    }
  }
  
  return tuples;
}

/**
 * Create a QueryInputTuple with validation
 */
type FlexibleTupleInput = Omit<QueryInputTupleEntity, '$id'> & { 
  '@id'?: string; 
  $id?: string; 
};

export async function createQueryInputTuple(data: FlexibleTupleInput): Promise<QueryInputTupleEntity> {
  const inputTuple = toEntity<QueryInputTupleEntity>({ ...(data), '@type': 'QueryInputTuple' });
  await QueryInputTuples.insert(inputTuple);
  const createdTuple = await QueryInputTuples.findByIri(inputTuple.$id);
  if (!createdTuple) {
    throw new Error('Failed to retrieve QueryInputTuple after creation');
  }
  return createdTuple as QueryInputTupleEntity;
}

/**
 * Update a QueryInputTuple
 */
export async function updateQueryInputTuple(id: string, updates: Partial<Omit<QueryInputTupleEntity, '$id'>>): Promise<QueryInputTupleEntity | null> {
  await QueryInputTuples.update({ $id: id, ...updates });
  const result = await QueryInputTuples.findByIri(id);
  if (!result) return null;
  
  return result as QueryInputTupleEntity;
}

/**
 * Delete a QueryInputTuple
 */
export async function deleteQueryInputTuple(id: string): Promise<void> {
  try {
    await QueryInputTuples.delete(id);
  } catch (error) {
    console.error(`Failed to delete QueryInputTuple ${id}:`, error);
    throw error;
  }
}