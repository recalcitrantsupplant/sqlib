import { createRepositoryLens } from './entityRepository.js';
import { PatchNodeSchema, type PersistedPatchNode } from '../schemas/PatchNodeSchema.js';

export const PatchNodes = createRepositoryLens(PatchNodeSchema);

export async function findPatchNodeById(id: string): Promise<PersistedPatchNode | null> {
  try {
    const item = await PatchNodes.findByIri(id);
    return item ? (item as PersistedPatchNode) : null;
  } catch {
    return null;
  }
}

export async function loadPatchNodesByIds(ids: string[]): Promise<PersistedPatchNode[]> {
  const out: PersistedPatchNode[] = [];
  for (const id of ids) {
    const item = await findPatchNodeById(id);
    if (item) out.push(item);
  }
  return out;
}
