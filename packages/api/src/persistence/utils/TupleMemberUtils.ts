import { createRepositoryLens } from './entityRepository.js';
import { TupleMemberSchema, type LdkitTupleMember } from '../schemas/TupleMemberSchema.js';

export const TupleMembers = createRepositoryLens(TupleMemberSchema);

export async function findTupleMemberById(id: string): Promise<LdkitTupleMember | null> {
  try {
    const item = await TupleMembers.findByIri(id);
    return item ? (item as LdkitTupleMember) : null;
  } catch {
    return null;
  }
}

export async function loadTupleMembersByIds(ids: string[]): Promise<LdkitTupleMember[]> {
  const out: LdkitTupleMember[] = [];
  for (const id of ids) {
    const item = await findTupleMemberById(id);
    if (item) out.push(item);
  }
  return out;
}

