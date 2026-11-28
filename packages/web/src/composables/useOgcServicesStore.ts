/**
 * The library's OGC services, and the versions under each.
 *
 * Shaped like `useTupleSetsStore`: a stable pointer carrying the name and the
 * slug, immutable versions carrying the collections. Versions are cached per
 * service, because a record page shows one service's history.
 */
import { computed, reactive } from 'vue';
import {
  useApiClient,
  type OgcServiceCollection,
  type OgcServiceRecord,
  type OgcServiceVersion,
} from './useApiClient.js';

type OgcServicesState = {
  ogcServices: OgcServiceRecord[];
  versionsByService: Record<string, OgcServiceVersion[]>;
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
};

const state = reactive<OgcServicesState>({
  ogcServices: [],
  versionsByService: {},
  loading: false,
  error: null,
  concurrency: {},
});

export function useOgcServicesStore() {
  const apiClient = useApiClient();

  const ogcServices = computed(() => state.ogcServices);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadOgcServices = async (filter?: { library?: string | null }) => {
    state.loading = true;
    state.error = null;
    try {
      state.ogcServices = await apiClient.listOgcServices(filter);
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load OGC services';
      state.ogcServices = [];
    } finally {
      state.loading = false;
    }
  };

  const loadVersions = async (serviceId: string) => {
    const versions = await apiClient.listOgcServiceVersions(serviceId);
    state.versionsByService[serviceId] = versions;
    return versions;
  };

  /** Replace or add a record in the listing, so the sidebar shows what was saved. */
  const remember = (service: OgcServiceRecord) => {
    state.ogcServices = state.ogcServices.some(entry => entry.id === service.id)
      ? state.ogcServices.map(entry => (entry.id === service.id ? service : entry))
      : [...state.ogcServices, service];
  };

  const getOgcService = async (serviceId: string) => {
    const { data, etag } = await apiClient.getOgcService(serviceId);
    state.concurrency[serviceId] = etag ?? data.dateModified ?? null;
    remember(data);
    return data;
  };

  const createOgcService = async (input: Parameters<typeof apiClient.createOgcService>[0]) => {
    const { data, etag } = await apiClient.createOgcService(input);
    state.concurrency[data.id] = etag ?? data.dateModified ?? null;
    remember(data);
    return data;
  };

  const updateOgcService = async (
    serviceId: string,
    input: Parameters<typeof apiClient.updateOgcService>[1],
  ) => {
    const { data, etag } = await apiClient.updateOgcService(serviceId, input, {
      ifMatch: state.concurrency[serviceId] ?? null,
    });
    state.concurrency[serviceId] = etag ?? data.dateModified ?? null;
    remember(data);
    return data;
  };

  const createVersion = async (
    serviceId: string,
    input: { collections: OgcServiceCollection[]; comment?: string | null },
  ) => {
    const { data } = await apiClient.createOgcServiceVersion(serviceId, input);
    state.versionsByService[serviceId] = [...(state.versionsByService[serviceId] ?? []), data];
    state.ogcServices = state.ogcServices.map(service =>
      service.id === serviceId ? { ...service, currentVersion: data.id, currentVersionNumber: data.version } : service,
    );
    return data;
  };

  const annotateVersion = async (serviceId: string, version: number, comment: string | null) => {
    const { data } = await apiClient.annotateOgcServiceVersion(serviceId, version, comment);
    state.versionsByService[serviceId] = (state.versionsByService[serviceId] ?? []).map(entry =>
      entry.id === data.id ? data : entry,
    );
    return data;
  };

  const deleteOgcService = async (serviceId: string) => {
    await apiClient.deleteOgcService(serviceId);
    state.ogcServices = state.ogcServices.filter(service => service.id !== serviceId);
    delete state.versionsByService[serviceId];
    delete state.concurrency[serviceId];
  };

  return {
    ogcServices,
    loading,
    error,
    loadOgcServices,
    loadVersions,
    getOgcService,
    createOgcService,
    updateOgcService,
    createVersion,
    annotateVersion,
    deleteOgcService,
  };
}
