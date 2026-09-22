import { ParserBuilder } from '@traqula/core';
import { sparql12ParserBuilder } from '@traqula/parser-sparql-1-2';
import { gram as g, lex as l } from '@traqula/rules-sparql-1-1';
import { srlTokenVocabulary } from './lexer.js';
import { assignOp, dataKeyword, notKeyword, ruleKeyword, setKeyword } from './tokens.js';
import { srlTuple, srlTupleSeedDoc, tupleKeyword } from './tuples/grammar.js';

/**
 * A `?var` token carries its name on `.value`. The builder DSL hands rules back
 * untyped, so reading it needs a cast — one here rather than one per caller.
 */
function varName(term: unknown): string {
  return String((term as { value?: unknown } | null | undefined)?.value ?? '');
}

/**
 * Body content (no surrounding braces): a sequence of SRL body items.
 * Reuses base SPARQL rules for the plain-SPARQL leaves (triples, filter,
 * expression) and adds SRL's `NOT { … }` and `SET ( ?v := expr )`.
 */
const srlGroupBody = {
  name: 'srlGroupBody',
  impl:
    ({ ACTION, CONSUME, SUBRULE, OR, MANY, OPTION, OPTION2 }: any) =>
    (_C: unknown) => {
      const items: any[] = [];
      MANY(() => {
        OR([
          {
            ALT: () => {
              CONSUME(notKeyword);
              // `NOT DATA { … }` (grammar rule [24]): the negated pattern is
              // matched against the ground graph rather than the evaluation
              // graph, so a rule can ask "was this absent from the input?"
              // while the rest of its body still sees inferred triples.
              const ground = OPTION2(() => CONSUME(dataKeyword));
              CONSUME(l.symbols.LCurly);
              const body = SUBRULE(srlGroupBody);
              CONSUME(l.symbols.RCurly);
              items.push({ kind: 'not', body, data: Boolean(ground) });
            },
          },
          {
            ALT: () => {
              const filter = SUBRULE(g.filter);
              items.push({ kind: 'filter', filter });
            },
          },
          {
            ALT: () => {
              CONSUME(setKeyword);
              CONSUME(l.symbols.LParen);
              const variable = SUBRULE(g.var_);
              CONSUME(assignOp);
              const expr = SUBRULE(g.expression);
              CONSUME(l.symbols.RParen);
              items.push({ kind: 'set', variable: varName(variable), expr });
            },
          },
          {
            ALT: () => {
              const tuple = SUBRULE(srlTuple);
              items.push({ kind: 'tuple', tuple });
            },
          },
          {
            ALT: () => {
              const triples = SUBRULE(g.triplesBlock);
              items.push({ kind: 'bgp', triples });
            },
          },
        ]);
        OPTION(() => CONSUME(l.symbols.dot));
      });
      return ACTION(() => items);
    },
};

/** A head block: `{ constructTriples? }`, returning the BGP and its inner span. */
const srlHead = {
  name: 'srlHead',
  impl:
    ({ ACTION, CONSUME, OPTION, OR, MANY, SUBRULE }: any) =>
    (_C: unknown) => {
      const open = CONSUME(l.symbols.LCurly);
      let head: unknown;
      const tuples: unknown[] = [];
      MANY(() => {
        OR([
          { ALT: () => tuples.push(SUBRULE(srlTuple)) },
          // `constructTriples` itself consumes dot-separated triples, so at most
          // one of these fires unless tuples are interleaved between them.
          { ALT: () => { head = SUBRULE(g.constructTriples); } },
        ]);
        OPTION(() => CONSUME(l.symbols.dot));
      });
      const close = CONSUME(l.symbols.RCurly);
      return ACTION(() => ({ head, tuples, span: [open.startOffset + 1, close.startOffset] as const }));
    },
};

/** A body block: `{ srlGroupBody }`, returning the items and its inner span. */
const srlBodyBlock = {
  name: 'srlBodyBlock',
  impl:
    ({ ACTION, CONSUME, SUBRULE }: any) =>
    (_C: unknown) => {
      const open = CONSUME(l.symbols.LCurly);
      const body = SUBRULE(srlGroupBody);
      const close = CONSUME(l.symbols.RCurly);
      return ACTION(() => ({ body, span: [open.startOffset + 1, close.startOffset] as const }));
    },
};

/**
 * A single rule (grammar rule [11]):
 *   RULE <iri>? { head } WHERE DATA? { body }
 *
 * The optional `DATA` after `WHERE` makes the *whole* body match the ground
 * graph rather than the evaluation graph — the rule then reads only what was
 * given, never what has been inferred.
 */
const srlRule = {
  name: 'srlRule',
  impl:
    ({ ACTION, CONSUME, OPTION1, OPTION2, SUBRULE }: any) =>
    (_C: unknown) => {
      const kw = CONSUME(ruleKeyword);
      const name = OPTION1(() => SUBRULE(g.iri));
      const h = SUBRULE(srlHead);
      CONSUME(l.where);
      const ground = OPTION2(() => CONSUME(dataKeyword));
      const b = SUBRULE(srlBodyBlock);
      return ACTION(() => buildRule(kw, name, h, b, Boolean(ground)));
    },
};

function buildRule(kw: any, name: any, h: any, b: any, data: boolean) {
  return {
    // Keep the term so expandIris can expand it; parse.ts derives `name`.
    nameTerm: name,
    head: h.head,
    headTuples: h.tuples ?? [],
    body: b.body,
    data,
    headSpan: h.span,
    bodySpan: b.span,
    startOffset: kw.startOffset,
  };
}

/** A ground-triple DATA block: `DATA { triples? }`. */
const srlDataBlock = {
  name: 'srlDataBlock',
  impl:
    ({ ACTION, CONSUME, OPTION, SUBRULE }: any) =>
    (_C: unknown) => {
      const kw = CONSUME(dataKeyword);
      const open = CONSUME(l.symbols.LCurly);
      const triples = OPTION(() => SUBRULE(g.triplesBlock));
      const close = CONSUME(l.symbols.RCurly);
      return ACTION(() => ({ triples, span: [open.startOffset + 1, close.startOffset] as const, startOffset: kw.startOffset }));
    },
};

/**
 * A whole SRL document: prologue declarations, rules, and DATA blocks, in any
 * order (PREFIX/BASE may appear between rules — see W3C syntax-ruleset-structure).
 */
const srlRuleSet = {
  name: 'srlRuleSet',
  impl:
    ({ ACTION, SUBRULE, MANY, OR }: any) =>
    (_C: unknown) => {
      const prologue: any[] = [];
      const rules: any[] = [];
      const dataBlocks: any[] = [];
      MANY(() => {
        OR([
          { ALT: () => prologue.push(SUBRULE(g.baseDecl)) },
          { ALT: () => prologue.push(SUBRULE(g.prefixDecl)) },
          { ALT: () => rules.push(SUBRULE(srlRule)) },
          { ALT: () => dataBlocks.push(SUBRULE(srlDataBlock)) },
        ]);
      });
      return ACTION(() => ({ prologue, rules, dataBlocks }));
    },
};

// Typed `any` deliberately (see note in prior revision): concrete builder/parser
// types reference transitive chevrotain paths and are not portable in .d.ts.
export const srlParserBuilder: any = ParserBuilder.create(sparql12ParserBuilder as any)
  .addRule(srlTuple)
  .addRule(srlGroupBody)
  .addRule(srlHead)
  .addRule(srlBodyBlock)
  .addRule(srlDataBlock)
  .addRule(srlRule)
  .addRule(srlRuleSet)
  .addRule(srlTupleSeedDoc);

/*
 * Building the parser assembles the whole chevrotain grammar — the SPARQL 1.2
 * rules this extends, plus the SRL rules added above — which is ~100ms and by
 * far the most expensive thing this package does at import time. It is deferred
 * to first use so that importing `@sparql-query-lib/srl` is cheap: the API
 * imports it on every boot, including boots that never parse a rule.
 *
 * `srlParser` stays an object with the grammar's rules as methods, because that
 * is how both call sites use it (`srlParser.srlRuleSet(...)`). The proxy builds
 * on the first property read and then forwards everything, so the parser is
 * still constructed exactly once and shared.
 */
let builtSrlParser: any = null;

export function getSrlParser(): any {
  if (!builtSrlParser) {
    builtSrlParser = srlParserBuilder.build({ tokenVocabulary: srlTokenVocabulary as any });
  }
  return builtSrlParser;
}

export const srlParser: any = new Proxy({} as any, {
  get(_target, property) {
    const parser = getSrlParser();
    const value = parser[property];
    return typeof value === 'function' ? value.bind(parser) : value;
  },
  has(_target, property) {
    return property in getSrlParser();
  },
});
