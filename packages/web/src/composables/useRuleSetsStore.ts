import {
  type RuleSet,
  type RuleSetCreateInput,
  type RuleSetUpdateInput,
} from '@sparql-query-lib/contracts';
import { useApiClient } from './useApiClient.js';
import { createVersionedEntityStore } from './createVersionedEntityStore';

const useRuleSetEntities = createVersionedEntityStore<RuleSet, RuleSetCreateInput, RuleSetUpdateInput>({
  noun: 'rule set',
  nounPlural: 'rule sets',
  api: () => {
    const client = useApiClient();
    return {
      list: client.listRuleSets,
      get: client.getRuleSet,
      create: client.createRuleSet,
      update: client.updateRuleSet,
      remove: client.deleteRuleSet,
    };
  },
});

export function useRuleSetsStore() {
  const entities = useRuleSetEntities();

  const fetchRuleSet = async (id: string) => {
    const { data, ifMatch } = await entities.fetch(id);
    return { ruleSet: data, ifMatch };
  };

  const createFromForm = async (data: {
    name: string;
    description: string | null;
    libraryId: string;
  }) => {
    const payload: RuleSetCreateInput = {
      name: data.name.trim(),
      description: data.description?.trim() || null,
      isPartOf: [data.libraryId],
    };
    return entities.create(payload);
  };

  return {
    ruleSets: entities.items,
    loading: entities.loading,
    error: entities.error,
    concurrency: entities.concurrency,
    fetchRuleSets: entities.load,
    fetchRuleSet,
    createRuleSet: entities.create,
    createRuleSetFromForm: createFromForm,
    updateRuleSet: entities.update,
    deleteRuleSet: entities.remove,
  };
}
