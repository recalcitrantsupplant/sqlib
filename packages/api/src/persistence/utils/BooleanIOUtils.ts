import { createRepositoryLens } from './entityRepository.js';
import { BooleanIOSchema, type LdkitBooleanIO } from '../schemas/BooleanIOSchema.js';

export const BooleanIOs = createRepositoryLens(BooleanIOSchema);

export async function findBooleanIOById(id: string): Promise<LdkitBooleanIO | null> {
  try {
    const item = await BooleanIOs.findByIri(id);
    return item ? (item as LdkitBooleanIO) : null;
  } catch {
    return null;
  }
}

export async function loadBooleanIOsByIds(ids: string[]): Promise<LdkitBooleanIO[]> {
  const out: LdkitBooleanIO[] = [];
  for (const id of ids) {
    const item = await findBooleanIOById(id);
    if (item) out.push(item);
  }
  return out;
}

export type { LdkitBooleanIO };