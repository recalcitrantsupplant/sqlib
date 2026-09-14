/**
 * Which model the in-app assistant calls, and with whose key.
 *
 * BYO key per request, which is the plan's step 4: "no auth needed yet". The
 * key is held in this browser and sent to our own API with each turn, because
 * the server deliberately does not hold one — there is no account to attach it
 * to until the caller-authorization model lands (plan §7).
 *
 * That is a real trade and worth stating rather than hiding: a key in
 * localStorage is readable by anything that can run script on this origin. It
 * is the right shape for a local or trusted-network deployment, which is what
 * the assistant is until it has auth, and the panel says so.
 */
import { computed, ref, watch } from 'vue';

const STORAGE_KEY = 'sparql-query-lib-assistant-provider';

/**
 * What a provider tells us about one model. Mirrors the server's shape.
 *
 * No price: no provider's `/models` endpoint returns one, so the panel shows
 * the context window where it is offered and leaves cost to the token counts
 * the turn stream reports.
 */
export type ProviderModel = {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxCompletionTokens?: number;
};

export type AssistantProviderSettings = {
  provider: string;
  model: string;
  apiKey: string;
  /** For OpenAI-compatible endpoints: OpenRouter, Groq, vLLM, Ollama, LM Studio. */
  baseUrl: string;
};

/** Providers the server's factory knows how to build. */
export const ASSISTANT_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-opus-5', needsKey: true },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-5', needsKey: true },
  /*
   * The default is the cheapest fast one, because the first thing anyone does
   * with a new provider is check that it works at all. It is not a
   * recommendation: 8B is thin for a 40-tool agent loop, and the model list is
   * fetched live so a better one is one click away.
   */
  { id: 'groq', label: 'Groq', defaultModel: 'llama-3.1-8b-instant', needsKey: true },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    defaultModel: '',
    needsKey: false,
  },
] as const;

const DEFAULTS: AssistantProviderSettings = {
  provider: 'anthropic',
  model: 'claude-opus-5',
  apiKey: '',
  baseUrl: '',
};

function read(): AssistantProviderSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(stored) as Partial<AssistantProviderSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

const settings = ref<AssistantProviderSettings>(read());
let watching = false;

/**
 * The provider's own model list, fetched on demand.
 *
 * Module-scoped alongside `settings` because the panel is a singleton and a
 * second component asking should not mean a second round trip. Never a hard
 * requirement: the field stays typeable, so a provider that will not list — or
 * a model saved an hour ago — is an inconvenience rather than a wall.
 */
const models = ref<ProviderModel[]>([]);
const modelsLoading = ref(false);
const modelsError = ref<string | null>(null);
/** Which credentials produced `models`, so a no-op refresh stays a no-op. */
let modelsFetchedFor = '';

export function useAssistantProvider() {
  if (!watching) {
    watching = true;
    watch(
      settings,
      (value) => {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      },
      { deep: true }
    );
  }

  const descriptor = computed(
    () => ASSISTANT_PROVIDERS.find((entry) => entry.id === settings.value.provider) ?? ASSISTANT_PROVIDERS[0]
  );

  /**
   * Enough to try a turn. A local endpoint needs a URL and no key; a hosted
   * provider needs a key. Getting this wrong in either direction is a request
   * that fails for a reason the user cannot see from the composer.
   */
  const isConfigured = computed(() => {
    if (!settings.value.model.trim()) return false;
    if (settings.value.provider === 'openai-compatible') return settings.value.baseUrl.trim().length > 0;
    return settings.value.apiKey.trim().length > 0;
  });

  const credentials = computed(() => {
    if (!isConfigured.value) return null;
    return {
      provider: settings.value.provider,
      model: settings.value.model.trim(),
      apiKey: settings.value.apiKey.trim() || undefined,
      baseUrl: settings.value.baseUrl.trim() || undefined,
    };
  });

  function setProvider(id: string) {
    const next = ASSISTANT_PROVIDERS.find((entry) => entry.id === id);
    settings.value = {
      ...settings.value,
      provider: id,
      // Carrying one provider's model name to another is never right, so the
      // default comes with the choice.
      model: next?.defaultModel ?? settings.value.model,
    };
    // Another provider's catalogue is worse than none: it would offer ids that
    // cannot work and hide that the list is stale.
    models.value = [];
    modelsError.value = null;
    modelsFetchedFor = '';
  }

  /**
   * Ask the server what this key can call.
   *
   * Keyed on everything that changes the answer *except* the model itself, so
   * choosing from the list does not refetch the list.
   */
  async function loadModels(apiBaseUrl: string, options: { force?: boolean } = {}) {
    const { provider, apiKey, baseUrl } = settings.value;
    const canAsk = provider === 'openai-compatible' ? baseUrl.trim() : apiKey.trim();
    if (!canAsk) return;

    const key = `${provider}|${apiKey.trim()}|${baseUrl.trim()}`;
    if (!options.force && key === modelsFetchedFor && models.value.length > 0) return;
    if (modelsLoading.value) return;

    modelsLoading.value = true;
    modelsError.value = null;
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/assistant/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as { models?: ProviderModel[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      models.value = payload.models ?? [];
      modelsFetchedFor = key;
    } catch (error) {
      models.value = [];
      modelsError.value = error instanceof Error ? error.message : String(error);
    } finally {
      modelsLoading.value = false;
    }
  }

  function clear() {
    settings.value = { ...DEFAULTS };
    models.value = [];
    modelsError.value = null;
    modelsFetchedFor = '';
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  }

  return {
    settings,
    descriptor,
    isConfigured,
    credentials,
    setProvider,
    clear,
    models,
    modelsLoading,
    modelsError,
    loadModels,
  };
}

export const ASSISTANT_PROVIDER_STORAGE_KEY = STORAGE_KEY;
