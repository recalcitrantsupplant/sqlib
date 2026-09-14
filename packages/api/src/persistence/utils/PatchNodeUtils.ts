import { createRepositoryLens } from './entityRepository.js';
import { PatchNodeSchema, type LdkitPatchNode } from '../schemas/PatchNodeSchema.js';

export const PatchNodes = createRepositoryLens(PatchNodeSchema);

export async function findPatchNodeById(id: string): Promise<LdkitPatchNode | null> {
  try {
    const item = await PatchNodes.findByIri(id);
    return item ? (item as LdkitPatchNode) : null;
  } catch {
    return null;
  }
}

export async function loadPatchNodesByIds(ids: string[]): Promise<LdkitPatchNode[]> {
  const out: LdkitPatchNode[] = [];
  for (const id of ids) {
    const item = await findPatchNodeById(id);
    if (item) out.push(item);
  }
  return out;
}
