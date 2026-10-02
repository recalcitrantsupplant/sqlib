import { Parser as SparqlParser } from '@traqula/parser-sparql-1-2';
import { sparql12GeneratorBuilder } from '@traqula/generator-sparql-1-2';
import { completeGeneratorContext } from '@traqula/rules-sparql-1-2';
import type { SrlAggregate, SrlBodyItem, SrlRule } from './ast.js';
import { aggregateKeys } from './aggregates/scope.js';
import {
  collectTupleReads,
  resolveSlotVars,
  toTupleRef,
  tuplePlaceholder,
  type TupleRef,
} from './tuples/compile.js';
import { boundBy, collectVars } from './wellformed.js';

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
 *  - `AGGREGATE …`       → an `OPTIONAL` grouped subquery; see
 *                          {@link compileAggregate}.
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
 * **`NOT` needs the same scoping, and for the same reason.** SRL checks a
 * negation against the bindings made *before* it (`evalRuleElements` runs the
 * body as a sequence), but a SPARQL `FILTER NOT EXISTS` sees its whole group.
 * The two agree whenever every variable the negation shares with the body is
 * bound before it. When one is only bound *after* it, they do not:
 *
 *     NOT { ?x :q ?y } ?x :p ?y
 *
 * is, in SRL, "if no `:q` triple exists anywhere, then every `?x :p ?y`" — the
 * `?x` and `?y` inside the NOT are free at that point — while the literal
 * SPARQL translation is the per-solution "`?x :p ?y` unless `?x :q ?y`". The
 * fix is the SET trick: close everything so far into a group ending in the
 * filter, so the filter can only see what came before it:
 *
 *     { FILTER NOT EXISTS { ?x :q ?y } } ?x :p ?y
 *
 * This is done only when it changes the meaning, so a negation written after
 * its binders — the usual case — compiles exactly as before.
 *
 * Caveat for the future: if SRL gains an OPTIONAL-like construct, or the spec
 * introduces an expression that can legitimately yield unbound, revisit the
 * BOUND test itself.
 *
 * Plain-SPARQL leaves (BGP, FILTER, expressions) are serialized from their
 * parsed sub-ASTs — no dependence on source spans.
 */
interface CompileContext {
  /** Next tuple-read slot index; shared so slots are numbered across nesting. */
  tupleIndex: { n: number };
  /** Next aggregate index, for naming its generated variables. */
  aggregateIndex: { n: number };
  /** Every variable name in the program so far, so generated names miss them. */
  used: Set<string>;
}

function compileBody(items: SrlBodyItem[], context: CompileContext, outerBound: ReadonlySet<string> = new Set()): string {
  let parts: string[] = [];
  const bound = new Set(outerBound);
  items.forEach((item, index) => {
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
        const inner = compileBody(item.body, context, bound);
        // `NOT DATA` negates against the ground graph. A plain `NOT` inside a
        // `WHERE DATA` rule needs no marker here — the whole body is already
        // inside the GRAPH block, which is exactly the spec's
        // `evalRuleElements(N.inner, S, G=GD, GD)`.
        parts.push(item.data
          ? `FILTER NOT EXISTS {\n  GRAPH <${GROUND_GRAPH_IRI}> {\n  ${inner}\n}\n}`
          : `FILTER NOT EXISTS {\n  ${inner}\n}`);
        // Close the group here when a later element binds a variable the
        // negation mentions, so the filter cannot see that binding. See the
        // note above.
        if (negationSeesLaterBinding(item, bound, items.slice(index + 1))) {
          parts = [`{\n  ${parts.join('\n  ')}\n}`];
        }
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
        parts.push(tuplePlaceholder(context.tupleIndex.n, toTupleRef(item.tuple)));
        context.tupleIndex.n += 1;
        break;
      case 'aggregate': {
        const keys = aggregateKeys(item, bound);
        parts = [compileAggregate(item, keys, parts, context)];
        if (item.mode === 'group') {
          // Only the listed variables and the results survive a GROUP BY.
          bound.clear();
          for (const key of keys) bound.add(key);
        }
        break;
      }
    }
    for (const name of boundBy(item)) bound.add(name);
  });
  return parts.join('\n  ');
}

/**
 * Compile one `AGGREGATE` against the body compiled before it.
 *
 * `prefix` is the compiled elements before the aggregate (`P`) and `keys` the
 * variables the inner pattern may see (`K`). For
 *
 *     AGGREGATE PER ?x { ?y :childOf ?x } ( ?n := COUNT(*) )
 *
 * the result is
 *
 *     {
 *       P
 *       OPTIONAL {
 *         SELECT ?x (COUNT(*) AS ?_agg0_count) (COUNT(*) AS ?_agg0_v0)
 *         WHERE { ?_agg0_y :childOf ?x }
 *         GROUP BY ?x
 *       }
 *       BIND(IF(COALESCE(?_agg0_count, 0) > 0, ?_agg0_v0, 0) AS ?n)
 *       FILTER(BOUND(?n))
 *     }
 *
 * - **The inner variables are renamed** apart from `K`, so the only variables
 *   the subquery shares with `P` are the keys. Well-formedness already makes it
 *   an error to use an inner variable outside the aggregate; the renaming keeps
 *   the translation right for a caller that compiles without checking.
 * - **`OPTIONAL` keeps an outer row whose group is empty**, and the hidden
 *   count tells an empty group (no subquery row: `COUNT` and `SUM` become 0,
 *   anything else drops the row) apart from an aggregate that failed (a row
 *   whose value is unbound: the row is dropped, as an error in `SET` drops it).
 * - **Grouping the inner pattern alone** means the outer pattern's own
 *   multiplicity never reaches the count: a person with two names and three
 *   children has three children on both rows.
 * - **The whole thing is closed into a group**, for the reason `SET` is: the
 *   `BOUND` test must not be satisfied by a pattern written after it.
 *
 * When a key is used by the inner pattern only in a `FILTER` — the rank idiom,
 * `{ ?o :score ?s FILTER(?s > ?score) }` — the subquery cannot compute it from
 * its own pattern, since SPARQL evaluates a subquery bottom-up. It is then
 * seeded with the distinct key rows of `P`, which repeats `P` inside it.
 *
 * `GROUP BY` mode adds a projection to the listed variables and the results.
 */
function compileAggregate(
  item: SrlAggregate,
  keys: string[],
  prefix: string[],
  context: CompileContext,
): string {
  const index = context.aggregateIndex.n;
  context.aggregateIndex.n += 1;
  const fresh = (base: string): string => {
    let name = `_agg${index}_${base}`;
    while (context.used.has(name)) name = `_${name}`;
    context.used.add(name);
    return name;
  };

  // Rename every inner variable that is not a key.
  const innerVars = new Set<string>();
  collectVars(item.body, innerVars);
  const renames = new Map<string, string>();
  for (const name of innerVars) if (!keys.includes(name)) renames.set(name, fresh(name));
  const body = renameVars(structuredClone(item.body), renames);
  const assignments = item.assignments.map((a) => ({
    variable: a.variable,
    aggregate: renameVars(structuredClone(a.aggregate), renames),
  }));

  const count = fresh('count');
  const values = assignments.map((_, j) => fresh(`v${j}`));
  const keyList = keys.map((k) => `?${k}`).join(' ');

  // Keys the inner pattern binds itself; any other key needs seeding.
  const patternBound = new Set(body.flatMap((inner) => boundBy(inner)));
  const seeded = keys.some((k) => !patternBound.has(k));
  const seed = seeded
    ? `{\n  SELECT DISTINCT ${keyList} WHERE {\n  ${prefix.join('\n  ')}\n}\n}\n  `
    : '';

  const inner = compileBody(body, context, new Set(keys));
  const projection = [
    keyList,
    `(COUNT(*) AS ?${count})`,
    ...assignments.map((a, j) => `(${serialize('expression', a.aggregate)} AS ?${values[j]})`),
  ].filter(Boolean).join(' ');
  const groupBy = keys.length > 0 ? `\nGROUP BY ${keyList}` : '';
  const subquery = `OPTIONAL {\n  SELECT ${projection} WHERE {\n  ${seed}${inner}\n}${groupBy}\n}`;

  const present = `COALESCE(?${count}, 0) > 0`;
  const after: string[] = [];
  // MIN, MAX and AVG have no value on an empty group, so the row goes.
  if (assignments.some((a) => !zeroOnEmpty(a.aggregate))) after.push(`FILTER(${present})`);
  assignments.forEach((a, j) => {
    after.push(zeroOnEmpty(a.aggregate)
      ? `BIND(IF(${present}, ?${values[j]}, 0) AS ?${a.variable})`
      : `BIND(?${values[j]} AS ?${a.variable})`);
  });
  after.push(`FILTER(${assignments.map((a) => `BOUND(?${a.variable})`).join(' && ')})`);

  const closed = `{\n  ${[...prefix, subquery, ...after].join('\n  ')}\n}`;
  if (item.mode !== 'group') return closed;
  const kept = [...keys, ...assignments.map((a) => a.variable)].map((v) => `?${v}`).join(' ');
  return `{\n  SELECT DISTINCT ${kept} WHERE ${closed}\n}`;
}

/** `COUNT` and `SUM` of an empty group are 0; the others have no value. */
function zeroOnEmpty(aggregate: unknown): boolean {
  const name = String((aggregate as { aggregation?: unknown }).aggregation ?? '').toLowerCase();
  return name === 'count' || name === 'sum';
}

/** Rename variables throughout an AST node, in place. Returns the node. */
function renameVars<T>(node: T, renames: ReadonlyMap<string, string>): T {
  if (renames.size === 0) return node;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const n = value as Record<string, unknown>;
    if (n.type === 'term' && n.subType === 'variable') {
      const renamed = renames.get(String(n.value ?? ''));
      if (renamed) n.value = renamed;
      return;
    }
    for (const [key, child] of Object.entries(n)) {
      if (key === 'loc') continue;
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  // The inner pattern holds no `SET` (the parser rejects one), so every
  // variable in it is a term node and nothing is named by a plain string.
  visit(node);
  return node;
}

/**
 * True when a `NOT` mentions a variable that is unbound at its position but
 * bound by an element after it — the one case where SRL's in-order negation
 * and SPARQL's group-scoped `FILTER NOT EXISTS` disagree.
 */
function negationSeesLaterBinding(
  item: Extract<SrlBodyItem, { kind: 'not' }>,
  boundBefore: ReadonlySet<string>,
  later: SrlBodyItem[],
): boolean {
  const mentioned = new Set<string>();
  collectVars(item.body, mentioned);
  const boundLater = new Set(later.flatMap((next) => boundBy(next)));
  return [...mentioned].some((name) => !boundBefore.has(name) && boundLater.has(name));
}

/**
 * The rule body with every blank node replaced by a variable the rule does not
 * use — the spec's "treating blank nodes as variables" (`evalRule`), done here
 * rather than left to the engine.
 *
 * The spec applies it to the whole body as one scope: the same blank node is
 * the same variable wherever it occurs, inside a triple term or a `NOT`
 * included. SPARQL scopes a blank node label to one basic graph pattern
 * instead, so the literal translation of
 *
 *     ?x :r _:b  NOT { _:b :q :c }
 *
 * fails to parse ("reuse of blank node across two different basic graph
 * patterns"), and so does a blank node used on both sides of a `SET`. As
 * variables, both compile, and the NOT-scoping above sees them like any other
 * variable. The head is left alone: its blank nodes are fresh per solution.
 *
 * `[ … ]` and `( … )` carry blank nodes too (`g_0`, …). They are replaced
 * with the rest; the generator writes those forms from their triples, so the
 * text keeps its brackets.
 */
function bnodesAsVariables(rule: SrlRule): SrlBodyItem[] {
  const taken = new Set<string>();
  collectVars(rule.head, taken);
  collectVars(rule.headTuples, taken);
  collectVars(rule.body, taken);
  const names = new Map<string, string>();
  const nameFor = (label: string): string => {
    let name = names.get(label);
    if (name === undefined) {
      name = `_bnode_${label}`;
      while (taken.has(name)) name = `_${name}`;
      taken.add(name);
      names.set(label, name);
    }
    return name;
  };
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!node || typeof node !== 'object') return node;
    const n = node as Record<string, unknown>;
    if (n.type === 'term' && n.subType === 'blankNode') {
      return { type: 'term', subType: 'variable', value: nameFor(String(n.label ?? '')), loc: n.loc };
    }
    return Object.fromEntries(Object.entries(n).map(([key, value]) => [key, key === 'loc' ? value : rewrite(value)]));
  };
  return rewrite(rule.body) as SrlBodyItem[];
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
  // Blank nodes first, so the names the aggregate compiler generates are
  // chosen against the variables the rewrite introduced as well.
  const items = bnodesAsVariables(rule);
  const used = new Set<string>();
  collectVars(rule.head, used);
  collectVars(rule.headTuples, used);
  collectVars(items, used);
  // SET targets and aggregate results are plain strings, not term nodes.
  for (const item of items) for (const name of boundBy(item)) used.add(name);
  const inner = compileBody(items, { tupleIndex: { n: 0 }, aggregateIndex: { n: 0 }, used });
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
