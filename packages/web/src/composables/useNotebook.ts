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
import type { ExecutionArgument, ExecutionArgumentRef, ExecutionDataGraph } from '@sparql-query-lib/contracts';
import type { Callable } from '../lib/callables';
import {
  booleanValue,
  graphValue,
  isTabularContentType,
  mapColumns,
  rowsValue,
  tabularRowsValue,
  toSlotArgument,
  type NotebookValue,
  type RowsValue,
  type SparqlBindingRow,
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
  type GraphSource,
  type NotebookCell,
  type Notebook,
  type RunCell,
  type SlotSource,
} from '../lib/notebookFormat';
import { useApiClient } from './useApiClient';
import { useCallables } from './useCallables';
import { useRuleSetsStore } from './useRuleSetsStore';
import { resolveQueryDefault } from '../lib/backendDefaults';

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

/**
 * Below this a value is sent back by content even when the server kept it:
 * the round trip a handle saves is not worth a second request on a 410.
 */
const PASS_BY_REFERENCE_BYTES = 64 * 1024;

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

export function useNotebook(
  libraryId: Ref<string | null>,
  /** The library's default backend — what a cell runs against unless it says otherwise. */
  defaultBackend: Ref<string | null> = ref(null),
) {
  const apiClient = useApiClient();
  const defaultBackendId = defaultBackend;
  const callables = useCallables(libraryId);
  const ruleSetsStore = useRuleSetsStore();

  const notebook = ref<Notebook>(emptyNotebook(libraryId.value));
  /** Bound values, by name. Session-scoped by design. */
  const values = ref<Record<string, NotebookValue>>({});
  const runState = ref<Record<string, CellRunState>>({});
  /**
   * The call each cell last made, and what came back, keyed by cell.
   *
   * Kept because "save this as a test" means the call that *ran*, not the one
   * the form currently describes: a slot fed from a value was filled with rows
   * this page no longer shows, and re-deriving it from the document would
   * record a different call from the one whose result is on screen.
   */
  const lastRun = ref<Record<string, { payload: unknown; result: unknown }>>({});

  const problems = computed(() => validateNotebook(notebook.value));

  /** What is wrong with one cell, as the document reads now. */
  function problemsFor(cellId: string): string[] {
    return problems.value.filter((problem) => problem.cellId === cellId).map((problem) => problem.message);
  }

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

  /*
   * The backend a cell runs on when it names none: the query's own default,
   * then the library's — the order `lib/backendDefaults.ts` sets out. A group
   * has none to fall back to (each of its nodes names its own, and the server
   * refuses a backend for a group), and a rule set runs in memory.
   */
  function defaultBackendFor(cell: RunCell): string | null {
    if (cell.kind !== 'query') return null;
    const callable = callables.callables.value.find((entry) => entry.id === cell.query);
    return resolveQueryDefault({
      queryDefault: callable?.defaultBackend ?? null,
      libraryDefault: defaultBackendId.value,
    });
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
    byReference = true,
  ): ExecutionArgument | { ref: ExecutionArgumentRef } | 'skip' | string {
    if (!slot || slot.from === 'typed') {
      // No source is a wildcard row: the runtime drops the slot, which is what
      // makes a freshly inserted cell runnable rather than an error.
      return {
        head: { vars: [...vars] },
        results: { bindings: slot?.from === 'typed' ? slot.bindings : [{}] },
      };
    }

    const value = values.value[slot.ref];
    if (!value) return `@${slot.ref} has not been produced yet — run the cell above first.`;
    if (value.type !== 'rows') return `@${slot.ref} is ${value.type}, and a parameter slot takes rows.`;
    if (value.bindings.length === 0) {
      if ((slot.whenEmpty ?? 'skip') === 'skip') return 'skip';
      if (slot.whenEmpty === 'stop') return `@${slot.ref} is empty.`;
    }
    if (byReference && sendsByReference(value)) {
      const columns = mapColumns(value.columns, vars).map(({ source, target }) => ({ from: source, to: target }));
      if (columns.length) return { ref: { resultRef: value.resultRef!, columns, vars: [...vars] } };
    }
    return toSlotArgument(value as RowsValue, vars);
  }

  /**
   * Whether a value goes back to the server by its handle rather than its
   * content: it is large, and the server kept a copy when it produced it.
   */
  function sendsByReference(value: NotebookValue): boolean {
    return Boolean(value.resultRef) && value.byteSize >= PASS_BY_REFERENCE_BYTES;
  }

  /**
   * Send by reference, and again by value if a handle could not be read.
   *
   * A handle lives for minutes in the server's memory, and a restart empties
   * it; the content is still in this browser, so a gone handle costs one more
   * request, not the run.
   */
  async function withInlineFallback<T>(send: (byReference: boolean) => Promise<T>): Promise<T> {
    try {
      return await send(true);
    } catch (cause) {
      const status = (cause as { statusCode?: number }).statusCode;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (status === 410 || (status === 400 && message.includes('kept result'))) return send(false);
      throw cause;
    }
  }

  /** Whether a cell's result is read below it, and so worth the server keeping. */
  function isRead(cell: RunCell): boolean {
    return dependentCellIds(notebook.value, cell.id).length > 0;
  }

  /** One graph a query runs over, as `/execute` takes it. */
  function graphInput(graph: GraphSource, byReference = true): ExecutionDataGraph {
    if (graph.from === 'dataGraph') return { dataGraphId: graph.dataGraphId };
    if (graph.from === 'dataGraphVersion') return { dataGraphVersionId: graph.dataGraphVersionId };
    const value = values.value[graph.ref];
    if (!value) throw new Error(`@${graph.ref} has not been produced yet — run the cell above first.`);
    if (value.type !== 'graph') throw new Error(`@${graph.ref} is ${value.type}, and a query reads graphs, not ${value.type}.`);
    if (byReference && sendsByReference(value)) return { resultRef: value.resultRef! };
    return { dataGraphInline: value.content, dataGraphInlineFormat: value.format };
  }

  async function runQueryLike(cell: RunCell, target: NotebookTarget, started: number): Promise<void> {
    const slots = cellSlots(cell);

    /*
     * The arguments, by value: what the run means, and what Save as test
     * records. Built first, because a slot that skips stops the cell here.
     */
    const args: ExecutionArgument[] = [];
    for (const [index, vars] of target.slots.entries()) {
      const built = slotArgument(slots[index], vars, false);
      if (built === 'skip') {
        runState.value = {
          ...runState.value,
          [cell.id]: { status: 'skipped', error: null, durationMs: null, ranAt: new Date().toISOString(), stale: false },
        };
        return;
      }
      if (typeof built === 'string') throw new Error(built);
      args.push(built as ExecutionArgument);
    }

    const limits = toExecutionParameters(cell.kind === 'query' ? cell.limits : undefined);
    const offsets = toExecutionParameters(cell.kind === 'query' ? cell.offsets : undefined);

    const payload = {
      ...(args.length ? { arguments: args } : {}),
      ...(cell.kind === 'query' && cell.limits ? { limits: cell.limits } : {}),
      ...(cell.kind === 'query' && cell.offsets ? { offsets: cell.offsets } : {}),
    };

    const graphs = cell.kind === 'query' ? cell.graphs ?? [] : [];
    /*
     * The store the cell names, else the query's default, else the library's.
     * Sent explicitly either way: "which backend did this run against" is a
     * fact the notebook shows on the cell, and a request that leaves it out
     * would let the answer change under the reader when a default does.
     *
     * A query given graphs runs over them alone, in an ephemeral store the
     * server makes for the request; it names no backend.
     */
    const backendId = graphs.length
      ? null
      : cell.kind === 'query'
        ? cell.backend ?? defaultBackendFor(cell)
        : null; // a group's nodes name their own; the server refuses one for a group
    const accept = cell.kind === 'ruleset' ? null : cell.accept;

    /*
     * The request. A large value the server kept goes by its handle rather
     * than its content (`sendsByReference`); the result is kept in turn when a
     * cell below reads it.
     */
    const send = (byReference: boolean) => {
      const inline: ExecutionArgument[] = [];
      const argumentRefs: ExecutionArgumentRef[] = [];
      for (const [index, vars] of target.slots.entries()) {
        const built = slotArgument(slots[index], vars, byReference) as ExecutionArgument | { ref: ExecutionArgumentRef };
        if ('ref' in built) argumentRefs.push(built.ref);
        else inline.push(built);
      }
      const dataGraphs = graphs.map((graph) => graphInput(graph, byReference));
      return apiClient.executeTarget(
        {
          targetId: cellTargetId(cell),
          ...(backendId ? { backendId } : {}),
          ...(dataGraphs.length ? { dataGraphs } : {}),
          ...(inline.length ? { arguments: inline } : {}),
          ...(argumentRefs.length ? { argumentRefs } : {}),
          ...(limits.length ? { limits } : {}),
          ...(offsets.length ? { offsets } : {}),
          ...(isRead(cell) ? { keepResult: true } : {}),
        },
        accept ?? undefined,
      );
    };
    const result = await withInlineFallback(send);

    const durationMs = Math.round(performance.now() - started);
    const source = { name: cell.out, cellId: cell.id, durationMs };
    const isJson = (result.contentType ?? '').includes('json');

    let produced: NotebookValue;
    if (isJson) {
      const body = JSON.parse(result.body) as {
        boolean?: boolean;
        head?: { vars?: string[] };
        results?: { bindings?: SparqlBindingRow[] };
      };
      produced =
        typeof body.boolean === 'boolean'
          ? booleanValue(source, body.boolean)
          : rowsValue(source, body, result.body);
      lastRun.value = { ...lastRun.value, [cell.id]: { payload, result: body } };
    } else if (isTabularContentType(result.contentType)) {
      // A SELECT asked for as CSV or TSV is still rows, not a graph.
      produced = tabularRowsValue(source, result.body, result.contentType);
      lastRun.value = { ...lastRun.value, [cell.id]: { payload, result: result.body } };
    } else {
      produced = graphValue(source, result.body, result.contentType);
      lastRun.value = { ...lastRun.value, [cell.id]: { payload, result: result.body } };
    }
    // A kept CSV body is no use as an argument: the server reads rows from JSON.
    produced.resultRef = isTabularContentType(result.contentType) ? null : result.resultRef ?? null;

    bind(cell, produced, durationMs);
  }

  async function runRuleSet(cell: RunCell & { kind: 'ruleset' }, started: number): Promise<void> {
    const input = cell.inputGraph;

    const send = (byReference: boolean) => {
      const request: Parameters<typeof apiClient.executeRuleSet>[1] = {};
      if (input?.from === 'value') {
        const value = values.value[input.ref];
        if (!value) throw new Error(`@${input.ref} has not been produced yet — run the cell above first.`);
        if (value.type !== 'graph') throw new Error(`@${input.ref} is ${value.type}, and a base graph takes RDF.`);
        // A large graph the server kept goes back by its handle; anything
        // else goes back by content, in the request that needs it.
        if (byReference && sendsByReference(value)) {
          request.dataGraphResultRef = value.resultRef!;
        } else {
          request.dataGraphInline = value.content;
          request.dataGraphInlineFormat = value.format;
        }
      } else if (input?.from === 'dataGraph') {
        request.dataGraphId = input.dataGraphId;
      } else if (input?.from === 'dataGraphVersion') {
        request.dataGraphVersionId = input.dataGraphVersionId;
      }
      if (cell.version) request.version = cell.version;
      if (isRead(cell)) request.keepResult = true;
      return apiClient.executeRuleSet(cell.ruleSet, request);
    };

    const response = await withInlineFallback(send);
    const durationMs = Math.round(performance.now() - started);

    if (response.status === 'failed') throw new Error('The rule set run failed.');

    const content = response.finalGraphNQuads ?? response.finalGraphContent ?? '';
    const contentType = response.finalGraphNQuads ? 'application/n-quads' : response.finalGraphContentType ?? null;
    const produced = graphValue({ name: cell.out, cellId: cell.id, durationMs }, content, contentType);
    produced.resultRef = response.resultRef ?? null;
    bind(cell, produced, durationMs);
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

    /*
     * A cell reads only what is bound above it. A value bound below, or left
     * over from a cell since removed, is still in memory, and running with it
     * would give a result the document does not explain.
     */
    const unbound = problemsFor(cellId).find((message) => message.includes('is not bound by a cell above'));
    if (unbound) {
      runState.value = {
        ...runState.value,
        [cellId]: { status: 'error', error: unbound, durationMs: null, ranAt: null, stale: false },
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
      });
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
      });
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
    lastRun,
    problems,
    problemsFor,
    targets,
    targetFor,
    defaultBackendFor,
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
