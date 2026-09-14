import { createRepositoryLens } from './entityRepository.js';
import { TriplesQuadsIOSchema, type LdkitTriplesQuadsIO } from '../schemas/TriplesQuadsIOSchema.js';

export const TriplesQuadsIOs = createRepositoryLens(TriplesQuadsIOSchema);

export async function findTriplesQuadsIOById(id: string): Promise<LdkitTriplesQuadsIO | null> {
  try {
    const item = await TriplesQuadsIOs.findByIri(id);
    return item ? (item as LdkitTriplesQuadsIO) : null;
  } catch {
    return null;
  }
}

export async function loadTriplesQuadsIOsByIds(ids: string[]): Promise<LdkitTriplesQuadsIO[]> {
  const out: LdkitTriplesQuadsIO[] = [];
  for (const id of ids) {
    const item = await findTriplesQuadsIOById(id);
    if (item) out.push(item);
  }
  return out;
}