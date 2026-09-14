/**
 * The runtime's front door: an export bundle plus an executor, as callable queries.
 *
 * ```ts
 * const lib = fromBundle(bundle, { executor: httpExecutor('https://example.org/sparql') });
 * const { results } = await lib.query('people-by-city').select({
 *   arguments: [{ bindings: [{ city: iri('http://example.org/Perth') }] }],
 *   limits: { page: 20 },
 * });
 * ```
 *
 * The payload is the one `POST /execute` takes, so moving an app between hosted
 * sqlib and an exported bundle is a change of transport, not of calling code.
 */

import {
  applyTemplateArguments,
  type ArgumentRow,
  type QueryTemplate,
  type TemplateArgumentSet,
} from './query-template.js';
import { normalizeUndefBindings, type WireArgumentSet } from './arguments.js';
import {
  assertPageParameterValue,
  toExecutionParameters,
  type ExecutionParameter,
} from './limit-offset.js';
import { assertValidBundle, type ExportBundle, type ExportedQuery } from './bundle.js';
import { QueryCallError } from './errors.js';
import { GroupHandle } from './group.js';
import type {
  ExecutionResult,
  Executor,
  RdfPayload,
  SparqlAskResults,
  SparqlSelectResults,
} from './executor.js';
import type { TermValue } from './sparql-terms.js';

/**
 * An argument set, in either the full wire form or the short form.
 *
 * The short form omits `head.vars` and takes them from the slot the set is being
 * applied to — the query already declares them, and repeating them is a chance to
 * get them wrong. The full form stays accepted so a payload built for `/execute`
 * can be passed straight through.
 *
 * The short form's rows are typed, the full form's are not: the full form is the
 * wire shape, arbitrary JSON until `normalizeUndefBindings` has been over it,
 * while the short form is the one written by hand. Its row type is
 * {@link TemplateArgumentSet}'s own, so a `null` row — a blank row, what a JSON
 * round-trip of a grid produces — is accepted here exactly as it is there.
 */
export type ArgumentSetInput =
  | WireArgumentSet
  | {
      bindings: readonly (ArgumentRow | null | undefined)[];
      whenEmpty?: TemplateArgumentSet['whenEmpty'];
    };

/*
 * The short form, named for the guard below and for nothing else. Writing the
 * name into `ArgumentSetInput` itself would put a type in a public signature
 * that no entry point exports, which `scripts/check-public-api.mjs` rejects and
 * is right to: a consumer could hold the value and not write down its type.
 */
type ShortFormArgumentSet = Extract<ArgumentSetInput, { bindings: unknown }>;

/** Page parameters, as a `{name: value}` map or the wire array. */
export type ParameterInput = Readonly<Record<string, number>> | readonly ExecutionParameter[];

export interface CallPayload {
  /** One argument set per parameter slot, in slot order. */
  arguments?: readonly ArgumentSetInput[];
  limits?: ParameterInput;
  offsets?: ParameterInput;
  signal?: AbortSignal;
}

/** A term of type `uri`. */
export function iri(value: string): TermValue {
  return { type: 'uri', value };
}

/** A literal, optionally typed or language-tagged. */
export function literal(
  value: string,
  options: { datatype?: string; lang?: string } = {},
): TermValue {
  const term: TermValue = { type: 'literal', value };
  if (options.datatype !== undefined) term.datatype = options.datatype;
  if (options.lang !== undefined) term['xml:lang'] = options.lang;
  return term;
}

export { QueryCallError } from './errors.js';

function isShortForm(input: ArgumentSetInput): input is ShortFormArgumentSet {
  return Array.isArray((input as { bindings?: unknown }).bindings);
}

/**
 * Bring every accepted argument-set spelling to the wire shape.
 *
 * Slot variables fill in `head.vars` for the short form. They are *not* used to
 * override a full form's own `vars`: a mismatch there is the caller telling us
 * something different from the query, and `applyTemplateArguments` should be the
 * one to say so, with the error message the server uses.
 */
function toWireArgumentSets(
  inputs: readonly ArgumentSetInput[],
  query: ExportedQuery,
): WireArgumentSet[] {
  return inputs.map((input, index) => {
    if (isShortForm(input)) {
      const vars = query.template.slots[index]?.vars;
      if (!vars) {
        throw new QueryCallError(
          `Received ${inputs.length} argument sets but the query has ${query.template.slots.length} parameter slots.`,
        );
      }
      return {
        // Copied rather than passed through: the short form's rows are readonly
        // (a caller may hand us a frozen array), and the wire shape is not.
        head: { vars: [...vars] },
        arguments: { bindings: [...input.bindings] },
        ...(input.whenEmpty !== undefined ? { whenEmpty: input.whenEmpty } : {}),
      };
    }
    return input;
  });
}

/** A single exported query, bound to an executor. */
export class QueryHandle {
  constructor(
    readonly name: string,
    private readonly query: ExportedQuery,
    private readonly executor: Executor | undefined,
  ) {}

  get queryType(): ExportedQuery['queryType'] {
    return this.query.queryType;
  }

  /**
   * The compiled query behind this handle.
   *
   * Read by {@link GroupHandle}, which has to see a node's slots to know which
   * of them an edge fills. Treat it as the bundle's own data: it is frozen at
   * export time and editing it invalidates the spans.
   */
  get exported(): ExportedQuery {
    return this.query;
  }

  /** The query's call signature: slot variables, and the page parameter names. */
  signature(): {
    inputs: string[][];
    limitParameters: string[];
    offsetParameters: string[];
  } {
    return {
      inputs: this.query.inferredInputs.map((vars) => [...vars]),
      limitParameters: [...this.query.limitParameters],
      offsetParameters: [...this.query.offsetParameters],
    };
  }

  /**
   * Substitute the payload and return the query text, without running it.
   *
   * The whole of the runtime's logic ends here; everything past this point is
   * transport. It is also the seam the contract tests use, since this string is
   * exactly what `POST /execute` would have sent.
   */
  text(payload: CallPayload = {}): string {
    // LIMIT/OFFSET first, then VALUES — the order `/execute` has always used, and
    // the order that keeps caller data out of the page substitution's way: a
    // literal argument whose text happens to read `LIMIT 0001` must not be
    // rewritten, and after this step nothing else scans the query.
    const template = withPageParameters(
      this.query,
      toExecutionParameters(payload.limits),
      toExecutionParameters(payload.offsets),
    );

    const wireSets = toWireArgumentSets(payload.arguments ?? [], this.query);
    const argumentSets = normalizeUndefBindings(wireSets) ?? [];

    return applyTemplateArguments(template, argumentSets);
  }

  /** Substitute and run, returning whatever the executor returns. */
  async run(payload: CallPayload = {}): Promise<ExecutionResult> {
    return this.runText(this.text(payload), payload.signal);
  }

  /**
   * Run a query this handle already substituted.
   *
   * The seam {@link GroupHandle} uses: a walk keeps each node's query text —
   * that text is what a contract test compares against the server — and running
   * it from here means the substitution happens once rather than once to show
   * and once to send.
   */
  async runText(queryText: string, signal?: AbortSignal): Promise<ExecutionResult> {
    if (!this.executor) {
      throw new QueryCallError(
        `No executor is configured, so '${this.name}' can only be substituted, not run. Pass one to fromBundle().`,
      );
    }
    return this.executor.execute({
      queryText,
      queryType: this.query.queryType,
      signal,
    });
  }

  /** Run a SELECT, returning SPARQL Results JSON. */
  async select(payload: CallPayload = {}): Promise<SparqlSelectResults> {
    this.assertType('SELECT', 'select');
    return (await this.run(payload)) as SparqlSelectResults;
  }

  /** Run an ASK, returning the boolean. */
  async ask(payload: CallPayload = {}): Promise<boolean> {
    this.assertType('ASK', 'ask');
    return ((await this.run(payload)) as SparqlAskResults).boolean;
  }

  /** Run a CONSTRUCT or DESCRIBE, returning the serialised RDF. */
  async construct(payload: CallPayload = {}): Promise<RdfPayload> {
    if (this.query.queryType !== 'CONSTRUCT' && this.query.queryType !== 'DESCRIBE') {
      throw new QueryCallError(
        `Query '${this.name}' is a ${this.query.queryType}; call run() or the matching helper instead of construct().`,
      );
    }
    return (await this.run(payload)) as RdfPayload;
  }

  private assertType(expected: ExportedQuery['queryType'], method: string): void {
    if (this.query.queryType !== expected) {
      throw new QueryCallError(
        `Query '${this.name}' is a ${this.query.queryType}, not a ${expected}; ${method}() would misread its results.`,
      );
    }
  }
}

/**
 * Substitute page parameters into a template, keeping its slot spans exact.
 *
 * Both kinds of parameter are spans into the same text, and replacing one shifts
 * everything after it. So the page replacements are applied first, in order, and
 * each slot's span is moved by the total length change that happened before it —
 * computed, not searched for.
 *
 * A parameter the caller did not supply is left alone: its placeholder text stays
 * in the query, which is exactly what the API does with an unsupplied `LIMIT 0001`.
 */
function withPageParameters(
  query: ExportedQuery,
  limits: ExecutionParameter[],
  offsets: ExecutionParameter[],
): QueryTemplate {
  const { template } = query;
  const supplied = new Map<string, number>();
  for (const { name, value } of limits) supplied.set(`limit:${name}`, value);
  for (const { name, value } of offsets) supplied.set(`offset:${name}`, value);
  if (supplied.size === 0 || !query.pageParameters?.length) return template;

  const edits = query.pageParameters
    .filter((span) => supplied.has(`${span.kind}:${span.name}`))
    .sort((a, b) => a.start - b.start)
    .map((span) => {
      const value = supplied.get(`${span.kind}:${span.name}`)!;
      assertPageParameterValue(span.kind, span.name, value);
      return {
        ...span,
        replacement: `${span.kind === 'limit' ? 'LIMIT' : 'OFFSET'} ${value}`,
      };
    });
  if (edits.length === 0) return template;

  let text = '';
  let cursor = 0;
  let delta = 0;
  /** Cumulative length change applied before each old offset. */
  const shifts: Array<[before: number, delta: number]> = [];

  for (const edit of edits) {
    text += template.text.slice(cursor, edit.start) + edit.replacement;
    delta += edit.replacement.length - (edit.end - edit.start);
    shifts.push([edit.end, delta]);
    cursor = edit.end;
  }
  text += template.text.slice(cursor);

  const shift = (position: number): number => {
    let applied = 0;
    for (const [before, cumulative] of shifts) {
      if (before <= position) applied = cumulative;
    }
    return position + applied;
  };

  return {
    text,
    slots: template.slots.map((slot) => ({
      start: shift(slot.start),
      end: shift(slot.end),
      vars: slot.vars,
    })),
    prefixes: template.prefixes,
  };
}

/**
 * A bundle whose query names are known to the type system.
 *
 * `sqlib export --typings` emits a declaration typing the generated JSON as this,
 * which is what makes `lib.query('...')` autocomplete and misspellings a compile
 * error. A plain {@link ExportBundle} still works — `TName` widens to `string`.
 */
export interface TypedExportBundle<TName extends string> extends ExportBundle {
  queries: Record<TName, ExportedQuery>;
}

/** A loaded bundle: the queries and groups it carries, bound to an executor. */
export class QueryLibrary<TName extends string = string> {
  private readonly handles = new Map<string, QueryHandle>();
  private readonly groups = new Map<string, GroupHandle>();

  constructor(
    private readonly bundle: ExportBundle,
    executor?: Executor,
  ) {
    for (const [name, query] of Object.entries(bundle.queries)) {
      this.handles.set(name, new QueryHandle(name, query, executor));
    }
    for (const [name, group] of Object.entries(bundle.groups ?? {})) {
      this.groups.set(name, new GroupHandle(name, group, (key) => this.query(key as TName)));
    }
  }

  /** The library this bundle was exported from. */
  get library(): ExportBundle['library'] {
    return this.bundle.library;
  }

  /** Every query name in the bundle. */
  names(): TName[] {
    return [...this.handles.keys()] as TName[];
  }

  /** Look up a query by name. Throws if the bundle does not carry it. */
  query(name: TName): QueryHandle {
    const handle = this.handles.get(name);
    if (!handle) {
      throw new QueryCallError(
        `Bundle has no query named '${name}'. Available: ${this.names().join(', ') || '(none)'}.`,
      );
    }
    return handle;
  }

  /** Every query group name in the bundle. Empty when it carries none. */
  groupNames(): string[] {
    return [...this.groups.keys()];
  }

  /** Look up a query group by name. Throws if the bundle does not carry it. */
  group(name: string): GroupHandle {
    const handle = this.groups.get(name);
    if (!handle) {
      throw new QueryCallError(
        `Bundle has no query group named '${name}'. Available: ${this.groupNames().join(', ') || '(none)'}.`,
      );
    }
    return handle;
  }
}

export interface FromBundleOptions {
  /** Where substituted queries go. Omit for substitution-only use. */
  executor?: Executor;
  /**
   * Skip the structural check. Only worth it for a bundle you built in the same
   * process; the check is microseconds and it is what catches a hand-edited file.
   */
  validate?: boolean;
}

/**
 * Load an export bundle.
 *
 * Synchronous, and does not verify the content hashes — that needs Web Crypto and
 * is therefore async. It does check the bundle's structure, including that every
 * slot span still lands on a `VALUES` keyword, which is what actually catches the
 * hand-edit this format is fragile to. Call {@link verifyBundleIntegrity} as well
 * when the bundle came from somewhere you do not control.
 */
export function fromBundle<TName extends string = string>(
  bundle: TypedExportBundle<TName> | ExportBundle,
  options: FromBundleOptions = {},
): QueryLibrary<TName> {
  if (options.validate !== false) assertValidBundle(bundle);
  return new QueryLibrary<TName>(bundle, options.executor);
}
