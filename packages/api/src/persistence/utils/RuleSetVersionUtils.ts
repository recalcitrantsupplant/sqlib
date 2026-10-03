import { createEntityUtilsWithFields } from './EntityUtils.js';
import { RuleSetVersionSchema, type RuleSetVersionEntity } from '../schemas/RuleSetVersionSchema.js';
import { assertMutableEntity } from '../../lib/immutability.js';

const RuleSetVersionUtils = createEntityUtilsWithFields<RuleSetVersionEntity>(
  RuleSetVersionSchema,
  'RuleSetVersion'
);

export const RuleSetVersions = RuleSetVersionUtils.Repository;
export const createRuleSetVersion = RuleSetVersionUtils.create;
export async function updateRuleSetVersion(id: string, updates: Partial<RuleSetVersionEntity>): Promise<void> {
  const existing = await findRuleSetVersionById(id);
  assertMutableEntity('RuleSetVersion', existing as Record<string, unknown> | null, updates as Record<string, unknown>);
  return RuleSetVersionUtils.update(id, updates);
}
export const deleteRuleSetVersion = RuleSetVersionUtils.delete;
export const findAllRuleSetVersions = RuleSetVersionUtils.findAll;
export const findRuleSetVersionById = RuleSetVersionUtils.findById;

export async function listVersionsForRuleSet(ruleSetId: string): Promise<RuleSetVersionEntity[]> {
  const all = await RuleSetVersionUtils.findAll();
  return all
    .filter(v => v.isPartOf === ruleSetId)
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
}

export async function loadRuleSetVersionsByIds(ids: string[]): Promise<RuleSetVersionEntity[]> {
  const out: RuleSetVersionEntity[] = [];
  for (const id of ids) {
    const item = await findRuleSetVersionById(id);
    if (item) out.push(item);
  }
  return out;
}
