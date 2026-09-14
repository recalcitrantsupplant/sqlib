import { createRepositoryLens } from './entityRepository.js';
import { StartNodeSchema, type LdkitStartNode } from '../schemas/StartNodeSchema.js';

export const StartNodes = createRepositoryLens(StartNodeSchema);

export async function findStartNodeById(id: string): Promise<LdkitStartNode | null> {
  try {
    const item = await StartNodes.findByIri(id);
    return item ? (item as LdkitStartNode) : null;
  } catch {
    return null;
  }
}

export async function loadStartNodesByIds(ids: string[]): Promise<LdkitStartNode[]> {
  const out: LdkitStartNode[] = [];
  for (const id of ids) {
    const item = await findStartNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

