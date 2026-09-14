/**
 * Result shaping: bound what a tool call hands the model, door A only.
 *
 * `ToolCallResult.text` is whatever the route returned, and a route that
 * lists rows does not know or care that an LLM is reading it — a forty
 * thousand row `queries.list` or a wide SELECT is the client's problem over
 * MCP, but ours here, because `DEFAULT_TOKEN_CAP` bounds what door A pays for
 * (issue #128 item 3). Truncating and dropping the rest would make the model
 * wrong about what exists; instead the full result stays in the session
 * (keyed by a `resultId` this module mints) and the model pages through it
 * with `results.more`.
 *
 * This is safe here and awkward over MCP for the same reason the draft gate
 * is: door A holds a bounded, single-turn session to stash the rest in. A
 * long-lived MCP session has no equivalent scratch space, and no turn
 * boundary to clear it on.
 */
import type { ListedTool } from '@sparql-query-lib/tools';

export const DEFAULT_RESULT_ROW_CAP = 50;
export const DEFAULT_RESULT_CHAR_CAP = 20_000;

/** What a truncated result is stashed as, so a later page can be served from it. */
export type StoredResult = {
  text: string;
};

export type ShapedResult = {
  text: string;
  truncated: boolean;
};

export type ResultShapingCaps = {
  rowCap?: number;
  charCap?: number;
};

const RESULT_ID_ARG = { type: 'string', description: 'The resultId named in a truncation note' } as const;

export const RESULT_TOOL_DEFINITIONS: ListedTool[] = [
  {
    name: 'results.more',
    title: 'See more of a truncated result',
    description:
      'Fetch more of a tool result that was truncated (a note at the end of the earlier result says so, with a resultId and the next offset to use).',
    inputSchema: {
      type: 'object',
      properties: {
        resultId: RESULT_ID_ARG,
        offset: { type: 'number', minimum: 0, description: 'Row or character offset to resume from' },
        limit: { type: 'number', minimum: 1, description: 'How many rows or characters to return, capped either way' },
      },
      required: ['resultId'],
      additionalProperties: false,
    },
  },
];

export const RESULT_TOOL_NAMES: readonly string[] = RESULT_TOOL_DEFINITIONS.map((tool) => tool.name);

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The two shapes a "rows" cap actually needs to see: a bare JSON array (any
 * list route), or a SPARQL JSON results document (`results.bindings`). Every
 * other body — Turtle, N-Quads, RDF Patch, plain text — falls back to the
 * character cap below.
 */
function findRowsArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const bindings = (parsed as { results?: { bindings?: unknown } }).results?.bindings;
    if (Array.isArray(bindings)) return bindings;
  }
  return null;
}

function withRows(parsed: unknown, rows: unknown[]): unknown {
  if (Array.isArray(parsed)) return rows;
  const asObject = parsed as { results?: Record<string, unknown> };
  return { ...asObject, results: { ...asObject.results, bindings: rows } };
}

function moreNote(resultId: string, unit: 'rows' | 'characters', shown: number, total: number, nextOffset: number): string {
  if (nextOffset >= total) return `\n\n[${shown} ${unit}, all of it — nothing left to page.]`;
  return `\n\n[Showing ${shown} of ${total} ${unit}. Call results.more with resultId "${resultId}" and offset ${nextOffset} to see more.]`;
}

/** Shape a fresh tool result. Only a truncated one needs storing for later paging. */
export function shapeResultText(text: string, resultId: string, caps: ResultShapingCaps = {}): ShapedResult {
  const rowCap = caps.rowCap ?? DEFAULT_RESULT_ROW_CAP;
  const charCap = caps.charCap ?? DEFAULT_RESULT_CHAR_CAP;

  const parsed = tryParseJson(text);
  const rows = parsed !== undefined ? findRowsArray(parsed) : null;

  if (rows && rows.length > rowCap) {
    const head = rows.slice(0, rowCap);
    const body = JSON.stringify(withRows(parsed, head), null, 2);
    return { text: body + moreNote(resultId, 'rows', head.length, rows.length, rowCap), truncated: true };
  }

  if (rows === null && text.length > charCap) {
    const head = text.slice(0, charCap);
    return { text: head + moreNote(resultId, 'characters', head.length, text.length, charCap), truncated: true };
  }

  return { text, truncated: false };
}

/** Serve a page from a result `shapeResultText` stashed earlier. */
export function pageStoredResult(
  stored: StoredResult,
  resultId: string,
  offsetArg: unknown,
  limitArg: unknown,
  caps: ResultShapingCaps = {}
): string {
  const rowCap = caps.rowCap ?? DEFAULT_RESULT_ROW_CAP;
  const charCap = caps.charCap ?? DEFAULT_RESULT_CHAR_CAP;
  const offset = typeof offsetArg === 'number' && offsetArg >= 0 ? Math.floor(offsetArg) : 0;

  const parsed = tryParseJson(stored.text);
  const rows = parsed !== undefined ? findRowsArray(parsed) : null;

  if (rows) {
    const limit = typeof limitArg === 'number' && limitArg > 0 ? Math.min(Math.floor(limitArg), rowCap) : rowCap;
    const slice = rows.slice(offset, offset + limit);
    const body = JSON.stringify(withRows(parsed, slice), null, 2);
    return body + moreNote(resultId, 'rows', slice.length, rows.length, offset + slice.length);
  }

  const limit = typeof limitArg === 'number' && limitArg > 0 ? Math.min(Math.floor(limitArg), charCap) : charCap;
  const slice = stored.text.slice(offset, offset + limit);
  return slice + moreNote(resultId, 'characters', slice.length, stored.text.length, offset + slice.length);
}
