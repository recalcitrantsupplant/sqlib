# SRL language reference

SRL is the surface syntax sqlib uses for SPARQL-RL inference rules — the SPARQL
Rule Language of [SPARQL 1.2 RL](https://www.w3.org/TR/sparql12-rl/). The parser,
well-formedness checker, stratifier and SPARQL compiler are in `packages/srl`.

This page documents what the parser accepts and what each stage reports. For
writing and running rules, see
[rules and SRL](../guides/rules-and-srl.md); for a worked set, see
[the Sudoku solver](../examples/sudoku-solver-ruleset.md).

The parser is built on the Traqula SPARQL 1.2 parser, so the leaves of a rule —
terms, triple patterns, expressions — are SPARQL 1.2. Everything in RDF 1.2 that
SPARQL 1.2 accepts is accepted here, including triple terms and reifiers.

## Document shape

A document is a sequence of prologue declarations, `RULE` blocks and `DATA`
blocks, in any order. `PREFIX` and `BASE` may appear between rules, not only at
the top.

```sparql
PREFIX : <http://example.org/>

DATA {
  :alice :parent :bob .
  :bob :parent :carol .
}

RULE :grandparent {
  ?x :grandparent ?z
} WHERE {
  ?x :parent ?y .
  ?y :parent ?z
}
```

### `RULE`

```
RULE <iri>? { head } WHERE DATA? { body }
```

The name is optional. When present it is an IRI, expanded against the prologue,
and it is the rule's identity across edits. A rule without a name is identified
by a SHA-256 hash of its canonical text, so editing an unnamed rule mints a new
one where editing a named rule revises it.

The head is a set of triple templates. Every variable in the head must be bound
by the body.

`WHERE DATA` makes the whole body match the *ground* graph — the base graph plus
every `DATA` block, as it stood before any rule ran — instead of the evaluation
graph. Such a rule reads only what was given and never what has been inferred,
and so depends on no other rule.

### `DATA`

```
DATA { triples }
```

Ground triples seeded before evaluation. Variables are not allowed; a variable
anywhere in a `DATA` block is rejected with:

```
SRL syntax error: variables are not allowed in a DATA block
```

A document may contain several `DATA` blocks. A block has no name in the
language, so its identity is always a content hash: two documents declaring the
same triples reuse the same stored block.

## What a rule body admits

A body is a sequence of items. Order matters — SRL evaluates a body
sequentially, unlike SPARQL, where `FILTER` is scoped to its whole group. A `.`
between items is optional.

| Construct | Form |
| --- | --- |
| Triple patterns | `?s :p ?o . ?o :q ?x` |
| `FILTER` | `FILTER(?age >= 18)`, including `FILTER NOT EXISTS { … }` and the rest of SPARQL's filter syntax |
| Negation | `NOT { … }` |
| Ground negation | `NOT DATA { … }` |
| Assignment | `SET ( ?v := expr )` |
| Named tuples | `TUPLE( … )` — extension, off by default; see below |

`NOT { … }` nests. `NOT DATA { … }` sends only the negated pattern to the ground
graph, so a rule can ask "was this absent from the input?" while the rest of its
body still sees inferred triples. Setting a default value is the usual case.

`SET ( ?v := expr )` binds `?v` to the value of a SPARQL expression. It may not
re-bind a variable the body already binds, and its expression may only reference
variables already bound at that point.

## What a rule body does not admit

These are SPARQL constructs the body grammar does not include. Each is a parse
error naming the offending token.

| Construct | Reported as |
| --- | --- |
| `VALUES` | `Parse error Expecting --> } <-- but found --> 'VALUES' <--` |
| `BIND` | `Parse error Expecting --> } <-- but found --> 'BIND' <--` |
| `OPTIONAL` | `Parse error Expecting --> } <-- but found --> 'OPTIONAL' <--` |
| `UNION` | `Parse error Expecting --> } <-- but found --> '{' <--` |
| Sub-`SELECT` | `Parse error Expecting --> } <-- but found --> 'SELECT' <--` |
| `MINUS` | `Parse error Expecting --> } <-- but found --> 'MINUS' <--` |
| `GRAPH` | `Parse error Expecting --> } <-- but found --> 'GRAPH' <--` |

`BIND` has `SET` in its place, and `FILTER NOT EXISTS` — which *is* accepted,
because it is part of SPARQL's `FILTER` — has `NOT` in its place; the SRL forms
carry the sequential-evaluation semantics the compiler relies on. The rest have
no SRL equivalent.

An earlier `IF … THEN` spelling and a `FOR ?v IN :Shape` clause are both
rejected: neither is in the language.

One further source-level check runs before parsing. A directional language tag's
base direction must be exactly `ltr` or `rtl` in lower case — the tag itself is
case-insensitive, and the parser normalises the direction, so an invalid
uppercase direction has to be caught in the text:

```
SRL syntax error: invalid base direction '--LTR' (expected '--ltr' or '--rtl')
```

## Well-formedness

`checkWellFormed` runs on a document that has already parsed. It returns a list
of issues, each with a category, the rule's index, its name where it has one,
and a message. An empty list means no issues.

| Category | Condition | Message |
| --- | --- | --- |
| `unbound-head` | A head variable is bound nowhere in the body | `Head variable ?z is not bound by the rule body` |
| `set-rebinds` | `SET` targets a variable the body already binds, or two `SET`s target the same variable | `SET (?y := …) re-binds a variable already bound in the body` |
| `use-before-bind` | A `FILTER` or `SET` expression references a variable not yet bound at that point | `?y is used by a FILTER before it is bound` |

Variables introduced inside `NOT { … }` are existentially quantified within the
negated pattern and are deliberately not required to be bound outside it. They
also do not count as binding a head variable.

## Stratification

`stratify` takes the rules of a document and reports how they must be layered.
A rule R depends on rule S when a body pattern of R can match a head template of
S. Each dependency carries a label:

| Label | Meaning |
| --- | --- |
| `positive` | An ordinary dependency. R may be in the same stratum as S |
| `negative` | The dependency occurs under a `NOT`. R must be in a strictly higher stratum |
| `closed` | R is a run-once rule, so it must see its dependencies complete. Same ordering demand as `negative` |

A document is non-stratifiable exactly when a dependency cycle contains a
negative or a closed edge. The report then carries an issue naming the rules:

```
Non-stratifiable cycle involving: http://example.org/b, http://example.org/a
```

The report also gives `strata` (rule IRI to layer number, from 0), `edges` with
the triple patterns that justified each one, `monotonicity` (`monotone` or
`negation` per rule) and `runOnce`.

Stratification compares fully expanded IRIs, so `expandIris` must run on the
document first; two rules spelling the same term with different prefixes are
otherwise never matched.

### Run-once rules

A rule that mints a blank node in its head, or that assigns with `SET`, produces
a fresh answer on every firing, so iterating it has no fixpoint. Such a rule is
evaluated exactly once per execution, after everything it reads is complete, and
all of its dependencies are promoted to `closed`. This makes a cycle through one
of these rules non-stratifiable, which is the correct outcome.

Blank-node detection inspects the blank-node terms in the head's triple
templates. A labelled blank node (`_:b`) in the head marks the rule run-once; an
anonymous `[ … ]` blank node written in the head is not currently detected as
one.

## How a rule compiles to SPARQL

`compileRule` turns one rule into a standalone SPARQL program, with the
document's prologue prepended so its prefixes resolve. The program is parsed
before being returned, so a compile that succeeds has produced valid SPARQL.

An ordinary rule becomes a SPARQL UPDATE:

```sparql
PREFIX : <http://example.org/>
INSERT {
  ?x :grandparent ?z
} WHERE {
  ?x :parent ?y . ?y :parent ?z .
}
```

Passing `{ flavour: 'construct' }` emits `CONSTRUCT { … } WHERE { … }` from the
same head and body: one pass of the rule, returning the triples instead of
writing them. Nothing executes that form; it is there so a reader can paste one
pass into any endpoint and see what it would add. Neither form is stored — both
are computed on demand from the document.

Body items translate as follows:

| SRL | SPARQL |
| --- | --- |
| Triple patterns | The same triple patterns |
| `FILTER(E)` | `FILTER(E)` |
| `NOT { P }` | `FILTER NOT EXISTS { P }` |
| `NOT DATA { P }` | `FILTER NOT EXISTS { GRAPH <urn:sqlib:srl:ground> { P } }` |
| `WHERE DATA { B }` | The whole body wrapped in `GRAPH <urn:sqlib:srl:ground> { B }` |
| `SET ( ?v := E )` | `BIND(E AS ?v) FILTER(BOUND(?v))`, with everything up to and including the assignment wrapped in a group |

`urn:sqlib:srl:ground` is the named graph the executor keeps the ground data
in — the base graph plus every `DATA` block, as it stood before any rule ran.
The compiler and the executor agree on that IRI; it is exported as
`GROUND_GRAPH_IRI`.

The `SET` translation is the specification's own: a SPARQL expression either
returns a term or raises a type error, never "unbound", so `?v` unbound after
`BIND` is precisely the error signal, and `FILTER(BOUND(?v))` drops that
solution. The group around it is load-bearing. A bare

```sparql
BIND(1/0 AS ?x) FILTER(BOUND(?x)) :s ?p ?x
```

lets the later triple pattern bind `?x`, at which point the filter passes and a
solution the `SET` should have killed comes back. Wrapping gives

```sparql
{ BIND(1/0 AS ?x) FILTER(BOUND(?x)) } :s ?p ?x
```

which keeps the test scoped to the point it was written at while still letting
the expression see the variables bound before it.

If SRL ever gains an `OPTIONAL`-like construct, or an expression that can
legitimately yield unbound, the `BOUND` test needs revisiting.

## Canonical form and identity

`expandIris` rewrites prefixed names to full IRIs throughout the AST, and
`generateRuleSet` serialises back to SRL *from the AST* rather than from source
slices. Together these make canonical text independent of how the author spelled
their prefixes, so a prefix-only edit is provably not a content change. The
verbatim `headText`, `bodyText` and `prologueText` slices are kept beside the
AST for display and are not affected by expansion.

A rule's canonical form carries no prologue: prefixes are presentation, owned by
the rule set.

## The rule-tuples extension

**This is not conformant SPARQL-RL.** `TUPLE( … )` is an extension to the
language, gated by the `ruleTuples` feature flag (`FEATURE_RULE_TUPLES`), which
is **off by default**. A document written with it on cannot be read by other
SPARQL-RL tooling.

With the extension off, `TUPLE` is a syntax error:

```
SRL syntax error: TUPLE requires the rule-tuples extension (parse with { tuples: true })
```

The parser reports that rather than a bare token error, so an author is told
which extension the document needs. What a caller sees from the API — and what
the flag does and does not cover — is in
[feature flags](feature-flags.md#ruletuples-the-srl-rule-tuples-extension).

A **tuple** here is an ordered list of terms with no relation name. The store is
keyed by arity, and within an arity terms unify slot by slot: a constant must be
equal, a variable matches anything. By convention, not by enforcement, an
identifying IRI goes in the first slot.

This has nothing to do with a **tuple set**, which is a saved table of RDF terms
that fills a query's `VALUES` clause. See [concepts](../concepts.md).

### In a head

```sparql
PREFIX : <http://example.org/>
RULE { TUPLE(:rel, ?x, ?y) } WHERE { ?x :a ?y }
```

compiles to a `SELECT` whose rows the executor captures as tuples:

```sparql
PREFIX : <http://example.org/>
SELECT DISTINCT ?x ?y WHERE { ?x :a ?y . }
```

`DISTINCT` because the tuple store is a set. A head may hold triple templates or
tuple templates, not both; a rule that mixes them is refused:

```
A rule head may contain either triple templates or tuple templates, not both
```

The `construct` flavour is ignored for a tuple-producing rule — a `SELECT` has
no `CONSTRUCT` form — and the same `SELECT` comes back either way.

### In a body

```sparql
PREFIX : <http://example.org/>
RULE { ?x :b ?y } WHERE { TUPLE(:rel, ?x, ?y) }
```

compiles to an `INSERT` whose body carries a placeholder for each tuple read: a
comment recording the pattern, followed by an all-`UNDEF` `VALUES` row whose
generated slot variables are named so they miss every variable the author wrote.

```sparql
PREFIX : <http://example.org/>
INSERT { ?x :b ?y } WHERE {
  # TUPLE(:rel, ?x, ?y)
  VALUES (?_read0_slot0 ?x ?y) { (:rel UNDEF UNDEF) }
}
```

The program parses as it stands; the executor substitutes a real `VALUES` block
built from the tuple store before running it. The compile result reports the
reads it found, with their arity and rendered terms.

### Seed rows

A rule set's rules derive tuples; nothing in the language gives it one, so a
tuple relation could otherwise only ever be computed. A seed document supplies
the initial rows, in a second authoring box, parsed by `parseTupleSeeds`:

```sparql
PREFIX : <http://example.org/>
TUPLE(:reach, :a, :b)
TUPLE(:reach, :b, ?target)
```

A row whose slots are all constants is a value the store starts with. A row
carrying a variable declares an input a caller is expected to fill — the tuple
analogue of an all-`UNDEF` `VALUES` row in a query. Blank nodes are rejected: a
blank node is existential, which is meaningless as an input and unmatchable as a
store row.

IRIs in a seed document are expanded against that document's own prologue. A
caller that wants the rule set's prefixes to apply prepends the rule set
prologue to the seed text. Seed parsing is gated by the same flag; with the
extension off it refuses with:

```
SRL syntax error: tuple seed rows require the rule-tuples extension (parse with { tuples: true })
```
