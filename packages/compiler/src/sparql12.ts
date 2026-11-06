/**
 * The SPARQL 1.2 parser and generator sqlib uses, with `LATERAL` added.
 *
 * `A LATERAL { B }` evaluates `B` once for each solution of `A`, with that
 * solution's bindings substituted into `B` (SEP-0006, part of the SPARQL 1.2
 * work, and run by Jena). A parameterised query needs it to feed a VALUES
 * parameter into a property function such as `text:query`: without it, Jena may
 * evaluate the two sides apart and hash-join them, and the property function
 * then runs with unbound arguments.
 *
 * Traqula 1.4.0 has no `LATERAL` rule, and it is built to have rules added, so
 * this module adds one to its 1.2 builders rather than forking them:
 *
 *  - a `LATERAL` keyword token, appended after the base vocabulary (the
 *    prefixed-name terminals come first, so `lateral:x` is still a name);
 *  - `LateralGraphPattern ::= 'LATERAL' GroupGraphPattern`, an alternative of
 *    `GraphPatternNotTriples`, which builds a `{ type: 'pattern', subType:
 *    'lateral', patterns }` node;
 *  - the generator rule that writes it back, so the canonical template text
 *    keeps the keyword.
 *
 * `Parser` and `Generator` are drop-in replacements for the Traqula classes of
 * the same name. Every place in sqlib that reads a stored query's text uses
 * these, so a query that saves also parses everywhere else.
 */
import { ParserBuilder, GeneratorBuilder, LexerBuilder, createToken } from '@traqula/core';
import { sparql12ParserBuilder } from '@traqula/parser-sparql-1-2';
import { sparql12GeneratorBuilder } from '@traqula/generator-sparql-1-2';
import { gram as g11 } from '@traqula/rules-sparql-1-1';
import {
  completeGeneratorContext,
  completeParseContext,
  copyParseContext,
  lex as l12,
  type Pattern,
  type PatternBase,
  type SparqlContext,
  type SparqlGeneratorContext,
  type SparqlQuery,
} from '@traqula/rules-sparql-1-2';

/** The `LATERAL` keyword. Case-insensitive, like every SPARQL keyword. */
export const lateralKeyword = createToken({ name: 'Lateral', pattern: /lateral/i, label: 'LATERAL' });

/** A `LATERAL { … }` pattern: its group's patterns, evaluated once per solution of what precedes it. */
export type PatternLateral = PatternBase & {
  subType: 'lateral';
  patterns: Pattern[];
};

/** True when a node is a `LATERAL { … }` pattern. */
export function isPatternLateral(node: unknown): node is PatternLateral {
  const candidate = node as { type?: unknown; subType?: unknown } | null | undefined;
  return candidate?.type === 'pattern' && candidate.subType === 'lateral';
}

/*
 * The builder DSL hands rule arguments back untyped once a rule is outside
 * Traqula's own type maps, as SRL's grammar (`packages/srl/src/grammar.ts`)
 * also finds. One permissive type here keeps the casts to these two rules.
 */
type AnyRule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** [SEP-0006] `LateralGraphPattern ::= 'LATERAL' GroupGraphPattern`. */
export const lateralGraphPattern: AnyRule = {
  name: 'lateralGraphPattern',
  impl:
    ({ ACTION, SUBRULE, CONSUME }: AnyRule) =>
    (C: AnyRule) => {
      const keyword = CONSUME(lateralKeyword);
      const group = SUBRULE(g11.groupGraphPattern);
      return ACTION(() => ({
        type: 'pattern',
        subType: 'lateral',
        patterns: group.patterns,
        loc: C.astFactory.sourceLocation(keyword, group),
      }));
    },
  gImpl:
    ({ SUBRULE, PRINT_WORD }: AnyRule) =>
    (ast: PatternLateral, { astFactory: F }: AnyRule) => {
      F.printFilter(ast, () => PRINT_WORD('LATERAL'));
      SUBRULE(g11.groupGraphPattern, F.patternGroup(ast.patterns, ast.loc));
    },
};

/**
 * [56] `GraphPatternNotTriples`, with `LateralGraphPattern` as one more
 * alternative. The other alternatives are Traqula's, unchanged; generation
 * hands every other node back to Traqula's own rule.
 */
export const graphPatternNotTriples: AnyRule = {
  name: g11.graphPatternNotTriples.name,
  impl:
    ({ SUBRULE, OR }: AnyRule) =>
    () =>
      OR([
        { ALT: () => SUBRULE(g11.groupOrUnionGraphPattern) },
        { ALT: () => SUBRULE(g11.optionalGraphPattern) },
        { ALT: () => SUBRULE(g11.minusGraphPattern) },
        { ALT: () => SUBRULE(g11.graphGraphPattern) },
        { ALT: () => SUBRULE(g11.serviceGraphPattern) },
        { ALT: () => SUBRULE(g11.filter) },
        { ALT: () => SUBRULE(g11.bind) },
        { ALT: () => SUBRULE(g11.inlineData) },
        { ALT: () => SUBRULE(lateralGraphPattern) },
      ]),
  gImpl: (args: AnyRule) => {
    const base = (g11.graphPatternNotTriples as AnyRule).gImpl(args);
    return (ast: AnyRule, C: AnyRule) => {
      if (isPatternLateral(ast)) {
        args.SUBRULE(lateralGraphPattern, ast);
        return;
      }
      base(ast, C);
    };
  },
};

/** The SPARQL 1.2 lexer with `LATERAL`. */
export const sqlibLexerBuilder = LexerBuilder.create(l12.sparql12LexerBuilder).add(lateralKeyword);

/** The SPARQL 1.2 parser builder with `LATERAL`. */
export const sqlibParserBuilder = (ParserBuilder.create(sparql12ParserBuilder) as AnyRule)
  .addRule(lateralGraphPattern)
  .patchRule(graphPatternNotTriples) as typeof sparql12ParserBuilder;

/** The SPARQL 1.2 generator builder with `LATERAL`. */
export const sqlibGeneratorBuilder = (GeneratorBuilder.create(sparql12GeneratorBuilder) as AnyRule)
  .addRule(lateralGraphPattern)
  .patchRule(graphPatternNotTriples) as typeof sparql12GeneratorBuilder;

/**
 * Parses SPARQL 1.2 text, `LATERAL` included. Same API as Traqula's `Parser`.
 * An instance is stateful and not parallel-safe, like Traqula's.
 */
export class Parser {
  private readonly parser: AnyRule;
  protected readonly defaultContext: SparqlContext;

  constructor(args: { defaultContext?: Partial<SparqlContext> } = {}) {
    this.parser = sqlibParserBuilder.build({ tokenVocabulary: sqlibLexerBuilder.tokenVocabulary });
    this.defaultContext = completeParseContext(args.defaultContext ?? {});
  }

  /** Parse a query or update, from the QueryUnit or UpdateUnit rule. */
  parse(query: string, context: Partial<SparqlContext> = {}): SparqlQuery {
    const ast = this.parser.queryOrUpdate(query, copyParseContext({ ...this.defaultContext, ...context }));
    ast.loc = this.defaultContext.astFactory.sourceLocationInlinedSource(query, ast.loc, 0, Number.MAX_SAFE_INTEGER);
    return ast as SparqlQuery;
  }
}

/** Writes a SPARQL 1.2 AST back to text, `LATERAL` included. Same API as Traqula's `Generator`. */
export class Generator {
  private readonly generator: AnyRule = sqlibGeneratorBuilder.build();
  private readonly defaultContext: SparqlGeneratorContext;

  constructor(defaultContext: Partial<SparqlGeneratorContext> = {}) {
    this.defaultContext = completeGeneratorContext(defaultContext);
  }

  /** Generate a query or update. */
  generate(ast: SparqlQuery, context: Partial<SparqlGeneratorContext> = {}): string {
    return (this.generator.queryOrUpdate(ast, { ...this.defaultContext, ...context }) as string).trim();
  }
}
