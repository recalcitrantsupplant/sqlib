import { ref, watch } from 'vue';

type QueryMethod = 'get' | 'post';

export type PlaygroundQuerySnippet = {
  id: string;
  name: string;
  query: string;
  endpoint?: string;
  method?: QueryMethod;
  mediaType?: string;
};

export type PlaygroundQueryLast = {
  query: string;
  endpoint: string;
  method: QueryMethod;
  mediaType: string;
};

export type PlaygroundRulesBundle = {
  id: string;
  name: string;
  dataBlocks: string[];
  rules: string[];
  maxIterations?: number | null;
  inferenceFormat?: string | null;
};

export type PlaygroundRulesLast = {
  dataBlocks: string[];
  rules: string[];
  maxIterations?: number | null;
  inferenceFormat?: string | null;
};

const QUERY_LAST_KEY = 'playground.queries.v1.last';
const QUERY_SAVED_KEY = 'playground.queries.v1.saved';
const RULES_LAST_KEY = 'playground.rules.v1.last';
const RULES_SAVED_KEY = 'playground.rules.v1.saved';

const isBrowser = typeof window !== 'undefined';

const generateId = () => {
  if (isBrowser && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pg-${Math.random().toString(36).slice(2, 10)}`;
};

function loadFromStorage<T>(key: string, fallback: T): T {
  if (!isBrowser) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function persist<T>(key: string, value: T) {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[playground-storage] Failed to persist ${key}`, error);
  }
}

const queryLast = ref<PlaygroundQueryLast>(loadFromStorage<PlaygroundQueryLast>(QUERY_LAST_KEY, {
  query: '',
  endpoint: '',
  method: 'post',
  mediaType: 'application/sparql-results+json',
}));

const querySaved = ref<PlaygroundQuerySnippet[]>(loadFromStorage<PlaygroundQuerySnippet[]>(QUERY_SAVED_KEY, []));

const rulesLast = ref<PlaygroundRulesLast>(loadFromStorage<PlaygroundRulesLast>(RULES_LAST_KEY, {
  dataBlocks: [''],
  rules: [''],
  maxIterations: null,
  inferenceFormat: 'application/n-triples',
}));

const rulesSaved = ref<PlaygroundRulesBundle[]>(loadFromStorage<PlaygroundRulesBundle[]>(RULES_SAVED_KEY, []));

let watchersInitialized = false;

const initWatchers = () => {
  if (watchersInitialized || !isBrowser) return;
  watchersInitialized = true;
  watch(queryLast, (val) => persist(QUERY_LAST_KEY, val), { deep: true });
  watch(querySaved, (val) => persist(QUERY_SAVED_KEY, val), { deep: true });
  watch(rulesLast, (val) => persist(RULES_LAST_KEY, val), { deep: true });
  watch(rulesSaved, (val) => persist(RULES_SAVED_KEY, val), { deep: true });
};

export function usePlaygroundStorage() {
  initWatchers();

  const addQuerySnippet = (data: { name: string; query: string; endpoint?: string; method?: QueryMethod; mediaType?: string }): PlaygroundQuerySnippet => {
    const snippet: PlaygroundQuerySnippet = {
      id: generateId(),
      name: data.name.trim() || 'Untitled',
      query: data.query,
      endpoint: data.endpoint,
      method: data.method,
      mediaType: data.mediaType,
    };
    querySaved.value = [snippet, ...querySaved.value];
    return snippet;
  };

  const updateQuerySnippet = (id: string, data: Partial<PlaygroundQuerySnippet>) => {
    querySaved.value = querySaved.value.map((entry) => entry.id === id ? { ...entry, ...data } : entry);
  };

  const deleteQuerySnippet = (id: string) => {
    querySaved.value = querySaved.value.filter((entry) => entry.id !== id);
  };

  const addRulesBundle = (data: { name: string; dataBlocks: string[]; rules: string[]; maxIterations?: number | null; inferenceFormat?: string | null }): PlaygroundRulesBundle => {
    const bundle: PlaygroundRulesBundle = {
      id: generateId(),
      name: data.name.trim() || 'Untitled',
      dataBlocks: data.dataBlocks,
      rules: data.rules,
      maxIterations: data.maxIterations ?? null,
      inferenceFormat: data.inferenceFormat ?? null,
    };
    rulesSaved.value = [bundle, ...rulesSaved.value];
    return bundle;
  };

  const updateRulesBundle = (id: string, data: Partial<PlaygroundRulesBundle>) => {
    rulesSaved.value = rulesSaved.value.map((entry) => entry.id === id ? { ...entry, ...data } : entry);
  };

  const deleteRulesBundle = (id: string) => {
    rulesSaved.value = rulesSaved.value.filter((entry) => entry.id !== id);
  };

  return {
    queryLast,
    querySaved,
    rulesLast,
    rulesSaved,
    addQuerySnippet,
    updateQuerySnippet,
    deleteQuerySnippet,
    addRulesBundle,
    updateRulesBundle,
    deleteRulesBundle,
  };
}
