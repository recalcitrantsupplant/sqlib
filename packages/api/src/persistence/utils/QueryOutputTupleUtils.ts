import { createRepositoryLens } from './entityRepository.js';
import { QueryOutputTupleSchema, type PersistedQueryOutputTuple } from '../schemas/QueryOutputTupleSchema.js';

export const QueryOutputTuples = createRepositoryLens(QueryOutputTupleSchema);

export async function findQueryOutputTupleById(id: string): Promise<PersistedQueryOutputTuple | null> {
  try {
    const item = await QueryOutputTuples.findByIri(id);
    return item ? (item as PersistedQueryOutputTuple) : null;
  } catch {
    return null;
  }
}

export async function loadQueryOutputTuplesByIds(ids: string[]): Promise<PersistedQueryOutputTuple[]> {
  const out: PersistedQueryOutputTuple[] = [];
  for (const id of ids) {
    const item = await findQueryOutputTupleById(id);
    if (item) out.push(item);
  }
  return out;
}

