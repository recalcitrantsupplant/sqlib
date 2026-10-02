import { createToken } from '@traqula/core';
import { gram as g, lex as l } from '@traqula/rules-sparql-1-1';
import { srlGroupBody } from '../grammar.js';
import { assignOp } from '../tokens.js';

/**
 * Rule-aggregates extension (proposal in w3c/data-shapes#840).
 *
 * Syntax, as a rule body element:
 *
 *     AGGREGATE PER ?x { ?y :childOf ?x ; :age ?age }
 *               ( ?n := COUNT(*), ?oldest := MAX(?age) )
 *
 * The variable list after the keyword says how the aggregate joins the rest of
 * the body. There are three forms, and they differ only in that:
 *
 * - `PER ?x …` — the inner pattern sees `?x` (and only `?x`) from the outer
 *   body, and every outer row is kept, gaining the results. No list at all is
 *   the same form with nothing correlated: one result over the whole graph.
 * - `PER *` — the inner pattern sees every variable it shares with the
 *   elements before it. This is the implicit correlation suggested in the
 *   issue thread.
 * - `GROUP BY ?x …` — correlation as for `PER`, but the outer rows collapse:
 *   after the aggregate only the listed variables and the results are bound,
 *   as after a SPARQL `GROUP BY`.
 *
 * Kept in its own module so the extension stays separable from the base SRL
 * grammar, as the rule-tuples extension is. Acceptance is gated by
 * `parseRuleSet(text, { aggregates: true })`.
 */
export const aggregateKeyword = createToken({ name: 'SrlAggregate', pattern: /aggregate/i, label: 'AGGREGATE' });
export const perKeyword = createToken({ name: 'SrlPer', pattern: /per/i, label: 'PER' });

/** A `?var` token carries its name on `.value`. */
function varName(term: unknown): string {
  return String((term as { value?: unknown } | null | undefined)?.value ?? '');
}

export const srlAggregate = {
  name: 'srlAggregate',
  impl:
    ({
      ACTION, CONSUME, CONSUME2, SUBRULE, SUBRULE2, SUBRULE3, SUBRULE4, SUBRULE5, SUBRULE6,
      OR, OR2, OPTION, AT_LEAST_ONE, AT_LEAST_ONE2, MANY,
    }: any) =>
    (C: any) => {
      CONSUME(aggregateKeyword);
      let mode: 'per' | 'per-all' | 'group' = 'per';
      const keys: string[] = [];
      OPTION(() => {
        OR([
          {
            ALT: () => {
              CONSUME(perKeyword);
              OR2([
                {
                  ALT: () => {
                    CONSUME(l.symbols.star);
                    ACTION(() => { mode = 'per-all'; });
                  },
                },
                {
                  ALT: () => AT_LEAST_ONE(() => {
                    const key = SUBRULE(g.var_);
                    ACTION(() => keys.push(varName(key)));
                  }),
                },
              ]);
            },
          },
          {
            ALT: () => {
              CONSUME(l.groupByGroup);
              CONSUME(l.by);
              ACTION(() => { mode = 'group'; });
              AT_LEAST_ONE2(() => {
                const key = SUBRULE2(g.var_);
                ACTION(() => keys.push(varName(key)));
              });
            },
          },
        ]);
      });
      CONSUME(l.symbols.LCurly);
      const body = SUBRULE(srlGroupBody);
      CONSUME(l.symbols.RCurly);
      CONSUME(l.symbols.LParen);
      const assignments: Array<{ variable: string; aggregate: unknown }> = [];
      // Chevrotain identifies a grammar call by its method and occurrence
      // index, so the first assignment and the repeated ones need different
      // indices even though they parse the same thing.
      const assignment = (subVar: any, consumeAssign: any, subAggregate: any): void => {
        const variable = subVar(g.var_);
        consumeAssign(assignOp);
        // Traqula refuses an aggregate outside SELECT, HAVING and ORDER BY
        // unless the parse mode says otherwise. This is the one place SRL wants
        // one, so the mode is switched on for exactly this call.
        ACTION(() => C.parseMode.add('canParseAggregate'));
        const aggregate = subAggregate(g.aggregate);
        ACTION(() => C.parseMode.delete('canParseAggregate'));
        ACTION(() => assignments.push({ variable: varName(variable), aggregate }));
      };
      assignment(SUBRULE3, CONSUME, SUBRULE4);
      MANY(() => {
        CONSUME(l.symbols.comma);
        assignment(SUBRULE5, CONSUME2, SUBRULE6);
      });
      CONSUME(l.symbols.RParen);
      return ACTION(() => ({ kind: 'aggregate', mode, keys, body, assignments }));
    },
};
