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
} from '@sparql-query-lib/runtime';
import { TemplateCompileError, compileQueryTemplate } from '@sparql-query-lib/compiler';
import { SparqlQueryParser } from '../parser.js';

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

/** Compile one query, or explain why it cannot be exported. */
export async function compileExportQuery(
  input: ExportQueryInput,
  parser: SparqlQueryParser,
): Promise<ExportedQuery> {
  // Parsing, slot location and verification are the compiler's, shared with
  // the CLI. Its refusal is this module's QueryExportError, so the route
  // still answers 400 with the same message.
  let compiled;
  try {
    compiled = compileQueryTemplate(input.queryString, { name: input.name, parser });
  } catch (error) {
    if (error instanceof TemplateCompileError) throw new QueryExportError(error.message);
    throw error;
  }

  const { template, pageParameters } = compiled;

  return {
    template,
    queryType: compiled.queryType,
    limitParameters: compiled.limitParameters,
    offsetParameters: compiled.offsetParameters,
    ...(pageParameters.length > 0 ? { pageParameters } : {}),
    inferredInputs: compiled.inferredInputs,
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
