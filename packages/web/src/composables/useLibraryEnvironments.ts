/**
 * The Library page's environment data: the chain, the entities that can be
 * promoted, each environment's pointers, and the actions on them.
 *
 * Created once per page for one library. Every change goes through the
 * #127 routes; a pointer move always sends `from`, the version the board
 * showed, so two people cannot both move one pointer unseen.
 */
import { computed, ref } from 'vue';
import type { Environment } from '@sparql-query-lib/contracts';
import { useApiClient, type EnvironmentPointer } from '@/composables/useApiClient';
import { useActiveEnvironment } from '@/composables/useActiveEnvironment';
import {
  buildBoard,
  indexPointers,
  type BoardRow,
  type PromotableEntity,
  type PromotableKind,
} from '@/lib/environmentBoard';

export type StartFrom = 'latest' | 'empty' | string;

export interface MoveOutcome {
  ok: boolean;
  /** Set when the pointer had moved since the board loaded: the board is reloaded. */
  conflict?: boolean;
  /** For a group: how many parts the environment holds at other versions. */
  partsBehind?: number;
  error?: string;
}

function belongsTo(isPartOf: unknown, library: string): boolean {
  return Array.isArray(isPartOf) ? isPartOf.includes(library) : isPartOf === library;
}

function errorText(error: unknown): string {
  const record = error as { data?: { error?: string }; statusMessage?: string; message?: string };
  return record?.data?.error ?? record?.statusMessage ?? record?.message ?? 'The request failed';
}

export function useLibraryEnvironments(libraryId: () => string | null) {
  const api = useApiClient();
  const activeEnvironment = useActiveEnvironment();

  const environments = ref<Environment[]>([]);
  const entities = ref<PromotableEntity[]>([]);
  const pointers = ref<Record<string, EnvironmentPointer[]>>({});
  const loading = ref(false);
  const loadError = ref<string | null>(null);

  const rows = computed<BoardRow[]>(() =>
    buildBoard(entities.value, environments.value, indexPointers(pointers.value)));

  async function loadEntities(library: string) {
    const settle = async <T>(call: () => Promise<T[]>) => {
      try {
        return await call();
      } catch {
        // A section the deployment turns off lists nothing.
        return [] as T[];
      }
    };
    const [queries, groups, ruleSets] = await Promise.all([
      settle(() => api.listQueries()),
      settle(() => api.listQueryGroups()),
      settle(() => api.listRuleSets()),
    ]);
    const shape = (kind: PromotableKind) => (item: {
      id: string; name: string; currentVersion?: string | null; currentVersionNumber?: number | null; groupOnly?: boolean | null;
    }): PromotableEntity => ({
      id: item.id,
      name: item.name,
      kind,
      currentVersion: item.currentVersion ?? null,
      currentVersionNumber: item.currentVersionNumber ?? null,
      groupOnly: item.groupOnly === true,
    });
    const order: Record<PromotableKind, number> = { Query: 0, QueryGroup: 1, RuleSet: 2 };
    entities.value = [
      ...queries.filter((q) => belongsTo(q.isPartOf, library)).map(shape('Query')),
      ...groups.filter((g) => belongsTo(g.isPartOf, library)).map(shape('QueryGroup')),
      ...ruleSets.filter((r) => belongsTo(r.isPartOf, library)).map(shape('RuleSet')),
    ].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  }

  async function loadPointers() {
    const entries = await Promise.all(environments.value.map(async (env) =>
      [env.id, await api.listEnvironmentPointers(env.id).catch(() => [])] as const));
    pointers.value = Object.fromEntries(entries);
  }

  async function load() {
    const library = libraryId();
    if (!library) return;
    loading.value = true;
    loadError.value = null;
    try {
      environments.value = await api.listEnvironments(library);
      await Promise.all([loadEntities(library), loadPointers()]);
    } catch (error) {
      loadError.value = errorText(error);
    } finally {
      loading.value = false;
    }
  }

  /** Reload, and tell the library switcher that the chain changed. */
  async function refresh() {
    await load();
    await activeEnvironment.reload();
  }

  async function create(input: { name: string; position: number; defaultBackend: string | null; startFrom: StartFrom }) {
    const library = libraryId();
    if (!library) return { ok: false, error: 'No library' };
    try {
      await api.createEnvironment({
        name: input.name.trim(),
        isPartOf: library,
        position: input.position,
        defaultBackend: input.defaultBackend,
        startFrom: input.startFrom === 'empty' ? null : input.startFrom,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  }

  /**
   * Create a whole chain at once, for a library that has none. Positions are
   * spaced by ten so a later insert has room without renumbering.
   */
  async function createChain(names: readonly string[], startFrom: StartFrom) {
    for (const [index, name] of names.entries()) {
      const result = await create({ name, position: (index + 1) * 10, defaultBackend: null, startFrom });
      if (!result.ok) {
        await refresh();
        return result;
      }
    }
    await refresh();
    return { ok: true };
  }

  async function update(id: string, input: { name?: string; defaultBackend?: string | null; position?: number }) {
    try {
      await api.updateEnvironment(id, input);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  }

  /** Swap an environment with its neighbour in the chain, renumbering every position. */
  async function move(id: string, by: -1 | 1) {
    const list = [...environments.value];
    const from = list.findIndex((env) => env.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= list.length) return { ok: true };
    [list[from], list[to]] = [list[to], list[from]];
    for (const [index, env] of list.entries()) {
      const position = (index + 1) * 10;
      if (env.position === position) continue;
      const result = await update(env.id, { position });
      if (!result.ok) {
        await refresh();
        return result;
      }
    }
    await refresh();
    return { ok: true };
  }

  async function remove(id: string) {
    try {
      await api.deleteEnvironment(id);
      await refresh();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  }

  async function movePointer(environment: string, entity: string, version: string | null, from: string | null): Promise<MoveOutcome> {
    try {
      const result = await api.moveEnvironmentPointer(environment, { entity, version, from });
      // The editors read each environment's versions from the switcher's list.
      await Promise.all([loadPointers(), activeEnvironment.reload()]);
      return { ok: true, partsBehind: result.partsBehind ?? 0 };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 409 && (error as { data?: { current?: unknown } }).data && 'current' in ((error as { data: object }).data)) {
        await loadPointers();
        return { ok: false, conflict: true };
      }
      return { ok: false, error: errorText(error) };
    }
  }

  /** Every version of one entity, newest first, for the "Other version" list. */
  async function versionsOf(entity: PromotableEntity): Promise<Array<{ id: string; version: number }>> {
    const list = entity.kind === 'Query'
      ? await api.listQueryVersions(entity.id)
      : entity.kind === 'QueryGroup'
        ? await api.listQueryGroupVersions(entity.id)
        : await api.listRuleSetVersions(entity.id);
    return (list as Array<{ id: string; version?: number | null }>)
      .filter((item): item is { id: string; version: number } => typeof item.version === 'number')
      .map((item) => ({ id: item.id, version: item.version }))
      .sort((a, b) => b.version - a.version);
  }

  return {
    environments,
    entities,
    rows,
    loading,
    loadError,
    load,
    refresh,
    create,
    createChain,
    update,
    move,
    remove,
    movePointer,
    versionsOf,
  };
}
