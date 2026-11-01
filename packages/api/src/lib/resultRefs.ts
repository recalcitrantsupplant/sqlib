/**
 * Turning a kept result's handle back into what a run takes.
 *
 * A request may name a kept result (`lib/resultCache.ts`) where it would
 * otherwise send content: as an argument's rows, or as a data graph. Both are
 * resolved here, before the run, into exactly the inline shapes a caller could
 * have sent — so nothing past the route knows a reference was used.
 */
import type { ExecutionArgument, ExecutionDataGraph } from '@sparql-query-lib/contracts';
import type { FastifyRequest } from 'fastify';
import { DATA_GRAPH_FORMATS } from './dataGraphContent.js';
import { getResultCache, ResultRefError } from './resultCache.js';
import { ValidationError } from './validationError.js';

export interface ArgumentRef {
  resultRef: string;
  columns: Array<{ from: string; to: string }>;
  /** The slot's variables, as the argument's head. The columns' targets when absent. */
  vars?: string[];
}

/** Whose kept results a request may read. */
export function resultOwner(request: FastifyRequest): string {
  return request.authContext?.subject ?? 'anonymous';
}

function mediaType(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}

/**
 * A kept SELECT result's rows, as one argument for a slot.
 *
 * `columns` pairs a column of the result with a variable of the slot. The
 * pairing is the caller's: it is the same name-then-position rule a group
 * edge uses, and the caller already applied it to show the wiring.
 */
export function resolveArgumentRef(owner: string, ref: ArgumentRef): ExecutionArgument {
  const kept = getResultCache().get(owner, ref.resultRef);
  let document: { head?: { vars?: string[] }; results?: { bindings?: Array<Record<string, unknown>> } };
  try {
    document = JSON.parse(kept.body);
  } catch {
    throw new ValidationError(`The kept result ${ref.resultRef} is ${mediaType(kept.contentType)}, not rows.`);
  }
  const bindings = document.results?.bindings;
  if (!Array.isArray(bindings)) {
    throw new ValidationError(`The kept result ${ref.resultRef} holds no rows (it is not a SELECT result).`);
  }
  const columns = document.head?.vars ?? [];
  for (const { from } of ref.columns) {
    if (!columns.includes(from)) {
      throw new ValidationError(`The kept result ${ref.resultRef} has no column ?${from}.`);
    }
  }
  return {
    head: { vars: ref.vars ?? ref.columns.map(({ to }) => to) },
    results: {
      bindings: bindings.map((row) => {
        const renamed: Record<string, unknown> = {};
        for (const { from, to } of ref.columns) if (row[from] !== undefined) renamed[to] = row[from];
        return renamed;
      }),
    } as ExecutionArgument['results'],
  };
}

/** A kept CONSTRUCT or rule set result, as an inline data graph. */
export function resolveGraphRef(owner: string, resultRef: string): { dataGraphInline: string; dataGraphInlineFormat: string } {
  const kept = getResultCache().get(owner, resultRef);
  const format = mediaType(kept.contentType);
  if (!(DATA_GRAPH_FORMATS as readonly string[]).includes(format)) {
    throw new ValidationError(
      `The kept result ${resultRef} is ${format}; a data graph is read from ${DATA_GRAPH_FORMATS.join(', ')}.`,
    );
  }
  return { dataGraphInline: kept.body, dataGraphInlineFormat: format };
}

/** A request's references, resolved into the inline shapes. Throws `ResultRefError` or `ValidationError`. */
export function resolveRequestRefs(
  request: FastifyRequest,
  body: { arguments?: ExecutionArgument[]; argumentRefs?: ArgumentRef[]; dataGraphs?: ExecutionDataGraph[] },
): { arguments?: ExecutionArgument[]; dataGraphs?: ExecutionDataGraph[] } {
  const owner = resultOwner(request);
  const refs = body.argumentRefs ?? [];
  const args = refs.length
    ? [...(body.arguments ?? []), ...refs.map((ref) => resolveArgumentRef(owner, ref))]
    : body.arguments;
  const dataGraphs = body.dataGraphs?.map((entry) => {
    if (!entry.resultRef) return entry;
    const { resultRef: handle, ...rest } = entry;
    return { ...rest, ...resolveGraphRef(owner, handle) };
  });
  return { arguments: args, dataGraphs };
}

export { ResultRefError };
