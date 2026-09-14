import { computed, reactive } from 'vue';
import {
  type RuleSet,
  type RuleSetCreateInput,
  type RuleSetUpdateInput,
} from '@sparql-query-lib/contracts';
import { useApiClient } from './useApiClient.js';

type RuleSetState = {
  items: RuleSet[];
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
};

const state = reactive<RuleSetState>({
  items: [],
  loading: false,
  error: null,
  concurrency: {},
});

function deriveIfMatchToken(
  etag: string | null,
  entity: { dateModified?: string | null; dateCreated?: string | null } | null,
): string | null {
  if (etag && typeof etag === 'string' && etag.trim().length > 0) {
    return etag;
  }
  if (!entity) {
    return null;
  }
  return entity.dateModified ?? entity.dateCreated ?? null;
}

export function useRuleSetsStore() {
  const {
    listRuleSets,
    getRuleSet,
    createRuleSet,
    updateRuleSet,
    deleteRuleSet,
  } = useApiClient();

  const ruleSets = computed(() => state.items);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadRuleSets = async () => {
    state.loading = true;
    state.error = null;
    try {
      state.items = await listRuleSets();
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load rule sets';
      state.items = [];
    } finally {
      state.loading = false;
    }
  };

  const fetchRuleSet = async (id: string) => {
    const result = await getRuleSet(id);
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    return {
      ruleSet: result.data,
      ifMatch: state.concurrency[id],
    };
  };

  const create = async (input: RuleSetCreateInput) => {
    const result = await createRuleSet(input);
    state.concurrency[result.data.id] = deriveIfMatchToken(result.etag, result.data);
    await loadRuleSets();
    return result.data;
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
    return create(payload);
  };

  const update = async (id: string, input: RuleSetUpdateInput, explicitIfMatch?: string | null) => {
    const ifMatch = explicitIfMatch ?? state.concurrency[id] ?? null;
    const result = await updateRuleSet(id, input, { ifMatch });
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    await loadRuleSets();
    return result.data;
  };

  const remove = async (id: string) => {
    await deleteRuleSet(id);
    delete state.concurrency[id];
    await loadRuleSets();
  };

  return {
    ruleSets,
    loading,
    error,
    concurrency: state.concurrency,
    fetchRuleSets: loadRuleSets,
    fetchRuleSet,
    createRuleSet: create,
    createRuleSetFromForm: createFromForm,
    updateRuleSet: update,
    deleteRuleSet: remove,
  };
}