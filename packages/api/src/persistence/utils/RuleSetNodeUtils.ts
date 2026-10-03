import { createRepositoryLens } from './entityRepository.js';
import { RuleSetNodeSchema, type RuleSetNodeEntity } from '../schemas/RuleSetNodeSchema.js';

export const RuleSetNodes = createRepositoryLens(RuleSetNodeSchema);

export async function findRuleSetNodeById(id: string): Promise<RuleSetNodeEntity | null> {
  try {
    const item = await RuleSetNodes.findByIri(id);
    return item ? (item as RuleSetNodeEntity) : null;
  } catch {
    return null;
  }
}

export async function loadRuleSetNodesByIds(ids: string[]): Promise<RuleSetNodeEntity[]> {
  const out: RuleSetNodeEntity[] = [];
  for (const id of ids) {
    const item = await findRuleSetNodeById(id);
    if (item) out.push(item);
  }
  return out;
}
