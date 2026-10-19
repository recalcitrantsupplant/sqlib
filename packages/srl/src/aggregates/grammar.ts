import { type ImplArgs, type ParserRule } from '@traqula/core';
import { gram as g, lex as l } from '@traqula/rules-sparql-1-1';
import { srlGroupBody } from '../grammar.js';
import type { SrlAggregate, SrlBodyItem } from '../ast.js';
import { assignOp } from '../tokens.js';

/**
 * The `GROUP` body element: aggregation, as proposed for SPARQL-RL in
 * w3c/data-shapes#1344 and given its grammar in w3c/data-shapes#1347.
 *
 *     GROUP BY ?c { ?x :employee ?c ; :salary ?s } [ ?n := COUNT(*) ?t := SUM(?s) ]
 *
 * From the PR's BNF:
 *
 *     [22] GroupAggregate        ::= 'GROUP' ( 'BY' ListVars )? '{' GroupPattern '}'
 *                                    ( ANON | '[' AggregationAssignment+ ']' )
 *     [23] GroupPattern          ::= BodyTriplesBlock? ( GroupPatternNotTriples '.'? BodyTriplesBlock? )*
 *     [24] GroupPatternNotTriples ::= Filter | Assignment
 *     [25] ListVars              ::= Var+
 *     [26] AggregationAssignment ::= Var ':=' AggregationFunction
 *     [27] AggregationFunction   ::= 'COUNT' '(' DISTINCT? VarOrStar ')'
 *                                  | 'MIN' '(' Var ')' | 'MAX' '(' Var ')' | 'SUM' '(' Var ')'
 *
 * The block of assignments is mandatory, written `[]` when empty, because it is
 * what marks the end of the element: a triple pattern after a `GROUP` can start
 * with `(`, so without a closing token a one-token-lookahead parser could not
 * tell where the element stops.
 *
 * Two parts of the rule are wider here than [23] and [27], and narrowed after
 * parsing (see `checkAggregatePlacement` in ../parse.ts), so that a document
 * outside the BNF gets a message naming what is wrong rather than a token
 * error:
 *
 * - the pattern is parsed as a rule body, and a `NOT` or a nested `GROUP` in
 *   it is refused afterwards;
 * - the functions are parsed with SPARQL's aggregate rule, and `AVG`,
 *   `SAMPLE`, `GROUP_CONCAT`, an expression argument, and `DISTINCT` outside
 *   `COUNT` are refused afterwards.
 *
 * Kept in its own module, as the rule-tuples extension is, and gated by
 * `parseRuleSet(text, { aggregates: true })` until the PR is merged.
 */

/** The parse context's mode set, which decides where an aggregate may appear. */
interface AggregateParseContext {
  parseMode: Set<string>;
}

/** A `?var` token carries its name on `.value`. */
function varName(term: unknown): string {
  return String((term as { value?: unknown } | null | undefined)?.value ?? '');
}

export const srlAggregate: ParserRule<unknown, 'srlAggregate', SrlAggregate> = {
  name: 'srlAggregate',
  impl:
    ({ ACTION, CONSUME, CONSUME2, SUBRULE, SUBRULE2, SUBRULE3, OR, OPTION, AT_LEAST_ONE, AT_LEAST_ONE2 }: ImplArgs) =>
    (context) => {
      // The builder's context is untyped here (see ../grammar.ts); what this
      // rule reads from it is the parse-mode set every Traqula context has.
      const C = context as AggregateParseContext;
      CONSUME(l.groupByGroup);
      const keys: string[] = [];
      OPTION(() => {
        CONSUME(l.by);
        AT_LEAST_ONE(() => {
          const key = SUBRULE(g.var_);
          ACTION(() => keys.push(varName(key)));
        });
      });
      CONSUME(l.symbols.LCurly);
      const body = SUBRULE(srlGroupBody);
      CONSUME(l.symbols.RCurly);
      const assignments: Array<{ variable: string; aggregate: unknown }> = [];
      OR([
        { ALT: () => { CONSUME(l.terminals.anon); } },
        {
          ALT: () => {
            CONSUME(l.symbols.LSquare);
            AT_LEAST_ONE2(() => {
              const variable = SUBRULE2(g.var_);
              CONSUME2(assignOp);
              // Traqula refuses an aggregate outside SELECT, HAVING and ORDER
              // BY unless the parse mode says otherwise. This is the one place
              // SRL wants one, so the mode is switched on for exactly this call.
              ACTION(() => C.parseMode.add('canParseAggregate'));
              const aggregate = SUBRULE3(g.aggregate);
              ACTION(() => C.parseMode.delete('canParseAggregate'));
              ACTION(() => assignments.push({ variable: varName(variable), aggregate }));
            });
            CONSUME(l.symbols.RSquare);
          },
        },
      ]);
      return ACTION((): SrlAggregate => ({
        kind: 'aggregate',
        keys,
        body: body as SrlBodyItem[],
        assignments,
      }));
    },
};
