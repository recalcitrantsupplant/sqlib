/**
 * LIMIT / OFFSET parameter substitution.
 *
 * A parameterised page size is written in the query as a reserved placeholder —
 * `LIMIT 0001`, `OFFSET 0002` — where `000` is the marker and what follows is the
 * parameter name. Unlike VALUES slots this needs no parser, but it does need to
 * know what is code: `# LIMIT 0001` in a comment and `"LIMIT 0001"` in a string
 * are text, not clauses. {@link findLimitOffsetClauses} is the one place that
 * decides, by skipping comments, string literals and IRIs before it matches,
 * and everything that finds a placeholder — detection, substitution, formatting,
 * export — asks it.
 *
 * The server has always done it this way (`SparqlQueryParser.applyLimitOffsetParameters`),
 * and this module is that function's core, extracted so the exported runtime and
 * the API cannot drift.
 *
 * **The validation here is load-bearing on the client.** The server re-parses the
 * substituted query and so would notice a value that spliced in as something other
 * than an integer; a browser runtime carries no parser and cannot. So a name that
 * is not a bare identifier, or a value that is not a non-negative safe integer, is
 * rejected outright rather than interpolated and hoped for.
 */

/** A LIMIT or OFFSET parameter, as both the API and the runtime spell it. */
export interface ExecutionParameter {
  name: string;
  value: number;
}

/**
 * Parameter names are held to an alphabet with no metacharacters, which is what
 * made interpolating them into a regular expression safe and still keeps a
 * malformed name a caller error. Real names are the digits after `000`;
 * identifiers are admitted for readability.
 */
const SAFE_PARAMETER_NAME = /^[A-Za-z0-9_]+$/;

/** Raised when a parameter cannot be substituted; always a caller error. */
export class InvalidParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidParameterError';
  }
}

/**
 * Check a page parameter's value before it becomes query syntax.
 *
 * Exported because the bundle path splices by span rather than by regular
 * expression and so skips {@link substituteLimitOffset} — but it must not skip
 * this. The server would catch a nonsense value when it re-parses the substituted
 * query; a browser has no parser, which makes this the only check there is.
 */
export function assertPageParameterValue(
  kind: 'limit' | 'offset',
  name: string,
  value: number,
): void {
  if (typeof value !== 'number') {
    // Wording preserved from `SparqlQueryParser.applyLimitOffsetParameters`, so
    // which path served a request is not observable from its errors.
    throw new InvalidParameterError(
      `Invalid ${kind} parameter: name must be string, value must be number.`,
    );
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidParameterError(
      `Invalid ${kind} value for '${name}': expected a non-negative integer, received ${value}.`,
    );
  }
}

function assertParameter(kind: 'limit' | 'offset', parameter: ExecutionParameter): void {
  if (parameter === null || typeof parameter !== 'object') {
    throw new InvalidParameterError(`Invalid ${kind} parameter: expected a {name, value} object.`);
  }
  const { name, value } = parameter;
  if (typeof name !== 'string') {
    throw new InvalidParameterError(
      `Invalid ${kind} parameter: name must be string, value must be number.`,
    );
  }
  if (!SAFE_PARAMETER_NAME.test(name)) {
    throw new InvalidParameterError(
      `Invalid ${kind} parameter name '${name}': expected letters, digits or underscores.`,
    );
  }
  assertPageParameterValue(kind, name, value);
}

/** A `LIMIT n` / `OFFSET n` clause found in query code. */
export interface LimitOffsetClause {
  kind: 'limit' | 'offset';
  /** The integer exactly as written, leading zeros included. */
  lexeme: string;
  /** The parameter name when the lexeme is a `000<name>` placeholder, else null. */
  name: string | null;
  /** Span of the whole clause, keyword through integer. */
  start: number;
  end: number;
}

/**
 * The query text with every comment, string literal and IRI blanked to spaces.
 *
 * Offsets are preserved, so a match in the masked text is a match at the same
 * place in the original. A comment becomes whitespace, which is what SPARQL
 * makes of it, so `LIMIT # page size` + newline + `0001` is still a clause.
 * An IRI is recognised only so that a `#` inside one does not open a comment.
 */
/** An IRI reference: no whitespace and none of <>"{}|^`\ before the closing >. */
const IRIREF = /<[^<>"{}|^`\\\u0000-\u0020]*>/y;

function maskNonCode(text: string): string {
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '#') {
      let j = i;
      while (j < text.length && text[j] !== '\n' && text[j] !== '\r') j++;
      blank(i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      const long = text.startsWith(c.repeat(3), i);
      const close = long ? c.repeat(3) : c;
      let j = i + close.length;
      while (j < text.length && !text.startsWith(close, j)) {
        if (text[j] === '\\') j++;
        else if (!long && (text[j] === '\n' || text[j] === '\r')) break;
        j++;
      }
      j = Math.min(text.length, j + close.length);
      blank(i, j);
      i = j;
    } else if (c === '<') {
      IRIREF.lastIndex = i;
      const iri = IRIREF.exec(text);
      if (iri) {
        blank(i, i + iri[0].length);
        i += iri[0].length;
      } else {
        i++;
      }
    } else if (c === '\\') {
      // A prefixed name's escaped character (`ex:a\#b`) is not a comment.
      i += 2;
    } else {
      i++;
    }
  }
  return out.join('');
}

/**
 * Every `LIMIT` / `OFFSET` clause in the code of a query, in order.
 *
 * Exported for the API, which detects, substitutes and formats placeholders and
 * must agree with this module about where they are.
 */
export function findLimitOffsetClauses(queryString: string): LimitOffsetClause[] {
  const masked = maskNonCode(queryString);
  const clause = /\b(LIMIT|OFFSET)(\s+)(\d+)\b/gi;
  const found: LimitOffsetClause[] = [];
  let match: RegExpExecArray | null;
  while ((match = clause.exec(masked)) !== null) {
    const lexeme = match[3];
    const placeholder = /^000(\d+)$/.exec(lexeme);
    found.push({
      kind: match[1].toLowerCase() === 'limit' ? 'limit' : 'offset',
      lexeme,
      name: placeholder ? placeholder[1] : null,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return found;
}

/**
 * Rewrite chosen clauses, right to left so earlier offsets stay valid.
 * `replace` returns the new clause text, or null to leave one as written.
 */
export function rewriteLimitOffsetClauses(
  queryString: string,
  replace: (clause: LimitOffsetClause) => string | null,
): string {
  let result = queryString;
  const clauses = findLimitOffsetClauses(queryString);
  for (let k = clauses.length - 1; k >= 0; k--) {
    const clause = clauses[k];
    const replacement = replace(clause);
    if (replacement === null) continue;
    result = result.slice(0, clause.start) + replacement + result.slice(clause.end);
  }
  return result;
}

/**
 * Replace `LIMIT 000<name>` / `OFFSET 000<name>` placeholders with their values.
 *
 * A parameter with no matching placeholder is silently ignored, matching the
 * server: a caller may hand over the whole page payload for a query that happens
 * not to paginate.
 */
export function substituteLimitOffset(
  queryString: string,
  limitParams: readonly ExecutionParameter[] = [],
  offsetParams: readonly ExecutionParameter[] = [],
): string {
  if (!Array.isArray(limitParams)) {
    throw new InvalidParameterError(
      'Invalid limitParams format: Expected an array of {name, value} objects.',
    );
  }
  if (!Array.isArray(offsetParams)) {
    throw new InvalidParameterError(
      'Invalid offsetParams format: Expected an array of {name, value} objects.',
    );
  }

  // Validated up front and in order, so the first bad parameter is the one
  // reported, as it was when each was substituted in turn.
  for (const parameter of limitParams) assertParameter('limit', parameter);
  for (const parameter of offsetParams) assertParameter('offset', parameter);
  // First of a name wins, as it did when the first replacement consumed every
  // occurrence and later ones found nothing left to match.
  const values = { limit: new Map<string, number>(), offset: new Map<string, number>() };
  for (const { name, value } of limitParams) if (!values.limit.has(name)) values.limit.set(name, value);
  for (const { name, value } of offsetParams) if (!values.offset.has(name)) values.offset.set(name, value);

  return rewriteLimitOffsetClauses(queryString, (clause) => {
    const value = clause.name === null ? undefined : values[clause.kind].get(clause.name);
    return value === undefined ? null : `${clause.kind === 'limit' ? 'LIMIT' : 'OFFSET'} ${value}`;
  });
}

/**
 * Turn a `Record<name, value>` page payload into the array form.
 *
 * The wire shape is an array because parameter order used to matter; an app
 * calling the runtime would rather write `{ page: 20 }`, so both are accepted.
 */
export function toExecutionParameters(
  parameters: Readonly<Record<string, number>> | readonly ExecutionParameter[] | undefined,
): ExecutionParameter[] {
  if (!parameters) return [];
  if (Array.isArray(parameters)) return [...parameters];
  return Object.entries(parameters as Record<string, number>).map(([name, value]) => ({ name, value }));
}
