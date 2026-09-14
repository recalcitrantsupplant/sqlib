import { createToken } from '@traqula/core';
import { gram as g, lex as l } from '@traqula/rules-sparql-1-1';

/**
 * Rule-tuples extension (w3c/data-shapes#752).
 *
 * Syntax: `TUPLE( term, term, … )` — usable as a body pattern (match against the
 * ephemeral tuple store) and as a head template (emit a grounded tuple).
 *
 * Long form only: the issue's `$( … )` shorthand is deliberately not supported,
 * because `$` is already SPARQL's alternative variable sigil (`$var`), making
 * `$(` ambiguous to lex.
 *
 * Kept in its own module so the extension stays separable from the base SRL
 * grammar (see plan §12 on upstreaming). Acceptance is gated by
 * `parseRuleSet(text, { tuples: true })`.
 */
export const tupleKeyword = createToken({ name: 'SrlTuple', pattern: /tuple/i, label: 'TUPLE' });

export const srlTuple = {
  name: 'srlTuple',
  impl:
    ({ ACTION, CONSUME, SUBRULE, MANY }: any) =>
    (_C: any) => {
      CONSUME(tupleKeyword);
      CONSUME(l.symbols.LParen);
      const terms: unknown[] = [];
      // At least one term; subsequent terms are comma-separated.
      terms.push(SUBRULE(g.varOrTerm));
      MANY(() => {
        CONSUME(l.symbols.comma);
        terms.push(SUBRULE(g.varOrTerm));
      });
      CONSUME(l.symbols.RParen);
      return ACTION(() => ({ terms }));
    },
};

/**
 * A tuple-seed document: the contents of the UI's second box.
 *
 * `prologue? ( TUPLE( … ) '.'? )*` — the rows a ruleset's tuple store starts
 * with. A **ground** row is a value seeded straight into the store; a row
 * carrying variables is a bare *declaration* of an input the caller supplies.
 *
 * Deliberately its own top-level production rather than an extension of
 * `DATA { }`: a `DATA` block means "ground triples for the RDF graph", and
 * tuples explicitly never enter that graph — so a conformant-looking `DATA`
 * block would end up holding non-conformant content.
 *
 * A prologue is accepted here so the box can stand alone (`parseTupleSeeds` is
 * usable on its own text); in the UI the ruleset's prefixes are prepended, so a
 * seed row may use the same prefixes the document declares.
 */
export const srlTupleSeedDoc = {
  name: 'srlTupleSeedDoc',
  impl:
    ({ ACTION, CONSUME, SUBRULE, MANY, OPTION, OR }: any) =>
    (_C: unknown) => {
      const prologue: unknown[] = [];
      const rows: unknown[] = [];
      MANY(() => {
        OR([
          { ALT: () => prologue.push(SUBRULE(g.baseDecl)) },
          { ALT: () => prologue.push(SUBRULE(g.prefixDecl)) },
          { ALT: () => rows.push(SUBRULE(srlTuple)) },
        ]);
        OPTION(() => CONSUME(l.symbols.dot));
      });
      return ACTION(() => ({ prologue, rows }));
    },
};
