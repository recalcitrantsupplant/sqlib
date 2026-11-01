/**
 * The `tool` object on a new query or query group version: which one it gets,
 * and the check that keeps it true to the version's inputs.
 *
 * A save that sends `tool` sets it (`null` clears it). A save that sends none
 * copies the previous version's, so editing the text keeps a published tool
 * published without restating it. Either way the result is checked against the
 * inputs this version declares, and a `params` key that names none of them is
 * a 400 that names the key. A published tool therefore never breaks silently
 * at the next start. See `docs/guides/publishing-tools.md`.
 */
import { checkToolObject, type DetectedInputs, type ToolObject } from '@sparql-query-lib/tools';
import { checkRefusals } from './refusals.js';

/** A `tool` object the version's inputs do not support. Answers 400. */
export class ToolObjectError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ToolObjectError';
  }
}

type StoredTool = ToolObject | false | null | undefined;

/**
 * The `tool` the new version stores: the body's, else the previous
 * version's. `undefined` stores none.
 */
export function resolveVersionTool(options: {
  body: Record<string, unknown>;
  previous: { version?: number | null; tool?: StoredTool } | null | undefined;
  inputs: DetectedInputs;
  targetKind: 'query' | 'group';
  /** A query version's text: `refusals` are checked against the flags it binds. */
  queryString?: string;
}): ToolObject | false | undefined {
  const { body, previous, inputs, targetKind, queryString } = options;
  const sent = Object.prototype.hasOwnProperty.call(body, 'tool');
  const tool: StoredTool = sent ? (body.tool as StoredTool) : previous?.tool;
  if (tool === undefined || tool === null) return undefined;
  if (tool === false) return false;

  const problem =
    checkToolObject(tool, inputs, { targetKind }) ??
    (tool.refusals && targetKind === 'query' ? checkRefusals(queryString ?? '', tool.refusals) : null);
  if (problem) {
    throw new ToolObjectError(
      sent
        ? problem
        : `${problem}. The tool object was copied from version ${previous?.version ?? 'the previous version'}; ` +
            'send a corrected tool object, or "tool": false, with the new text.',
    );
  }
  return tool;
}

type NamedRecord = { variableName?: unknown; name?: unknown };

/**
 * A query version's inputs, as the flattened create body states them once the
 * route has derived what the client left out. The check needs only the names,
 * so every variable is reported as one table.
 */
export function queryBodyInputs(flat: Record<string, unknown>): DetectedInputs {
  const names = (list: unknown, field: 'variableName' | 'name') =>
    (Array.isArray(list) ? (list as NamedRecord[]) : [])
      .map(entry => entry?.[field])
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const variables = names(flat.inputs, 'variableName');
  return {
    tables: variables.length ? [variables] : [],
    limits: names(flat.limitParameters, 'name'),
    offsets: names(flat.offsetParameters, 'name'),
  };
}

type Lookup = (id: string) => unknown;

function field<T>(entity: unknown, name: string): T | undefined {
  return entity && typeof entity === 'object' ? ((entity as Record<string, unknown>)[name] as T) : undefined;
}

/**
 * The variables of one start-node port, in member order. A port is a tuple of
 * its own (`QueryOutputTuple`) or, in the simple form, the input tuple of the
 * query it feeds (`QueryInputTuple`). A port that is not a variable table (an
 * RDF input, a query-id slot) has none.
 */
function portVariables(portId: string, lookup: Lookup): string[] {
  const port = lookup(portId);
  const type = field<string>(port, '@type');
  if (type !== 'QueryOutputTuple' && type !== 'QueryInputTuple') return [];
  const members = (field<string[]>(port, 'memberEntries') ?? [])
    .map(id => lookup(id))
    .filter(Boolean)
    .sort((a, b) => (field<number>(a, 'position') ?? 0) - (field<number>(b, 'position') ?? 0));
  return members
    .map(member => field<string>(lookup(field<string>(member, 'variable') ?? ''), 'variableName'))
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/**
 * A query group version's parameters: one table per variable port of its
 * start node, and the LIMIT and OFFSET parameters of the queries its nodes
 * run. `lookup` resolves an id to an entity, staged or stored.
 */
export function groupInputs(options: {
  startNodePorts: string[];
  nodeQueryVersionIds: string[];
  lookup: Lookup;
  detect: (queryString: string) => { limitParameters: string[]; offsetParameters: string[] };
}): DetectedInputs {
  const { startNodePorts, nodeQueryVersionIds, lookup, detect } = options;
  const tables = startNodePorts.map(port => portVariables(port, lookup)).filter(table => table.length > 0);
  const limits = new Set<string>();
  const offsets = new Set<string>();
  for (const versionId of nodeQueryVersionIds) {
    const queryString = field<string>(lookup(versionId), 'queryString');
    if (!queryString) continue;
    try {
      const detected = detect(queryString);
      detected.limitParameters.forEach(name => limits.add(name));
      detected.offsetParameters.forEach(name => offsets.add(name));
    } catch {
      // A node whose text does not parse reports that itself when it runs.
    }
  }
  return { tables, limits: [...limits], offsets: [...offsets] };
}
