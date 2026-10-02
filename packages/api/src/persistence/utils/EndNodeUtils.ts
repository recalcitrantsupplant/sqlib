import { createRepositoryLens } from './entityRepository.js';
import { EndNodeSchema, type EndNodeEntity } from '../schemas/EndNodeSchema.js';

export const EndNodes = createRepositoryLens(EndNodeSchema);

export async function findEndNodeById(id: string): Promise<EndNodeEntity | null> {
  try {
    const item = await EndNodes.findByIri(id);
    return item ? (item as EndNodeEntity) : null;
  } catch {
    return null;
  }
}

export async function loadEndNodesByIds(ids: string[]): Promise<EndNodeEntity[]> {
  const out: EndNodeEntity[] = [];
  for (const id of ids) {
    const item = await findEndNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

