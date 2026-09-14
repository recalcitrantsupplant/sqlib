import { createRepositoryLens } from './entityRepository.js';
import { QueryIdInputSchema, type LdkitQueryIdInput } from '../schemas/QueryIdInputSchema.js';

export const QueryIdInputs = createRepositoryLens(QueryIdInputSchema);

export async function findQueryIdInputById(id: string): Promise<LdkitQueryIdInput | null> {
  try {
    const item = await QueryIdInputs.findByIri(id);
    return item ? (item as LdkitQueryIdInput) : null;
  } catch {
    return null;
  }
}

export async function loadQueryIdInputsByIds(ids: string[]): Promise<LdkitQueryIdInput[]> {
  const out: LdkitQueryIdInput[] = [];
  for (const id of ids) {
    const item = await findQueryIdInputById(id);
    if (item) out.push(item);
  }
  return out;
}
