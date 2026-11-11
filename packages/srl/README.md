# @sparql-query-lib/srl

A parser, generator, SPARQL compiler and stratifier for the SHACL 1.2 Shape
Rules Language (SRL). It is a grammar extension of the SPARQL 1.2 parser and
generator of [Traqula](https://www.npmjs.com/package/@traqula/core).

An SRL document has a prologue, zero or more ground `DATA { … }` blocks, and a
sequence of rules:

```
PREFIX : <http://example/>

RULE :base { ?x :ancestor ?y } WHERE { ?x :parent ?y }
RULE :step { ?x :ancestor ?z } WHERE { ?x :parent ?y . ?y :ancestor ?z }
```

The package does these steps:

1. It parses the document into an AST.
2. It checks that the document is well formed.
3. It calculates the order in which the rules can run.
4. It compiles each rule to a standalone SPARQL program.

It does not evaluate rules. It has no store and no executor. `packages/api`
supplies both.

The package is `private: true`, and is not published to npm.
`@sparql-query-lib/api` uses it as a workspace dependency.

## What the language adds to SPARQL

A rule body is a SPARQL group pattern, plus three SRL constructs:

- `NOT { … }` is negation. It compiles to `FILTER NOT EXISTS`.
- `NOT DATA { … }` and `WHERE DATA { … }` match the *ground* graph. This is the
  base graph plus each `DATA` block, before any rule ran. Both compile to a
  `GRAPH <urn:sqlib:srl:ground>` block. The package exports the IRI as
  `GROUND_GRAPH_IRI`, so the executor and the compiler use the same name.
- `SET ( ?v := expr )` is assignment. It compiles to
  `BIND(expr AS ?v) FILTER(BOUND(?v))`, in a group. The group stops a later
  pattern in the body from binding `?v` again. Without it, such a pattern could
  restore a solution that an evaluation error in the assignment removed.

## Installation and build

In the monorepo:

```bash
pnpm install
pnpm --filter @sparql-query-lib/srl build
```

The package is ESM only. Its only runtime dependencies are the five
`@traqula/*` packages.

## Example

This parses a document, stratifies it, and compiles one rule to SPARQL:

```ts
import { parseRuleSet, expandIris, stratify, compileRule } from '@sparql-query-lib/srl';

const doc = `PREFIX : <http://example/>

RULE :base      { ?x :ancestor ?y }  WHERE { ?x :parent ?y }
RULE :step      { ?x :ancestor ?z }  WHERE { ?x :parent ?y . ?y :ancestor ?z }
RULE :unrelated { ?x :unrelated ?y } WHERE { ?x a :Person . ?y a :Person . NOT { ?x :ancestor ?y } }
`;

// expandIris rewrites prefixed names to full IRIs in place, so identity and
// dependency matching do not depend on how the author spelled a prefix.
const ruleSet = expandIris(parseRuleSet(doc));

const report = stratify(ruleSet.rules.map((ast, i) => ({ id: ast.name ?? `rule-${i}`, ast })));
console.log(report.strata);
console.log(compileRule(ruleSet.rules[2], ruleSet.prologueText).program);
```

Output:

```
{
  'http://example/base': 0,
  'http://example/step': 0,
  'http://example/unrelated': 1
}
PREFIX : <http://example/>
INSERT {
  ?x :unrelated ?y
} WHERE {
  ?x <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example/Person> .
?y <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example/Person> .
  FILTER NOT EXISTS {
  ?x <http://example/ancestor> ?y .
}
}
```

`:unrelated` is one stratum above the two rules that derive `:ancestor`. It
negates what they produce.

## Main exports

```ts
parseRuleSet(text: string, opts?: ParseOptions): SrlRuleSet
```
Parses a document, and throws on a syntax error. `opts.tuples` turns on the
rule-tuples extension, and `opts.aggregates` turns on `GROUP`. Both are off by
default. See below.

```ts
expandIris(ruleSet: SrlRuleSet): SrlRuleSet
expandTerms(nodes: unknown, prologue: unknown): void
```
Rewrites prefixed names to full IRIs in the whole AST, in place. Expanded IRIs
are the canonical form. Run this before you stratify, split or compare.

```ts
checkWellFormed(ruleSet: SrlRuleSet): WellFormednessIssue[]
```
Reports the SRL well-formedness conditions. These are separate from syntax:

- `unbound-head`: a head variable that the body does not bind;
- `set-rebinds`: a `SET` on a variable that the body already binds;
- `use-before-bind`: a `FILTER` or `SET` expression that uses a variable before
  the body binds it.

Variables inside `NOT { … }` are exempt. They are existentially quantified in
the negated pattern.

```ts
stratify(rules: Array<{ id: string; ast: SrlRule }>): StratificationReport
```
Gives each rule a stratum. The report also has the dependency edges, the
monotonicity of each rule, the run-once flags, and the issues. See
[Stratification](#stratification).

```ts
compileRule(rule: SrlRule, prologueText?: string, options?: CompileOptions): CompiledRule
```
Compiles one rule to a standalone SPARQL program. The document prologue is put
first, so prefixes resolve. `options.flavour` has two values:

- `'insert'` (the default) gives `INSERT { head } WHERE { body }`. The executor
  runs this.
- `'construct'` gives `CONSTRUCT { head } WHERE { body }`. This is one pass of
  the same rule, and returns the triples with no write. Paste it into an
  endpoint to see what the rule adds.

The function parses the program again with the SPARQL 1.2 parser before it
returns it. Each program that it returns is therefore syntactically valid.

```ts
generateRule(rule: SrlRule): string
generateRuleSet(ruleSet: SrlRuleSet, prologueText?: string): string
generateHead(rule: SrlRule): string
generateBody(rule: SrlRule): string
generateDataBlock(block: SrlDataBlock): string
```
Serialise the AST to SRL text, one rule on each line. The text comes from the
AST, and not from slices of the source. After `expandIris`, the text does not
change with the prefixes that the author used. An edit to prefixes only
therefore gives the same text, and is not a content change.

```ts
formatRuleSet(ruleSet: SrlRuleSet, options?: FormatOptions): string
formatRule(rule: SrlRule, options?: FormatOptions): string
formatDataBlock(block: SrlDataBlock, options?: FormatOptions): string
```
Print the same ASTs for a person to read:

- one pattern on each line;
- nested `NOT` blocks indented (`options.indent`, two spaces by default);
- one prologue declaration on each line;
- a blank line between blocks.

`POST /format` uses this for an SRL document, as it uses the SPARQL generator
for a query. Formatting is idempotent, and keeps the meaning: its output parses
to the same rules. The single-line generator above stays the canonical form.
Identity comes from `canonicalRuleText`, which ignores whitespace, so it gives
the same result for both.

```ts
splitRuleSet(ruleSet: SrlRuleSet): SrlRuleDocument[]
splitDataBlocks(ruleSet: SrlRuleSet): SrlDataBlockDocument[]
mergeRuleSet(docs, prologueText?, dataBlocks?): string
reconcileRuleSet(docs, existing, identityOf, textOf): ReconcileResult
canonicalRuleText(rule: SrlRule): string
abbreviateIris(text: string, prologueText?: string): string
```
Split a document into rules and data blocks that each have an address, and join
them again. Each piece has an identity. This is the IRI from `RULE <iri>` if
the rule has one. If not, it is `hash:<sha256>` of the canonical text. With
this, a person edits a rule set as one text box, and the server stores separate
versioned rules.

```ts
sparqlToRule(query: string, options?: SparqlImportOptions): SparqlImportResult
isSrlImportable(query: string): boolean
```
Convert a `CONSTRUCT` query or an `INSERT … WHERE` update into one SRL rule.
The function does not throw for a query that it cannot convert. It returns
`rule: null` and each reason for the refusal. `SRL_IMPORT_REVISION` is the
version of the accept and refuse logic. With it, a stored importability flag
that is out of date can be found.

## Stratification

`stratify` makes a dependency graph of the rules. Rule R depends on rule S when
a body triple pattern of R can match a head triple template of S. An edge has
one of three kinds:

- `positive`: the body pattern is outside each negation;
- `negative`: the body pattern is in a `NOT`;
- `closed`: R is a run-once rule.

A rule is run-once when its head makes a blank node, or its body has a `SET`.
Each firing of such a rule gives a new answer, so iteration has no fixpoint.
The rule must run once only, after each rule that it reads is complete.
Negation has the same constraint on order. For this reason, `stratify` changes
the positive dependencies of a run-once rule to `closed`.

Rules joined by positive edges can share a stratum. Recursion through positive
edges is therefore valid: `:step` above depends on itself. A negative or closed
edge needs a higher stratum. A dependency cycle with a negative or closed edge
has no valid assignment, and `stratify` refuses the document:

```ts
stratify(/* RULE :a { ?x :p ?y } WHERE { ?x :q ?y . NOT { ?x :r ?y } }
            RULE :b { ?x :r ?y } WHERE { ?x :p ?y } */)
// issues: [ 'Non-stratifiable cycle involving: http://example/b, http://example/a' ]
```

Such a document has no defined answer. `:a` fires only where `:r` is absent.
`:b` derives `:r` from the output of `:a`. The result therefore depends on the
rule that runs first.

A `WHERE DATA` rule reads only the ground graph. It adds no edges, and is never
part of a cycle.

## Limitations

- **No evaluation.** The package does not run rules or hold a graph. It
  compiles SPARQL for another component to run.
- **`FOR ?var IN <shape>` and the `IF … THEN` rule form are refused.** The
  parser does not read them. The upstream grammar removed both: see the
  changelog entry of 2026-08-12 for `FOR`, and w3c/data-shapes#1191 for the
  rest. A conforming processor does not read such a document, so this package
  does not either. There is one rule production:
  `RULE iri? HeadTemplate 'WHERE' 'DATA'? BodyPattern`.
- **The specification is in development.** The W3C test snapshot in
  `test/w3c/` is pinned to a commit. A past refresh changed the language under
  this package. `test/w3c/SOURCE` records the pin, and what the last refresh
  changed.

## The rule-tuples extension

`parseRuleSet(text, { tuples: true })` turns on `TUPLE( … )` in rule heads and
bodies, and `parseTupleSeeds` for the initial rows of a rule set. This extension
does **not conform** to the specification. It follows the proposal in
w3c/data-shapes#752, which the specification does not include. It is off by
default. Without the option, a document that uses `TUPLE` is a syntax error:

```
SRL syntax error: TUPLE requires the rule-tuples extension (parse with { tuples: true })
```

A tuple is an ordered list of terms, with no relation name. The store keys
tuples by arity. In one arity, terms unify position by position. The
convention is to put an identifying IRI in the first slot, for example
`TUPLE(:reach, ?x, ?y)`. The parser does not enforce this.

A rule with tuples in its head compiles to a `SELECT DISTINCT` over the body.
The executor stores each solution row as a ground tuple. A rule head has triple
templates or tuple templates. It cannot have both.

The server controls this with the `ruleTuples` feature flag
(`FEATURE_RULE_TUPLES`, default `false`). It passes the flag as `{ tuples: … }`.
See `packages/api/src/lib/ruleTuples.ts`. When the flag is off:

- the API refuses a rule set version that sets `tuplesEnabled` or has
  `tupleSeeds`;
- the web UI shows no control for the extension.

These tuples have no relation to the `TupleSet` entity, or to the "Tuples"
section of the web UI. A tuple set is a saved table of RDF terms that fills the
`VALUES` clause of a query.

## Aggregation: `GROUP`

`parseRuleSet(text, { aggregates: true })` turns on the `GROUP` body element.
The grammar is the one proposed in w3c/data-shapes#1347. That pull request is
not merged yet, so the option is off by default. Without it, a document that
uses `GROUP` is a syntax error:

```
SRL syntax error: GROUP requires the rule-aggregates extension (parse with { aggregates: true })
```

```sparql
RULE { ?x :numChildren ?n }
WHERE { ?x a :Person . GROUP BY ?x { ?y :childOf ?x } [ ?n := COUNT(*) ] }
```

The server controls this with the `ruleAggregates` feature flag
(`FEATURE_RULE_AGGREGATES`, default `false`). See
`packages/api/src/lib/ruleAggregates.ts`. A rule with `GROUP` has the
monotonicity `aggregation`. The other two values are `monotone` and `negation`.
[The SRL reference](../../docs/reference/srl-language.md#aggregation-group) gives
the syntax, evaluation, well-formedness rules and compilation.

## Conformance testing

`test/w3c/` holds a pinned snapshot of the W3C SPARQL-RL test suite.
`test/w3c.harness.test.ts` runs the three categories that a parser can answer:
`syntax/`, `wellformed/` and `stratification/`. It compares them with the
baseline in `test/w3c/expected-pass.json`. `test/w3c/scoreboard.json` records
the current scores.

The evaluation categories need a store and a graph comparison.
`packages/api` runs them, in `test/lib/w3cRulesSuite.harness.test.ts`. That
test writes its baseline into this directory, so the scores of all categories
are in one place.

```bash
pnpm --filter @sparql-query-lib/srl test
```

## Further documentation

- [SRL language reference](../../docs/reference/srl-language.md)
- [Rules and SRL guide](../../docs/guides/rules-and-srl.md)
- [Feature flags](../../docs/reference/feature-flags.md)

## Origin

Before this package, the rules engine ran on a vendored fork of `sparqljs`
3.7.3. The fork was a tarball in a `vendor/` directory of this repository. Its
Jison grammars had manual extensions for SHACL rules, aggregation and negation.

This package replaced the fork, which is now removed. The rules engine was
written again against the current SHACL 1.2 Rules draft, as a Traqula grammar
extension. `packages/api` uses this package through two entry points:
`src/lib/RuleStratifier.ts` and `src/lib/RuleGrammarValidator.ts`.

The move dropped the aggregation of the fork. Aggregation is now the `GROUP`
extension above. RDF-star comes from the standard SPARQL 1.2 syntax in the
Traqula grammar (`<<( )>>`, `{| |}`), with no local grammar patches.
