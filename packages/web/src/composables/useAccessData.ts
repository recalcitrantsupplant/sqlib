/**
 * The data behind the Access screen, loaded once and shared by its views.
 *
 * The page creates it and provides it; each view injects it. Grants are
 * additive records on the server, one per principal, resource and set of
 * modes, so a change replaces a principal's grants on one resource with a
 * single grant of the new modes.
 *
 * Graph counts come from two places. The total is the backend's own graph
 * list, read as an administrator, whom no policy narrows. What one principal
 * may read is a `Test as` call, cached per backend and principal until a
 * grant or a policy changes.
 */
import { inject, provide, reactive, ref, type InjectionKey } from 'vue';
import type { Backend, Library } from '@sparql-query-lib/contracts';
import { useApiClient, type Grant, type GraphPolicyTest, type PrincipalRecord } from '@/composables/useApiClient';
import { LIST_GRAPHS_QUERY } from '@/lib/graphDataset';

/** The readable graphs one principal reaches on one backend. */
export interface ReadableGraphs {
  loading: boolean;
  result: GraphPolicyTest | null;
  error: string | null;
}

export function createAccessData() {
  const api = useApiClient();

  const principals = ref<PrincipalRecord[]>([]);
  const grants = ref<Grant[]>([]);
  const libraries = ref<Library[]>([]);
  const backends = ref<Backend[]>([]);
  const loaded = ref(false);
  const loadError = ref<string | null>(null);
  const saving = ref(false);
  const saveError = ref<string | null>(null);
  /** When the last change was saved, for the header's Saved badge. */
  const savedAt = ref<number | null>(null);

  const graphTotals = reactive(new Map<string, number | null>());
  const readable = reactive(new Map<string, ReadableGraphs>());

  async function load() {
    const [principalList, grantList, libraryList, backendList] = await Promise.allSettled([
      api.listPrincipals(),
      api.listGrants(),
      api.listLibraries(),
      api.listBackends(),
    ]);
    if (principalList.status === 'fulfilled') principals.value = principalList.value;
    else loadError.value = 'Could not load people and groups. Only administrators can manage access.';
    if (grantList.status === 'fulfilled') grants.value = grantList.value;
    if (libraryList.status === 'fulfilled') libraries.value = libraryList.value;
    if (backendList.status === 'fulfilled') backends.value = backendList.value;
    loaded.value = true;
  }

  async function reloadBackends() {
    backends.value = await api.listBackends();
    readable.clear();
  }

  function grantsOf(principal: string): Grant[] {
    return grants.value.filter((grant) => grant.principal === principal);
  }

  function modesOn(principal: string, resource: string): Set<string> {
    return new Set(grants.value
      .filter((grant) => grant.principal === principal && grant.resource === resource)
      .flatMap((grant) => grant.modes));
  }

  /** Replace `principal`'s grants on one resource with one grant of `modes`. */
  async function replaceModes(principal: string, resourceKind: 'library' | 'backend', resource: string, modes: string[]) {
    saving.value = true;
    saveError.value = null;
    try {
      for (const grant of grants.value.filter((g) => g.principal === principal && g.resource === resource)) {
        await api.deleteGrant(grant.id);
      }
      if (modes.length > 0) await api.createGrant({ principal, resourceKind, resource, modes });
      grants.value = await api.listGrants();
      savedAt.value = Date.now();
      if (resourceKind === 'backend') forgetReadable(resource);
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : String(error);
      grants.value = await api.listGrants().catch(() => grants.value);
    } finally {
      saving.value = false;
    }
  }

  /** Give `target` the same library and backend grants as `source`, replacing its own. */
  async function copyGrants(source: string, target: string) {
    const resources = new Map<string, { kind: 'library' | 'backend'; modes: string[] }>();
    for (const grant of [...grantsOf(source), ...grantsOf(target)]) {
      if (grant.resourceKind === 'everything') continue;
      resources.set(grant.resource, { kind: grant.resourceKind, modes: [...modesOn(source, grant.resource)] });
    }
    for (const [resource, { kind, modes }] of resources) await replaceModes(target, kind, resource, modes);
  }

  async function graphTotal(backendId: string): Promise<number | null> {
    if (graphTotals.has(backendId)) return graphTotals.get(backendId) ?? null;
    graphTotals.set(backendId, null);
    try {
      const response = await api.runSparql({ query: LIST_GRAPHS_QUERY, backendId });
      const bindings = (response as { results?: { bindings?: unknown[] } }).results?.bindings ?? [];
      graphTotals.set(backendId, bindings.length);
    } catch {
      graphTotals.delete(backendId);
    }
    return graphTotals.get(backendId) ?? null;
  }

  function principalInput(principal: PrincipalRecord): { user?: string; groups?: string[] } {
    if (principal.kind === 'group') return { groups: [principal.iri] };
    if (principal.kind === 'everyone') return { groups: [] };
    return { user: principal.iri };
  }

  /** What `principal` may read on `backendId`, loading it the first time it is asked for. */
  function readableFor(backendId: string, principal: PrincipalRecord): ReadableGraphs {
    const key = `${backendId}\n${principal.iri}`;
    const known = readable.get(key);
    if (known) return known;
    const entry = reactive<ReadableGraphs>({ loading: true, result: null, error: null });
    readable.set(key, entry);
    void graphTotal(backendId);
    api.testGraphPolicy(backendId, principalInput(principal))
      .then((result) => { entry.result = result; })
      .catch((error) => { entry.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { entry.loading = false; });
    return entry;
  }

  function forgetReadable(backendId?: string) {
    for (const key of [...readable.keys()]) {
      if (!backendId || key.startsWith(`${backendId}\n`)) readable.delete(key);
    }
  }

  return {
    principals, grants, libraries, backends, loaded, loadError, saving, saveError, savedAt,
    graphTotals, load, reloadBackends, grantsOf, modesOn, replaceModes, copyGrants,
    graphTotal, readableFor, forgetReadable,
  };
}

export type AccessData = ReturnType<typeof createAccessData>;

const ACCESS_DATA: InjectionKey<AccessData> = Symbol('access-data');

export function provideAccessData(data: AccessData) {
  provide(ACCESS_DATA, data);
}

export function useAccessData(): AccessData {
  const data = inject(ACCESS_DATA);
  if (!data) throw new Error('useAccessData needs the Access page to provide it');
  return data;
}

/** The distinct graphs in a Test as result. */
export function graphsOf(result: GraphPolicyTest | null): string[] {
  if (!result) return [];
  return [...new Set([...(result.defaultGraphs ?? []), ...(result.namedGraphs ?? [])])];
}
