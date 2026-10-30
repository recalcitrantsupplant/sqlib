import { createRepositoryLens } from './entityRepository.js';
import { StartNodeSchema, type PersistedStartNode } from '../schemas/StartNodeSchema.js';

export const StartNodes = createRepositoryLens(StartNodeSchema);

export async function findStartNodeById(id: string): Promise<PersistedStartNode | null> {
  try {
    const item = await StartNodes.findByIri(id);
    return item ? (item as PersistedStartNode) : null;
  } catch {
    return null;
  }
}

export async function loadStartNodesByIds(ids: string[]): Promise<PersistedStartNode[]> {
  const out: PersistedStartNode[] = [];
  for (const id of ids) {
    const item = await findStartNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

