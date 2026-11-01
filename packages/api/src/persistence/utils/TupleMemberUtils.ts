import { createRepositoryLens } from './entityRepository.js';
import { TupleMemberSchema, type PersistedTupleMember } from '../schemas/TupleMemberSchema.js';

export const TupleMembers = createRepositoryLens(TupleMemberSchema);

export async function findTupleMemberById(id: string): Promise<PersistedTupleMember | null> {
  try {
    const item = await TupleMembers.findByIri(id);
    return item ? (item as PersistedTupleMember) : null;
  } catch {
    return null;
  }
}

export async function loadTupleMembersByIds(ids: string[]): Promise<PersistedTupleMember[]> {
  const out: PersistedTupleMember[] = [];
  for (const id of ids) {
    const item = await findTupleMemberById(id);
    if (item) out.push(item);
  }
  return out;
}

