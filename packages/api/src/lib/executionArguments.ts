import { normalizeArguments as normalizeRuntimeArguments } from '@sparql-query-lib/runtime';
import { SparqlQueryParser } from './parser.js';
import type { ArgumentSet as RuntimeArgumentSet } from './query-chaining.js';
import type { RuntimeArgumentPayload } from './ArgumentSetService.js';
import {
  describeParameterKey,
  scalarParameterKey,
  tableParameterKey,
} from '@sparql-query-lib/types';

/**
 * Applying an execution payload to a query string, in one place.
 *
 * `POST /execute` and `POST /sparql` do the same two things to a query before
 * it runs — substitute LIMIT/OFFSET parameters, then bind the VALUES inputs —
 * and differ only in where the query came from: a stored version, or the
 * editor. Keeping the substitution here is what makes "an unsaved query runs
 * the same way a saved one does" true rather than approximately true.
 */

/** A LIMIT or OFFSET parameter, as both routes' request bodies spell it. */
export interface ExecutionParameter {
  name: string;
  value: number;
}

/**
 * A failed substitution: the caller's payload does not fit the query.
 *
 * Carries `statusCode` so a route can answer 400 rather than turning a caller's
 * mistake into a 500 — the shape both routes' generic error handlers read.
 */
export class ArgumentApplicationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ArgumentApplicationError';
  }
}

/**
 * An argument as it arrives on the wire: a SPARQL Results JSON document.
 *
 * Deliberately looser than the runtime `ArgumentSet`: a request may carry
 * `null` cells and `null` rows, `typed-literal` terms and, until it is refused,
 * blank nodes. Normalising those away is exactly what turns one into the other.
 */
export interface WireArgumentSet {
  head: { vars: string[] };
  results: { bindings: unknown[] };
}

/**
 * Validate wire arguments and bring them to the runtime shape.
 *
 * Shared with the exported runtime so a bundle accepts precisely the payload
 * `/execute` accepts, refused in the same words. A refusal is rethrown as an
 * {@link ArgumentApplicationError} so every route answers it with a 400.
 */
export function normalizeArguments(
  argumentSets: readonly WireArgumentSet[] | undefined
): RuntimeArgumentSet[] | undefined {
  try {
    return normalizeRuntimeArguments(argumentSets) as RuntimeArgumentSet[] | undefined;
  } catch (error) {
    throw new ArgumentApplicationError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Substitute an execution payload into a query string.
 *
 * LIMIT/OFFSET first, then arguments — the order `/execute` has always used,
 * because binding VALUES rewrites the query and the parameter placeholders are
 * easier to find in the text the caller wrote. Returns the query unchanged when
 * the payload is empty, so a caller can hand its payload over unconditionally.
 */
export function applyExecutionArguments(
  queryString: string,
  payload: {
    argumentSets?: readonly WireArgumentSet[];
    limits?: ExecutionParameter[];
    offsets?: ExecutionParameter[];
  },
  parser: SparqlQueryParser = new SparqlQueryParser()
): string {
  const limits = payload.limits ?? [];
  const offsets = payload.offsets ?? [];
  const argumentSets = normalizeArguments(payload.argumentSets) ?? [];

  let result = queryString;

  if (limits.length > 0 || offsets.length > 0) {
    try {
      result = parser.applyLimitOffsetParameters(result, limits, offsets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ArgumentApplicationError(`Failed to apply LIMIT/OFFSET parameters: ${message}`);
    }
  }

  if (argumentSets.length > 0) {
    try {
      result = parser.applyArguments(result, argumentSets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ArgumentApplicationError(`Failed to apply arguments: ${message}`);
    }
  }

  return result;
}

/**
 * A request's argument fields, as `POST /sparql` and `POST /substitute` take
 * them. `/execute` names a stored version instead, so it does not pass through
 * here.
 */
export interface WireExecutionPayload {
  arguments?: WireArgumentSet[];
  limits?: ExecutionParameter[];
  offsets?: ExecutionParameter[];
  argumentSetIds?: string[];
}

/**
 * Complete a payload from the stored argument sets it names.
 *
 * A named set may be combined with inline values for the parameters it leaves
 * open; supplying a value for one it already fills is refused naming the
 * parameter, rather than silently letting one win. That rule is `/execute`'s,
 * and lives here so the routes that accept raw query text cannot drift from it
 * — `/substitute` exists precisely to give a browser-side executor the same
 * substitution the server would have done, and "the same" has to include this.
 */
export async function resolveExecutionPayload(
  payload: WireExecutionPayload,
  service: { exportRuntimePayload: (ids: string[]) => Promise<RuntimeArgumentPayload> }
): Promise<{
  argumentSets: WireArgumentSet[] | undefined;
  limits: ExecutionParameter[] | undefined;
  offsets: ExecutionParameter[] | undefined;
}> {
  const { arguments: inlineArguments, limits, offsets, argumentSetIds } = payload;

  if (!Array.isArray(argumentSetIds) || argumentSetIds.length === 0) {
    return { argumentSets: inlineArguments, limits, offsets };
  }

  const stored = await service.exportRuntimePayload(argumentSetIds);
  const filled = stored.filledParameters;
  const conflicts: string[] = [];

  for (const argSet of inlineArguments ?? []) {
    const vars = Array.isArray(argSet?.head?.vars) ? argSet.head.vars : [];
    if (vars.length && filled.has(tableParameterKey(vars))) {
      conflicts.push(describeParameterKey(tableParameterKey(vars)));
    }
  }
  for (const limit of limits ?? []) {
    if (filled.has(scalarParameterKey('limit', limit.name))) {
      conflicts.push(describeParameterKey(scalarParameterKey('limit', limit.name)));
    }
  }
  for (const offset of offsets ?? []) {
    if (filled.has(scalarParameterKey('offset', offset.name))) {
      conflicts.push(describeParameterKey(scalarParameterKey('offset', offset.name)));
    }
  }
  if (conflicts.length) {
    throw new ArgumentApplicationError(
      `The named argument set already fills ${conflicts.join(', ')}; `
        + 'supply a value only for a parameter it leaves open.'
    );
  }

  return {
    argumentSets: [...stored.tupleList, ...(inlineArguments ?? [])],
    limits: [...stored.limits, ...(limits ?? [])],
    offsets: [...stored.offsets, ...(offsets ?? [])],
  };
}
