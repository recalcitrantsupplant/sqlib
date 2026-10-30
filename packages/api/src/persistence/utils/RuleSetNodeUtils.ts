import { createRepositoryLens } from './entityRepository.js';
import { RuleSetNodeSchema, type PersistedRuleSetNode } from '../schemas/RuleSetNodeSchema.js';

export const RuleSetNodes = createRepositoryLens(RuleSetNodeSchema);

export async function findRuleSetNodeById(id: string): Promise<PersistedRuleSetNode | null> {
  try {
    const item = await RuleSetNodes.findByIri(id);
    return item ? (item as PersistedRuleSetNode) : null;
  } catch {
    return null;
  }
}

export async function loadRuleSetNodesByIds(ids: string[]): Promise<PersistedRuleSetNode[]> {
  const out: PersistedRuleSetNode[] = [];
  for (const id of ids) {
    const item = await findRuleSetNodeById(id);
    if (item) out.push(item);
  }
  return out;
}
