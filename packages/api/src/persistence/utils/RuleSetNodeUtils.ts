import { createRepositoryLens } from './entityRepository.js';
import { RuleSetNodeSchema, type LdkitRuleSetNode } from '../schemas/RuleSetNodeSchema.js';

export const RuleSetNodes = createRepositoryLens(RuleSetNodeSchema);

export async function findRuleSetNodeById(id: string): Promise<LdkitRuleSetNode | null> {
  try {
    const item = await RuleSetNodes.findByIri(id);
    return item ? (item as LdkitRuleSetNode) : null;
  } catch {
    return null;
  }
}

export async function loadRuleSetNodesByIds(ids: string[]): Promise<LdkitRuleSetNode[]> {
  const out: LdkitRuleSetNode[] = [];
  for (const id of ids) {
    const item = await findRuleSetNodeById(id);
    if (item) out.push(item);
  }
  return out;
}
