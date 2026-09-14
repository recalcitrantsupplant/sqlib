import { createEntityUtilsWithFields } from './EntityUtils.js';
import { RuleVersionSchema, type LdkitRuleVersion } from '../schemas/RuleVersionSchema.js';
import { assertMutableEntity } from '../../lib/immutability.js';

const RuleVersionUtils = createEntityUtilsWithFields<LdkitRuleVersion>(
  RuleVersionSchema,
  'RuleVersion'
);

export const RuleVersions = RuleVersionUtils.Repository;
export const createRuleVersion = RuleVersionUtils.create;
export async function updateRuleVersion(id: string, updates: Partial<LdkitRuleVersion>): Promise<void> {
  const existing = await findRuleVersionById(id);
  assertMutableEntity('RuleVersion', existing as Record<string, unknown> | null);
  return RuleVersionUtils.update(id, updates);
}
export const deleteRuleVersion = RuleVersionUtils.delete;
export const findAllRuleVersions = RuleVersionUtils.findAll;
export const findRuleVersionById = RuleVersionUtils.findById;

export async function listVersionsForRule(ruleId: string): Promise<LdkitRuleVersion[]> {
  const all = await RuleVersionUtils.findAll();
  return all
    .filter(v => v.isPartOf === ruleId)
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
}

export async function loadRuleVersionsByIds(ids: string[]): Promise<LdkitRuleVersion[]> {
  const out: LdkitRuleVersion[] = [];
  for (const id of ids) {
    const item = await findRuleVersionById(id);
    if (item) out.push(item);
  }
  return out;
}
