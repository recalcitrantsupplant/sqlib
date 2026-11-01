import { createRepositoryLens } from './entityRepository.js';
import { EndNodeSchema, type PersistedEndNode } from '../schemas/EndNodeSchema.js';

export const EndNodes = createRepositoryLens(EndNodeSchema);

export async function findEndNodeById(id: string): Promise<PersistedEndNode | null> {
  try {
    const item = await EndNodes.findByIri(id);
    return item ? (item as PersistedEndNode) : null;
  } catch {
    return null;
  }
}

export async function loadEndNodesByIds(ids: string[]): Promise<PersistedEndNode[]> {
  const out: PersistedEndNode[] = [];
  for (const id of ids) {
    const item = await findEndNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

