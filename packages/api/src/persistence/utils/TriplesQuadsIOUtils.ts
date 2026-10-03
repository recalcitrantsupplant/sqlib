import { createRepositoryLens } from './entityRepository.js';
import { TriplesQuadsIOSchema, type TriplesQuadsIOEntity } from '../schemas/TriplesQuadsIOSchema.js';

export const TriplesQuadsIOs = createRepositoryLens(TriplesQuadsIOSchema);

export async function findTriplesQuadsIOById(id: string): Promise<TriplesQuadsIOEntity | null> {
  try {
    const item = await TriplesQuadsIOs.findByIri(id);
    return item ? (item as TriplesQuadsIOEntity) : null;
  } catch {
    return null;
  }
}

export async function loadTriplesQuadsIOsByIds(ids: string[]): Promise<TriplesQuadsIOEntity[]> {
  const out: TriplesQuadsIOEntity[] = [];
  for (const id of ids) {
    const item = await findTriplesQuadsIOById(id);
    if (item) out.push(item);
  }
  return out;
}