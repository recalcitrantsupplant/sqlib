/**
 * SRL AST.
 *
 * Rules carry structured sub-ASTs (Traqula BGP / expression / pattern nodes)
 * used for compilation and stratification. Head/body source text is also
 * retained (sliced verbatim) for round-trip display and identity.
 */

export type Span = readonly [start: number, end: number];

/**
 * A tuple pattern (body) or template (head): an ordered list of terms.
 *
 * Tuples have **no relation name**. Identity falls out of ordinary pattern
 * matching, exactly as a triple's predicate is just a slot: the store is keyed
 * by **arity**, and within an arity terms unify position-by-position (a constant
 * must be equal, a variable matches anything). By convention — not enforced —
 * an identifying IRI goes in the first slot, e.g. `TUPLE(:rel, ?x, ?y)`.
 */
export interface SrlTuple {
  /** Traqula term nodes, in order. `terms.length` is the arity. */
  terms: unknown[];
}

/** One element of a rule body. */
export type SrlBodyItem =
  | { kind: 'bgp'; triples: unknown }
  | { kind: 'filter'; filter: unknown }
  /**
   * `NOT { … }`, or `NOT DATA { … }` when `data` is true.
   *
   * `data` sends the negated pattern to the ground graph (`GD`, the base graph
   * plus every DATA block) instead of the evaluation graph, which is how a rule
   * asks "was this absent from the *input*?" while the rest of its body still
   * matches inferred triples. Setting a default value is the spec's own example.
   */
  | { kind: 'not'; body: SrlBodyItem[]; data?: boolean }
  | { kind: 'set'; variable: string; expr: unknown }
  | { kind: 'tuple'; tuple: SrlTuple };

export interface SrlRule {
  /** Optional author-supplied name from `RULE <iri>` (expanded IRI), else undefined. */
  name?: string;
  /** The name's raw term node, so prefix expansion can reach it. Internal. */
  nameTerm?: unknown;
  /** Head triple templates (Traqula BGP). */
  head: unknown;
  /** Head tuple templates (rule-tuples extension; empty unless `opts.tuples`). */
  headTuples: SrlTuple[];
  /** Structured, SRL-aware body. */
  body: SrlBodyItem[];
  /**
   * `WHERE DATA`: match the whole body against the ground graph rather than
   * the evaluation graph.
   *
   * Per the spec's `evalRuleElements`, a rule with `R.data` is evaluated with
   * `GD` in place of `G` throughout — nested `NOT` included — so such a rule
   * reads only what was given and never what has been inferred.
   */
  data?: boolean;
  /** Verbatim head inner source text. */
  headText: string;
  /** Verbatim body inner source text. */
  bodyText: string;
  /** Offset of the leading keyword — used to delimit the prologue. */
  startOffset: number;
  /**
   * The whole rule, keyword to closing brace.
   *
   * `startOffset` says where a rule begins but not where it ends, which is
   * enough to delimit the prologue and nothing else. An editor showing which
   * lines of the document a rule occupies — the stratum gutter — needs both.
   */
  span: Span;
}

/** A ground-triple `DATA { … }` block, seeded before rule evaluation. */
export interface SrlDataBlock {
  /** Ground triples (Traqula BGP), or undefined for an empty block. */
  triples: unknown;
  /** Verbatim inner source text. */
  dataText: string;
  /** The whole block, `DATA` keyword to closing brace. */
  span: Span;
}

export interface SrlRuleSet {
  /** Traqula prologue context (ordered BASE/PREFIX definitions). */
  prologue: unknown;
  /** Verbatim prologue text (all BASE/PREFIX decls), prepended when compiling standalone. */
  prologueText: string;
  rules: SrlRule[];
  dataBlocks: SrlDataBlock[];
}
