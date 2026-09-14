import { Parser } from '@traqula/parser-sparql-1-2';
import { Generator } from '@traqula/generator-sparql-1-2';
import { AstFactory } from '@traqula/rules-sparql-1-2';
import type {
  SparqlQuery,
  PatternValues,
  ValuePatternRow,
  TermIri,
  TermLiteral,
  TermVariable,
} from '@traqula/rules-sparql-1-2';
import { logger, SeverityNumber } from './logger.js'; // Import OTEL logger
// Term serialisation, templates and page-parameter substitution live in
// @sparql-query-lib/runtime: they are the half of this file that needs no parser,
// and an exported bundle runs them in the browser. Importing rather than copying
// is what makes "the client substitutes exactly as the server does" true by
// construction (`docs/guides/static-export.md`).
import {
  alignArgumentSets,
  applyTemplateArguments,
  isSafeVariableName,
  serializeIri,
  serializeTerm,
  substituteLimitOffset,
  type QueryTemplate,
  type TemplateArgumentSet,
  type TemplateSlot,
  type TermValue,
} from '@sparql-query-lib/runtime';

// The Traqula parse result (a SPARQL 1.2 query or update AST).
export type ParsedSparql = SparqlQuery;

// A VALUES term as inserted by applyArguments (concrete IRI or literal, never UNDEF).
type ValuesTerm = TermIri | TermLiteral;

// Traqula's 1.2 PatternValues type omits `variables`, but the parser emits it at
// runtime (as in 1.1). Augment the type so we can read the declared variables.
type ValuesPattern = PatternValues & { variables: TermVariable[] };

/**
 * A parameter group whose VALUES clause sits inside a FILTER EXISTS / NOT EXISTS and
 * declares a variable that the enclosing scope also binds.
 *
 * SPARQL 1.1 does not define how inline data inside EXISTS is evaluated, and SEP-0007
 * ("Injection of Values for Variables") proposes forbidding VALUES in EXISTS from using
 * current-row variables outright. Substitution itself is unaffected — by the time the
 * endpoint sees the query the rows are concrete terms — but the *meaning* of the result
 * is engine-dependent, so the same parameterised query can return different answers on
 * different endpoints.
 */
export interface CorrelatedExistsInput {
  /** The parameter group's declared variables (bare names, sorted). */
  parameters: string[];
  /** Group variables that the scope enclosing the EXISTS also binds (bare names, sorted). */
  correlatedVariables: string[];
}

// Define a structure for the return type of detectInputs
export interface DetectedParameters { // Add export keyword
  valuesInputs: string[][];
  limitParameters: string[]; // Stores all full matched placeholders, e.g., ["LIMIT 001"]
  offsetParameters: string[]; // Stores all full matched placeholders, e.g., ["OFFSET 002"]
  /** Advisory portability warnings; empty for the overwhelming majority of queries. */
  correlatedExistsInputs: CorrelatedExistsInput[];
  // havingParameters?: string[]; // Placeholder for future implementation
}

/** Where in the pattern tree a VALUES clause was found, as tracked during traversal. */
interface ValuesScope {
  /** True when the pattern sits inside a FILTER EXISTS / NOT EXISTS group. */
  insideExists: boolean;
  /** Variables bound along the path to this pattern, including the current group. */
  bound: ReadonlySet<string>;
  /** Snapshot of `bound` taken just outside the nearest enclosing EXISTS, if any. */
  existsOuter: ReadonlySet<string> | null;
}

/**
 * Shape of a single argument value as supplied in the SPARQL Results JSON style
 * argument sets consumed by {@link SparqlQueryParser.applyArguments}.
 */
interface ArgumentValue {
  type: 'uri' | 'literal' | string;
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

/** How a parameter slot is rewritten when it has no bound rows. */
type EmptyArgumentMode = 'unconstrained' | 'propagateEmpty' | 'require';

interface ApplyArgumentSet {
  head: { vars: string[] };
  arguments: { bindings: Array<Record<string, ArgumentValue | null | undefined>> };
  whenEmpty?: EmptyArgumentMode;
}

/**
 * The parts of a parsed UPDATE operation that `removeValuesPatterns` rewrites.
 *
 * The parsed operation is a union across every UPDATE form and most members
 * carry none of these lists, so it is narrowed to just the three the pruning
 * touches rather than widened to `any`.
 */
interface PrunableOperation {
  insert?: unknown[];
  delete?: unknown[];
  where?: { patterns?: unknown[] };
}

/** Marker IRI scheme used to locate parameter slots in generated query text. */
const SLOT_MARKER_PREFIX = 'urn:sqlib:template-slot:';

/**
 * Cap on compiled templates held per parser instance. Templates are keyed by
 * query text, so the population is bounded by the library's distinct query
 * versions; the cap only matters for ad-hoc/unsaved query execution, where it
 * degrades to the AST path rather than growing without bound.
 */
const TEMPLATE_CACHE_LIMIT = 500;

export class SparqlQueryParser {
  private parser: Parser;
  private generator: Generator;
  private factory: AstFactory;
  /**
   * Compiled templates by query text. A `null` entry is a *negative* result —
   * this query could not be compiled or failed verification — cached so the
   * compile is not retried on every request.
   */
  private templateCache = new Map<string, QueryTemplate | null>();

  constructor() {
    // Traqula's SPARQL 1.2 engine natively parses/generates RDF-star triple terms,
    // replacing sparqljs's `sparqlStar: true` option. Parser/Generator instances are
    // stateful and not parallel-safe, so each SparqlQueryParser owns its own pair.
    this.parser = new Parser();
    this.generator = new Generator();
    this.factory = new AstFactory();
  }

  /**
   * Check whether a VALUES pattern is a reserved *parameter slot*: exactly one row,
   * every declared variable UNDEF. Blocks that merely contain an all-UNDEF row
   * alongside real rows are author data and are never rewritten.
   * @param pattern The VALUES pattern to check
   * @returns True if the pattern is a parameter slot, false otherwise
   */
  private isParameterSlot(pattern: { subType?: string; values?: ValuePatternRow[] }): boolean {
    if (pattern.subType !== 'values' || !Array.isArray(pattern.values)) return false;
    // In Traqula a VALUES row is keyed by the bound variable names; an UNDEF binding
    // is stored as that key mapping to `undefined`. A row is "all UNDEF" when every
    // declared value is undefined.
    return pattern.values.length === 1 && this.isAllUndefRow(pattern.values[0]);
  }

  /** True if the VALUES row binds no variables (every value is UNDEF). */
  private isAllUndefRow(row: ValuePatternRow): boolean {
    const vals = Object.values(row);
    return vals.length > 0 && vals.every(value => value === undefined);
  }

  /** Variable names (bare, without `?`) declared by a VALUES pattern. */
  private valuesVariableNames(pattern: ValuesPattern): string[] {
    return Array.isArray(pattern.variables)
      ? pattern.variables.map(v => v.value)
      : [];
  }

  /**
   * Parse a SPARQL query string into a structured object
   * @param queryString The SPARQL query string to parse
   * @returns The parsed query object
   */
  parseQuery(queryString: string): ParsedSparql {
    try {
      return this.parser.parse(queryString);
    } catch (error) {
      throw new Error(`Failed to parse SPARQL query: ${(error as Error).message}`);
    }
  }

  /**
   * Format a parsed SPARQL query/update back into a pretty-printed string.
   */
  formatQuery(parsedQuery: ParsedSparql): string {
    return this.generator.generate(parsedQuery);
  }

  /**
   * Walk the pattern tree of a group/where clause, invoking `onValues` for every
   * VALUES pattern encountered (recursing through groups, unions, optionals, graphs,
   * services, minus, FILTER EXISTS/NOT EXISTS and nested sub-SELECTs).
   */
  private walkPatternsForValues(
    patterns: unknown[] | undefined,
    onValues: (pattern: ValuesPattern, scope: ValuesScope) => void,
  ): void {
    if (!Array.isArray(patterns)) return;

    // The tree is a union of heterogeneous node shapes walked by structural dispatch;
    // a permissive node type keeps the traversal readable without a guard per branch.
    const visit = (node: any, scope: ValuesScope): void => {
      if (!node || typeof node !== 'object') return;

      if (node.type === 'pattern') {
        if (node.subType === 'values') {
          onValues(node as ValuesPattern, scope);
          return;
        }
        if (node.subType === 'filter') {
          const expr = node.expression;
          // FILTER EXISTS / NOT EXISTS carries a pattern group in `args`. Anything the
          // enclosing group binds is the "current row" the EXISTS body is correlated with,
          // so snapshot it here — before the body's own variables widen `bound`.
          if (expr && expr.subType === 'patternOperation' && expr.args && Array.isArray(expr.args.patterns)) {
            visitGroup(expr.args.patterns, { insideExists: true, bound: scope.bound, existsOuter: scope.bound });
          }
          return;
        }
        // group / optional / union / minus / graph / service all expose a `patterns` array.
        if (Array.isArray(node.patterns)) {
          visitGroup(node.patterns, scope);
        }
        return;
      }

      // Nested sub-SELECT: recurse into its WHERE group.
      if (node.type === 'query' && node.where && Array.isArray(node.where.patterns)) {
        visitGroup(node.where.patterns, scope);
      }
    };

    // Descend into a pattern list, widening the scope with the variables that list binds.
    const visitGroup = (group: unknown[], scope: ValuesScope): void => {
      const bound = new Set(scope.bound);
      this.findVariablesInPatterns(group).forEach(v => bound.add(v));
      const inner: ValuesScope = { ...scope, bound };
      group.forEach(node => visit(node, inner));
    };

    visitGroup(patterns, { insideExists: false, bound: new Set<string>(), existsOuter: null });
  }

  /** Run `onValues` over every VALUES pattern reachable from a parsed query/update. */
  private forEachValuesPattern(
    parsedQuery: ParsedSparql,
    onValues: (pattern: ValuesPattern, scope: ValuesScope) => void,
  ): void {
    if (parsedQuery.type === 'update') {
      parsedQuery.updates.forEach(entry => {
        // Only INSERT/DELETE-style operations carry templates and a WHERE clause.
        const op = entry?.operation as {
          insert?: unknown[];
          delete?: unknown[];
          where?: { patterns?: unknown[] };
        } | undefined;
        if (!op) return;
        this.walkPatternsForValues(op.insert, onValues);
        this.walkPatternsForValues(op.delete, onValues);
        if (op.where && Array.isArray(op.where.patterns)) {
          this.walkPatternsForValues(op.where.patterns, onValues);
        }
      });
    } else {
      const where = parsedQuery.where;
      if (where && Array.isArray(where.patterns)) {
        this.walkPatternsForValues(where.patterns, onValues);
      }
    }
  }

  /**
   * Detect parameter groups (variables marked with UNDEF in VALUES clauses) in a SPARQL query.
   * @param queryString The SPARQL query string to analyze
   * @returns An object containing detected parameter groups (VALUES) and specific LIMIT/OFFSET parameters.
   */
  detectInputs(queryString: string): DetectedParameters {
    logger.emit({ severityNumber: SeverityNumber.DEBUG, body: 'Starting detectInputs for query:', attributes: { query: queryString } });

    const result: DetectedParameters = {
      valuesInputs: [],
      limitParameters: [],
      offsetParameters: [],
      correlatedExistsInputs: [],
    };

    // --- Detect parameterized LIMIT/OFFSET using regex on the raw string ---
    // Match "LIMIT" followed by whitespace, "000", and capture the integer parameter name
    const limitRegex = /\bLIMIT\s+000(\d+)\b/gi; // Case-insensitive, word boundary, digits only
    let limitMatch;
    while ((limitMatch = limitRegex.exec(queryString)) !== null) {
      result.limitParameters.push(limitMatch[1]);
      logger.emit({ severityNumber: SeverityNumber.DEBUG, body: 'Detected parameterized LIMIT:', attributes: { paramName: limitMatch[1] } });
    }

    // Match "OFFSET" followed by whitespace, "000", and capture the integer parameter name
    const offsetRegex = /\bOFFSET\s+000(\d+)\b/gi; // Case-insensitive, word boundary, digits only
    let offsetMatch;
    while ((offsetMatch = offsetRegex.exec(queryString)) !== null) {
      result.offsetParameters.push(offsetMatch[1]);
      logger.emit({ severityNumber: SeverityNumber.DEBUG, body: 'Detected parameterized OFFSET:', attributes: { paramName: offsetMatch[1] } });
    }
    // --- End LIMIT/OFFSET detection ---

    // --- Detect VALUES parameters ---
    const parsedQuery = this.parseQuery(queryString);

    this.forEachValuesPattern(parsedQuery, (pattern, scope) => {
      if (pattern.values && pattern.values.length > 0 && this.isParameterSlot(pattern)) {
        const parameters = this.valuesVariableNames(pattern).slice().sort();
        if (parameters.length > 0) {
          logger.emit({ severityNumber: SeverityNumber.DEBUG, body: 'Found VALUES inputs:', attributes: { parameters: parameters.join(', ') } });
          result.valuesInputs.push(parameters);

          // A parameter group inside EXISTS that reuses an enclosing variable lands in the
          // territory SEP-0007 calls undefined; warn rather than reject, since real endpoints
          // do evaluate it — they just don't all agree on what it means.
          const correlatedVariables = scope.insideExists && scope.existsOuter
            ? parameters.filter(name => scope.existsOuter!.has(name))
            : [];
          if (correlatedVariables.length > 0) {
            result.correlatedExistsInputs.push({ parameters, correlatedVariables });
            logger.emit({
              severityNumber: SeverityNumber.WARN,
              body: `Parameter group [${parameters.join(', ')}] is declared by a VALUES clause inside FILTER EXISTS / NOT EXISTS and shares variable(s) [${correlatedVariables.join(', ')}] with the enclosing scope. SPARQL 1.1 leaves this case undefined (see SEP-0007), so results may differ between endpoints.`,
              attributes: { parameters: parameters.join(', '), correlatedVariables: correlatedVariables.join(', ') },
            });
          }
        }
      }
    });
    // --- End VALUES detection ---

    return result;
  }

  // Helper function to find variables within expressions (used in FILTER, BIND, etc.)
  private findVariablesInExpression(expression: any): Set<string> {
    const variables = new Set<string>();
    if (!expression || typeof expression !== 'object') return variables;

    if (expression.type === 'term' && expression.subType === 'variable') {
      variables.add(expression.value);
    } else if (expression.type === 'expression') {
      // operation / functionCall carry an `args` array; aggregate carries `expression`.
      const children: any[] = Array.isArray(expression.args)
        ? expression.args
        : Array.isArray(expression.expression)
          ? expression.expression
          : [];
      children.forEach((arg: any) => {
        this.findVariablesInExpression(arg).forEach(v => variables.add(v));
      });
    }

    return variables;
  }

  // Helper function to recursively find variables in patterns
  private findVariablesInPatterns(patterns: any[]): Set<string> {
    const variables = new Set<string>();

    const addIfVariable = (term: any) => {
      if (term && term.type === 'term' && term.subType === 'variable') {
        variables.add(term.value);
      }
    };

    const processPattern = (pattern: any) => {
      if (!pattern || typeof pattern !== 'object') return;

      if (pattern.type === 'pattern') {
        switch (pattern.subType) {
          case 'bgp':
            (pattern.triples || []).forEach((triple: any) => {
              addIfVariable(triple.subject);
              addIfVariable(triple.predicate);
              addIfVariable(triple.object);
            });
            break;
          case 'bind':
            addIfVariable(pattern.variable);
            if (pattern.expression) {
              this.findVariablesInExpression(pattern.expression).forEach(v => variables.add(v));
            }
            break;
          case 'filter':
            if (pattern.expression) {
              this.findVariablesInExpression(pattern.expression).forEach(v => variables.add(v));
            }
            break;
          case 'values':
            this.valuesVariableNames(pattern).forEach(v => variables.add(v));
            break;
          // group / optional / graph / service / minus / union expose nested patterns.
          // Sub-SELECT variables are locally scoped, so (as before) we don't descend into them.
          default:
            if (Array.isArray(pattern.patterns)) {
              this.findVariablesInPatterns(pattern.patterns).forEach(v => variables.add(v));
            }
            break;
        }
      }
    };

    patterns.forEach(processPattern);
    return variables;
  }

  /**
   * Detect output variables or aliased expressions in a SELECT query.
   * Returns the names as they would appear in the SPARQL JSON results header.
   * Handles SELECT * by finding variables in the WHERE clause.
   * @param queryString The SPARQL query string to analyze
   * @returns Array of output variable/alias names for SELECT queries. Returns an empty array for non-SELECT queries (including CONSTRUCT, ASK, DESCRIBE).
   */
  detectQueryOutputs(queryString: string): string[] {
    const parsedQuery = this.parseQuery(queryString);

    // Only SELECT queries have tabular output variables.
    if (parsedQuery.type !== 'query') {
      return []; // Return empty array for UPDATE queries
    }
    if (parsedQuery.subType !== 'select') {
      return []; // Return empty array for CONSTRUCT, ASK, DESCRIBE
    }

    const variables = parsedQuery.variables;
    if (!Array.isArray(variables)) {
      return []; // Return empty array for invalid SELECT
    }

    // A projected item is a variable term, an expression alias (bind pattern), or a Wildcard.
    type ProjectionItem = {
      type?: string;
      subType?: string;
      value?: string;
      variable?: { subType?: string; value?: string };
    };
    const items = variables as ProjectionItem[];

    // Check for SELECT * (a single Wildcard node in Traqula).
    const isSelectStar = items.length === 1 && items[0]?.type === 'wildcard';

    if (isSelectStar) {
      const where = parsedQuery.where;
      if (!where || !Array.isArray(where.patterns)) {
        return []; // No WHERE clause, no variables
      }
      const foundVariables = this.findVariablesInPatterns(where.patterns);
      return Array.from(foundVariables).sort();
    }

    // Explicit variables / aliases.
    const outputs: string[] = [];
    for (const item of items) {
      if (item?.type === 'term' && item.subType === 'variable' && item.value) {
        // Plain projected variable.
        outputs.push(item.value);
      } else if (item?.type === 'pattern' && item.subType === 'bind' && item.variable?.subType === 'variable' && item.variable.value) {
        // Expression alias: (<expr> AS ?alias)
        outputs.push(item.variable.value);
      }
      // Ignore items without a clear output variable name.
    }
    return outputs.sort();
  }

  /**
   * Collect the prefix declarations of a parsed query/update as [prefix, namespace]
   * pairs, sorted by descending namespace length (longest match first). Used to keep
   * inserted IRIs abbreviated, matching the previous sparqljs generator behaviour.
   */
  private collectPrefixes(parsedQuery: ParsedSparql): Array<[string, string]> {
    const map = new Map<string, string>();
    const addFrom = (context: unknown) => {
      if (!Array.isArray(context)) return;
      for (const def of context) {
        if (def && def.subType === 'prefix' && def.value && typeof def.value.value === 'string') {
          if (!map.has(def.key)) map.set(def.key, def.value.value);
        }
      }
    };
    if (parsedQuery.type === 'update') {
      parsedQuery.updates.forEach(entry => addFrom(entry?.context));
    } else {
      addFrom(parsedQuery.context);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }

  /**
   * Build a namedNode term for a full IRI, abbreviating it to `prefix:local` form when
   * one of the query's prefixes matches and the resulting local name is syntactically valid.
   */
  private buildIriTerm(iri: string, prefixes: Array<[string, string]>): TermIri {
    // Traqula's generator writes IRIs verbatim — it neither validates nor escapes
    // them — so an unchecked value here reaches the endpoint as query *syntax*.
    // `http://e/a> <http://e/b` used to render as two terms inside the VALUES
    // block, letting a caller widen a parameterised filter to rows of their
    // choosing. Validate before the term is built, so no caller of this method
    // can forget to. See sparql-terms.ts and parser.injection.test.ts.
    serializeIri(iri);
    const loc = this.factory.gen();
    for (const [prefix, namespace] of prefixes) {
      if (namespace && iri.startsWith(namespace) && namespace.length > 0) {
        const local = iri.slice(namespace.length);
        // Conservative PN_LOCAL check: keep it prefixed only when unambiguous.
        if (local.length > 0 && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(local) && !local.endsWith('.')) {
          return this.factory.termNamed(loc, local, prefix);
        }
      }
    }
    return this.factory.termNamed(loc, iri);
  }

  /**
   * Build a Traqula VALUES term node for an argument value.
   * Only 'uri' and 'literal' argument types are supported (matching SPARQL VALUES semantics).
   */
  private buildValuesTerm(argValue: ArgumentValue, varName: string, argSetIndex: number, prefixes: Array<[string, string]>): ValuesTerm {
    // Validate through the same serializer the splice path uses, and discard the
    // string: one definition of "is this value representable", so the two paths
    // cannot drift into accepting different inputs. It covers the IRI, the
    // datatype IRI and the language tag — none of which Traqula's generator checks.
    serializeTerm(argValue as TermValue, `for variable '${varName}' in argument set ${argSetIndex + 1}`);
    const loc = this.factory.gen();
    if (argValue.type === 'uri') {
      return this.buildIriTerm(argValue.value, prefixes);
    }
    if (argValue.type === 'literal') {
      const datatype = argValue.datatype;
      const lang = argValue['xml:lang'];
      if (datatype) {
        // Datatype takes precedence over language (RDF 1.1).
        return this.factory.termLiteral(loc, argValue.value, this.factory.termNamed(this.factory.gen(), datatype));
      }
      if (lang) {
        return this.factory.termLiteral(loc, argValue.value, lang);
      }
      return this.factory.termLiteral(loc, argValue.value, undefined);
    }
    throw new Error(`Invalid argument type '${argValue.type}' for variable '${varName}' in argument set ${argSetIndex + 1}. Only 'uri' and 'literal' are supported.`);
  }

  /**
   * Applies structured arguments to a SPARQL query by replacing UNDEF values in matching VALUES clauses.
   * Each argument set in the input array should correspond to one VALUES clause with an UNDEF row, matched in order of appearance.
   *
   * @param queryString The original SPARQL query string.
   * @param argumentSets An array of argument sets, each mimicking SPARQL Results JSON but with an 'arguments' object containing a 'bindings' array.
   *                     Example: [{ head: { vars: ["var1", "var2"] }, arguments: { bindings: [{ var1: { type: "literal", value: "a" }, var2: { type: "uri", value: "http://example.com/a" } }] } }]
   * @returns The modified query string with arguments applied.
   * @throws Error if the number of UNDEF VALUES clauses doesn't match the number of argument sets,
   *         if variables in a VALUES clause don't match the corresponding argument set header,
   *         or if invalid argument types are provided.
   */
  applyArguments(queryString: string, argumentSets: ApplyArgumentSet[]): string {
    const template = this.getVerifiedTemplate(queryString);
    if (template) {
      return applyTemplateArguments(template, argumentSets as TemplateArgumentSet[]);
    }
    return this.applyArgumentsViaAst(queryString, argumentSets);
  }

  /**
   * Compile a query to a verified template, for callers that need the artifact
   * itself rather than a substituted query.
   *
   * `sqlib export` is the caller: a bundle carries templates, and shipping one
   * that had not passed {@link verifyTemplate} would hand the browser a splice
   * the server never agreed with. `null` means "this query cannot be exported" —
   * on the request path the same answer only means "take the AST path", which is
   * why the distinction is the caller's to make and not this method's.
   */
  compileVerifiedTemplate(queryString: string): QueryTemplate | null {
    return this.getVerifiedTemplate(queryString);
  }

  /**
   * The original AST rewrite: parse, mutate the slots, regenerate the whole query.
   *
   * Retained for two reasons. It is the fallback for any query the template
   * compiler declines (§`buildTemplate`), and it is the oracle the compiler
   * verifies against, so it defines correct behaviour by construction.
   */
  private applyArgumentsViaAst(queryString: string, argumentSets: ApplyArgumentSet[]): string {
    if (!Array.isArray(argumentSets)) {
      throw new Error("Invalid arguments format: Expected an array of argument sets.");
    }

    const parsedQuery = this.parseQuery(queryString);
    // VALUES patterns with an UNDEF row, in order of appearance, with their declared vars.
    const undefValuesPatterns: Array<{ pattern: ValuesPattern; variables: string[] }> = [];
    const patternsToRemove = new Set<ValuesPattern>();

    this.forEachValuesPattern(parsedQuery, (pattern) => {
      if (!this.isParameterSlot(pattern)) return; // Author data, never a slot to bind
      undefValuesPatterns.push({ pattern, variables: this.valuesVariableNames(pattern) });
    });

    // --- Now apply arguments to the found patterns ---
    if (undefValuesPatterns.length !== argumentSets.length) {
      throw new Error(`Mismatch: Found ${undefValuesPatterns.length} UNDEF VALUES clauses, but received ${argumentSets.length} argument sets.`);
    }

    // Prefixes declared by the query, used to keep inserted IRIs abbreviated.
    const prefixes = this.collectPrefixes(parsedQuery);

    /*
     * Pair sets with patterns by the variables they name, not by arrival order —
     * the same alignment the runtime does, imported rather than repeated, so
     * what an exported page previews is what this substitutes. A payload with no
     * matching arrangement keeps the caller's order, leaving the per-pattern
     * checks below to report the mismatch.
     */
    const ordered =
      alignArgumentSets(
        undefValuesPatterns.map(({ variables }) => variables),
        argumentSets,
      ) ?? argumentSets;

    undefValuesPatterns.forEach(({ pattern, variables }, index) => {
      const argSet = ordered[index];

      // Validate argument set structure
      if (!argSet || !argSet.head || !Array.isArray(argSet.head.vars) || !argSet.arguments || !Array.isArray(argSet.arguments.bindings)) {
        throw new Error(`Invalid structure for argument set at index ${index}. Expected { head: { vars: [...] }, arguments: { bindings: [...] } }.`);
      }

      const patternVars = [...variables].sort();
      const argVars = [...argSet.head.vars].sort() as string[]; // Sort copies for comparison

      if (patternVars.length !== argVars.length || !patternVars.every((v: string, i: number) => v === argVars[i])) {
        throw new Error(`Variable mismatch for VALUES clause ${index + 1}. Query expects [${patternVars.join(', ')}], arguments provide [${argVars.join(', ')}].`);
      }

      const bindings = argSet.arguments.bindings;
      const isAllUndef = (row: Record<string, ArgumentValue | null | undefined> | null | undefined) =>
        row == null || Object.values(row).every(value => value == null);
      const wildcardRows = bindings.filter(isAllUndef);
      if (bindings.length > 1 && wildcardRows.length > 0) {
        throw new Error(`Invalid bindings for VALUES clause ${index + 1}: an all-UNDEF row cannot be mixed with bound rows.`);
      }
      const isWildcard = bindings.length === 1 && wildcardRows.length === 1;

      // `whenEmpty` governs an input that supplies no bound rows — either zero rows
      // or the pure singleton wildcard. It never discards rows the caller did supply.
      if (bindings.length === 0 || isWildcard) {
        const mode = argSet.whenEmpty ?? (isWildcard ? 'unconstrained' : 'propagateEmpty');
        if (mode === 'require') {
          throw new Error(`Required input for VALUES clause ${index + 1} received no bindings.`);
        }
        if (mode === 'unconstrained') {
          patternsToRemove.add(pattern);
        } else {
          // propagateEmpty: a zero-row VALUES joins to no solutions, faithfully
          // substituting the empty set that arrived.
          pattern.values = [];
        }
        return;
      }

      // Replace the reserved all-UNDEF parameter row with the supplied rows.
      pattern.values = [];
      bindings.forEach((argRow) => {
        const newRow: ValuePatternRow = {};
        argSet.head.vars.forEach((varName: string) => {
          const argValue = argRow[varName];
          if (argValue == null) {
            // UNDEF binding => key maps to undefined (matching Traqula's parsed rows).
            newRow[varName] = undefined;
            return;
          }
          newRow[varName] = this.buildValuesTerm(argValue, varName, index, prefixes);
        });
        pattern.values.push(newRow);
      });
    });

    if (patternsToRemove.size > 0) {
      this.removeValuesPatterns(parsedQuery, patternsToRemove);
    }
    // --- End Applying ---

    // The rewrite is total: every parameter slot resolves to bound rows, a zero-row
    // clause, removal, or an error. A surviving slot would ship an UNDEF wildcard to
    // the endpoint and silently run the query unconstrained, so fail loudly instead.
    this.forEachValuesPattern(parsedQuery, (pattern) => {
      if (this.isParameterSlot(pattern)) {
        throw new Error(
          `Argument application left an unresolved parameter slot for VALUES [${this.valuesVariableNames(pattern).join(', ')}].`
        );
      }
    });

    // Generate the modified query string
    return this.generator.generate(parsedQuery);
  }

  /**
   * Compile `queryString` to a template, verify it against the AST path, and cache
   * the outcome. Returns `null` when the query is not templatable or verification
   * failed — both mean "use the AST path", neither is an error.
   */
  private getVerifiedTemplate(queryString: string): QueryTemplate | null {
    const cached = this.templateCache.get(queryString);
    if (cached !== undefined) return cached;

    let template: QueryTemplate | null = null;
    try {
      template = this.buildTemplate(queryString);
      if (template && !this.verifyTemplate(queryString, template)) {
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          body: 'Query template failed verification against the AST path; falling back.',
        });
        template = null;
      }
    } catch {
      // Any surprise during compilation is a fallback, never a request failure.
      template = null;
    }

    if (this.templateCache.size >= TEMPLATE_CACHE_LIMIT) {
      // Cheap FIFO eviction: templates are equally valuable, so recency ranking
      // is not worth the bookkeeping.
      const oldest = this.templateCache.keys().next();
      if (!oldest.done) this.templateCache.delete(oldest.value);
    }
    this.templateCache.set(queryString, template);
    return template;
  }

  /**
   * Parse once and record each parameter slot's span in the canonical rendering.
   *
   * Traqula discards source positions (every node's `loc` is `autoGenerate`), so
   * spans cannot be read off the parse of the *original* text. Instead each slot is
   * filled with marker IRIs, the query is generated once, and the markers are
   * located in that output — which is also the text the template will splice into.
   *
   * Returns `null` for anything the splice path should not handle.
   */
  private buildTemplate(queryString: string): QueryTemplate | null {
    const parsed = this.parseQuery(queryString);

    const slots: Array<{ pattern: ValuesPattern; vars: string[] }> = [];
    this.forEachValuesPattern(parsed, (pattern) => {
      if (this.isParameterSlot(pattern)) {
        slots.push({ pattern, vars: this.valuesVariableNames(pattern) });
      }
    });

    // Collected before the slots are marked, so the table reflects the query as
    // authored. Inserted IRIs are abbreviated against it exactly as `buildIriTerm`
    // abbreviates them on the AST path.
    const prefixes = this.collectPrefixes(parsed);

    if (slots.length === 0) {
      // No slots: the template still earns its keep by removing the per-request
      // parse. `applyArguments` will reject a non-empty argument list on arity.
      return { text: this.generator.generate(parsed), slots: [], prefixes };
    }

    // A slot must declare variables we can re-emit verbatim; anything exotic
    // (unicode variable names) drops to the AST path rather than risking a rename.
    for (const slot of slots) {
      if (slot.vars.length === 0 || !slot.vars.every(isSafeVariableName)) return null;
      if (new Set(slot.vars).size !== slot.vars.length) return null;
    }

    slots.forEach((slot, index) => {
      const row: ValuePatternRow = {};
      for (const varName of slot.vars) {
        row[varName] = this.factory.termNamed(
          this.factory.gen(),
          `${SLOT_MARKER_PREFIX}${index}:${varName}`,
        );
      }
      slot.pattern.values = [row];
    });

    const text = this.generator.generate(parsed);

    const spans: TemplateSlot[] = [];
    for (let index = 0; index < slots.length; index++) {
      const span = SparqlQueryParser.locateSlotSpan(text, `${SLOT_MARKER_PREFIX}${index}:`);
      if (!span) return null;
      spans.push({ ...span, vars: slots[index].vars });
    }

    // Spans must be ordered and disjoint, or splicing would corrupt the output.
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].start < spans[i - 1].end) return null;
    }
    // No marker may survive outside a recorded span.
    for (const span of spans) {
      if (text.slice(span.start, span.end).indexOf(SLOT_MARKER_PREFIX) === -1) return null;
    }
    const outside = spans.reduceRight((acc, s) => acc.slice(0, s.start) + acc.slice(s.end), text);
    if (outside.includes(SLOT_MARKER_PREFIX)) return null;

    return { text, slots: spans, prefixes };
  }

  /**
   * Find the `VALUES ... { ... }` block containing every occurrence of `marker`.
   *
   * Safe because the marked block contains nothing but our own marker IRIs: no
   * string literals, so the first `}` after the last marker is the block's close,
   * and nothing between the keyword and the first marker can read as `VALUES`
   * except a variable spelled `?VALUES`, which the sigil check excludes.
   */
  private static locateSlotSpan(text: string, marker: string): { start: number; end: number } | null {
    const first = text.indexOf(marker);
    if (first === -1) return null;
    let last = first;
    for (;;) {
      const next = text.indexOf(marker, last + 1);
      if (next === -1) break;
      last = next;
    }

    const before = text.slice(0, first);
    const keyword = /\bVALUES\b/gi;
    let start = -1;
    let match: RegExpExecArray | null;
    while ((match = keyword.exec(before)) !== null) {
      const sigil = match.index > 0 ? before[match.index - 1] : '';
      if (sigil === '?' || sigil === '$') continue; // a variable named ?VALUES
      start = match.index;
    }
    if (start === -1) return null;

    const close = text.indexOf('}', last);
    if (close === -1) return null;
    return { start, end: close + 1 };
  }

  /**
   * Prove the template agrees with the AST path before trusting it.
   *
   * Probes deliberately include values designed to break out of their production,
   * so a serialisation regression shows up here as a build-time fallback rather
   * than as injected syntax at request time. Equality is checked semantically —
   * both outputs are reparsed and regenerated — because the two paths legitimately
   * differ in whitespace and in short-vs-long VALUES form.
   *
   * Costs roughly twice the probe count in parse+generate, once per distinct query.
   */
  private verifyTemplate(queryString: string, template: QueryTemplate): boolean {
    for (const probe of SparqlQueryParser.buildProbeArgumentSets(template)) {
      let expected: string;
      try {
        expected = this.applyArgumentsViaAst(queryString, probe as ApplyArgumentSet[]);
      } catch {
        // The oracle rejects this probe, so the template must reject it too.
        try {
          applyTemplateArguments(template, probe);
          return false;
        } catch {
          continue;
        }
      }
      let actual: string;
      try {
        actual = applyTemplateArguments(template, probe);
      } catch {
        return false;
      }
      if (!this.semanticallyEqual(expected, actual)) return false;
    }
    return true;
  }

  /** Compare two queries up to formatting by reparsing and regenerating both. */
  private semanticallyEqual(a: string, b: string): boolean {
    try {
      return this.generator.generate(this.parseQuery(a)) === this.generator.generate(this.parseQuery(b));
    } catch {
      return false;
    }
  }

  /** Probe argument sets covering the shapes and the hostile values that matter. */
  private static buildProbeArgumentSets(template: QueryTemplate): TemplateArgumentSet[][] {
    const hostile = 'a"\\\n}\r) UNDEF (<http://evil/x>';
    const perSlot = (vars: string[]): TemplateArgumentSet[] => {
      const row = (make: (v: string) => TermValue | null) =>
        Object.fromEntries(vars.map((v) => [v, make(v)]));
      const set = (
        bindings: Array<Record<string, TermValue | null>>,
        whenEmpty?: EmptyArgumentMode,
      ): TemplateArgumentSet => ({
        head: { vars },
        arguments: { bindings },
        ...(whenEmpty ? { whenEmpty } : {}),
      });
      const candidates: TemplateArgumentSet[] = [
        set([row(() => ({ type: 'uri', value: 'http://example.org/probe' }))]),
        set([row(() => ({ type: 'literal', value: hostile }))]),
        set([row(() => ({ type: 'literal', value: 'x', 'xml:lang': 'en-GB' }))]),
        set([
          row(() => ({ type: 'literal', value: '42', datatype: 'http://www.w3.org/2001/XMLSchema#integer' })),
        ]),
        set([
          row(() => ({ type: 'uri', value: 'http://example.org/a' })),
          row(() => ({ type: 'literal', value: 'second' })),
        ]),
        set([], 'propagateEmpty'),
        set([], 'unconstrained'),
        set([row(() => null)]),
      ];
      if (vars.length > 1) {
        // Partial UNDEF is only expressible when a row has more than one cell.
        candidates.push(set([row((v) => (v === vars[0] ? { type: 'literal', value: 'bound' } : null))]));
      }
      return candidates;
    };

    const perSlotCandidates = template.slots.map((slot) => perSlot(slot.vars));
    const rounds = Math.max(0, ...perSlotCandidates.map((c) => c.length));
    const probes: TemplateArgumentSet[][] = [];
    for (let round = 0; round < rounds; round++) {
      probes.push(perSlotCandidates.map((candidates) => candidates[round % candidates.length]));
    }
    if (template.slots.length === 0) probes.push([]);
    return probes;
  }

  /** Remove optional parameter slots rather than serializing an UNDEF wildcard. */
  private removeValuesPatterns(parsedQuery: ParsedSparql, remove: Set<ValuesPattern>): void {
    const prune = (patterns: unknown[] | undefined): unknown[] | undefined => {
      if (!Array.isArray(patterns)) return patterns;
      return patterns.flatMap((node: any) => {
        if (remove.has(node as ValuesPattern)) return [];
        if (node?.type === 'pattern' && Array.isArray(node.patterns)) node.patterns = prune(node.patterns);
        if (node?.type === 'pattern' && node.subType === 'filter' && Array.isArray(node.expression?.args?.patterns)) {
          node.expression.args.patterns = prune(node.expression.args.patterns);
        }
        if (node?.type === 'query' && Array.isArray(node.where?.patterns)) node.where.patterns = prune(node.where.patterns);
        return [node];
      });
    };
    if (parsedQuery.type === 'update') {
      parsedQuery.updates.forEach(entry => {
        // Only the three pattern lists this function prunes are named. The
        // parsed-update operation is a union across every UPDATE form and most
        // members have none of these; the cast says which parts are touched
        // rather than surrendering the whole node to `any`.
        const op = entry?.operation as PrunableOperation | undefined;
        if (!op) return;
        op.insert = prune(op.insert);
        op.delete = prune(op.delete);
        if (op.where) op.where.patterns = prune(op.where.patterns);
      });
    } else if (parsedQuery.where) {
      (parsedQuery.where as { patterns?: unknown[] }).patterns = prune(parsedQuery.where.patterns);
    }
  }

  /**
   * Apply LIMIT and OFFSET parameter substitutions to a SPARQL query.
   * Replaces parameterized limits (e.g., "LIMIT 0001") and offsets (e.g., "OFFSET 0001")
   * with actual values using string-based replacement for accuracy.
   *
   * @param queryString - The SPARQL query string containing parameterized LIMIT/OFFSET clauses
   * @param limitParams - Array of limit parameter objects with name and value
   * @param offsetParams - Array of offset parameter objects with name and value
   * @returns The modified SPARQL query string with parameter placeholders replaced by actual values
   * @throws Error if the query cannot be parsed or parameter format is invalid
   */
  applyLimitOffsetParameters(
    queryString: string,
    limitParams: Array<{name: string, value: number}> = [],
    offsetParams: Array<{name: string, value: number}> = []
  ): string {
    // Validate that the query can be parsed (for error detection)
    this.parseQuery(queryString);

    // The substitution itself is the runtime's, so a page parameter behaves the
    // same whether it is applied here or in an exported bundle. The parse either
    // side of it is this path's own belt and braces — a browser has no parser and
    // relies instead on the runtime's validation of names and values.
    const modifiedQuery = substituteLimitOffset(queryString, limitParams, offsetParams);

    // Validate that the modified query can still be parsed
    try {
      this.parseQuery(modifiedQuery);
    } catch (error) {
      throw new Error(`Parameter substitution resulted in invalid SPARQL: ${(error as Error).message}`);
    }

    return modifiedQuery;
  }
}
