import { createRepositoryLens } from './entityRepository.js';
import { DynamicQueryNodeSchema, type PersistedDynamicQueryNode } from '../schemas/DynamicQueryNodeSchema.js';

export const DynamicQueryNodes = createRepositoryLens(DynamicQueryNodeSchema);

export async function findDynamicQueryNodeById(id: string): Promise<PersistedDynamicQueryNode | null> {
  try {
    const item = await DynamicQueryNodes.findByIri(id);
    return item ? (item as PersistedDynamicQueryNode) : null;
  } catch {
    return null;
  }
}

export async function loadDynamicQueryNodesByIds(ids: string[]): Promise<PersistedDynamicQueryNode[]> {
  const out: PersistedDynamicQueryNode[] = [];
  for (const id of ids) {
    const item = await findDynamicQueryNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

