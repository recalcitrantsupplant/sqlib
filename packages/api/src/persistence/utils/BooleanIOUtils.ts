import { createRepositoryLens } from './entityRepository.js';
import { BooleanIOSchema, type PersistedBooleanIO } from '../schemas/BooleanIOSchema.js';

export const BooleanIOs = createRepositoryLens(BooleanIOSchema);

export async function findBooleanIOById(id: string): Promise<PersistedBooleanIO | null> {
  try {
    const item = await BooleanIOs.findByIri(id);
    return item ? (item as PersistedBooleanIO) : null;
  } catch {
    return null;
  }
}

export async function loadBooleanIOsByIds(ids: string[]): Promise<PersistedBooleanIO[]> {
  const out: PersistedBooleanIO[] = [];
  for (const id of ids) {
    const item = await findBooleanIOById(id);
    if (item) out.push(item);
  }
  return out;
}

export type { PersistedBooleanIO };