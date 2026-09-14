/**
 * The callable list for one library: every query and query group in it, with
 * its signature and its live-versus-draft state.
 *
 * Loading cost, stated rather than hidden. A callable's signature lives on its
 * *version*, and finding which version is current needs the version list, so
 * this is two requests per callable. That is fine for a hand-built library and
 * will not be fine for a chat-built one — the design flags scale as an open
 * question (§9.6) and the answer is a batch endpoint, not a client-side
 * workaround. Requests are issued with a small concurrency cap so a library of
 * fifty does not open a hundred sockets at once.
 */
import { ref, computed, type Ref } from 'vue';
import type { Query, QueryGroup } from '@sparql-query-lib/contracts';
import { useApiClient } from './useApiClient';
import { useFeatureFlags } from './useFeatureFlags';
import { useCallableDrafts, type CallableDraft } from './useCallableDrafts';
import {
  callableFromQueryVersion,
  callableFromGroupVersion,
  type Callable,
} from '../lib/callables';

const CONCURRENCY = 6;

/** Run `worker` over `items`, at most CONCURRENCY at a time, keeping order. */
async function mapLimit<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
}

/**
 * A draft carries detected variable names and nothing else — no datatypes, no
 * defaults — because it has never been through the version endpoints that
 * store them as entities. Rendering it as a Callable keeps one row component
 * for both states; the missing metadata simply shows as absent.
 */
function callableFromDraft(draft: CallableDraft): Callable {
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    type: draft.type,
    state: 'draft',
    version: null,
    libraryId: draft.libraryId,
    resultKind: draft.resultKind,
    inputTuples: draft.inputTuples.map((members, index) => ({
      id: `${draft.id}#tuple-${index}`,
      name: null,
      members: members.map((variableName) => ({ variableName, datatype: null })),
    })),
    limitParameters: draft.limitParameters.map((name) => ({ name, defaultValue: null })),
    offsetParameters: draft.offsetParameters.map((name) => ({ name, defaultValue: null })),
    outputs: draft.outputs.map((variableName) => ({ variableName, description: null })),
    composes: null,
  };
}

export function useCallables(libraryId: Ref<string | null>) {
  const apiClient = useApiClient();
  const { isEnabled } = useFeatureFlags();
  const { drafts: libraryDrafts, allDrafts } = useCallableDrafts(libraryId);

  /*
   * Scratch queries are not library-scoped — they read `unassigned` until the
   * save moment picks a library (nav doc §1) — but they are exactly the
   * "the assistant wrote this and it was never saved" state this screen is
   * about, so they belong in the list alongside the library's own drafts.
   */
  const drafts = computed<CallableDraft[]>(() => {
    const scoped = libraryDrafts.value;
    const unassignedScratch = allDrafts.value.filter(
      (draft) => draft.kind === 'scratch' && !scoped.includes(draft)
    );
    return [...scoped, ...unassignedScratch];
  });

  const live = ref<Callable[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /**
   * Which library `live` currently holds rows for, so a *refresh* of the
   * library already on screen can be told apart from a *switch* to another one.
   *
   * Only the switch may blank the table. The change feed refreshes this list
   * every time an MCP client writes — and the Build screen replaces the whole
   * table with a one-line "Loading callables…" while `loading` is true, so an
   * unconditional flag moved everything below it up by the height of the table
   * and back on every refresh. That measured as CLS 0.14 on /build, repeating
   * for as long as the page stayed open. Rows stay on screen while the reload
   * runs; they are replaced when it lands.
   */
  const loadedLibraryId = ref<string | null>(null);

  async function loadQueryCallable(query: Query): Promise<Callable | null> {
    try {
      const versions = await apiClient.listQueryVersions(query.id);
      const current =
        versions.find((version) => version.id === query.currentVersion) ??
        // No currentVersion set is normal for a query mid-authoring; the
        // highest version is still the one a caller would reach.
        versions.slice().sort((a, b) => b.version - a.version)[0];
      if (!current) return null;

      /*
       * getQueryVersion returns the ApiResult envelope (data plus the etag and
       * last-modified the version editors need for If-Match), where the list
       * endpoints return the parsed body directly. Unwrapping the wrong one is
       * silent: the callable simply never appears.
       */
      const expanded = await apiClient.getQueryVersion(query.id, current.version);
      return callableFromQueryVersion(query, expanded.data);
    } catch (cause) {
      // One unreadable callable must not empty the whole table — but it must
      // not vanish without trace either. Swallowing this silently is how a
      // wrong response shape reads as "the library is empty".
      console.warn('[useCallables] skipped query', query.id, cause);
      return null;
    }
  }

  async function loadGroupCallable(group: QueryGroup): Promise<Callable | null> {
    try {
      const versions = await apiClient.listQueryGroupVersions(group.id);
      const current =
        versions.find((version) => version.id === group.currentVersion) ??
        versions.slice().sort((a, b) => b.version - a.version)[0];
      if (!current) return null;

      const expanded = await apiClient.getQueryGroupVersion(group.id, current.version);
      return callableFromGroupVersion(group, expanded.data);
    } catch (cause) {
      console.warn('[useCallables] skipped group', group.id, cause);
      return null;
    }
  }

  async function load() {
    const id = libraryId.value;
    if (!id) {
      live.value = [];
      loadedLibraryId.value = null;
      return;
    }

    loading.value = loadedLibraryId.value !== id;
    error.value = null;
    try {
      const [queries, groups] = await Promise.all([
        isEnabled('queries') ? apiClient.listQueries() : Promise.resolve([] as Query[]),
        isEnabled('queryGroups') ? apiClient.listQueryGroups() : Promise.resolve([] as QueryGroup[]),
      ]);

      const [queryCallables, groupCallables] = await Promise.all([
        mapLimit(
          queries.filter((query) => query.isPartOf.includes(id)),
          loadQueryCallable
        ),
        mapLimit(
          groups.filter((group) => group.isPartOf === id),
          loadGroupCallable
        ),
      ]);

      live.value = [...queryCallables, ...groupCallables].filter(
        (callable): callable is Callable => callable !== null
      );
      loadedLibraryId.value = id;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Failed to load callables';
      live.value = [];
      // Nothing is on screen to keep, so the next attempt is a first load again.
      loadedLibraryId.value = null;
    } finally {
      loading.value = false;
    }
  }

  /*
   * Drafts sort first. A draft is the thing that needs a decision — save it
   * or throw it away — and burying it under twenty saved callables is how
   * a library ends up with drafts nobody remembers writing.
   */
  const callables = computed<Callable[]>(() => [
    ...drafts.value.map(callableFromDraft),
    ...live.value,
  ]);

  const liveCount = computed(() => live.value.length);
  const draftCount = computed(() => drafts.value.length);

  return { callables, live, drafts, liveCount, draftCount, loading, error, load };
}
