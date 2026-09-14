/**
 * LIMIT / OFFSET parameter substitution.
 *
 * A parameterised page size is written in the query as a reserved placeholder —
 * `LIMIT 0001`, `OFFSET 0002` — where `000` is the marker and what follows is the
 * parameter name. Unlike VALUES slots this never needed a parser: the placeholder
 * is unambiguous in the raw text, so substitution is a regular expression.
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
 * Parameter names are interpolated into a regular expression, so they are held to
 * an alphabet with no metacharacters. Real names are the digits `detectInputs`
 * captures from `LIMIT 000(\d+)`; identifiers are admitted for readability.
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

  let result = queryString;
  for (const parameter of limitParams) {
    assertParameter('limit', parameter);
    result = result.replace(
      new RegExp(`\\bLIMIT\\s+000${parameter.name}\\b`, 'gi'),
      `LIMIT ${parameter.value}`,
    );
  }
  for (const parameter of offsetParams) {
    assertParameter('offset', parameter);
    result = result.replace(
      new RegExp(`\\bOFFSET\\s+000${parameter.name}\\b`, 'gi'),
      `OFFSET ${parameter.value}`,
    );
  }
  return result;
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
