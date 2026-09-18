/**
 * The notebook document: prose and cell references, as one small JSON file.
 *
 * A notebook is not an export bundle. The bundle exists so a front end can call
 * a triplestore with no sqlib in the request path, which is what restricts it to
 * compiled queries and SELECT-chaining groups. A notebook goes the other way: it
 * is a *story* that calls the sqlib REST API, so it gets the whole product —
 * rule sets, groups with any edge type, argument sets, access control — and pays
 * for that by needing a server. See `docs/proposals/notebook-cells.md`.
 *
 * Three properties follow from keeping it declarative, and all three are the
 * reason this module exists rather than the state living in component refs:
 *
 * - **Small.** A cell is a reference plus arguments, never a copy of a query's
 *   text. A twelve-cell notebook is a few kilobytes.
 * - **Diffable.** It can sit in git beside the library; a changed argument is a
 *   one-line diff.
 * - **Honest about versions.** A cell names an entity and floats to its current
 *   version, or pins a version id. Floating is the default: a notebook is a
 *   living document and should track the library it documents.
 *
 * What is deliberately *not* in the format: results. A notebook is the story,
 * not the run, so outputs live in session state and a reloaded notebook shows
 * cells that have not been run — exactly as an `.ipynb` with cleared outputs
 * does.
 */

/** The format tag written into every document, and the only one read back. */
export const NOTEBOOK_FORMAT = 'sqlib-notebook/1';

/** The file extension the export writes and the import offers. */
export const NOTEBOOK_FILE_EXTENSION = '.sqlibnb';

export type NotebookCellKind = 'markdown' | 'query' | 'group' | 'ruleset';

/** Prose. The cell kind that makes a list of queries legible as work. */
export interface MarkdownCell {
  kind: 'markdown';
  id: string;
  source: string;
}

/**
 * Where one parameter slot's rows come from.
 *
 * `typed` carries the bindings the arguments builder produced, in the shape
 * `POST /execute` takes them. `value` names another cell's output, which is the
 * whole point of a notebook over a list of queries — and it carries the same
 * empty-policy a query group's edge carries, for the same reason: what to do
 * when the upstream returns nothing is the author's decision, not a default.
 */
export type SlotSource =
  | { from: 'typed'; bindings: Array<Record<string, unknown>> }
  | { from: 'value'; ref: string; whenEmpty?: NotebookEmptyMode };

/** The policy when a referenced value has no rows. Mirrors a group edge's. */
export type NotebookEmptyMode = 'skip' | 'empty' | 'stop';

/** Where a rule set's base graph comes from. A data cell is not needed for it. */
export type GraphSource =
  | { from: 'value'; ref: string }
  | { from: 'dataGraph'; dataGraphId: string }
  | { from: 'dataGraphVersion'; dataGraphVersionId: string };

/** The parts of a run cell that do not depend on which entity it names. */
export interface RunCellCommon {
  id: string;
  /**
   * The name this cell's result binds to, without the leading `@`. Auto-assigned
   * (`out1`, `out2`, …) and renameable; renaming rewrites the references, which
   * is why it is held here rather than derived from the cell's index — an index
   * changes when a cell is inserted above, and a reference to "cell 2" would
   * then silently mean something else.
   */
  out: string;
  /** Display name, cached so a reference renders before the library loads. */
  label?: string;
}

export interface QueryCell extends RunCellCommon {
  kind: 'query';
  /** The Query IRI. Floats to its current version unless `version` is set. */
  query: string;
  version?: number | null;
  slots?: SlotSource[];
  limits?: Record<string, number>;
  offsets?: Record<string, number>;
}

export interface GroupCell extends RunCellCommon {
  kind: 'group';
  /** The QueryGroup IRI. */
  group: string;
  slots?: SlotSource[];
}

export interface RuleSetCell extends RunCellCommon {
  kind: 'ruleset';
  /** The RuleSet IRI. */
  ruleSet: string;
  version?: number | null;
  /** The base graph, G0. Absent means "run the rule set's DATA blocks alone". */
  inputGraph?: GraphSource;
}

export type RunCell = QueryCell | GroupCell | RuleSetCell;
export type NotebookCell = MarkdownCell | RunCell;

export interface Notebook {
  format: typeof NOTEBOOK_FORMAT;
  title: string;
  /** The library whose entities the cells name. */
  library: string | null;
  cells: NotebookCell[];
}

export function isRunCell(cell: NotebookCell): cell is RunCell {
  return cell.kind !== 'markdown';
}

/** The entity IRI a run cell points at, whatever kind it is. */
export function cellTargetId(cell: RunCell): string {
  switch (cell.kind) {
    case 'query':
      return cell.query;
    case 'group':
      return cell.group;
    case 'ruleset':
      return cell.ruleSet;
  }
}

/** Slots, for the two cell kinds that have them. A rule set has none. */
export function cellSlots(cell: RunCell): SlotSource[] {
  return cell.kind === 'ruleset' ? [] : (cell.slots ?? []);
}

/*
 * Ids are minted here rather than taken from `crypto.randomUUID` so a notebook
 * written in a test reads the same way twice. They only have to be unique
 * within one document.
 */
let idCounter = 0;

export function mintCellId(prefix = 'c'): string {
  idCounter += 1;
  return `${prefix}${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyNotebook(library: string | null, title = 'Untitled notebook'): Notebook {
  return { format: NOTEBOOK_FORMAT, title, library, cells: [] };
}

export function markdownCell(source = ''): MarkdownCell {
  return { kind: 'markdown', id: mintCellId('md'), source };
}

/**
 * The next free `outN`.
 *
 * Counts from the highest number already taken rather than from the cell count:
 * deleting cell 2 and adding another should not hand out a name that a cell
 * below is still referencing.
 */
export function nextValueName(notebook: Notebook): string {
  let highest = 0;
  for (const cell of notebook.cells) {
    if (!isRunCell(cell)) continue;
    const match = /^out(\d+)$/.exec(cell.out);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `out${highest + 1}`;
}

/** Value names are identifiers so they can be written as `@name` unambiguously. */
export const VALUE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function isValidValueName(name: string): boolean {
  return VALUE_NAME_PATTERN.test(name);
}

/**
 * Rename a value, rewriting every reference to it.
 *
 * Returns a new notebook — the caller assigns it, so a rename that fails
 * validation cannot leave the document half-renamed with some cells pointing at
 * a name that no longer exists.
 */
export function renameValue(notebook: Notebook, from: string, to: string): Notebook {
  if (from === to) return notebook;
  const rewriteSlot = (slot: SlotSource): SlotSource =>
    slot.from === 'value' && slot.ref === from ? { ...slot, ref: to } : slot;

  return {
    ...notebook,
    cells: notebook.cells.map((cell) => {
      if (!isRunCell(cell)) return cell;
      const renamed: RunCell = cell.out === from ? { ...cell, out: to } : { ...cell };
      if (renamed.kind === 'ruleset') {
        if (renamed.inputGraph?.from === 'value' && renamed.inputGraph.ref === from) {
          return { ...renamed, inputGraph: { from: 'value', ref: to } };
        }
        return renamed;
      }
      return renamed.slots ? { ...renamed, slots: renamed.slots.map(rewriteSlot) } : renamed;
    }),
  };
}

/** Every value name a cell reads, in slot order then graph. */
export function cellReferences(cell: NotebookCell): string[] {
  if (!isRunCell(cell)) return [];
  const refs = cellSlots(cell)
    .filter((slot): slot is Extract<SlotSource, { from: 'value' }> => slot.from === 'value')
    .map((slot) => slot.ref);
  if (cell.kind === 'ruleset' && cell.inputGraph?.from === 'value') refs.push(cell.inputGraph.ref);
  return refs;
}

export interface NotebookProblem {
  cellId: string;
  message: string;
}

/**
 * The document's own consistency, checked without touching the server.
 *
 * Scope is the rule that matters: a reference may only name a value bound
 * *above* it. Forward references would make the notebook a graph rather than a
 * sequence, and the whole appeal of a notebook over a query group is that it is
 * read top to bottom.
 */
export function validateNotebook(notebook: Notebook): NotebookProblem[] {
  const problems: NotebookProblem[] = [];
  const seenIds = new Set<string>();
  const bound = new Set<string>();

  for (const cell of notebook.cells) {
    if (seenIds.has(cell.id)) problems.push({ cellId: cell.id, message: 'Duplicate cell id.' });
    seenIds.add(cell.id);

    for (const ref of cellReferences(cell)) {
      if (!bound.has(ref)) {
        problems.push({
          cellId: cell.id,
          message: `@${ref} is not bound by a cell above this one.`,
        });
      }
    }

    if (isRunCell(cell)) {
      if (!isValidValueName(cell.out)) {
        problems.push({ cellId: cell.id, message: `"${cell.out}" is not a usable value name.` });
      } else if (bound.has(cell.out)) {
        problems.push({ cellId: cell.id, message: `@${cell.out} is bound twice.` });
      }
      bound.add(cell.out);
    }
  }

  return problems;
}

/** Cells that read a value the given cell binds, directly or through a chain. */
export function dependentCellIds(notebook: Notebook, cellId: string): string[] {
  const start = notebook.cells.find((cell) => cell.id === cellId);
  if (!start || !isRunCell(start)) return [];

  const dirty = new Set<string>([start.out]);
  const dependents: string[] = [];
  const index = notebook.cells.findIndex((cell) => cell.id === cellId);

  for (const cell of notebook.cells.slice(index + 1)) {
    if (!isRunCell(cell)) continue;
    if (!cellReferences(cell).some((ref) => dirty.has(ref))) continue;
    dependents.push(cell.id);
    // Its own output is now suspect too, which is what makes this transitive.
    dirty.add(cell.out);
  }
  return dependents;
}

export class InvalidNotebookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNotebookError';
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidNotebookError(`${what} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidNotebookError(`${what} is missing.`);
  }
  return value;
}

function parseSlots(raw: unknown, what: string): SlotSource[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new InvalidNotebookError(`${what} slots are not a list.`);
  return raw.map((entry, index) => {
    const slot = asRecord(entry, `${what} slot ${index + 1}`);
    if (slot.from === 'value') {
      return {
        from: 'value',
        ref: asString(slot.ref, `${what} slot ${index + 1} ref`),
        ...(typeof slot.whenEmpty === 'string'
          ? { whenEmpty: slot.whenEmpty as NotebookEmptyMode }
          : {}),
      };
    }
    return {
      from: 'typed',
      bindings: Array.isArray(slot.bindings) ? (slot.bindings as Array<Record<string, unknown>>) : [],
    };
  });
}

function parseCell(raw: unknown, index: number): NotebookCell {
  const cell = asRecord(raw, `Cell ${index + 1}`);
  const id = typeof cell.id === 'string' && cell.id ? cell.id : mintCellId();
  const label = typeof cell.label === 'string' ? cell.label : undefined;
  const slots = parseSlots(cell.slots, `Cell ${index + 1}`);

  switch (cell.kind) {
    case 'markdown':
      return { kind: 'markdown', id, source: typeof cell.source === 'string' ? cell.source : '' };
    case 'query':
      return {
        kind: 'query',
        id,
        label,
        query: asString(cell.query, `Cell ${index + 1} query`),
        // Written only when pinned: an absent `version` is what floating means,
        // and writing it back as null would make a round-trip a diff.
        ...(typeof cell.version === 'number' ? { version: cell.version } : {}),
        out: asString(cell.out, `Cell ${index + 1} out`),
        ...(slots ? { slots } : {}),
        ...(cell.limits ? { limits: cell.limits as Record<string, number> } : {}),
        ...(cell.offsets ? { offsets: cell.offsets as Record<string, number> } : {}),
      };
    case 'group':
      return {
        kind: 'group',
        id,
        label,
        group: asString(cell.group, `Cell ${index + 1} group`),
        out: asString(cell.out, `Cell ${index + 1} out`),
        ...(slots ? { slots } : {}),
      };
    case 'ruleset':
      return {
        kind: 'ruleset',
        id,
        label,
        ruleSet: asString(cell.ruleSet, `Cell ${index + 1} ruleSet`),
        ...(typeof cell.version === 'number' ? { version: cell.version } : {}),
        out: asString(cell.out, `Cell ${index + 1} out`),
        ...(cell.inputGraph ? { inputGraph: cell.inputGraph as GraphSource } : {}),
      };
    default:
      throw new InvalidNotebookError(`Cell ${index + 1} has an unknown kind.`);
  }
}

/**
 * Read a notebook document.
 *
 * Unknown fields are kept out rather than carried: this format has one reader
 * and one writer today, and silently round-tripping fields a version of the app
 * did not understand would make "the file says what the screen shows" untrue.
 * A document whose `format` this reader does not know is refused outright — the
 * same rule the bundle follows, for the same reason.
 */
export function parseNotebook(raw: unknown): Notebook {
  const doc = asRecord(raw, 'The notebook');
  if (doc.format !== NOTEBOOK_FORMAT) {
    throw new InvalidNotebookError(
      `Unsupported notebook format ${String(doc.format ?? '(none)')} — this build reads ${NOTEBOOK_FORMAT}.`,
    );
  }
  const cells = Array.isArray(doc.cells) ? doc.cells.map(parseCell) : [];
  return {
    format: NOTEBOOK_FORMAT,
    title: typeof doc.title === 'string' && doc.title ? doc.title : 'Untitled notebook',
    library: typeof doc.library === 'string' ? doc.library : null,
    cells,
  };
}

export function parseNotebookJson(text: string): Notebook {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (cause) {
    throw new InvalidNotebookError(
      `That file is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return parseNotebook(payload);
}

/** Pretty-printed, because the file is meant to be read and diffed. */
export function serializeNotebook(notebook: Notebook): string {
  return `${JSON.stringify(notebook, null, 2)}\n`;
}
