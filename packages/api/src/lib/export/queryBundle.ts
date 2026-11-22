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
  type ExportedUpdate,
  type SlotPolicy,
} from '@sparql-query-lib/runtime';
import {
  TemplateCompileError,
  compileQueryTemplate,
  compileUpdateTemplate,
  detectSparqlOperation,
  type CompiledUpdate,
} from '@sparql-query-lib/compiler';
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
  /** The version's per-slot `whenEmpty`, carried so the bundle refuses what the server refuses. */
  inputPolicies?: SlotPolicy[];
}

export interface BuildExportBundleOptions {
  library: { id: string; name?: string };
  queries: readonly ExportQueryInput[];
  /** Tags the selection was filtered by, recorded for provenance. */
  tags?: string[];
  /** Overrides the export timestamp; tests pass a fixed value. */
  generatedAt?: string;
  parser?: SparqlQueryParser;
  /**
   * Carry the library's SPARQL UPDATEs in `bundle.updates`. Off by default, and
   * an update in the selection is then refused, as it always was. A bundle has
   * no authorization of its own, so turn this on only for a bundle that runs
   * against a store its caller owns, such as an in-browser Oxigraph store.
   */
  updates?: boolean;
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
 * Reserve a unique key for a name among those already taken.
 *
 * Two entities may legitimately share a name — the library only requires IRIs
 * to be unique — so a collision gets a numeric suffix rather than silently
 * overwriting the earlier entry, which is what a plain object build would do.
 * A query a group brings in collides with the library's own queries on
 * purpose: two entries for the same name are two queries.
 */
export function reserveKey(name: string, taken: Set<string>): string {
  const base = slugify(name);
  let key = base;
  for (let suffix = 2; taken.has(key); suffix++) key = `${base}-${suffix}`;
  taken.add(key);
  return key;
}

/** Assign each query a unique bundle key. */
function assignKeys(queries: readonly ExportQueryInput[]): Array<[string, ExportQueryInput]> {
  const used = new Set<string>();
  return queries.map((query) => [reserveKey(query.name, used), query]);
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

  // `queryType` second, where it has always been, so a re-export of an
  // unchanged library stays byte-identical.
  const { template, ...rest } = await exportedEntry(compiled, input);
  return { template, queryType: compiled.queryType, ...rest };
}

/** Compile one update, or explain why it cannot be exported. */
export async function compileExportUpdate(
  input: ExportQueryInput,
  parser: SparqlQueryParser,
): Promise<ExportedUpdate> {
  try {
    return await exportedEntry(compileUpdateTemplate(input.queryString, { name: input.name, parser }), input);
  } catch (error) {
    if (error instanceof TemplateCompileError) throw new QueryExportError(error.message);
    throw error;
  }
}

/** The members a compiled query and a compiled update share. */
async function exportedEntry(compiled: CompiledUpdate, input: ExportQueryInput): Promise<ExportedUpdate> {
  const { template, pageParameters } = compiled;

  return {
    template,
    limitParameters: compiled.limitParameters,
    offsetParameters: compiled.offsetParameters,
    ...(pageParameters.length > 0 ? { pageParameters } : {}),
    inferredInputs: compiled.inferredInputs,
    ...(input.inputPolicies && input.inputPolicies.length > 0
      ? {
          inputPolicies: input.inputPolicies.map((policy) => ({
            vars: [...policy.vars],
            ...(policy.whenEmpty ? { whenEmpty: policy.whenEmpty } : {}),
            ...(policy.valuePattern ? { valuePattern: policy.valuePattern } : {}),
          })),
        }
      : {}),
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
  const keyed = assignKeys(options.queries);
  // With updates on, an update goes to `updates`. Text that does not parse
  // stays with the queries, whose compile reports it with the usual message.
  const isUpdate = (input: ExportQueryInput): boolean => {
    if (!options.updates) return false;
    try {
      return detectSparqlOperation(input.queryString) === 'UPDATE';
    } catch {
      return false;
    }
  };
  const [queryEntries, updateEntries] = await Promise.all([
    Promise.all(
      keyed
        .filter(([, input]) => !isUpdate(input))
        .map(async ([key, input]) => [key, await compileExportQuery(input, parser)] as const),
    ),
    Promise.all(
      keyed
        .filter(([, input]) => isUpdate(input))
        .map(async ([key, input]) => [key, await compileExportUpdate(input, parser)] as const),
    ),
  ]);

  return {
    version: 2,
    library: options.library,
    queries: Object.fromEntries(queryEntries),
    ...(updateEntries.length > 0 ? { updates: Object.fromEntries(updateEntries) } : {}),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(options.tags && options.tags.length > 0 ? { tags: options.tags } : {}),
  };
}
