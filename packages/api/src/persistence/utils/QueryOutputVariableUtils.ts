/**
 * entity utilities for QueryOutputVariable entities
 */

import { QueryOutputVariableSchema, type PersistedQueryOutputVariable } from '../schemas/QueryOutputVariableSchema.js';
import { createRepositoryLens } from './entityRepository.js';

export const QueryOutputVariables = createRepositoryLens(QueryOutputVariableSchema);

export async function findQueryOutputVariableById(id: string): Promise<PersistedQueryOutputVariable | null> {
  try {
    const item = await QueryOutputVariables.findByIri(id);
    return item ? (item as PersistedQueryOutputVariable) : null;
  } catch (error) {
    return null;
  }
}

export async function loadQueryOutputVariablesByIds(ids: string[]): Promise<PersistedQueryOutputVariable[]> {
  const out: PersistedQueryOutputVariable[] = [];
  for (const id of ids) {
    const item = await findQueryOutputVariableById(id);
    if (item) out.push(item);
  }
  return out;
}
