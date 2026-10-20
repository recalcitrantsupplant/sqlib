/**
 * Compile SPARQL text into the template a parser-free runtime splices.
 *
 * This is the step that needs the parser. Parse the query, find its parameter
 * slots, record their spans, and prove the resulting template agrees with the
 * AST path. The result is what an export bundle carries, and what the CLI
 * builds from a text file before it runs one: the same template either way,
 * applied by the same `@sparql-query-lib/runtime` splice.
 *
 * The failure policy is strict. Anything that cannot be compiled and verified
 * is an error, not a warning. On the API's request path a query that declines
 * to compile falls back to the AST path, but a template consumer has no
 * fallback, and an unverified template is a splice nobody has checked.
 */
import {
  findLimitOffsetClauses,
  rewriteLimitOffsetClauses,
  type ExportedQueryType,
  type PageParameterSpan,
  type QueryTemplate,
} from '@sparql-query-lib/runtime';
import { SparqlQueryParser } from './parser.js';
import { detectSparqlOperation } from './operation.js';

/** Why a query could not be compiled to a template. The message names the query. */
export class TemplateCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateCompileError';
  }
}

/** A query compiled for a parser-free runtime. */
export interface CompiledQuery {
  template: QueryTemplate;
  queryType: ExportedQueryType;
  limitParameters: string[];
  offsetParameters: string[];
  /** Located `LIMIT 000n` / `OFFSET 000n` placeholders; empty when there are none. */
  pageParameters: PageParameterSpan[];
  /** The variables of each parameter slot, sorted, in slot order. */
  inferredInputs: string[][];
}

export interface CompileQueryOptions {
  /** How the query is named in error messages. */
  name: string;
  /** A parser to reuse. Its template cache then serves repeated compiles. */
  parser?: SparqlQueryParser;
}

/**
 * First of the integers standing in for page-parameter placeholders while a
 * query is compiled. Large enough that no realistic query pages by one, and any
 * collision is caught rather than tolerated (see {@link locatePageParameters}).
 */
const SENTINEL_BASE = 2_000_000_000;

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

  // By clause, as detection found them, so a placeholder's text inside a
  // comment or string literal is left as the text it is.
  const occurrences = new Map<string, number>();
  const sentinelQuery = rewriteLimitOffsetClauses(queryString, (clause) => {
    const parameter = clause.name === null ? undefined : unique.get(`${clause.kind}:${clause.name}`);
    if (!parameter) return null;
    const key = `${parameter.kind}:${parameter.name}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    return `${clause.kind === 'limit' ? 'LIMIT' : 'OFFSET'} ${parameter.sentinel}`;
  });

  const template = parser.compileVerifiedTemplate(sentinelQuery);
  if (!template) return null;

  // Rewrite each sentinel back to its placeholder, recording where it landed.
  // Working right to left keeps the offsets of the edits still to come valid.
  const found: PageParameterSpan[] = [];
  let text = template.text;
  const edits: Array<{ start: number; end: number; replacement: string; span: PageParameterSpan }> = [];
  const clauses = findLimitOffsetClauses(text);
  for (const parameter of unique.values()) {
    const keyword = parameter.kind === 'limit' ? 'LIMIT' : 'OFFSET';
    let seen = 0;
    for (const clause of clauses) {
      if (clause.kind !== parameter.kind || clause.lexeme !== String(parameter.sentinel)) continue;
      seen++;
      const replacement = `${keyword} 000${parameter.name}`;
      edits.push({
        start: clause.start,
        end: clause.end,
        replacement,
        span: { name: parameter.name, kind: parameter.kind, start: 0, end: 0 },
      });
    }
    // A sentinel that collided with a literal integer already in the query, or
    // one the generator dropped, would silently mislocate the parameter.
    if (seen !== (occurrences.get(`${parameter.kind}:${parameter.name}`) ?? 0)) {
      throw new TemplateCompileError(
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

/**
 * Compile a read query, or explain why it cannot be compiled.
 *
 * Throws {@link TemplateCompileError} when the text does not parse, is an
 * update, or does not compile to a verified template.
 */
export function compileQueryTemplate(queryString: string, options: CompileQueryOptions): CompiledQuery {
  const { name } = options;
  const parser = options.parser ?? new SparqlQueryParser();

  let operation;
  try {
    operation = detectSparqlOperation(queryString);
  } catch (error) {
    throw new TemplateCompileError(
      `Query '${name}' could not be parsed, so it cannot be exported: ${(error as Error).message}`,
    );
  }

  if (operation === 'UPDATE') {
    throw new TemplateCompileError(
      `Query '${name}' is an update operation, which the static export path does not carry. Export read queries only.`,
    );
  }

  const detected = parser.detectInputs(queryString);
  const paginated = detected.limitParameters.length > 0 || detected.offsetParameters.length > 0;

  const compiled = paginated
    ? locatePageParameters(queryString, parser, detected, name)
    : (() => {
        const template = parser.compileVerifiedTemplate(queryString);
        return template ? { template, pageParameters: [] } : null;
      })();

  if (!compiled) {
    throw new TemplateCompileError(
      `Query '${name}' could not be compiled to a verified template, so its arguments cannot be applied without a parser. It can still be run through the API.`,
    );
  }

  return {
    template: compiled.template,
    queryType: operation,
    limitParameters: detected.limitParameters,
    offsetParameters: detected.offsetParameters,
    pageParameters: compiled.pageParameters,
    inferredInputs: compiled.template.slots.map((slot) => [...slot.vars].sort()),
  };
}
