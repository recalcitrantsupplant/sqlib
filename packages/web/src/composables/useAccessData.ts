/**
 * The data behind the Access screen, loaded once and shared by its views.
 *
 * The page creates it and provides it; each view injects it. Grants are
 * additive records on the server, one per principal, resource and set of
 * modes, so a change replaces a principal's grants on one resource with a
 * single grant of the new modes.
 *
 * Changes are a draft until saved, as everywhere else in the app: each one
 * replaces the modes a principal holds on one resource, and the views read
 * the grants with the draft applied. Save writes every change; Discard drops
 * them. Graph counts and `Test as` read the saved grants. Like the other
 * screens' drafts, it is kept in this browser, so leaving the screen or
 * reloading does not lose it.
 *
 * Graph counts come from two places. The total is the backend's own graph
 * list, read as an administrator, whom no policy narrows. What one principal
 * may read is a `Test as` call, cached per backend and principal until a
 * grant or a policy changes.
 */
import { computed, inject, provide, reactive, ref, watch, type InjectionKey } from 'vue';
import type { Backend, Library } from '@sparql-query-lib/contracts';
import { useApiClient, type Grant, type GraphPolicyTest, type PrincipalRecord } from '@/composables/useApiClient';
import { LIST_GRAPHS_QUERY } from '@/lib/graphDataset';

/** The readable graphs one principal reaches on one backend. */
export interface ReadableGraphs {
  loading: boolean;
  result: GraphPolicyTest | null;
  error: string | null;
}

/** One unsaved change: the modes `principal` will hold on `resource`. */
export interface DraftChange {
  principal: string;
  resourceKind: 'library' | 'backend';
  resource: string;
  modes: string[];
}

const draftKey = (principal: string, resource: string) => `${principal}\n${resource}`;

const DRAFT_STORAGE_KEY = 'sqlib:access-draft';

function readStoredDraft(): DraftChange[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((c) => c && typeof c.principal === 'string' && Array.isArray(c.modes)) : [];
  } catch {
    return [];
  }
}

function storeDraft(changes: DraftChange[]) {
  try {
    if (changes.length) localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(changes));
    else localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Storage refused: the draft lives for this page only.
  }
}

export function createAccessData() {
  const api = useApiClient();

  const principals = ref<PrincipalRecord[]>([]);
  /** The grants as the server holds them. */
  const savedGrants = ref<Grant[]>([]);
  const draft = reactive(new Map<string, DraftChange>());
  const libraries = ref<Library[]>([]);
  const backends = ref<Backend[]>([]);
  /** The grants with the draft applied: what the screen shows. */
  const grants = computed<Grant[]>(() => {
    const kept = savedGrants.value.filter((grant) => !draft.has(draftKey(grant.principal, grant.resource)));
    const drafted = [...draft.values()]
      .filter((change) => change.modes.length > 0)
      .map((change): Grant => ({ id: `draft:${draftKey(change.principal, change.resource)}`, ...change }));
    return [...kept, ...drafted];
  });
  const pendingCount = computed(() => draft.size);
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
    if (grantList.status === 'fulfilled') savedGrants.value = grantList.value;
    if (libraryList.status === 'fulfilled') libraries.value = libraryList.value;
    if (backendList.status === 'fulfilled') backends.value = backendList.value;
    // Restored after the saved grants, so a change someone has since saved drops out.
    for (const change of readStoredDraft()) replaceModes(change.principal, change.resourceKind, change.resource, change.modes);
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

  function savedModesOn(principal: string, resource: string): Set<string> {
    return new Set(savedGrants.value
      .filter((grant) => grant.principal === principal && grant.resource === resource)
      .flatMap((grant) => grant.modes));
  }

  function sameModes(a: Iterable<string>, b: Set<string>): boolean {
    const list = [...new Set(a)];
    return list.length === b.size && list.every((mode) => b.has(mode));
  }

  /** Draft `principal`'s modes on one resource. A change back to the saved modes is no change. */
  function replaceModes(principal: string, resourceKind: 'library' | 'backend', resource: string, modes: string[]) {
    const key = draftKey(principal, resource);
    if (sameModes(modes, savedModesOn(principal, resource))) draft.delete(key);
    else draft.set(key, { principal, resourceKind, resource, modes: [...new Set(modes)] });
  }

  watch(draft, () => { if (loaded.value) storeDraft([...draft.values()]); }, { deep: true });

  function isPending(principal: string, resource: string): boolean {
    return draft.has(draftKey(principal, resource));
  }

  function discardDraft() {
    draft.clear();
    saveError.value = null;
  }

  /** Write every drafted change. A change that fails stays in the draft, so Save can be pressed again. */
  async function saveDraft() {
    saving.value = true;
    saveError.value = null;
    try {
      for (const [key, change] of [...draft.entries()]) {
        const existing = savedGrants.value.filter((g) => g.principal === change.principal && g.resource === change.resource);
        for (const grant of existing) await api.deleteGrant(grant.id);
        if (change.modes.length > 0) {
          await api.createGrant({ principal: change.principal, resourceKind: change.resourceKind, resource: change.resource, modes: change.modes });
        }
        draft.delete(key);
        if (change.resourceKind === 'backend') forgetReadable(change.resource);
      }
      savedAt.value = Date.now();
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : String(error);
    } finally {
      savedGrants.value = await api.listGrants().catch(() => savedGrants.value);
      saving.value = false;
    }
  }

  /** Draft `target` to hold the same library and backend grants as `source`, replacing its own. */
  function copyGrants(source: string, target: string) {
    const resources = new Map<string, { kind: 'library' | 'backend'; modes: string[] }>();
    for (const grant of [...grantsOf(source), ...grantsOf(target)]) {
      if (grant.resourceKind === 'everything') continue;
      resources.set(grant.resource, { kind: grant.resourceKind, modes: [...modesOn(source, grant.resource)] });
    }
    for (const [resource, { kind, modes }] of resources) replaceModes(target, kind, resource, modes);
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
    pendingCount, isPending, saveDraft, discardDraft,
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
