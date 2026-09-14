/**
 * LDKit utilities for QueryInputVariable entities
 */

import { QueryInputVariableSchema, type LdkitQueryInputVariable } from '../schemas/QueryInputVariableSchema.js';
import { createRepositoryLens } from './entityRepository.js';

export const QueryInputVariables = createRepositoryLens(QueryInputVariableSchema);

export async function findQueryInputVariableById(id: string): Promise<LdkitQueryInputVariable | null> {
  try {
    const item = await QueryInputVariables.findByIri(id);
    return item ? (item as LdkitQueryInputVariable) : null;
  } catch (error) {
    return null;
  }
}

export async function loadQueryInputVariablesByIds(ids: string[]): Promise<LdkitQueryInputVariable[]> {
  const out: LdkitQueryInputVariable[] = [];
  for (const id of ids) {
    const item = await findQueryInputVariableById(id);
    if (item) out.push(item);
  }
  return out;
}
