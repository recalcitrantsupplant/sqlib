import { createRepositoryLens } from './entityRepository.js';
import { EndNodeSchema, type LdkitEndNode } from '../schemas/EndNodeSchema.js';

export const EndNodes = createRepositoryLens(EndNodeSchema);

export async function findEndNodeById(id: string): Promise<LdkitEndNode | null> {
  try {
    const item = await EndNodes.findByIri(id);
    return item ? (item as LdkitEndNode) : null;
  } catch {
    return null;
  }
}

export async function loadEndNodesByIds(ids: string[]): Promise<LdkitEndNode[]> {
  const out: LdkitEndNode[] = [];
  for (const id of ids) {
    const item = await findEndNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

