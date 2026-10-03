import { createRepositoryLens } from './entityRepository.js';
import { QueryIdInputSchema, type QueryIdInputEntity } from '../schemas/QueryIdInputSchema.js';

export const QueryIdInputs = createRepositoryLens(QueryIdInputSchema);

export async function findQueryIdInputById(id: string): Promise<QueryIdInputEntity | null> {
  try {
    const item = await QueryIdInputs.findByIri(id);
    return item ? (item as QueryIdInputEntity) : null;
  } catch {
    return null;
  }
}

export async function loadQueryIdInputsByIds(ids: string[]): Promise<QueryIdInputEntity[]> {
  const out: QueryIdInputEntity[] = [];
  for (const id of ids) {
    const item = await findQueryIdInputById(id);
    if (item) out.push(item);
  }
  return out;
}
