import { createEntityUtilsWithFields } from './EntityUtils.js';
import { RuleSetVersionSchema, type LdkitRuleSetVersion } from '../schemas/RuleSetVersionSchema.js';
import { assertMutableEntity } from '../../lib/immutability.js';

const RuleSetVersionUtils = createEntityUtilsWithFields<LdkitRuleSetVersion>(
  RuleSetVersionSchema,
  'RuleSetVersion'
);

export const RuleSetVersions = RuleSetVersionUtils.Repository;
export const createRuleSetVersion = RuleSetVersionUtils.create;
export async function updateRuleSetVersion(id: string, updates: Partial<LdkitRuleSetVersion>): Promise<void> {
  const existing = await findRuleSetVersionById(id);
  assertMutableEntity('RuleSetVersion', existing as Record<string, unknown> | null);
  return RuleSetVersionUtils.update(id, updates);
}
export const deleteRuleSetVersion = RuleSetVersionUtils.delete;
export const findAllRuleSetVersions = RuleSetVersionUtils.findAll;
export const findRuleSetVersionById = RuleSetVersionUtils.findById;

export async function listVersionsForRuleSet(ruleSetId: string): Promise<LdkitRuleSetVersion[]> {
  const all = await RuleSetVersionUtils.findAll();
  return all
    .filter(v => v.isPartOf === ruleSetId)
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
}

export async function loadRuleSetVersionsByIds(ids: string[]): Promise<LdkitRuleSetVersion[]> {
  const out: LdkitRuleSetVersion[] = [];
  for (const id of ids) {
    const item = await findRuleSetVersionById(id);
    if (item) out.push(item);
  }
  return out;
}
