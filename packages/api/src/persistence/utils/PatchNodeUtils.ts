import { createRepositoryLens } from './entityRepository.js';
import { PatchNodeSchema, type PatchNodeEntity } from '../schemas/PatchNodeSchema.js';

export const PatchNodes = createRepositoryLens(PatchNodeSchema);

export async function findPatchNodeById(id: string): Promise<PatchNodeEntity | null> {
  try {
    const item = await PatchNodes.findByIri(id);
    return item ? (item as PatchNodeEntity) : null;
  } catch {
    return null;
  }
}

export async function loadPatchNodesByIds(ids: string[]): Promise<PatchNodeEntity[]> {
  const out: PatchNodeEntity[] = [];
  for (const id of ids) {
    const item = await findPatchNodeById(id);
    if (item) out.push(item);
  }
  return out;
}
