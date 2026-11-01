import { createRepositoryLens } from './entityRepository.js';
import { QueryIdInputSchema, type PersistedQueryIdInput } from '../schemas/QueryIdInputSchema.js';

export const QueryIdInputs = createRepositoryLens(QueryIdInputSchema);

export async function findQueryIdInputById(id: string): Promise<PersistedQueryIdInput | null> {
  try {
    const item = await QueryIdInputs.findByIri(id);
    return item ? (item as PersistedQueryIdInput) : null;
  } catch {
    return null;
  }
}

export async function loadQueryIdInputsByIds(ids: string[]): Promise<PersistedQueryIdInput[]> {
  const out: PersistedQueryIdInput[] = [];
  for (const id of ids) {
    const item = await findQueryIdInputById(id);
    if (item) out.push(item);
  }
  return out;
}
