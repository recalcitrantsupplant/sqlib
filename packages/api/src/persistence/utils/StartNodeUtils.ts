import { createRepositoryLens } from './entityRepository.js';
import { StartNodeSchema, type StartNodeEntity } from '../schemas/StartNodeSchema.js';

export const StartNodes = createRepositoryLens(StartNodeSchema);

export async function findStartNodeById(id: string): Promise<StartNodeEntity | null> {
  try {
    const item = await StartNodes.findByIri(id);
    return item ? (item as StartNodeEntity) : null;
  } catch {
    return null;
  }
}

export async function loadStartNodesByIds(ids: string[]): Promise<StartNodeEntity[]> {
  const out: StartNodeEntity[] = [];
  for (const id of ids) {
    const item = await findStartNodeById(id);
    if (item) out.push(item);
  }
  return out;
}

