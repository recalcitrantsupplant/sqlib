import { createRepositoryLens } from './entityRepository.js';
import { QueryOutputTupleSchema, type LdkitQueryOutputTuple } from '../schemas/QueryOutputTupleSchema.js';

export const QueryOutputTuples = createRepositoryLens(QueryOutputTupleSchema);

export async function findQueryOutputTupleById(id: string): Promise<LdkitQueryOutputTuple | null> {
  try {
    const item = await QueryOutputTuples.findByIri(id);
    return item ? (item as LdkitQueryOutputTuple) : null;
  } catch {
    return null;
  }
}

export async function loadQueryOutputTuplesByIds(ids: string[]): Promise<LdkitQueryOutputTuple[]> {
  const out: LdkitQueryOutputTuple[] = [];
  for (const id of ids) {
    const item = await findQueryOutputTupleById(id);
    if (item) out.push(item);
  }
  return out;
}

