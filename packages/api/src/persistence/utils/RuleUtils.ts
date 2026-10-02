import { createEntityUtilsWithFields } from './EntityUtils.js';
import { RuleSchema, type RuleEntity } from '../schemas/RuleSchema.js';

const RuleUtils = createEntityUtilsWithFields<RuleEntity>(
  RuleSchema,
  'Rule'
);

export const Rules = RuleUtils.Repository;
export const createRule = RuleUtils.create;
export const updateRule = RuleUtils.update;
export const deleteRule = RuleUtils.delete;
export const findAllRules = RuleUtils.findAll;
export const findRuleById = RuleUtils.findById;

export async function findRuleByName(name: string): Promise<RuleEntity | null> {
  const items = await RuleUtils.findBy('name', name);
  return items[0] || null;
}
