/**
 * What a sync would do, worked out before anything is touched.
 *
 * The preview table, the conflict UI, `applyPrefixSyncPlan` and the tests all
 * read one list of typed actions produced here. Keeping it pure — no manager,
 * no network, no storage — is what makes the three-way merge testable as a
 * table rather than through a dialog.
 *
 * See `docs/guides/prefixes.md`.
 */
import type { PrefixMapping } from '@/types/prefixes';

export type SyncDirection = 'pull' | 'push' | 'bidirectional';

/** How a conflicted prefix is settled. `both` is the only lossless answer. */
export type ConflictResolution = 'local' | 'remote' | 'skip' | 'both';

export interface RemotePrefix {
  prefix: string;
  namespace: string;
}

export type PrefixSyncAction =
  | { kind: 'pull-add'; prefix: string; namespace: string; note?: string }
  | { kind: 'pull-update'; id: string; prefix: string; from: string; to: string }
  | { kind: 'pull-delete'; id: string; prefix: string; namespace: string }
  | { kind: 'push-add'; prefix: string; namespace: string }
  | { kind: 'push-update'; prefix: string; from: string; to: string }
  | { kind: 'push-delete'; prefix: string; namespace: string }
  | {
      kind: 'conflict';
      prefix: string;
      /** Null when the side deleted it — a delete-vs-edit conflict. */
      local: string | null;
      localId: string | null;
      remote: string | null;
      resolution: ConflictResolution | null;
    };

export interface SkippedMapping {
  prefix: string;
  namespace: string;
  reason: string;
}

export interface PrefixSyncPlan {
  backendId: string;
  direction: SyncDirection;
  actions: PrefixSyncAction[];
  skipped: SkippedMapping[];
  /** True when nothing here can be applied until conflicts are answered. */
  get blocked(): boolean;
}

export interface PrefixSyncOptions {
  /**
   * Pull: also remove local mappings the store does not have.
   * Push: also delete remote prefixes we do not have.
   *
   * Off by default in both directions — it is the only destructive shape this
   * feature has.
   */
  mirror: boolean;
  /** Which local sources may be pushed. Defaults exclude `default`. */
  pushSources: PrefixMapping['source'][];
}

export const DEFAULT_SYNC_OPTIONS: PrefixSyncOptions = {
  mirror: false,
  pushSources: ['user-added', 'auto-discovered', 'endpoint'],
};

export interface PrefixSyncInput {
  backendId: string;
  direction: SyncDirection;
  options: PrefixSyncOptions;
  local: PrefixMapping[];
  /**
   * Which local mappings win their prefix, from the manager's own duplicate
   * resolution. A shadowed mapping is not a claim about anything and is
   * reported as skipped rather than pushed.
   */
  effectiveIds: Set<string>;
  remote: RemotePrefix[];
  /** What the remote held at the end of the last sync. Null before the first. */
  baseline: Record<string, string> | null;
}

/** The empty prefix reads fine but Fuseki refuses to store one. */
function isPushable(prefix: string): boolean {
  return prefix !== '';
}

function conflictsIn(actions: PrefixSyncAction[]): PrefixSyncAction[] {
  return actions.filter((action) => action.kind === 'conflict');
}

export function unresolvedConflicts(plan: PrefixSyncPlan): number {
  return conflictsIn(plan.actions).filter(
    (action) => action.kind === 'conflict' && action.resolution === null
  ).length;
}

function finish(
  backendId: string,
  direction: SyncDirection,
  actions: PrefixSyncAction[],
  skipped: SkippedMapping[]
): PrefixSyncPlan {
  /*
   * A getter, not a field: the dialog settles conflicts by writing
   * `resolution` onto the actions in place, so a boolean computed here would
   * be stale the moment the first one is answered.
   */
  return {
    backendId,
    direction,
    actions,
    skipped,
    get blocked() {
      return actions.some((action) => action.kind === 'conflict' && action.resolution === null);
    },
  };
}

/**
 * The local mappings that take part, keyed by prefix.
 *
 * Disabled mappings are excluded because a disabled row is not a claim about
 * anything, and shadowed ones because the manager has already decided they
 * lose their prefix — pushing one would send a mapping the app itself does not
 * use. Both are recorded in `skipped` so the preview can say so rather than
 * appearing to have missed them.
 */
function localByPrefix(input: PrefixSyncInput, skipped: SkippedMapping[]): Map<string, PrefixMapping> {
  const byPrefix = new Map<string, PrefixMapping>();
  for (const mapping of input.local) {
    if (!mapping.enabled) {
      skipped.push({ prefix: mapping.prefix, namespace: mapping.namespace, reason: 'Disabled' });
      continue;
    }
    if (!input.effectiveIds.has(mapping.id)) {
      skipped.push({ prefix: mapping.prefix, namespace: mapping.namespace, reason: 'Shadowed by another mapping' });
      continue;
    }
    byPrefix.set(mapping.prefix, mapping);
  }
  return byPrefix;
}

function remoteByPrefix(remote: RemotePrefix[]): Map<string, string> {
  return new Map(remote.map((pair) => [pair.prefix, pair.namespace]));
}

export function planPrefixSync(input: PrefixSyncInput): PrefixSyncPlan {
  const skipped: SkippedMapping[] = [];
  const locals = localByPrefix(input, skipped);
  const remotes = remoteByPrefix(input.remote);

  if (input.direction === 'pull') return planPull(input, locals, remotes, skipped);
  if (input.direction === 'push') return planPush(input, locals, remotes, skipped);
  return planBidirectional(input, locals, remotes, skipped);
}

/**
 * Remote is authoritative.
 *
 * A default mapping is never rewritten in place: an odd dataset config
 * redefining `rdf:` would otherwise silently change what the whole app
 * abbreviates. The remote value is added alongside instead, where the
 * manager's own duplicate warning can surface it.
 */
function planPull(
  input: PrefixSyncInput,
  locals: Map<string, PrefixMapping>,
  remotes: Map<string, string>,
  skipped: SkippedMapping[]
): PrefixSyncPlan {
  const actions: PrefixSyncAction[] = [];

  for (const [prefix, namespace] of remotes) {
    const local = locals.get(prefix);
    if (!local) {
      actions.push({ kind: 'pull-add', prefix, namespace });
      continue;
    }
    if (local.namespace === namespace) continue;
    if (local.isDefault) {
      actions.push({
        kind: 'pull-add',
        prefix,
        namespace,
        note: `Added alongside the default ${prefix}: rather than replacing it`,
      });
      continue;
    }
    actions.push({ kind: 'pull-update', id: local.id, prefix, from: local.namespace, to: namespace });
  }

  if (input.options.mirror) {
    for (const [prefix, mapping] of locals) {
      if (remotes.has(prefix)) continue;
      if (mapping.isDefault) {
        skipped.push({ prefix, namespace: mapping.namespace, reason: 'A default is never removed by a mirror' });
        continue;
      }
      actions.push({ kind: 'pull-delete', id: mapping.id, prefix, namespace: mapping.namespace });
    }
  }

  return finish(input.backendId, 'pull', actions, skipped);
}

/** Local is authoritative, filtered to what the store can hold and what the user chose to send. */
function planPush(
  input: PrefixSyncInput,
  locals: Map<string, PrefixMapping>,
  remotes: Map<string, string>,
  skipped: SkippedMapping[]
): PrefixSyncPlan {
  const actions: PrefixSyncAction[] = [];
  const eligible = new Map<string, PrefixMapping>();

  for (const [prefix, mapping] of locals) {
    if (!input.options.pushSources.includes(mapping.source)) {
      skipped.push({ prefix, namespace: mapping.namespace, reason: `Not pushing ${mapping.source} mappings` });
      continue;
    }
    if (!isPushable(prefix)) {
      skipped.push({ prefix, namespace: mapping.namespace, reason: 'The store will not hold the empty prefix' });
      continue;
    }
    eligible.set(prefix, mapping);
  }

  for (const [prefix, mapping] of eligible) {
    const remote = remotes.get(prefix);
    if (remote === undefined) {
      actions.push({ kind: 'push-add', prefix, namespace: mapping.namespace });
      continue;
    }
    if (remote !== mapping.namespace) {
      actions.push({ kind: 'push-update', prefix, from: remote, to: mapping.namespace });
    }
  }

  if (input.options.mirror) {
    for (const [prefix, namespace] of remotes) {
      if (!eligible.has(prefix)) actions.push({ kind: 'push-delete', prefix, namespace });
    }
  }

  return finish(input.backendId, 'push', actions, skipped);
}

/**
 * Three-way merge against the baseline.
 *
 * The baseline is what makes this more than a diff: without it, "added here
 * since the last sync" and "deleted there since the last sync" look identical,
 * and every run resurrects everything either side has ever deleted.
 *
 * Before the first sync there is no baseline, and every difference is judged on
 * its values alone — the two sides agreeing is convergence, and only a real
 * disagreement is a conflict. A first bidirectional run against a fresh backend
 * is therefore usually a clean union.
 */
function planBidirectional(
  input: PrefixSyncInput,
  locals: Map<string, PrefixMapping>,
  remotes: Map<string, string>,
  skipped: SkippedMapping[]
): PrefixSyncPlan {
  const actions: PrefixSyncAction[] = [];
  const baseline = input.baseline;
  const prefixes = new Set([...locals.keys(), ...remotes.keys()]);

  const conflict = (prefix: string, local: PrefixMapping | undefined, remote: string | undefined) =>
    actions.push({
      kind: 'conflict',
      prefix,
      local: local?.namespace ?? null,
      localId: local?.id ?? null,
      remote: remote ?? null,
      resolution: null,
    });

  for (const prefix of [...prefixes].sort()) {
    const local = locals.get(prefix);
    const remote = remotes.get(prefix);
    const base = baseline?.[prefix];

    if (local && remote && local.namespace === remote) continue;

    // Present on one side only: either it was added there, or removed here.
    if (local && !remote) {
      if (base === undefined) {
        if (!isPushable(prefix)) {
          skipped.push({ prefix, namespace: local.namespace, reason: 'The store will not hold the empty prefix' });
          continue;
        }
        actions.push({ kind: 'push-add', prefix, namespace: local.namespace });
      } else if (base === local.namespace) {
        actions.push({ kind: 'pull-delete', id: local.id, prefix, namespace: local.namespace });
      } else {
        // Deleted there, edited here.
        conflict(prefix, local, undefined);
      }
      continue;
    }

    if (!local && remote) {
      if (base === undefined) {
        actions.push({ kind: 'pull-add', prefix, namespace: remote });
      } else if (base === remote) {
        actions.push({ kind: 'push-delete', prefix, namespace: remote });
      } else {
        // Deleted here, edited there.
        conflict(prefix, undefined, remote);
      }
      continue;
    }

    if (!local || !remote) continue;

    // Both sides hold it, with different values.
    if (base === local.namespace) {
      if (local.isDefault) {
        actions.push({
          kind: 'pull-add',
          prefix,
          namespace: remote,
          note: `Added alongside the default ${prefix}: rather than replacing it`,
        });
      } else {
        actions.push({ kind: 'pull-update', id: local.id, prefix, from: local.namespace, to: remote });
      }
    } else if (base === remote) {
      actions.push({ kind: 'push-update', prefix, from: remote, to: local.namespace });
    } else {
      conflict(prefix, local, remote);
    }
  }

  return finish(input.backendId, 'bidirectional', actions, skipped);
}

/**
 * A resolved conflict, as the actions it stands for.
 *
 * `both` keeps the remote value under the prefix it owns and renames the local
 * one out of the way, which is the only resolution that discards nothing. The
 * suffix is picked against every prefix in use so the rename cannot collide
 * with a mapping that already exists.
 */
export function resolveConflict(
  action: Extract<PrefixSyncAction, { kind: 'conflict' }>,
  takenPrefixes: Set<string>
): { actions: PrefixSyncAction[]; rename?: { id: string; to: string } } {
  const { prefix, local, localId, remote, resolution } = action;

  if (resolution === null || resolution === 'skip') return { actions: [] };

  if (resolution === 'local') {
    if (local === null) return { actions: [{ kind: 'push-delete', prefix, namespace: remote ?? '' }] };
    return {
      actions: remote === null
        ? [{ kind: 'push-add', prefix, namespace: local }]
        : [{ kind: 'push-update', prefix, from: remote, to: local }],
    };
  }

  if (resolution === 'remote') {
    if (remote === null) {
      return { actions: localId ? [{ kind: 'pull-delete', id: localId, prefix, namespace: local ?? '' }] : [] };
    }
    return {
      actions: local === null || localId === null
        ? [{ kind: 'pull-add', prefix, namespace: remote }]
        : [{ kind: 'pull-update', id: localId, prefix, from: local, to: remote }],
    };
  }

  // 'both': the remote value keeps the prefix, the local one is renamed beside it.
  let suffix = 1;
  while (takenPrefixes.has(`${prefix}-${suffix}`)) suffix += 1;
  const renamed = `${prefix}-${suffix}`;
  const actions: PrefixSyncAction[] = remote === null
    ? []
    : [{ kind: 'pull-add', prefix, namespace: remote }];
  return {
    actions,
    rename: localId && local !== null ? { id: localId, to: renamed } : undefined,
  };
}
