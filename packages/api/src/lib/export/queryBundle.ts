/**
 * Building an export bundle: compile a library's queries for client-side use.
 *
 * This is the server half of the static export path. Everything expensive and
 * everything that needs a SPARQL parser happens here, once, at export time —
 * parse the query, find its parameter slots, record their spans, prove the
 * resulting template agrees with the AST path. What ships is the result, which
 * `@sparql-query-lib/runtime` can apply arguments to with no parser at all.
 *
 * The failure policy is deliberately strict: anything that cannot be compiled and
 * verified is an error, not a warning. On the request path a query that declines
 * to compile is merely slow (it falls back to the AST path), but there is no
 * fallback in a browser — an unverified template would be a splice nobody has
 * checked. Better to refuse to export the query and say which one.
 *
 * See `docs/guides/static-export.md`.
 */

import {
  hashTemplateText,
  type ExportBundle,
  type ExportedQuery,
  type ExportedQueryType,
  type PageParameterSpan,
  type QueryTemplate,
} from '@sparql-query-lib/runtime';
import { SparqlQueryParser } from '../parser.js';
import { detectSparqlOperation } from '../queryTypeDetector.js';
import { QueryTypeIri, type QueryTypeValue } from '../queryTypes.js';

/** A query to export, reduced to what the bundle actually needs. */
export interface ExportQueryInput {
  /** Human name, from the stored Query. Slugged to become the bundle key. */
  name: string;
  queryString: string;
  /** The stable Query IRI, used to find this query's tests. Provenance too. */
  sourceQuery?: string;
  /** Tag IRIs the query carries, so a rendered library can filter by them. */
  tags?: string[];
  /** The QueryVersion IRI this text came from. Provenance only. */
  sourceVersion?: string;
  description?: string;
}

export interface BuildExportBundleOptions {
  library: { id: string; name?: string };
  queries: readonly ExportQueryInput[];
  /** Tags the selection was filtered by, recorded for provenance. */
  tags?: string[];
  /** Overrides the export timestamp; tests pass a fixed value. */
  generatedAt?: string;
  parser?: SparqlQueryParser;
}

/**
 * A query that cannot be exported, and why.
 *
 * Carries `statusCode` so the route answers 400 rather than turning a library
 * containing one un-exportable query into a 500.
 */
export class QueryExportError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'QueryExportError';
  }
}

/**
 * First of the integers standing in for page-parameter placeholders while a
 * query is compiled. Large enough that no realistic query pages by one, and any
 * collision is caught rather than tolerated (see {@link locatePageParameters}).
 */
const SENTINEL_BASE = 2_000_000_000;

/** SPARQL forms an exported bundle can carry, mapped from their stored IRIs. */
const EXPORTABLE_TYPES = new Map<QueryTypeValue, ExportedQueryType>([
  [QueryTypeIri.select, 'SELECT'],
  [QueryTypeIri.ask, 'ASK'],
  [QueryTypeIri.construct, 'CONSTRUCT'],
  [QueryTypeIri.describe, 'DESCRIBE'],
]);

/**
 * Turn a query's name into a bundle key: an app writes `lib.query('people-by-city')`,
 * so the key has to be stable, readable, and safe in a URL and a filename.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'query';
}

/**
 * Assign each query a unique bundle key.
 *
 * Two queries may legitimately share a name — the library only requires IRIs to
 * be unique — so a collision gets a numeric suffix rather than silently
 * overwriting the earlier entry, which is what a plain object build would do.
 */
function assignKeys(queries: readonly ExportQueryInput[]): Array<[string, ExportQueryInput]> {
  const used = new Set<string>();
  return queries.map((query) => {
    const base = slugify(query.name);
    let key = base;
    for (let suffix = 2; used.has(key); suffix++) key = `${base}-${suffix}`;
    used.add(key);
    return [key, query];
  });
}

/**
 * Compile a query whose page parameters survive generation.
 *
 * The problem: `LIMIT 0001` is a placeholder only in the text the author wrote.
 * Traqula reads `0001` as the integer 1 and generates `LIMIT 1`, so by the time a
 * template exists the placeholder is gone — and with it any way for a browser to
 * find it. The server never noticed because it substitutes page parameters over
 * the original string, before any template is built.
 *
 * The fix is to make the placeholder something the generator *does* preserve:
 * substitute a distinctive integer, compile, then find that integer in the
 * generated text. Its span is where the placeholder ended up. The placeholder
 * text is then written back into the template, so an unsupplied parameter behaves
 * exactly as it does on the server, and the span is recorded for the runtime to
 * splice over.
 */
function locatePageParameters(
  queryString: string,
  parser: SparqlQueryParser,
  detected: { limitParameters: string[]; offsetParameters: string[] },
  name: string,
): { template: QueryTemplate; pageParameters: PageParameterSpan[] } | null {
  const parameters: Array<{ name: string; kind: 'limit' | 'offset'; sentinel: number }> = [
    ...detected.limitParameters.map((n, i) => ({ name: n, kind: 'limit' as const, sentinel: SENTINEL_BASE + i })),
    ...detected.offsetParameters.map((n, i) => ({
      name: n,
      kind: 'offset' as const,
      sentinel: SENTINEL_BASE + detected.limitParameters.length + i,
    })),
  ];

  // Distinct names only: the same parameter may appear in several clauses, and
  // every occurrence takes the same sentinel and the same value.
  const unique = new Map<string, (typeof parameters)[number]>();
  for (const parameter of parameters) {
    const key = `${parameter.kind}:${parameter.name}`;
    if (!unique.has(key)) unique.set(key, parameter);
  }

  let sentinelQuery = queryString;
  const occurrences = new Map<string, number>();
  for (const parameter of unique.values()) {
    const keyword = parameter.kind === 'limit' ? 'LIMIT' : 'OFFSET';
    const placeholder = new RegExp(`\\b${keyword}\\s+000${parameter.name}\\b`, 'gi');
    let count = 0;
    sentinelQuery = sentinelQuery.replace(placeholder, () => {
      count++;
      return `${keyword} ${parameter.sentinel}`;
    });
    occurrences.set(`${parameter.kind}:${parameter.name}`, count);
  }

  const template = parser.compileVerifiedTemplate(sentinelQuery);
  if (!template) return null;

  // Rewrite each sentinel back to its placeholder, recording where it landed.
  // Working right to left keeps the offsets of the edits still to come valid.
  const found: PageParameterSpan[] = [];
  let text = template.text;
  const edits: Array<{ start: number; end: number; replacement: string; span: PageParameterSpan }> = [];
  for (const parameter of unique.values()) {
    const keyword = parameter.kind === 'limit' ? 'LIMIT' : 'OFFSET';
    const pattern = new RegExp(`\\b${keyword}\\s+${parameter.sentinel}\\b`, 'gi');
    let match: RegExpExecArray | null;
    let seen = 0;
    while ((match = pattern.exec(text)) !== null) {
      seen++;
      const replacement = `${keyword} 000${parameter.name}`;
      edits.push({
        start: match.index,
        end: match.index + match[0].length,
        replacement,
        span: { name: parameter.name, kind: parameter.kind, start: 0, end: 0 },
      });
    }
    // A sentinel that collided with a literal integer already in the query, or
    // one the generator dropped, would silently mislocate the parameter.
    if (seen !== occurrences.get(`${parameter.kind}:${parameter.name}`)) {
      throw new QueryExportError(
        `Query '${name}' declares ${keyword} parameter ${parameter.name}, but it could not be located unambiguously in the compiled query. Rewrite the query to avoid a literal ${keyword} ${parameter.sentinel}.`,
      );
    }
  }

  edits.sort((a, b) => a.start - b.start);
  let rebuilt = '';
  let cursor = 0;
  let delta = 0;
  const shifts: Array<[number, number]> = [];
  for (const edit of edits) {
    rebuilt += text.slice(cursor, edit.start) + edit.replacement;
    edit.span.start = edit.start + delta;
    edit.span.end = edit.span.start + edit.replacement.length;
    delta += edit.replacement.length - (edit.end - edit.start);
    shifts.push([edit.end, delta]);
    cursor = edit.end;
    found.push(edit.span);
  }
  rebuilt += text.slice(cursor);
  text = rebuilt;

  const shift = (position: number): number => {
    let applied = 0;
    for (const [before, cumulative] of shifts) {
      if (before <= position) applied = cumulative;
    }
    return position + applied;
  };

  return {
    template: {
      text,
      slots: template.slots.map((slot) => ({
        start: shift(slot.start),
        end: shift(slot.end),
        vars: slot.vars,
      })),
      prefixes: template.prefixes,
    },
    pageParameters: found,
  };
}

/** Compile one query, or explain why it cannot be exported. */
export async function compileExportQuery(
  input: ExportQueryInput,
  parser: SparqlQueryParser,
): Promise<ExportedQuery> {
  let operation: QueryTypeValue;
  try {
    operation = detectSparqlOperation(input.queryString);
  } catch (error) {
    throw new QueryExportError(
      `Query '${input.name}' could not be parsed, so it cannot be exported: ${(error as Error).message}`,
    );
  }

  const queryType = EXPORTABLE_TYPES.get(operation);
  if (!queryType) {
    // UPDATE and the graph-management operations write, and an exported bundle
    // has no authorization story of its own. Reads only, deliberately.
    throw new QueryExportError(
      `Query '${input.name}' is an update operation, which the static export path does not carry. Export read queries only.`,
    );
  }

  // Page parameters and the slot signature both come from the query text rather
  // than from the stored LimitParameter/QueryInputTuple entities: the text is what
  // the template was compiled from, so deriving both from it is what keeps the
  // bundle self-consistent even if the stored metadata has drifted.
  const detected = parser.detectInputs(input.queryString);
  const paginated = detected.limitParameters.length > 0 || detected.offsetParameters.length > 0;

  const compiled = paginated
    ? locatePageParameters(input.queryString, parser, detected, input.name)
    : (() => {
        const template = parser.compileVerifiedTemplate(input.queryString);
        return template ? { template, pageParameters: [] } : null;
      })();

  if (!compiled) {
    throw new QueryExportError(
      `Query '${input.name}' could not be compiled to a verified template, so its arguments cannot be applied without a parser. It can still be run through the API.`,
    );
  }

  const { template, pageParameters } = compiled;

  return {
    template,
    queryType,
    limitParameters: detected.limitParameters,
    offsetParameters: detected.offsetParameters,
    ...(pageParameters.length > 0 ? { pageParameters } : {}),
    inferredInputs: template.slots.map((slot) => [...slot.vars].sort()),
    textHash: await hashTemplateText(template.text),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(input.sourceQuery ? { sourceQuery: input.sourceQuery } : {}),
    ...(input.sourceVersion ? { sourceVersion: input.sourceVersion } : {}),
    ...(input.description ? { description: input.description } : {}),
  };
}

/**
 * Compile a set of queries into an export bundle.
 *
 * Throws {@link QueryExportError} naming the offending query if any of them
 * cannot be exported, rather than quietly returning a partial bundle: a bundle
 * missing the query an app calls is a runtime failure at someone else's site.
 */
export async function buildExportBundle(options: BuildExportBundleOptions): Promise<ExportBundle> {
  const parser = options.parser ?? new SparqlQueryParser();
  const entries = await Promise.all(
    assignKeys(options.queries).map(
      async ([key, input]) => [key, await compileExportQuery(input, parser)] as const,
    ),
  );

  return {
    version: 1,
    library: options.library,
    queries: Object.fromEntries(entries),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(options.tags && options.tags.length > 0 ? { tags: options.tags } : {}),
  };
}
