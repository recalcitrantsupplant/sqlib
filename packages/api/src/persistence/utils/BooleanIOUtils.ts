import { createRepositoryLens } from './entityRepository.js';
import { BooleanIOSchema, type BooleanIOEntity } from '../schemas/BooleanIOSchema.js';

export const BooleanIOs = createRepositoryLens(BooleanIOSchema);

export async function findBooleanIOById(id: string): Promise<BooleanIOEntity | null> {
  try {
    const item = await BooleanIOs.findByIri(id);
    return item ? (item as BooleanIOEntity) : null;
  } catch {
    return null;
  }
}

export async function loadBooleanIOsByIds(ids: string[]): Promise<BooleanIOEntity[]> {
  const out: BooleanIOEntity[] = [];
  for (const id of ids) {
    const item = await findBooleanIOById(id);
    if (item) out.push(item);
  }
  return out;
}

export type { BooleanIOEntity };