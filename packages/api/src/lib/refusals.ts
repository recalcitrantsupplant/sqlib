/**
 * Why a published update wrote nothing (`docs/proposals/queries-as-tools.md`,
 * part B).
 *
 * SPARQL Update cannot fail on purpose, so an update states its preconditions
 * as flags: it binds `?ok_<name>` for each, `?ok` as their conjunction, and ends
 * its `WHERE` clause with `FILTER(?ok)`. A failed precondition leaves `WHERE`
 * with no solutions and the update writes nothing, which `/execute` would
 * answer with the same `204` as a write.
 *
 * The refusal query is that `WHERE` clause as a `SELECT *`, without the final
 * filter. `/execute` runs it first, with the call's arguments, for a version
 * whose `tool` object has `refusals`: a flag that is not true in some solution
 * failed, the update is skipped, and the call answers `409` with each failed
 * flag's message. Running it first rather than detecting "nothing changed"
 * afterwards needs no change detection from the backend; a write by another
 * client between the two can make them disagree, which on a single-writer
 * store does not arise.
 */
import { Parser } from '@traqula/parser-sparql-1-2';
import { Generator } from '@traqula/generator-sparql-1-2';
import type { RefusedBody } from '@sparql-query-lib/tools';

/** An update text that cannot carry refusals. Answers 400. */
export class RefusalQueryError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'RefusalQueryError';
  }
}

const FLAG_PREFIX = 'ok_';
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object';

/** The `ok_` flags a pattern binds, wherever it binds them, without the prefix. */
function boundFlags(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    value.forEach(item => boundFlags(item, into));
  } else if (isNode(value)) {
    if (value.type === 'pattern' && value.subType === 'bind' && isNode(value.variable)) {
      const name = value.variable.value;
      if (typeof name === 'string' && name.startsWith(FLAG_PREFIX)) into.add(name.slice(FLAG_PREFIX.length));
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'loc') boundFlags(child, into);
    }
  }
  return into;
}

const isFilterOk = (pattern: unknown): boolean =>
  isNode(pattern) &&
  pattern.type === 'pattern' &&
  pattern.subType === 'filter' &&
  isNode(pattern.expression) &&
  pattern.expression.subType === 'variable' &&
  pattern.expression.value === 'ok';

/**
 * The refusal query of an update, and the flags it binds. Throws
 * `RefusalQueryError` for an update that does not follow the convention.
 */
export function refusalQuery(updateText: string): { text: string; flags: Set<string> } {
  const parser = new Parser();
  let parsed: Node;
  try {
    parsed = parser.parse(updateText) as unknown as Node;
  } catch (error) {
    throw new RefusalQueryError(`tool.refusals: the text does not parse: ${(error as Error).message}`);
  }
  const updates = parsed.type === 'update' && Array.isArray(parsed.updates) ? (parsed.updates as Node[]) : [];
  const operation = updates.length === 1 && isNode(updates[0].operation) ? updates[0].operation : null;
  if (!operation || operation.subType !== 'modify' || !isNode(operation.where)) {
    throw new RefusalQueryError(
      'tool.refusals needs an update of one DELETE/INSERT … WHERE operation, whose WHERE clause binds the flags',
    );
  }
  const where = operation.where;
  const patterns = Array.isArray(where.patterns) ? where.patterns : [];
  if (!isFilterOk(patterns[patterns.length - 1])) {
    throw new RefusalQueryError('tool.refusals needs the update\'s WHERE clause to end with FILTER(?ok)');
  }

  const select = parser.parse('SELECT * WHERE { }') as unknown as Node;
  select.context = updates[0].context;
  select.where = { ...where, patterns: patterns.slice(0, -1) };
  // The dataset the WHERE clause reads: USING is FROM by another name, and
  // WITH (with no USING) names the default graph.
  const from = isNode(operation.from) && Array.isArray(operation.from.clauses) ? operation.from : null;
  if (from && (from.clauses as unknown[]).length > 0) {
    select.datasets = from;
  } else if (isNode(operation.graph)) {
    // Parsed rather than built, so the clause carries the node fields the
    // generator expects.
    const withGraph = parser.parse('SELECT * FROM <urn:sqlib:with> WHERE { }') as unknown as Node;
    const datasets = withGraph.datasets as { clauses: Array<{ value: unknown }> };
    datasets.clauses[0].value = operation.graph;
    select.datasets = datasets;
  }
  const text = new Generator().generate(select as never);
  return { text, flags: boundFlags(select.where, new Set()) };
}

/**
 * The save-time check: the text follows the convention and binds a flag for
 * every key. `null` when it does.
 */
export function checkRefusals(updateText: string, refusals: Record<string, string>): string | null {
  let flags: Set<string>;
  try {
    ({ flags } = refusalQuery(updateText));
  } catch (error) {
    if (error instanceof RefusalQueryError) return error.message;
    throw error;
  }
  for (const key of Object.keys(refusals)) {
    if (!flags.has(key)) {
      const bound = [...flags].map(flag => `?${FLAG_PREFIX}${flag}`).join(', ') || 'none';
      return `tool.refusals.${key} names no flag of this version: it binds no ?${FLAG_PREFIX}${key}. Its flags are: ${bound}`;
    }
  }
  return null;
}

type Binding = { type?: string; value?: string; datatype?: string };
type Results = { results?: { bindings?: Array<Record<string, Binding>> } };
type ArgumentTable = { head?: { vars?: string[] }; results?: { bindings?: Array<Record<string, Binding>> } };

const isTrue = (binding: Binding | undefined): boolean =>
  !!binding &&
  binding.type === 'literal' &&
  (binding.datatype === undefined || binding.datatype === XSD_BOOLEAN) &&
  (binding.value === 'true' || binding.value === '1');

/**
 * The flags that failed: those not true in some solution. An unbound flag
 * failed. Only the flags `refusals` names are reported, in its order.
 */
export function failedFlags(results: Results, refusals: Record<string, string>): { rows: number; failed: string[] } {
  const rows = results.results?.bindings ?? [];
  const failed = Object.keys(refusals).filter(flag => rows.some(row => !isTrue(row[`${FLAG_PREFIX}${flag}`])));
  return { rows: rows.length, failed };
}

/** `{param}` in a message: the call's values for that variable, joined with `, `. */
export function fillMessage(message: string, argumentTables: readonly ArgumentTable[] | undefined): string {
  return message.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const values = (argumentTables ?? [])
      .filter(table => table.head?.vars?.includes(name))
      .flatMap(table => table.results?.bindings ?? [])
      .map(row => row[name]?.value)
      .filter((value): value is string => typeof value === 'string');
    return values.length ? values.join(', ') : whole;
  });
}

/**
 * The `409` body for a refused call. `failed` empty means the refusal query
 * had no solutions, or no named flag failed while `?ok` still did: the update
 * would write nothing either way.
 */
export function refusedBody(
  failed: string[],
  refusals: Record<string, string>,
  argumentTables: readonly ArgumentTable[] | undefined,
): RefusedBody {
  const refused = failed.map(flag => ({ flag, message: fillMessage(refusals[flag], argumentTables) }));
  return {
    error: refused.length
      ? refused.map(entry => entry.message).join(' ')
      : 'The update wrote nothing: its WHERE clause has no solution for these arguments.',
    refused,
  };
}
