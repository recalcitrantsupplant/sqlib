import { computed, reactive } from 'vue';
import type { Backend } from '@sparql-query-lib/contracts';
import type { BackendFormInput } from '../types/backend.js';
import { useApiClient } from './useApiClient.js';

type BackendState = {
  items: Backend[];
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
};

const state = reactive<BackendState>({
  items: [],
  loading: false,
  error: null,
  concurrency: {},
});

function deriveIfMatchToken(etag: string | null, backend: Backend | null): string | null {
  if (etag && typeof etag === 'string' && etag.trim().length > 0) {
    return etag;
  }
  if (!backend) {
    return null;
  }
  return backend.dateModified ?? backend.dateCreated ?? null;
}

function toFormInput(backend: Backend): BackendFormInput {
  return {
    name: backend.name,
    description: backend.description ?? null,
    backendType: backend.backendType,
    // Null, not '': the contract types endpoint as an optional IRI, and an
    // in-process backend legitimately has none — '' would fail validation.
    endpoint: backend.endpoint ?? null,
    authEnvKey: backend.authEnvKey ?? null,
    queryMethod: backend.queryMethod ?? null,
    oxigraphConfig: backend.oxigraphConfig ?? null,
  };
}

export function useBackendsStore() {
  const {
    listBackends,
    getBackend,
    createBackend,
    updateBackend,
    deleteBackend,
  } = useApiClient();

  const backends = computed(() => state.items);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadBackends = async () => {
    state.loading = true;
    state.error = null;
    try {
      state.items = await listBackends();
    } catch (err: any) {
      state.error = err?.message ?? 'Failed to load backends';
      state.items = [];
    } finally {
      state.loading = false;
    }
  };

  const fetchBackend = async (id: string) => {
    const result = await getBackend(id);
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    return {
      backend: result.data,
      ifMatch: state.concurrency[id],
      form: toFormInput(result.data),
    };
  };

  const create = async (input: BackendFormInput) => {
    const result = await createBackend(input);
    state.concurrency[result.data.id] = deriveIfMatchToken(result.etag, result.data);
    await loadBackends();
    return result.data;
  };

  const update = async (id: string, input: BackendFormInput, explicitIfMatch?: string | null) => {
    const ifMatch = explicitIfMatch ?? state.concurrency[id] ?? null;
    const result = await updateBackend(id, input, { ifMatch });
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    await loadBackends();
    return result.data;
  };

  const remove = async (id: string) => {
    await deleteBackend(id);
    delete state.concurrency[id];
    await loadBackends();
  };

  return {
    backends,
    loading,
    error,
    concurrency: state.concurrency,
    loadBackends,
    createBackend: create,
    updateBackend: update,
    deleteBackend: remove,
    fetchBackend,
    toFormInput,
  };
}
