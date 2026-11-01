/**
 * Promote the open notebook to a query group: resolve, plan, write.
 *
 * The plan itself is `lib/notebookPromote.ts`, which touches no network. This
 * is the half that does: it pins every cell to the version it names (the
 * current one when the cell floats — a group is a snapshot, so promotion is
 * where floating stops, as the proposal's §11 says), asks the server for the
 * columns a SELECT projects in order, and writes the group, its first version
 * and the pointer to it.
 */
import { ref } from 'vue';
import { isRunCell, type Notebook, type RunCell } from '../lib/notebookFormat';
import { planPromotion, type PromotionPlan, type PromotionTarget } from '../lib/notebookPromote';
import { useApiClient } from './useApiClient';
import type { UseNotebook } from './useNotebook';

export function useNotebookPromotion(nb: UseNotebook) {
  const apiClient = useApiClient();
  const busy = ref(false);

  async function resolveTarget(cell: RunCell): Promise<PromotionTarget | null> {
    const target = nb.targetFor(cell);
    if (!target) return null;

    if (cell.kind === 'group') {
      return {
        kind: 'group', versionId: '', resultKind: target.resultKind, inputTupleIds: [],
        slotVars: target.slots, outputPortId: null, outputVars: [], backendId: null,
      };
    }

    if (cell.kind === 'ruleset') {
      const version = cell.version ?? target.version;
      if (version == null) return null;
      const { data } = await apiClient.getRuleSetVersion(cell.ruleSet, version);
      return {
        kind: 'ruleset', versionId: data.ruleSetVersion.id, resultKind: 'GRAPH', inputTupleIds: [],
        slotVars: [], outputPortId: null, outputVars: [], backendId: null,
      };
    }

    const version = cell.version ?? target.version;
    if (version == null) return null;
    const { data } = await apiClient.getQueryVersion(cell.query, version);
    const outputVars = target.resultKind === 'BINDINGS' && data.queryVersion.queryString
      ? await apiClient.detectOutputs(data.queryVersion.queryString)
      : [];
    return {
      kind: 'query',
      versionId: data.queryVersion.id,
      resultKind: target.resultKind,
      inputTupleIds: data.inputTuples.map((tuple) => tuple.id),
      slotVars: target.slots,
      outputPortId: (data.queryVersion.inferredOutputs ?? [])[0] ?? null,
      outputVars,
      backendId: cell.backend ?? nb.defaultBackendFor(cell),
    };
  }

  /** Resolve every run cell and plan the group, without writing anything. */
  async function plan(notebook: Notebook): Promise<PromotionPlan> {
    const targets = new Map<string, PromotionTarget>();
    for (const cell of notebook.cells) {
      if (!isRunCell(cell)) continue;
      const resolved = await resolveTarget(cell);
      if (resolved) targets.set(cell.id, resolved);
    }
    return planPromotion(notebook, targets);
  }

  /**
   * Write the planned group into the notebook's library and make it current.
   *
   * Three calls, in the order the server needs them. A failure after the
   * group exists leaves an empty group behind rather than none; the error says
   * so, because quietly deleting something the person can already see in the
   * Groups list is worse than leaving it.
   */
  async function promote(
    notebook: Notebook,
    planned: Extract<PromotionPlan, { ok: true }>,
    name: string,
  ): Promise<{ id: string }> {
    const library = notebook.library;
    if (!library) throw new Error('This notebook names no library to promote into.');
    busy.value = true;
    try {
      const { data: group } = await apiClient.createQueryGroup({
        name,
        description: planned.description || null,
        isPartOf: library,
      });
      try {
        const { data: version } = await apiClient.createQueryGroupVersion(group.id, planned.payload);
        // The flat write drops `queryGroupVersion.comment` today, so the note
        // saying where this version came from is set the way an edit sets it.
        const comment = planned.payload.queryGroupVersion?.comment;
        if (comment) {
          await apiClient.patchQueryGroupVersion(group.id, version.queryGroupVersion.version, { comment });
        }
        await apiClient.updateQueryGroup(group.id, {
          name, isPartOf: library, currentVersion: version.queryGroupVersion.id,
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`The group "${name}" was created, but its version could not be written: ${message}`, { cause });
      }
      return { id: group.id };
    } finally {
      busy.value = false;
    }
  }

  return { busy, plan, promote };
}
