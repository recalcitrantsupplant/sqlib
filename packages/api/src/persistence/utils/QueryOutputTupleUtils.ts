import { createRepositoryLens } from './entityRepository.js';
import { QueryOutputTupleSchema, type QueryOutputTupleEntity } from '../schemas/QueryOutputTupleSchema.js';

export const QueryOutputTuples = createRepositoryLens(QueryOutputTupleSchema);

export async function findQueryOutputTupleById(id: string): Promise<QueryOutputTupleEntity | null> {
  try {
    const item = await QueryOutputTuples.findByIri(id);
    return item ? (item as QueryOutputTupleEntity) : null;
  } catch {
    return null;
  }
}

export async function loadQueryOutputTuplesByIds(ids: string[]): Promise<QueryOutputTupleEntity[]> {
  const out: QueryOutputTupleEntity[] = [];
  for (const id of ids) {
    const item = await findQueryOutputTupleById(id);
    if (item) out.push(item);
  }
  return out;
}

