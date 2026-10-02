import { createRepositoryLens } from './entityRepository.js';
import { DynamicQueryNodeSchema, type DynamicQueryNodeEntity } from '../schemas/DynamicQueryNodeSchema.js';

export const DynamicQueryNodes = createRepositoryLens(DynamicQueryNodeSchema);

export async function findDynamicQueryNodeById(id: string): Promise<DynamicQueryNodeEntity | null> {
  try {
    const item = await DynamicQueryNodes.findByIri(id);
    return item ? (item as DynamicQueryNodeEntity) : null;
  } catch {
    return null;
  }
}

export async function loadDynamicQueryNodesByIds(ids: string[]): Promise<DynamicQueryNodeEntity[]> {
  const out: DynamicQueryNodeEntity[] = [];
  for (const id of ids) {
    const item = await findDynamicQueryNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

