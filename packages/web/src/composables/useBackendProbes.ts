import { computed, reactive } from 'vue';
import { useApiClient, type BackendProbe } from './useApiClient.js';

/**
 * Backend health, as last observed by the server.
 *
 * One shared map, because the sidebar's dots and the record page's pill are the
 * same fact seen twice: `Test connection` in the pane has to move the dot in
 * the list, and it can only do that if both read one store.
 *
 * A backend with no entry is `never_probed` rather than unhealthy. Nothing here
 * is persisted server-side, so "we have not asked yet" is a real and common
 * state, and drawing it as a red dot would be a lie about the store.
 */
export type BackendHealth = BackendProbe['health'] | 'never_probed';

type ProbeState = {
  byBackend: Record<string, BackendProbe>;
  inFlight: Record<string, boolean>;
  probingAll: boolean;
  loaded: boolean;
  error: string | null;
};

const state = reactive<ProbeState>({
  byBackend: {},
  inFlight: {},
  probingAll: false,
  loaded: false,
  error: null,
});

function absorb(probes: BackendProbe[]) {
  for (const probe of probes) {
    state.byBackend[probe.backendId] = probe;
  }
}

export function useBackendProbes() {
  const client = useApiClient();

  const probes = computed(() => state.byBackend);
  const probingAll = computed(() => state.probingAll);
  const error = computed(() => state.error);

  const probeFor = (backendId: string | null | undefined): BackendProbe | null =>
    (backendId ? state.byBackend[backendId] ?? null : null);

  const healthFor = (backendId: string | null | undefined): BackendHealth =>
    probeFor(backendId)?.health ?? 'never_probed';

  const isProbing = (backendId: string | null | undefined): boolean =>
    (backendId ? state.inFlight[backendId] === true : false);

  /** The cached results. Cheap, and the only thing the sidebar needs on mount. */
  const loadProbes = async (options: { force?: boolean } = {}) => {
    if (state.loaded && !options.force) return;
    try {
      absorb(await client.listBackendProbes());
      state.loaded = true;
      state.error = null;
    } catch (err: any) {
      state.error = err?.message ?? 'Failed to load backend health';
    }
  };

  /** `Test connection`, and the single probe a newly created backend gets. */
  const probe = async (backendId: string) => {
    state.inFlight[backendId] = true;
    try {
      const result = await client.probeBackend(backendId);
      state.byBackend[backendId] = result;
      state.error = null;
      return result;
    } catch (err: any) {
      state.error = err?.message ?? 'Probe failed';
      return null;
    } finally {
      delete state.inFlight[backendId];
    }
  };

  /** `Probe all`. */
  const probeAll = async () => {
    state.probingAll = true;
    try {
      absorb(await client.probeAllBackends());
      state.loaded = true;
      state.error = null;
    } catch (err: any) {
      state.error = err?.message ?? 'Probe failed';
    } finally {
      state.probingAll = false;
    }
  };

  const forget = (backendId: string) => {
    delete state.byBackend[backendId];
  };

  return { probes, probingAll, error, probeFor, healthFor, isProbing, loadProbes, probe, probeAll, forget };
}

/** Test seam — the store is module-level, so a spec has to be able to empty it. */
export function resetBackendProbesForTest() {
  state.byBackend = {};
  state.inFlight = {};
  state.probingAll = false;
  state.loaded = false;
  state.error = null;
}
