/**
 * A notebook, running against the REST API.
 *
 * The split from the library page is the point. That screen *renders* a library
 * from the export bundle: one cell per exportable query, no prose, no order, no
 * way for one cell to use what another produced. This composable holds a
 * document someone wrote — markdown cells between run cells — and the session
 * values those runs bind.
 *
 * Everything runs through the API, so everything the product has is available:
 * queries and groups through `POST /execute`, rule sets through
 * `POST /rule-sets/:id/execute`. Nothing here needs the bundle, which is why
 * rule-set cells work at all (the bundle carries no rule sets, and does not
 * need to — see `docs/proposals/notebook-cells.md`).
 *
 * Two deliberate limits, both stated in the proposal:
 *
 * - Values are **session state**. The document is the story, not the run, so a
 *   reloaded notebook shows cells that have not run — the same contract an
 *   `.ipynb` with cleared outputs offers. `Save` promotes a value to a real
 *   `DataGraph` or `TupleSet` version, and that is the only thing that persists.
 * - Chaining is **by value**: a result comes back to the browser and goes out
 *   again in the next request. That is fine for the demonstrations a notebook is
 *   for, and it is the wrong shape for production — which is what
 *   promote-to-query-group is for.
 */
import { computed, ref, watch, type Ref } from 'vue';
import { toExecutionParameters } from '@sparql-query-lib/runtime';
import type { Callable } from '../lib/callables';
import {
  booleanValue,
  graphValue,
  rowsValue,
  toSlotArgument,
  type NotebookValue,
  type RowsValue,
} from '../lib/notebookValues';
import {
  cellSlots,
  cellTargetId,
  dependentCellIds,
  emptyNotebook,
  isRunCell,
  isValidValueName,
  nextValueName,
  renameValue,
  validateNotebook,
  type NotebookCell,
  type Notebook,
  type RunCell,
  type SlotSource,
} from '../lib/notebookFormat';
import { useApiClient } from './useApiClient';
import { useCallables } from './useCallables';
import { useRuleSetsStore } from './useRuleSetsStore';

/**
 * What a cell can be pointed at, flattened across the three entity kinds.
 *
 * A notebook does not care that a query's signature comes off its version's
 * input tuples and a rule set has no signature at all; it cares what to show in
 * the cell header and what to send. One shape for all three keeps the cell
 * components from each growing their own resolution path.
 */
export interface NotebookTarget {
  id: string;
  kind: 'query' | 'group' | 'ruleset';
  name: string;
  description: string | null;
  /** SELECT / ASK / CONSTRUCT, or GRAPH for a rule set. */
  resultKind: 'BINDINGS' | 'BOOLEAN' | 'GRAPH' | 'UPDATE';
  /** One entry per parameter slot, each the variables it binds, in order. */
  slots: string[][];
  limitParameters: string[];
  offsetParameters: string[];
  version: number | null;
  /** The query's text, where it has one: what the cell shows it will run. */
  queryString: string | null;
}

export type CellStatus = 'idle' | 'running' | 'ok' | 'error' | 'skipped';

export interface CellRunState {
  status: CellStatus;
  error: string | null;
  durationMs: number | null;
  ranAt: string | null;
  /** An upstream value was rebound after this cell ran. */
  stale: boolean;
}

const IDLE: CellRunState = { status: 'idle', error: null, durationMs: null, ranAt: null, stale: false };

function targetFromCallable(callable: Callable): NotebookTarget {
  return {
    id: callable.id,
    kind: callable.type === 'group' ? 'group' : 'query',
    name: callable.name,
    description: callable.description,
    resultKind: callable.resultKind,
    slots: callable.inputTuples.map((tuple) => tuple.members.map((member) => member.variableName)),
    limitParameters: callable.limitParameters.map((parameter) => parameter.name),
    offsetParameters: callable.offsetParameters.map((parameter) => parameter.name),
    version: callable.version,
    queryString: callable.queryString ?? null,
  };
}

/** The message a failed call should show, preferring the server's own words. */
function runErrorMessage(cause: unknown): string {
  const statusMessage = (cause as { statusMessage?: string })?.statusMessage;
  if (statusMessage) return statusMessage;
  return cause instanceof Error ? cause.message : String(cause);
}

export function useNotebook(libraryId: Ref<string | null>) {
  const apiClient = useApiClient();
  const callables = useCallables(libraryId);
  const ruleSetsStore = useRuleSetsStore();

  const notebook = ref<Notebook>(emptyNotebook(libraryId.value));
  /** Bound values, by name. Session-scoped by design. */
  const values = ref<Record<string, NotebookValue>>({});
  const runState = ref<Record<string, CellRunState>>({});

  const problems = computed(() => validateNotebook(notebook.value));

  /**
   * Load everything a cell can point at.
   *
   * Rule sets come from their own store because they are not callables — they
   * take a graph and return one, rather than taking arguments and returning
   * results — and `useCallables` is the callable list by construction.
   */
  async function loadTargets(): Promise<void> {
    await Promise.all([
      callables.load(),
      ruleSetsStore.fetchRuleSets().catch((cause: unknown) => {
        // A library with the rules suite turned off is a normal state, not a
        // failure of the screen: the picker simply offers no rule sets.
        console.warn('[useNotebook] rule sets unavailable', cause);
      }),
    ]);
  }

  const targets = computed<Map<string, NotebookTarget>>(() => {
    const map = new Map<string, NotebookTarget>();
    for (const callable of callables.callables.value) {
      if (callable.state !== 'live') continue;
      map.set(callable.id, targetFromCallable(callable));
    }
    for (const ruleSet of ruleSetsStore.ruleSets.value) {
      // The rule-set store is account-wide; a notebook only offers the library's.
      if (!ruleSet.isPartOf.includes(libraryId.value ?? '')) continue;
      map.set(ruleSet.id, {
        id: ruleSet.id,
        kind: 'ruleset',
        name: ruleSet.name,
        description: ruleSet.description ?? null,
        resultKind: 'GRAPH',
        slots: [],
        limitParameters: [],
        offsetParameters: [],
        version: ruleSet.currentVersionNumber ?? null,
        // A rule set is a document of rules, not one query: the cell links to
        // the editor for it rather than pretending it has a body to show.
        queryString: null,
      });
    }
    return map;
  });

  function targetFor(cell: RunCell): NotebookTarget | null {
    return targets.value.get(cellTargetId(cell)) ?? null;
  }

  function stateFor(cellId: string): CellRunState {
    return runState.value[cellId] ?? IDLE;
  }

  /* ------------------------------------------------------------------ *
   * Editing the document
   * ------------------------------------------------------------------ */

  function addCell(cell: NotebookCell, afterId?: string | null): void {
    const cells = [...notebook.value.cells];
    const index = afterId ? cells.findIndex((entry) => entry.id === afterId) : -1;
    if (index >= 0) cells.splice(index + 1, 0, cell);
    else cells.push(cell);
    notebook.value = { ...notebook.value, cells };
  }

  /** A run cell needs a name before it is inserted, so that it can be referenced. */
  function mintValueName(): string {
    return nextValueName(notebook.value);
  }

  function removeCell(cellId: string): void {
    const cell = notebook.value.cells.find((entry) => entry.id === cellId);
    notebook.value = {
      ...notebook.value,
      cells: notebook.value.cells.filter((entry) => entry.id !== cellId),
    };
    // The value goes with the cell that bound it: leaving it would let a cell
    // below keep reading a name the document no longer defines.
    if (cell && isRunCell(cell)) {
      const { [cell.out]: _dropped, ...rest } = values.value;
      values.value = rest;
    }
    const { [cellId]: _state, ...restState } = runState.value;
    runState.value = restState;
  }

  function moveCell(cellId: string, delta: -1 | 1): void {
    const cells = [...notebook.value.cells];
    const index = cells.findIndex((entry) => entry.id === cellId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= cells.length) return;
    [cells[index], cells[next]] = [cells[next]!, cells[index]!];
    notebook.value = { ...notebook.value, cells };
  }

  function updateCell<T extends NotebookCell>(cellId: string, patch: Partial<T>): void {
    notebook.value = {
      ...notebook.value,
      cells: notebook.value.cells.map((cell) =>
        cell.id === cellId ? ({ ...cell, ...patch } as NotebookCell) : cell,
      ),
    };
  }

  /**
   * Rename a value, carrying its references and its bound result with it.
   *
   * Returns an error message rather than throwing: this is driven by an input
   * field, and a half-typed name is a normal state rather than a fault.
   */
  function renameOutput(cellId: string, name: string): string | null {
    const cell = notebook.value.cells.find((entry) => entry.id === cellId);
    if (!cell || !isRunCell(cell)) return 'That cell binds no value.';
    if (cell.out === name) return null;
    if (!isValidValueName(name)) return 'A value name starts with a letter and holds letters, digits or _.';
    if (notebook.value.cells.some((entry) => isRunCell(entry) && entry.out === name)) {
      return `@${name} is already bound by another cell.`;
    }

    const previous = cell.out;
    notebook.value = renameValue(notebook.value, previous, name);
    const held = values.value[previous];
    if (held) {
      const { [previous]: _dropped, ...rest } = values.value;
      values.value = { ...rest, [name]: { ...held, name } };
    }
    return null;
  }

  /**
   * Open a document.
   *
   * A document that names no library takes the active one as it is opened. It
   * is not bookkeeping: the library watcher below resets a notebook belonging
   * to a *different* library, and a document that never learned which library
   * it was written against would be cleared the moment the library resolved —
   * which is exactly what happened to a restored notebook on load.
   */
  function setNotebook(next: Notebook): void {
    notebook.value = next.library ? next : { ...next, library: libraryId.value };
    values.value = {};
    runState.value = {};
  }

  /* ------------------------------------------------------------------ *
   * Running
   * ------------------------------------------------------------------ */

  /**
   * Build one slot's `arguments` entry.
   *
   * A slot fed from a value is renamed here, client-side, to the target's own
   * variables — the same name-then-position pairing a query group's edge uses,
   * so that a notebook chain and the group it promotes to mean the same thing.
   */
  function slotArgument(
    slot: SlotSource | undefined,
    vars: string[],
  ): { head: { vars: string[] }; arguments: { bindings: Array<Record<string, unknown>> } } | 'skip' | string {
    if (!slot || slot.from === 'typed') {
      // No source is a wildcard row: the runtime drops the slot, which is what
      // makes a freshly inserted cell runnable rather than an error.
      return {
        head: { vars: [...vars] },
        arguments: { bindings: slot?.from === 'typed' ? slot.bindings : [{}] },
      };
    }

    const value = values.value[slot.ref];
    if (!value) return `@${slot.ref} has not been produced yet — run the cell above first.`;
    if (value.type !== 'rows') return `@${slot.ref} is ${value.type}, and a parameter slot takes rows.`;
    if (value.bindings.length === 0) {
      if ((slot.whenEmpty ?? 'skip') === 'skip') return 'skip';
      if (slot.whenEmpty === 'stop') return `@${slot.ref} is empty.`;
    }
    return toSlotArgument(value as RowsValue, vars);
  }

  async function runQueryLike(cell: RunCell, target: NotebookTarget, started: number): Promise<void> {
    const args: Array<{ head: { vars: string[] }; arguments: { bindings: Array<Record<string, unknown>> } }> = [];
    const slots = cellSlots(cell);

    for (const [index, vars] of target.slots.entries()) {
      const built = slotArgument(slots[index], vars);
      if (built === 'skip') {
        runState.value = {
          ...runState.value,
          [cell.id]: { status: 'skipped', error: null, durationMs: null, ranAt: new Date().toISOString(), stale: false },
        };
        return;
      }
      if (typeof built === 'string') throw new Error(built);
      args.push(built);
    }

    const limits = toExecutionParameters(cell.kind === 'query' ? cell.limits : undefined);
    const offsets = toExecutionParameters(cell.kind === 'query' ? cell.offsets : undefined);

    const result = await apiClient.executeTarget({
      targetId: cellTargetId(cell),
      ...(args.length ? { arguments: args as never } : {}),
      ...(limits.length ? { limits } : {}),
      ...(offsets.length ? { offsets } : {}),
    } as never);

    const durationMs = Math.round(performance.now() - started);
    const source = { name: cell.out, cellId: cell.id, durationMs };
    const isJson = (result.contentType ?? '').includes('json');

    let produced: NotebookValue;
    if (isJson) {
      const payload = JSON.parse(result.body) as {
        boolean?: boolean;
        head?: { vars?: string[] };
        results?: { bindings?: Array<Record<string, unknown>> };
      };
      produced =
        typeof payload.boolean === 'boolean'
          ? booleanValue(source, payload.boolean)
          : rowsValue(source, payload, result.body);
    } else {
      produced = graphValue(source, result.body, result.contentType);
    }

    bind(cell, produced, durationMs);
  }

  async function runRuleSet(cell: RunCell & { kind: 'ruleset' }, started: number): Promise<void> {
    const input = cell.inputGraph;
    const request: Parameters<typeof apiClient.executeRuleSet>[1] = {};

    if (input?.from === 'value') {
      const value = values.value[input.ref];
      if (!value) throw new Error(`@${input.ref} has not been produced yet — run the cell above first.`);
      if (value.type !== 'graph') throw new Error(`@${input.ref} is ${value.type}, and a base graph takes RDF.`);
      // By value: the triples go back out in the request that needs them. The
      // by-reference path is a saved graph id, which is what Save produces.
      request.dataGraphInline = value.content;
      request.dataGraphInlineFormat = value.format;
    } else if (input?.from === 'dataGraph') {
      request.dataGraphId = input.dataGraphId;
    } else if (input?.from === 'dataGraphVersion') {
      request.dataGraphVersionId = input.dataGraphVersionId;
    }
    if (cell.version) request.version = cell.version;

    const response = await apiClient.executeRuleSet(cell.ruleSet, request);
    const durationMs = Math.round(performance.now() - started);

    if (response.status === 'failed') throw new Error('The rule set run failed.');

    const content = response.finalGraphNQuads ?? response.finalGraphContent ?? '';
    const contentType = response.finalGraphNQuads ? 'application/n-quads' : response.finalGraphContentType ?? null;
    bind(cell, graphValue({ name: cell.out, cellId: cell.id, durationMs }, content, contentType), durationMs);
  }

  /** Bind a value and mark everything downstream of it stale. */
  function bind(cell: RunCell, produced: NotebookValue, durationMs: number): void {
    values.value = { ...values.value, [cell.out]: produced };

    const dependents = dependentCellIds(notebook.value, cell.id);
    const next: Record<string, CellRunState> = {
      ...runState.value,
      [cell.id]: {
        status: 'ok',
        error: null,
        durationMs,
        ranAt: produced.producedAt,
        stale: false,
      },
    };
    /*
     * Staleness is shown, never cascaded. Re-running the upstream of a chain
     * that took four minutes should not silently spend another four; the dot
     * says the result below is from an older input and leaves the decision
     * where it belongs.
     */
    for (const dependent of dependents) {
      const existing = next[dependent] ?? IDLE;
      if (existing.status === 'ok') next[dependent] = { ...existing, stale: true };
    }
    runState.value = next;
  }

  async function run(cellId: string): Promise<void> {
    const cell = notebook.value.cells.find((entry) => entry.id === cellId);
    if (!cell || !isRunCell(cell)) return;

    const target = targetFor(cell);
    if (!target) {
      runState.value = {
        ...runState.value,
        [cellId]: {
          status: 'error',
          error: 'This cell names something the library no longer holds.',
          durationMs: null,
          ranAt: null,
          stale: false,
        },
      };
      return;
    }

    runState.value = { ...runState.value, [cellId]: { ...stateFor(cellId), status: 'running', error: null } };
    const started = performance.now();

    try {
      if (cell.kind === 'ruleset') await runRuleSet(cell, started);
      else await runQueryLike(cell, target, started);
    } catch (cause) {
      runState.value = {
        ...runState.value,
        [cellId]: {
          status: 'error',
          error: runErrorMessage(cause),
          durationMs: Math.round(performance.now() - started),
          ranAt: new Date().toISOString(),
          stale: false,
        },
      };
    }
  }

  /**
   * Run every cell in order, stopping at the first failure.
   *
   * Sequential because the cells are a sequence: a downstream cell reads the
   * value the one above it just bound, and running them in parallel would race
   * exactly the dependency the notebook exists to express.
   */
  async function runAll(): Promise<void> {
    for (const cell of notebook.value.cells) {
      if (!isRunCell(cell)) continue;
      await run(cell.id);
      if (stateFor(cell.id).status === 'error') return;
    }
  }

  /* ------------------------------------------------------------------ *
   * Save: a session value becomes a library entity
   * ------------------------------------------------------------------ */

  /**
   * Promote a value to a stored version.
   *
   * A graph becomes a `DataGraph`, rows become a `TupleSet` — the entities whose
   * shape the value already has, which is why this is a couple of calls rather
   * than a conversion. `query-results` is the tuple source format for exactly
   * this: rows that came from running something, not from an import somebody
   * chose a dialect for.
   */
  async function saveValue(name: string, entityName: string): Promise<{ id: string } | null> {
    const value = values.value[name];
    const library = libraryId.value;
    if (!value || !library) return null;

    if (value.type === 'graph') {
      const { data: graph } = await apiClient.createDataGraph({
        name: entityName,
        description: `Bound to @${name} in a notebook.`,
        isPartOf: [library],
      } as never);
      await apiClient.createDataGraphVersion(graph.id, {
        contentString: value.content,
        contentFormat: value.format,
        comment: `From notebook value @${name}`,
      });
      return { id: graph.id };
    }

    if (value.type === 'rows') {
      const { data: tupleSet } = await apiClient.createTupleSet({
        name: entityName,
        description: `Bound to @${name} in a notebook.`,
        isPartOf: [library],
      } as never);
      await apiClient.createTupleSetVersion(tupleSet.id, {
        contentString: JSON.stringify({
          head: { vars: value.columns },
          results: { bindings: value.bindings },
        }),
        sourceFormat: 'query-results',
        comment: `From notebook value @${name}`,
      });
      return { id: tupleSet.id };
    }

    // A boolean is an answer, not an asset: there is no entity to promote it to.
    return null;
  }

  /*
   * Switching library invalidates everything: the cells name entities that
   * library does not hold, and the values were produced against its backend.
   */
  watch(libraryId, (id) => {
    if (notebook.value.library === id) return;
    setNotebook(emptyNotebook(id));
  });

  return {
    notebook,
    values,
    runState,
    problems,
    targets,
    targetFor,
    stateFor,
    loading: callables.loading,
    load: loadTargets,
    addCell,
    removeCell,
    moveCell,
    updateCell,
    renameOutput,
    mintValueName,
    setNotebook,
    run,
    runAll,
    saveValue,
  };
}

export type UseNotebook = ReturnType<typeof useNotebook>;
