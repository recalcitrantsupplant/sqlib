# @sparql-query-lib/srl

A parser, generator, SPARQL compiler and stratifier for the SHACL 1.2 Shape
Rules Language (SRL), written from scratch as a grammar extension on top of
[Traqula](https://www.npmjs.com/package/@traqula/core)'s SPARQL 1.2 parser and
generator.

An SRL document is a prologue, zero or more ground `DATA { … }` blocks, and a
sequence of rules:

```
PREFIX : <http://example/>

RULE :base { ?x :ancestor ?y } WHERE { ?x :parent ?y }
RULE :step { ?x :ancestor ?z } WHERE { ?x :parent ?y . ?y :ancestor ?z }
```

The package parses that into an AST, checks its well-formedness, works out in
which order the rules may be evaluated, and compiles each rule to a standalone
SPARQL program. It does not evaluate anything: there is no store and no
executor here. `packages/api` supplies both.

The package is `private: true` and is not published to npm. It is consumed by
`@sparql-query-lib/api` as a workspace dependency.

## What the language adds to SPARQL

Rule bodies are SPARQL group patterns plus three SRL constructs, all handled by
this package:

- `NOT { … }` — negation, compiled to `FILTER NOT EXISTS`.
- `NOT DATA { … }` and `WHERE DATA { … }` — match the *ground* graph (the base
  graph plus every `DATA` block, as it stood before any rule ran) rather than
  the growing evaluation graph. Both compile to a `GRAPH <urn:sqlib:srl:ground>`
  block; the IRI is exported as `GROUND_GRAPH_IRI` so the executor and the
  compiler agree on the name.
- `SET ( ?v := expr )` — assignment. Compiled to
  `BIND(expr AS ?v) FILTER(BOUND(?v))`, wrapped in a group so that a pattern
  later in the body cannot rebind `?v` and revive a solution the assignment's
  evaluation error should have dropped.

## Installation and build

Inside the monorepo:

```bash
pnpm install
pnpm --filter @sparql-query-lib/srl build
```

The package ships ESM only. Its only runtime dependencies are the five
`@traqula/*` packages.

## Example

Parse a document, stratify it, and compile one rule to SPARQL:

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

`:unrelated` lands one stratum above the two rules that derive `:ancestor`,
because it negates over what they produce.

## Main exports

```ts
parseRuleSet(text: string, opts?: ParseOptions): SrlRuleSet
```
Parse a document. Throws on a syntax error. `opts.tuples` enables the
rule-tuples extension (see below); it is off by default.

```ts
expandIris(ruleSet: SrlRuleSet): SrlRuleSet
expandTerms(nodes: unknown, prologue: unknown): void
```
Rewrite prefixed names to full IRIs throughout the AST, in place. Expanded IRIs
are the canonical form; run this before stratifying, splitting or comparing.

```ts
checkWellFormed(ruleSet: SrlRuleSet): WellFormednessIssue[]
```
Report the SRL well-formedness conditions separately from syntax: a head
variable never bound in the body (`unbound-head`), a `SET` targeting a variable
the body already binds (`set-rebinds`), and a `FILTER` or `SET` expression
referring to a variable not yet bound at that point in the body
(`use-before-bind`). Variables introduced inside `NOT { … }` are exempt: they
are existentially quantified within the negated pattern.

```ts
stratify(rules: Array<{ id: string; ast: SrlRule }>): StratificationReport
```
Assign each rule a stratum, and report the dependency edges, per-rule
monotonicity, run-once flags, and any issues. See below.

```ts
compileRule(rule: SrlRule, prologueText?: string, options?: CompileOptions): CompiledRule
```
Compile one rule to a standalone SPARQL program, with the document prologue
prepended so prefixes resolve. `options.flavour` is `'insert'` (default), which
emits `INSERT { head } WHERE { body }` — what the executor runs — or
`'construct'`, which emits `CONSTRUCT { head } WHERE { body }`: one pass of the
same rule, returning the triples instead of writing them, for a reader who wants
to paste it into any endpoint and see what it would add. The result is parsed
back with the SPARQL 1.2 parser before it is returned, so a program that comes
out of this function is syntactically valid.

```ts
generateRule(rule: SrlRule): string
generateRuleSet(ruleSet: SrlRuleSet, prologueText?: string): string
generateHead(rule: SrlRule): string
generateBody(rule: SrlRule): string
generateDataBlock(block: SrlDataBlock): string
```
Serialise back to SRL text from the AST rather than from source slices, one rule
to a line. After `expandIris`, the generated text is the same however the author
spelled their prefixes, which is what makes a prefix-only edit provably not a
content change.

```ts
formatRuleSet(ruleSet: SrlRuleSet, options?: FormatOptions): string
formatRule(rule: SrlRule, options?: FormatOptions): string
formatDataBlock(block: SrlDataBlock, options?: FormatOptions): string
```
Pretty-print the same ASTs for a human: one pattern per line, nested `NOT`
blocks indented (`options.indent`, two spaces by default), the prologue
normalised to one declaration per line, and a blank line between blocks. This is
what `POST /format` serves an SRL document, as the SPARQL generator serves a
query. Formatting is idempotent and meaning-preserving — what it emits parses
back to the same rules — so it is the author-facing counterpart to the
single-line canonical generator above, not a replacement for it: identity still
comes from `canonicalRuleText`, which is whitespace-insensitive and so agrees
with both.

```ts
splitRuleSet(ruleSet: SrlRuleSet): SrlRuleDocument[]
splitDataBlocks(ruleSet: SrlRuleSet): SrlDataBlockDocument[]
mergeRuleSet(docs, prologueText?, dataBlocks?): string
reconcileRuleSet(docs, existing, identityOf, textOf): ReconcileResult
canonicalRuleText(rule: SrlRule): string
abbreviateIris(text: string, prologueText?: string): string
```
Decompose a document into individually addressable rules and data blocks and
put it back together again. Each piece gets an identity: the explicit IRI from
`RULE <iri>` when it has one, otherwise `hash:<sha256>` over its canonical text.
This is what lets a ruleset be edited as one text box and stored as separate
versioned rules.

```ts
sparqlToRule(query: string, options?: SparqlImportOptions): SparqlImportResult
isSrlImportable(query: string): boolean
```
Convert a `CONSTRUCT` query or an `INSERT … WHERE` update into a single SRL
rule. The result is a verdict rather than a throw: an unconvertible query comes
back with `rule: null` and every reason it was rejected.
`SRL_IMPORT_REVISION` versions that accept/reject decision, so a stored
importability flag can be told apart from a stale one.

## Stratification

`stratify` builds a dependency graph over the rules. Rule R depends on rule S
when a body triple pattern of R can match a head triple template of S. An edge
is:

- `positive` when the body pattern sits outside any negation;
- `negative` when it sits under a `NOT`;
- `closed` when R is a run-once rule.

A rule is run-once when its head mints a blank node or its body contains a `SET`.
Either makes the rule produce a fresh answer on every firing, so iterating it has
no fixpoint; it has to be evaluated exactly once, after everything it reads is
complete. That is the same ordering constraint negation imposes, which is why
its positive dependencies are promoted to `closed`.

Positive edges permit rules to share a stratum, so recursion through them (`:step`
above depends on itself) is fine. Negative and closed edges demand a strictly
higher stratum. A dependency cycle containing a negative or closed edge therefore
has no consistent assignment, and the document is rejected:

```ts
stratify(/* RULE :a { ?x :p ?y } WHERE { ?x :q ?y . NOT { ?x :r ?y } }
            RULE :b { ?x :r ?y } WHERE { ?x :p ?y } */)
// issues: [ 'Non-stratifiable cycle involving: http://example/b, http://example/a' ]
```

Such a document has no well-defined answer: `:a` fires only where `:r` is
absent, and `:b` derives `:r` from what `:a` produced, so what comes out depends
on which rule ran first. A
`WHERE DATA` rule reads only the ground graph, so it contributes no edges at all
and never takes part in a cycle.

## Limitations

- **No aggregation.** The vendored parser this package replaced supported
  aggregation in rules; it was dropped deliberately and not reimplemented. This
  is why the monotonicity classification has only two values, `monotone` and
  `negation`.
- **No evaluation.** Nothing here executes a rule or holds a graph. Compilation
  emits SPARQL for someone else to run.
- **`FOR ?var IN <shape>` and the `IF … THEN` rule form are rejected**, not
  parsed. Both were removed from the upstream grammar (the changelog entry of
  2026-08-12 for `FOR`, and w3c/data-shapes#1191 for the leftovers of both), so
  accepting them would let through a document no conforming processor reads.
  There is one rule production: `RULE iri? HeadTemplate 'WHERE' 'DATA'?
  BodyPattern`.
- **The spec is in development.** The vendored W3C test snapshot under
  `test/w3c/` is pinned to a commit, and a refresh has changed the language
  under this package before. `test/w3c/SOURCE` records the pin and what the last
  refresh changed.

## The rule-tuples extension

`parseRuleSet(text, { tuples: true })` enables `TUPLE( … )` in rule heads and
bodies, and `parseTupleSeeds` for a ruleset's initial rows. This is a
**non-conformant extension** to the language: it tracks the proposal in
w3c/data-shapes#752, which the specification does not include. It is off by
default.
Without the flag, a document using `TUPLE` is a syntax error rather than
silently-ignored input:

```
SRL syntax error: TUPLE requires the rule-tuples extension (parse with { tuples: true })
```

A tuple is an ordered list of terms with no relation name. The store is keyed by
arity, and within an arity terms unify position by position. By convention, not
by enforcement, an identifying IRI goes in the first slot: `TUPLE(:reach, ?x, ?y)`.
A rule whose head writes tuples compiles to a `SELECT DISTINCT` over the body
rather than an `INSERT`, and the executor captures each solution row as a
grounded tuple. A rule head may carry triple templates or tuple templates, not
both.

The server gates this behind the `ruleTuples` feature flag
(`FEATURE_RULE_TUPLES`, default `false`), which is what it passes as
`{ tuples: … }` — see `packages/api/src/lib/ruleTuples.ts`. With the flag off,
the API refuses a rule set version that sets `tuplesEnabled` or carries
`tupleSeeds`, and the web UI draws no control mentioning the extension.

These tuples are unrelated to the `TupleSet` entity and the "Tuples" section of
the web UI, which are a saved table of RDF terms that fills a query's `VALUES`
clause.

## Conformance testing

`test/w3c/` holds a pinned snapshot of the W3C SPARQL-RL test suite, and
`test/w3c.harness.test.ts` runs the three categories a parser-and-analyses
package can answer — `syntax/`, `wellformed/` and `stratification/` — against
the baseline in `test/w3c/expected-pass.json`. The current scores are recorded
in `test/w3c/scoreboard.json`. The evaluation categories need a store and graph
comparison, so they are driven from `packages/api` instead
(`test/lib/w3cRulesSuite.harness.test.ts`), which writes its baseline back into
this directory so every category's score is read in one place.

```bash
pnpm --filter @sparql-query-lib/srl test
```

## Further documentation

- [SRL language reference](../../docs/reference/srl-language.md)
- [Rules and SRL guide](../../docs/guides/rules-and-srl.md)
- [Feature flags](../../docs/reference/feature-flags.md)

## Origin

Before this package existed, the rules engine ran on a vendored fork of
`sparqljs` 3.7.3, kept as a tarball in a `vendor/` directory of this repository.
Its Jison grammars had been extended by hand to cover SHACL rules, aggregation
and negation. That fork has been removed, and this package replaces it: the
rules engine was re-implemented against the current SHACL 1.2 Rules draft as a
Traqula grammar extension, and `packages/api` depends on this package instead —
`src/lib/RuleStratifier.ts` and `src/lib/RuleGrammarValidator.ts` are the two
entry points. Aggregation was intentionally dropped in the move. RDF-star now
comes from the standardized SPARQL 1.2 syntax (`<<( )>>`, `{| |}`) in Traqula's
grammar rather than from local grammar patches.
