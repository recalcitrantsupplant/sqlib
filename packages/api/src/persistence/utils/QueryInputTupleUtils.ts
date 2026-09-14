/**
 * LDKit utilities for QueryInputTuple entities
 */

import { QueryInputTupleSchema, type LdkitQueryInputTuple } from '../schemas/QueryInputTupleSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toLdkit } from './id-adapter.js';

export const QueryInputTuples = createRepositoryLens(QueryInputTupleSchema);

/**
 * Find QueryInputTuple by ID
 */
export async function findQueryInputTupleById(id: string): Promise<LdkitQueryInputTuple | null> {
  try {
    const tuple = await QueryInputTuples.findByIri(id);
    return tuple ? (tuple as LdkitQueryInputTuple) : null;
  } catch (error) {
    console.warn(`Failed to find QueryInputTuple ${id}:`, error);
    return null;
  }
}

/**
 * Load QueryInputTuple entities by IDs
 */
export async function loadQueryInputTuplesByIds(ids: string[]): Promise<LdkitQueryInputTuple[]> {
  const tuples: LdkitQueryInputTuple[] = [];
  
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
type FlexibleTupleInput = Omit<LdkitQueryInputTuple, '$id'> & { 
  '@id'?: string; 
  $id?: string; 
};

export async function createQueryInputTuple(data: FlexibleTupleInput): Promise<LdkitQueryInputTuple> {
  const inputTuple = toLdkit<LdkitQueryInputTuple>({ ...(data), '@type': 'QueryInputTuple' });
  await QueryInputTuples.insert(inputTuple);
  const createdTuple = await QueryInputTuples.findByIri(inputTuple.$id);
  if (!createdTuple) {
    throw new Error('Failed to retrieve QueryInputTuple after creation');
  }
  return createdTuple as LdkitQueryInputTuple;
}

/**
 * Update a QueryInputTuple
 */
export async function updateQueryInputTuple(id: string, updates: Partial<Omit<LdkitQueryInputTuple, '$id'>>): Promise<LdkitQueryInputTuple | null> {
  await QueryInputTuples.update({ $id: id, ...updates });
  const result = await QueryInputTuples.findByIri(id);
  if (!result) return null;
  
  return result as LdkitQueryInputTuple;
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