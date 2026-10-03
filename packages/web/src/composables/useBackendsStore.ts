import type { Backend } from '@sparql-query-lib/contracts';
import type { BackendFormInput } from '../types/backend.js';
import { useApiClient } from './useApiClient.js';
import { useBrowserBackends } from './useBrowserBackends.js';
import { createVersionedEntityStore } from './createVersionedEntityStore';

const useBackendEntities = createVersionedEntityStore<Backend, BackendFormInput, BackendFormInput>({
  noun: 'backend',
  nounPlural: 'backends',
  api: () => {
    const client = useApiClient();
    return {
      /*
       * The server's backends and this browser's, as one list.
       *
       * Browser backends are appended rather than merged in: they cannot collide
       * with a server id (their own `urn:` namespace sees to that), and a picker
       * that showed them first would put a visitor's scratch endpoint above the
       * catalogue the deployment curated.
       */
      list: async () => [...(await client.listBackends()), ...useBrowserBackends().asBackends.value],
      get: client.getBackend,
      create: client.createBackend,
      update: client.updateBackend,
      remove: client.deleteBackend,
    };
  },
  // They survive a failed load on purpose — on a read-only site with the API
  // unreachable, the endpoints a visitor registered themselves are the ones
  // still worth offering.
  fallbackItems: () => [...useBrowserBackends().asBackends.value],
});

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
  const entities = useBackendEntities();

  const fetchBackend = async (id: string) => {
    const { data, ifMatch } = await entities.fetch(id);
    return { backend: data, ifMatch, form: toFormInput(data) };
  };

  return {
    backends: entities.items,
    loading: entities.loading,
    error: entities.error,
    concurrency: entities.concurrency,
    loadBackends: entities.load,
    createBackend: entities.create,
    updateBackend: entities.update,
    deleteBackend: entities.remove,
    fetchBackend,
    toFormInput,
  };
}
