import { createRepositoryLens } from './entityRepository.js';
import { TriplesQuadsIOSchema, type PersistedTriplesQuadsIO } from '../schemas/TriplesQuadsIOSchema.js';

export const TriplesQuadsIOs = createRepositoryLens(TriplesQuadsIOSchema);

export async function findTriplesQuadsIOById(id: string): Promise<PersistedTriplesQuadsIO | null> {
  try {
    const item = await TriplesQuadsIOs.findByIri(id);
    return item ? (item as PersistedTriplesQuadsIO) : null;
  } catch {
    return null;
  }
}

export async function loadTriplesQuadsIOsByIds(ids: string[]): Promise<PersistedTriplesQuadsIO[]> {
  const out: PersistedTriplesQuadsIO[] = [];
  for (const id of ids) {
    const item = await findTriplesQuadsIOById(id);
    if (item) out.push(item);
  }
  return out;
}