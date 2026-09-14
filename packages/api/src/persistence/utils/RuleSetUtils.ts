import { createEntityUtilsWithFields } from './EntityUtils.js';
import { RuleSetSchema, type LdkitRuleSet } from '../schemas/RuleSetSchema.js';

const RuleSetUtils = createEntityUtilsWithFields<LdkitRuleSet>(
  RuleSetSchema,
  'RuleSet'
);

export const RuleSets = RuleSetUtils.Repository;
export const createRuleSet = RuleSetUtils.create;
export const updateRuleSet = RuleSetUtils.update;
export const deleteRuleSet = RuleSetUtils.delete;
export const findAllRuleSets = RuleSetUtils.findAll;
export const findRuleSetById = RuleSetUtils.findById;

export async function findRuleSetByName(name: string): Promise<LdkitRuleSet | null> {
  const items = await RuleSetUtils.findBy('name', name);
  return items[0] || null;
}
