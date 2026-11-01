/**
 * entity utilities for QueryInputTuple entities
 */

import { QueryInputTupleSchema, type PersistedQueryInputTuple } from '../schemas/QueryInputTupleSchema.js';
import { createRepositoryLens } from './entityRepository.js';
import { toPersisted } from './id-adapter.js';
import { log } from '../../lib/log.js';

export const QueryInputTuples = createRepositoryLens(QueryInputTupleSchema);

/**
 * Find QueryInputTuple by ID
 */
export async function findQueryInputTupleById(id: string): Promise<PersistedQueryInputTuple | null> {
  try {
    const tuple = await QueryInputTuples.findByIri(id);
    return tuple ? (tuple as PersistedQueryInputTuple) : null;
  } catch (error) {
    log.warn({ err: error, id }, 'Failed to find QueryInputTuple');
    return null;
  }
}

/**
 * Load QueryInputTuple entities by IDs
 */
export async function loadQueryInputTuplesByIds(ids: string[]): Promise<PersistedQueryInputTuple[]> {
  const tuples: PersistedQueryInputTuple[] = [];
  
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
type FlexibleTupleInput = Omit<PersistedQueryInputTuple, '$id'> & { 
  '@id'?: string; 
  $id?: string; 
};

export async function createQueryInputTuple(data: FlexibleTupleInput): Promise<PersistedQueryInputTuple> {
  const inputTuple = toPersisted<PersistedQueryInputTuple>({ ...(data), '@type': 'QueryInputTuple' });
  await QueryInputTuples.insert(inputTuple);
  const createdTuple = await QueryInputTuples.findByIri(inputTuple.$id);
  if (!createdTuple) {
    throw new Error('Failed to retrieve QueryInputTuple after creation');
  }
  return createdTuple as PersistedQueryInputTuple;
}

/**
 * Update a QueryInputTuple
 */
export async function updateQueryInputTuple(id: string, updates: Partial<Omit<PersistedQueryInputTuple, '$id'>>): Promise<PersistedQueryInputTuple | null> {
  await QueryInputTuples.update({ $id: id, ...updates });
  const result = await QueryInputTuples.findByIri(id);
  if (!result) return null;
  
  return result as PersistedQueryInputTuple;
}

/**
 * Delete a QueryInputTuple
 */
export async function deleteQueryInputTuple(id: string): Promise<void> {
  try {
    await QueryInputTuples.delete(id);
  } catch (error) {
    log.error({ err: error, id }, 'Failed to delete QueryInputTuple');
    throw error;
  }
}