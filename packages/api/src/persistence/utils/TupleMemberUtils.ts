import { createRepositoryLens } from './entityRepository.js';
import { TupleMemberSchema, type TupleMemberEntity } from '../schemas/TupleMemberSchema.js';

export const TupleMembers = createRepositoryLens(TupleMemberSchema);

export async function findTupleMemberById(id: string): Promise<TupleMemberEntity | null> {
  try {
    const item = await TupleMembers.findByIri(id);
    return item ? (item as TupleMemberEntity) : null;
  } catch {
    return null;
  }
}

export async function loadTupleMembersByIds(ids: string[]): Promise<TupleMemberEntity[]> {
  const out: TupleMemberEntity[] = [];
  for (const id of ids) {
    const item = await findTupleMemberById(id);
    if (item) out.push(item);
  }
  return out;
}

