import { completeParseContext, copyParseContext } from '@traqula/rules-sparql-1-2';
import { srlParser } from '../grammar.js';
import { extractPrologueText } from '../parse.js';
import type { ParseOptions } from '../parse.js';
import type { SrlTuple } from '../ast.js';
import { expandTerms } from '../expand.js';
import { renderTerm, toTupleRef, type TupleRef } from './compile.js';

/**
 * The tuple-seed document: a ruleset's *initial* named tuples.
 *
 * This is the second authoring box. A ruleset's rules derive tuples; nothing in
 * the base language can *give* it one, so a tuple relation could only ever be
 * computed, never supplied. Seed rows close that: a ground row is a value the
 * store starts with, and a row carrying variables declares an input a caller is
 * expected to fill — the tuple analogue of an all-`UNDEF` `VALUES` row in a
 * query.
 *
 * Gated behind the same `{ tuples: true }` flag as the rest of the extension:
 * with the extension off there are no tuples, so there is nothing to seed.
 */

const defaultContext = completeParseContext({});

export interface SrlTupleSeedRow {
  /** The parsed tuple (terms in slot order). */
  tuple: SrlTuple;
  /** Rendered terms, in order — `?name` for a variable, else SPARQL syntax. */
  terms: string[];
  /** True when every slot is a constant: a value, not a declaration. */
  ground: boolean;
}

export interface SrlTupleSeeds {
  /** Traqula prologue context (ordered BASE/PREFIX definitions). */
  prologue: unknown;
  /** Verbatim prologue text of the seed document. */
  prologueText: string;
  rows: SrlTupleSeedRow[];
}

/**
 * Parse a tuple-seed document. Throws on syntax error.
 *
 * IRIs are expanded against the document's own prologue, the same way
 * {@link expandIris} treats a ruleset — so a seed spelled `:reach` and a rule
 * reading the full IRI match. A caller that wants the *ruleset's* prefixes to
 * apply should prepend the ruleset prologue to `text` before calling.
 *
 * Blank nodes are rejected. A blank node is existential — it names "something",
 * which is meaningless as an input value and unmatchable as a store row — and
 * the query argument path rejects them for the same reason.
 */
export function parseTupleSeeds(text: string, opts: ParseOptions = {}): SrlTupleSeeds {
  if (!opts.tuples) {
    throw new Error('SRL syntax error: tuple seed rows require the rule-tuples extension (parse with { tuples: true })');
  }

  const source = (text ?? '').trim();
  if (!source) return { prologue: [], prologueText: '', rows: [] };

  const ctx = copyParseContext(defaultContext);
  const ast = srlParser.srlTupleSeedDoc(source, ctx) as {
    prologue: unknown;
    rows: SrlTuple[];
  };

  const seeds: SrlTupleSeeds = {
    prologue: ast.prologue,
    prologueText: extractPrologueText(source),
    rows: [],
  };

  expandTerms(ast.rows, ast.prologue);

  for (const tuple of ast.rows) {
    const terms = tuple.terms.map(renderTerm);
    if (terms.some((t) => t.startsWith('_:'))) {
      throw new Error('SRL syntax error: blank nodes are not allowed in tuple seed rows');
    }
    seeds.rows.push({ tuple, terms, ground: !terms.some((t) => t.startsWith('?')) });
  }

  return seeds;
}

/**
 * Serialize seed rows back to text, canonically: one `TUPLE( … )` per line,
 * with expanded IRIs and no prologue.
 *
 * The storage form, for the same reason a rule is stored expanded and
 * prologue-free (July plan §7): a seed's terms have to match a rule's tuple
 * terms, and a rule's are expanded. Storing the author's prefixed spelling
 * would leave the seed depending on a prologue that is not stored beside it —
 * so `:reach` would reach execution unexpanded and match nothing.
 */
export function generateTupleSeeds(seeds: SrlTupleSeeds): string {
  return seeds.rows.map((row) => `TUPLE(${row.terms.join(', ')})`).join('\n');
}

/**
 * The ground rows, as rendered term arrays — exactly the shape `TupleStore.add`
 * takes, so seeding the store is a fold over this.
 */
export function groundTupleSeedRows(seeds: SrlTupleSeeds): string[][] {
  return seeds.rows.filter((r) => r.ground).map((r) => r.terms);
}

/**
 * The rows carrying variables, as tuple refs: the ruleset's declared inputs.
 *
 * Not yet consumed by the executor — a declaration without a supplied value
 * contributes nothing to the store — but it is what a caller reads to know what
 * a ruleset expects, so it is reported rather than dropped.
 */
export function tupleSeedDeclarations(seeds: SrlTupleSeeds): TupleRef[] {
  return seeds.rows.filter((r) => !r.ground).map((r) => toTupleRef(r.tuple));
}
