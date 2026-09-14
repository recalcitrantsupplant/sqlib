/**
 * Syncing local prefix mappings with a backend's own prefix map.
 *
 * Kept beside `usePrefixManager` rather than inside it. The manager is a
 * singleton with a deep watcher that persists and rebuilds the abbreviation
 * cache on every mutation; threading network state, per-backend baselines and
 * a half-finished plan through it would make every one of those a reason to
 * re-render result tables. This composable owns the sync, and reaches the
 * mappings through the manager's own CRUD so validation and persistence stay
 * in one place.
 *
 * See `docs/guides/prefixes.md`.
 */
import { ref, computed } from 'vue';
import { useApiClient, type RemotePrefixes } from '@/composables/useApiClient';
import { usePrefixManager } from '@/composables/usePrefixManager';
import {
  DEFAULT_SYNC_OPTIONS,
  planPrefixSync,
  resolveConflict,
  type ConflictResolution,
  type PrefixSyncAction,
  type PrefixSyncOptions,
  type PrefixSyncPlan,
  type SyncDirection,
} from '@/lib/prefixSyncPlan';

const BASELINE_KEY_PREFIX = 'sparqlQueryLib.prefixSync.';

export interface SyncBaseline {
  syncedAt: string;
  /** What the *remote* held when the sync finished. */
  pairs: Record<string, string>;
}

export interface ApplyOutcome {
  localAdded: number;
  localUpdated: number;
  localRemoved: number;
  pushed: number;
  pushFailed: number;
  failures: Array<{ prefix: string; error: string }>;
}

/**
 * The per-backend baseline: what the store held at the end of the last sync.
 *
 * In `localStorage` beside the manager's own settings, because it describes
 * this browser's relationship with that store — another machine syncing the
 * same backend has its own history and its own idea of what changed since.
 */
export function readBaseline(backendId: string): SyncBaseline | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(`${BASELINE_KEY_PREFIX}${backendId}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as SyncBaseline;
    return parsed && typeof parsed.pairs === 'object' ? parsed : null;
  } catch {
    // A corrupt baseline is not worth failing a sync over: without one the
    // planner falls back to judging differences on their values alone.
    return null;
  }
}

export function writeBaseline(backendId: string, pairs: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    const baseline: SyncBaseline = { syncedAt: new Date().toISOString(), pairs };
    localStorage.setItem(`${BASELINE_KEY_PREFIX}${backendId}`, JSON.stringify(baseline));
  } catch (error) {
    console.warn('Failed to record prefix sync baseline', error);
  }
}

export function clearBaseline(backendId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`${BASELINE_KEY_PREFIX}${backendId}`);
}

export function usePrefixSync() {
  const { getBackendPrefixes, pushBackendPrefixes } = useApiClient();
  const { prefixSettings, addPrefix, updatePrefix, removePrefix, getEffectiveIds } = usePrefixManager();

  const remote = ref<RemotePrefixes | null>(null);
  const plan = ref<PrefixSyncPlan | null>(null);
  const loading = ref(false);
  const applying = ref(false);
  const error = ref<string | null>(null);
  const outcome = ref<ApplyOutcome | null>(null);

  /*
   * Read through the ref rather than delegating to the plan's own `blocked`
   * getter. That getter closes over the raw action array, so a computed built
   * on it subscribes to nothing and never re-evaluates when the dialog answers
   * a conflict — the Apply button stayed disabled on a fully resolved plan.
   */
  const blocked = computed(() =>
    (plan.value?.actions ?? []).some((action) => action.kind === 'conflict' && action.resolution === null)
  );

  const loadRemote = async (backendId: string): Promise<RemotePrefixes | null> => {
    loading.value = true;
    error.value = null;
    outcome.value = null;
    plan.value = null;
    try {
      remote.value = await getBackendPrefixes(backendId);
      return remote.value;
    } catch (err: unknown) {
      remote.value = null;
      error.value = err instanceof Error ? err.message : 'Failed to read the store\'s prefixes';
      return null;
    } finally {
      loading.value = false;
    }
  };

  const buildPlan = (
    backendId: string,
    direction: SyncDirection,
    options: PrefixSyncOptions = DEFAULT_SYNC_OPTIONS
  ): PrefixSyncPlan | null => {
    if (!remote.value) return null;
    plan.value = planPrefixSync({
      backendId,
      direction,
      options,
      local: prefixSettings.value.mappings,
      effectiveIds: getEffectiveIds(),
      remote: remote.value.mappings,
      baseline: readBaseline(backendId)?.pairs ?? null,
    });
    return plan.value;
  };

  const setResolution = (prefix: string, resolution: ConflictResolution): void => {
    for (const action of plan.value?.actions ?? []) {
      if (action.kind === 'conflict' && action.prefix === prefix) action.resolution = resolution;
    }
  };

  const resolveAll = (resolution: ConflictResolution): void => {
    for (const action of plan.value?.actions ?? []) {
      if (action.kind === 'conflict') action.resolution = resolution;
    }
  };

  /**
   * Run a plan.
   *
   * Local mutations first, then the remote batch, then a re-read that becomes
   * the new baseline. The re-read is not a formality: a push is applied one
   * prefix at a time and can land half-way, so what the store holds afterwards
   * is a fact to fetch rather than to infer from the batch we sent.
   */
  const apply = async (): Promise<ApplyOutcome | null> => {
    const current = plan.value;
    if (!current || current.blocked) return null;

    applying.value = true;
    error.value = null;
    try {
      const actions = expand(current.actions, prefixSettings.value.mappings.map((m) => m.prefix));
      const result: ApplyOutcome = {
        localAdded: 0,
        localUpdated: 0,
        localRemoved: 0,
        pushed: 0,
        pushFailed: 0,
        failures: [],
      };

      for (const rename of actions.renames) {
        updatePrefix(rename.id, { prefix: rename.to });
      }

      for (const action of actions.local) {
        if (action.kind === 'pull-add') {
          const id = addPrefix(action.prefix, action.namespace, 'endpoint', {
            discoveredFrom: current.backendId,
            syncedWith: current.backendId,
          });
          if (id) result.localAdded += 1;
        } else if (action.kind === 'pull-update') {
          updatePrefix(action.id, { namespace: action.to, syncedWith: current.backendId });
          result.localUpdated += 1;
        } else if (action.kind === 'pull-delete') {
          removePrefix(action.id);
          result.localRemoved += 1;
        }
      }

      const upserts = actions.remote
        .filter((action) => action.kind === 'push-add' || action.kind === 'push-update')
        .map((action) => ({
          prefix: action.prefix,
          namespace: action.kind === 'push-add' ? action.namespace : action.to,
        }));
      const deletes = actions.remote
        .filter((action) => action.kind === 'push-delete')
        .map((action) => action.prefix);

      if (upserts.length || deletes.length) {
        const pushed = await pushBackendPrefixes(current.backendId, { upserts, deletes });
        result.pushed = pushed.applied;
        result.pushFailed = pushed.failed;
        result.failures = pushed.results
          .filter((item) => item.status === 'failed')
          .map((item) => ({ prefix: item.prefix, error: item.error ?? 'Refused by the store' }));
      }

      const after = await loadRemoteQuietly(current.backendId);
      if (after) {
        writeBaseline(
          current.backendId,
          Object.fromEntries(after.mappings.map((pair) => [pair.prefix, pair.namespace]))
        );
      }

      outcome.value = result;
      plan.value = null;
      return result;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to apply the sync';
      return null;
    } finally {
      applying.value = false;
    }
  };

  /** The post-apply re-read, which must not blow away the outcome being reported. */
  const loadRemoteQuietly = async (backendId: string): Promise<RemotePrefixes | null> => {
    try {
      remote.value = await getBackendPrefixes(backendId);
      return remote.value;
    } catch {
      return null;
    }
  };

  return {
    remote,
    plan,
    loading,
    applying,
    error,
    outcome,
    blocked,
    loadRemote,
    buildPlan,
    setResolution,
    resolveAll,
    apply,
    readBaseline,
    clearBaseline,
  };
}

/**
 * Flatten resolved conflicts into the plain actions they stand for, split by
 * which side they act on. Exported for the tests, which check the split rather
 * than driving the whole composable.
 */
export function expand(
  actions: PrefixSyncAction[],
  existingPrefixes: string[]
): {
  local: PrefixSyncAction[];
  remote: PrefixSyncAction[];
  renames: Array<{ id: string; to: string }>;
} {
  const taken = new Set(existingPrefixes);
  const flattened: PrefixSyncAction[] = [];
  const renames: Array<{ id: string; to: string }> = [];

  for (const action of actions) {
    if (action.kind !== 'conflict') {
      flattened.push(action);
      continue;
    }
    const resolved = resolveConflict(action, taken);
    flattened.push(...resolved.actions);
    if (resolved.rename) {
      renames.push(resolved.rename);
      taken.add(resolved.rename.to);
    }
  }

  return {
    local: flattened.filter((action) => action.kind.startsWith('pull-')),
    remote: flattened.filter((action) => action.kind.startsWith('push-')),
    renames,
  };
}
