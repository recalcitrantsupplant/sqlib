import { createRepositoryLens } from './entityRepository.js';
import { DynamicQueryNodeSchema, type LdkitDynamicQueryNode } from '../schemas/DynamicQueryNodeSchema.js';

export const DynamicQueryNodes = createRepositoryLens(DynamicQueryNodeSchema);

export async function findDynamicQueryNodeById(id: string): Promise<LdkitDynamicQueryNode | null> {
  try {
    const item = await DynamicQueryNodes.findByIri(id);
    return item ? (item as LdkitDynamicQueryNode) : null;
  } catch {
    return null;
  }
}

export async function loadDynamicQueryNodesByIds(ids: string[]): Promise<LdkitDynamicQueryNode[]> {
  const out: LdkitDynamicQueryNode[] = [];
  for (const id of ids) {
    const item = await findDynamicQueryNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

