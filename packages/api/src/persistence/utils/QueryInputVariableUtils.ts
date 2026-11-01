/**
 * entity utilities for QueryInputVariable entities
 */

import { QueryInputVariableSchema, type PersistedQueryInputVariable } from '../schemas/QueryInputVariableSchema.js';
import { createRepositoryLens } from './entityRepository.js';

export const QueryInputVariables = createRepositoryLens(QueryInputVariableSchema);

export async function findQueryInputVariableById(id: string): Promise<PersistedQueryInputVariable | null> {
  try {
    const item = await QueryInputVariables.findByIri(id);
    return item ? (item as PersistedQueryInputVariable) : null;
  } catch (error) {
    return null;
  }
}

export async function loadQueryInputVariablesByIds(ids: string[]): Promise<PersistedQueryInputVariable[]> {
  const out: PersistedQueryInputVariable[] = [];
  for (const id of ids) {
    const item = await findQueryInputVariableById(id);
    if (item) out.push(item);
  }
  return out;
}
