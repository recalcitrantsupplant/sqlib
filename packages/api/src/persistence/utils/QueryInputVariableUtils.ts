/**
 * LDKit utilities for QueryInputVariable entities
 */

import { QueryInputVariableSchema, type QueryInputVariableEntity } from '../schemas/QueryInputVariableSchema.js';
import { createRepositoryLens } from './entityRepository.js';

export const QueryInputVariables = createRepositoryLens(QueryInputVariableSchema);

export async function findQueryInputVariableById(id: string): Promise<QueryInputVariableEntity | null> {
  try {
    const item = await QueryInputVariables.findByIri(id);
    return item ? (item as QueryInputVariableEntity) : null;
  } catch (error) {
    return null;
  }
}

export async function loadQueryInputVariablesByIds(ids: string[]): Promise<QueryInputVariableEntity[]> {
  const out: QueryInputVariableEntity[] = [];
  for (const id of ids) {
    const item = await findQueryInputVariableById(id);
    if (item) out.push(item);
  }
  return out;
}
