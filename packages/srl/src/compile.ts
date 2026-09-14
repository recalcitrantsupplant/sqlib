import { Parser as SparqlParser } from '@traqula/parser-sparql-1-2';
import { sparql12GeneratorBuilder } from '@traqula/generator-sparql-1-2';
import { completeGeneratorContext } from '@traqula/rules-sparql-1-2';
import type { SrlBodyItem, SrlRule } from './ast.js';
import {
  collectTupleReads,
  resolveSlotVars,
  toTupleRef,
  tuplePlaceholder,
  type TupleRef,
} from './tuples/compile.js';

export type { TupleRef } from './tuples/compile.js';

/**
 * The named graph holding `GD` — the base graph plus every DATA block — as it
 * stood before any rule ran.
 *
 * `WHERE DATA` and `NOT DATA` are the spec's way of matching the *input* rather
 * than the growing evaluation graph, and SPARQL's way of matching one graph
 * rather than another is `GRAPH <g> { … }`. So the executor keeps a copy of the
 * ground data under this IRI and the compiler points ground patterns at it.
 * Exported because the two ends have to agree on the name.
 */
export const GROUND_GRAPH_IRI = 'urn:sqlib:srl:ground';

/**
 * Which SPARQL form a rule compiles to.
 *
 * - `insert` — `INSERT { head } WHERE { body }`, what the executor runs.
 * - `construct` — `CONSTRUCT { head } WHERE { body }`: the same rule, one pass,
 *   *returning* the triples instead of writing them. Nobody executes this; it is
 *   for a reader who wants to paste one pass of a rule into any endpoint and see
 *   what it would add.
 *
 * The two are generated from the same AST rather than by rewriting the string,
 * because the cases where a reader most needs the answer to be right — tuple
 * heads, `SET`, blank-node heads — are exactly the ones a token swap gets wrong.
 * Neither form is stored: this is a rendering of the rule, computed on demand
 * from the document the caller posted, like the INSERT form beside it.
 */
export type CompileFlavour = 'insert' | 'construct';

export interface CompileOptions {
  /** SPARQL form to emit. Default `insert`. */
  flavour?: CompileFlavour;
}

export interface CompiledRule {
  /**
   * A standalone SPARQL program.
   *
   * - No head tuples → a SPARQL UPDATE (`INSERT { head } WHERE { body }`), or a
   *   `CONSTRUCT … WHERE` under the `construct` flavour.
   * - Head tuples    → a `SELECT` over the body; the executor captures each
   *   solution row as a grounded tuple instead of inserting triples. There is no
   *   CONSTRUCT form for it (see {@link producesTuples}), so the flavour is
   *   ignored and the same SELECT comes back either way.
   */
  program: string;
  /** True when `program` is a SELECT whose rows become tuples (see above). */
  producesTuples: boolean;
  /** Tuple patterns the body matches; the executor injects VALUES for each. */
  tupleReads: TupleRef[];
  /** Tuple templates the head emits. */
  tupleWrites: TupleRef[];
}

const generator: any = sparql12GeneratorBuilder.build();
const generatorContext: any = completeGeneratorContext({});
const sparqlParser = new SparqlParser();

/** Serialize a sub-AST via one of the built generator's per-rule methods. */
function serialize(rule: string, ast: unknown): string {
  return generator[rule](ast, { ...generatorContext, origSource: '' }).trim();
}

/**
 * Compile the (SRL-aware) body items to a SPARQL group-graph-pattern body.
 *
 * Transforms:
 *  - `NOT { P }`         → `FILTER NOT EXISTS { P }`
 *  - `SET (?v := E)`     → `BIND(E AS ?v) FILTER(BOUND(?v))`
 *  - `TUPLE( … )`        → a placeholder comment; the executor substitutes a
 *                          `VALUES` block built from the tuple store.
 *
 * `BIND` + `FILTER(BOUND(?v))` encodes SRL's "an error in SET drops the
 * solution", which the spec states outright: *"SET(?var := expr) would be the
 * same as SPARQL BIND(expr AS ?var) followed by FILTER(BOUND(?var))"*
 * (Relationship between SRL and SPARQL). In SPARQL an expression either returns
 * a term or raises a type error — none returns "unbound" as a success — so `?v`
 * unbound after `BIND` is precisely and only the error signal.
 *
 * **The pair has to be scoped, though, and that is the subtle part.** A SPARQL
 * `FILTER` applies to its whole group, not to the point it is written at, so
 *
 *     BIND(1/0 AS ?x) FILTER(BOUND(?x)) :s ?p ?x
 *
 * lets the *later* triple pattern bind `?x`, at which point the filter passes
 * and a solution the SET should have killed comes back to life. That is
 * `eval-assign-03` exactly: the suite expects nothing and we emitted a triple.
 * So everything up to and including the assignment is wrapped in a group, and
 * the rest of the body joins onto it from outside:
 *
 *     { BIND(1/0 AS ?x) FILTER(BOUND(?x)) } :s ?p ?x
 *
 * The wrap also keeps the SET's expression able to see the variables bound
 * before it, which a bare `{ BIND … }` on its own would not.
 *
 * Caveat for the future: if SRL gains an OPTIONAL-like construct, or the spec
 * introduces an expression that can legitimately yield unbound, revisit the
 * BOUND test itself.
 *
 * Plain-SPARQL leaves (BGP, FILTER, expressions) are serialized from their
 * parsed sub-ASTs — no dependence on source spans.
 */
function compileBody(items: SrlBodyItem[], tupleIndex: { n: number }): string {
  let parts: string[] = [];
  for (const item of items) {
    switch (item.kind) {
      case 'bgp':
        parts.push(serialize('triplesBlock', item.triples));
        break;
      case 'filter':
        parts.push(serialize('filter', item.filter));
        break;
      case 'not': {
        // Newlines matter: a tuple placeholder ends in a comment (the read
        // marker), so a closing brace on the same line would be commented out.
        const inner = compileBody(item.body, tupleIndex);
        // `NOT DATA` negates against the ground graph. A plain `NOT` inside a
        // `WHERE DATA` rule needs no marker here — the whole body is already
        // inside the GRAPH block, which is exactly the spec's
        // `evalRuleElements(N.inner, S, G=GD, GD)`.
        parts.push(item.data
          ? `FILTER NOT EXISTS {\n  GRAPH <${GROUND_GRAPH_IRI}> {\n  ${inner}\n}\n}`
          : `FILTER NOT EXISTS {\n  ${inner}\n}`);
        break;
      }
      case 'set': {
        parts.push(`BIND(${serialize('expression', item.expr)} AS ?${item.variable}) FILTER(BOUND(?${item.variable}))`);
        // Close the group here, so the BOUND test cannot be satisfied by a
        // pattern that comes after it. See the note above.
        parts = [`{\n  ${parts.join('\n  ')}\n}`];
        break;
      }
      case 'tuple':
        parts.push(tuplePlaceholder(tupleIndex.n, toTupleRef(item.tuple)));
        tupleIndex.n += 1;
        break;
    }
  }
  return parts.join('\n  ');
}

/** Variables appearing in a rule's head tuple templates, in first-seen order. */
function headTupleVars(rule: SrlRule): string[] {
  const seen: string[] = [];
  for (const tuple of rule.headTuples) {
    for (const term of tuple.terms as any[]) {
      if (term?.subType === 'variable') {
        const name = String(term.value ?? '');
        if (!seen.includes(name)) seen.push(name);
      }
    }
  }
  return seen;
}

/**
 * Compile one SRL rule to a validated SPARQL program.
 *
 * @param rule         the rule to compile
 * @param prologueText document prologue (BASE/PREFIX), prepended so prefixes resolve
 * @param options      {@link CompileOptions}; `flavour` picks INSERT or CONSTRUCT
 */
export function compileRule(rule: SrlRule, prologueText = '', options: CompileOptions = {}): CompiledRule {
  const prologue = prologueText.trim();
  const tupleIndex = { n: 0 };
  const inner = compileBody(rule.body, tupleIndex);
  // `WHERE DATA`: the spec evaluates the whole body with GD in place of G, so
  // one GRAPH block around everything is the exact translation — nested NOTs
  // included, which is why they need no marker of their own.
  const body = rule.data ? `GRAPH <${GROUND_GRAPH_IRI}> {\n  ${inner}\n}` : inner;
  const tupleReads = collectTupleReads(rule.body);
  const tupleWrites = rule.headTuples.map((t) => toTupleRef(t));
  const producesTuples = tupleWrites.length > 0;

  const prefix = prologue ? `${prologue}\n` : '';
  let program: string;
  if (producesTuples) {
    // Rows of this SELECT become grounded tuples in the store. A rule that also
    // writes triples would need two passes in the executor, so reject it here
    // rather than silently dropping the triples.
    const headTriples = (rule.head as any)?.triples;
    if (Array.isArray(headTriples) && headTriples.length > 0) {
      throw new Error('A rule head may contain either triple templates or tuple templates, not both');
    }
    const vars = headTupleVars(rule);
    const projection = vars.length > 0 ? vars.map((v) => `?${v}`).join(' ') : '*';
    // DISTINCT because the store is a set: a SELECT returns a solution
    // *sequence*, so without it a duplicated row in an injected VALUES block
    // multiplies into duplicate captures. The store also de-duplicates on
    // insert, but doing it here keeps the rows that cross out of the engine
    // down to the ones that can matter.
    program = `${prefix}SELECT DISTINCT ${projection} WHERE {\n  ${body}\n}`;
  } else {
    // `INSERT` and `CONSTRUCT` take the same template and the same body, and
    // both mint a fresh blank node per solution, so the head text is reused
    // as-is. The difference is only what becomes of the triples.
    const form = options.flavour === 'construct' ? 'CONSTRUCT' : 'INSERT';
    program = `${prefix}${form} {\n  ${rule.headText}\n} WHERE {\n  ${body}\n}`;
  }

  // Name the generated tuple-slot columns last, when the whole program is
  // visible: the names have to miss every variable the author wrote, in the body
  // and in the head alike.
  program = resolveSlotVars(program);

  // Validate. A tuple slot is an all-UNDEF VALUES row under a comment, so the
  // program parses as-is, pre-substitution.
  sparqlParser.parse(program);

  return { program, producesTuples, tupleReads, tupleWrites };
}
