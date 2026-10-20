# SRL language reference

SRL is the surface syntax sqlib uses for SHACL 1.2 inference rules. The parser,
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
| `FILTER` | `FILTER(?age >= 18)`, and the rest of SPARQL's filter syntax except `EXISTS` / `NOT EXISTS` |
| Negation | `NOT { … }` |
| Ground negation | `NOT DATA { … }` |
| Assignment | `SET ( ?v := expr )` |
| Named tuples | `TUPLE( … )` — extension, off by default; see below |

`NOT { … }` sees only the variables bound before it. A variable it shares with
the body but that is bound only *after* it is free inside the negation, so

```
RULE { ?x :r ?y } WHERE { NOT { ?x :q ?y } ?x :p ?y }
```

means "if no `:q` triple exists anywhere, every `?x :p ?y`", not "every
`?x :p ?y` unless `?x :q ?y`". Put the `NOT` after the patterns that bind its
variables for the per-solution reading. `FILTER` and `SET` have no such trap:
using a variable before it is bound makes the rule ill-formed (`use-before-bind`
below).

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

`BIND` has `SET` in its place, and `FILTER EXISTS` / `FILTER NOT EXISTS` —
rejected with `NOT EXISTS is not part of SRL — write the negation as NOT { … }`
— have `NOT` in theirs; the SRL forms carry the sequential-evaluation semantics
the compiler relies on. The rest have no SRL equivalent.

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
also do not count as binding a head variable. A `FILTER` or `SET` *inside* a
`NOT` is held to the same order rule: it may use the variables bound before the
`NOT` and those the negated pattern binds ahead of it, and nothing bound later
in the outer body.

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
negative or a closed edge. The report then carries an issue naming the rules,
in the order they were given:

```
Non-stratifiable cycle involving: http://example.org/a, http://example.org/b
```

It also carries each such cycle as data in `cycles`: the rules on it, every
dependency between them (with the triple patterns that made it), whether it
fails through negation or through a run-once rule, and a `witness`:

```
{ kind: 'negation', rules: ['a', 'b'], edges: [ … ], witness: [{ from: 'a', to: 'b', label: 'negative', reasons: [ … ] }, … ] }
```

The witness is the shortest loop through a `negative` or `closed` edge, in path
order (each edge's `to` is the next edge's `from`, and the last leads back to
the first). A cycle can hold more rules and dependencies than that; the witness
is the smallest part of it that shows why the rules cannot be ordered.

The report also gives `strata` (rule IRI to layer number, from 0), `edges` with
the triple patterns that justified each one, `monotonicity` (`monotone` or
`negation` per rule) and `runOnce`. `strata` is **empty** for a
non-stratifiable document: no layering exists, and the layers the algorithm
had reached when it gave up depend only on its iteration cap and on edge order.

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
templates, after Turtle's shorthand is expanded. A labelled blank node (`_:b`),
an anonymous `[ … ]`, a list `( … )` and a reified triple `<< … >>` without a
named reifier all mint a fresh node on every firing, so each marks the rule
run-once.

Stratification matches the triples that shorthand stands for, in RDF 1.2 terms,
in heads and bodies alike. `[ … ]` and `( … )` assert their triples about a
blank node. `<< s p o >>` does not assert `s p o`: it asserts that its reifier
`rdf:reifies` the triple term `<<( s p o )>>`. An annotation (`~ :r` or
`{| … |}`) asserts the triple it follows, that the reifier `rdf:reifies` it, and
the annotation's own triples about the reifier.

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

A `NOT` that mentions a variable bound only after it also closes a group: see
[The order of `NOT`](#the-order-of-not) below.

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

### The order of `NOT`

`NOT` needs the same treatment for the same reason. SRL checks a negation
against the bindings made before it; `FILTER NOT EXISTS` sees its whole group
wherever it is written. The two agree whenever every variable the `NOT` shares
with the body is bound before it, and then the `NOT` compiles to a bare
`FILTER NOT EXISTS` in place. When a later element binds one of its variables,
everything up to and including the negation is wrapped in a group:

```sparql
# RULE { ?x :r ?y } WHERE { NOT { ?x :q ?y } ?x :p ?y }
{ FILTER NOT EXISTS { ?x :q ?y } } ?x :p ?y
```

Without the group the filter would see `?x` and `?y` from the triple pattern
after it and check each solution separately, which is a different rule. The
same applies to a `SET` after the `NOT` and to a `NOT` nested inside another.

Importing SPARQL (`sparqlToRule`) runs the other way. A `FILTER` or
`FILTER NOT EXISTS` written before a pattern, `BIND` or nested group that binds
one of its variables is moved to the end of its group, where SRL's in-order
reading matches SPARQL's, and the import reports a `filter-moved` warning.
`MINUS` and `BIND` stay where they are: SPARQL evaluates both in place too.

`packages/srl/test/w3c-proposed/` holds evaluation tests for these cases in the
W3C suite's format, each with data on which the SRL and literal-SPARQL readings
infer different triples; its README lists both answers.

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

**This is not conformant SHACL 1.2 Rules.** `TUPLE( … )` is an extension to the
language, gated by the `ruleTuples` feature flag (`FEATURE_RULE_TUPLES`), which
is **off by default**. A document written with it on cannot be read by other
SHACL 1.2 Rules tooling.

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

## Aggregation: `GROUP`

`GROUP` is the aggregation element proposed for SPARQL-RL in
[w3c/data-shapes#1344](https://github.com/w3c/data-shapes/issues/1344), with
the grammar of
[w3c/data-shapes#1347](https://github.com/w3c/data-shapes/pull/1347). **Until
that pull request is merged it is not in the specification**, so it is gated by
the `ruleAggregates` feature flag (`FEATURE_RULE_AGGREGATES`), which is **off
by default**.

With the flag off, `GROUP` is a syntax error:

```
SRL syntax error: GROUP requires the rule-aggregates extension (parse with { aggregates: true })
```

### Syntax

`GROUP` is a rule body element: optional `BY` variables, a pattern, and a block
of assignments.

```sparql
PREFIX : <http://example.org/>
RULE { ?c :employees ?n ; :salaryBill ?t }
WHERE {
  ?c a :Company .
  GROUP BY ?c { ?x :employee ?c ; :salary ?s }
  [ ?n := COUNT(DISTINCT ?x)
    ?t := SUM(?s) ]
}
```

| Part | Form |
| --- | --- |
| `BY` | one or more variables, no separator; may be left out |
| pattern | triple patterns, `FILTER` and `SET`; with the rule-tuples extension on, `TUPLE( … )` |
| block | `[ ?v := FUNCTION(…) … ]`, one or more assignments with no separator, or `[]` for none |
| functions | `COUNT(*)`, `COUNT(?v)`, `COUNT(DISTINCT ?v)`, `COUNT(DISTINCT *)`, `SUM(?v)`, `MIN(?v)`, `MAX(?v)` |

The block is required, even when empty, because its closing `]` marks the end
of the element: a triple pattern after a `GROUP` can start with `(`.

These are refused, each with a message naming the fault: `AVG`, `SAMPLE`,
`GROUP_CONCAT`, an expression as an argument (`SUM(?a + 1)`), `DISTINCT` in
`SUM`, `MIN` or `MAX`, a `NOT` in the pattern, a `GROUP` inside another `GROUP`
or a `NOT`, and commas or parentheses in the block.

### Evaluation

`GROUP` runs in *augment mode*, as agreed in
[w3c/data-shapes#840](https://github.com/w3c/data-shapes/issues/840): it adds
the results to the rows it receives and keeps every variable they bind.

1. The `GROUP` receives the rows produced by the elements before it.
2. The pattern's solutions are grouped by the `BY` variables, the only
   variables the pattern shares with those rows. A `BY` variable bound before the `GROUP`
   selects that key's group; one the earlier rows do not bind takes its values
   from the pattern. With no `BY`, every solution falls in one group.
3. Each function runs over the solutions in a group, every pattern variable
   included. Two children aged 10 are two solutions, so `SUM(?age)` counts
   both. How many rows the earlier elements gave for a key does not change
   the result: a person with two names and two children counts 2.
4. Every row keeps what it had, and gains the `BY` variables and the results.
   The pattern's other variables stay inside the `GROUP`.

| The pattern matches | `COUNT`, `SUM` | `MIN`, `MAX` |
| --- | --- | --- |
| at least once | the value | the value |
| never, for a key bound before the `GROUP` | `0` | no value: the row is dropped |

These are the rules of
[w3c/data-shapes#1344](https://github.com/w3c/data-shapes/issues/1344): "`SUM`
of nothing is zero" and "`MIN` of nothing is an error and the row is not
produced". A key that only the pattern supplies has no value when nothing
matches, so it gives no row.

An error in any assignment, such as `SUM` over a string, drops the row, as an
error in `SET` does. An empty block, `[]`, keeps every row.

`COUNT(?v)` counts the solutions in which `?v` is bound, and every pattern
variable is bound in every solution, so it equals `COUNT(*)`. To count distinct
values, write `COUNT(DISTINCT ?v)`. For the same reason `COUNT(DISTINCT *)`
equals `COUNT(*)`.

### Well-formedness

Violations are reported under the category `aggregate-scope`:

- Each `BY` variable must be bound before the `GROUP`, by its pattern, or both.
  Only one bound before can have a row with a count of 0. A `BY` variable the
  pattern does not use is carried through unchanged.
- A pattern variable that is not a `BY` variable belongs to the `GROUP`, `SET`
  targets included, as a variable a subquery does not project belongs to the
  subquery. One of the same name before or after the `GROUP` is a different
  variable. To correlate it, list it after `BY`. Unlike a `NOT`, which sees
  every variable bound before it, a `GROUP` sees only its `BY` variables.
- Each result must be a new variable: not bound before, not used in the
  pattern, and not assigned again later in the body.
- A `SET` in the pattern must not re-bind a variable, and each argument must be
  bound by the pattern or be a `BY` variable.

A `FILTER` or `SET` in the pattern follows the usual order rule, with only the
`BY` variables bound from outside.

### Patterns that follow from the evaluation

**Using an earlier variable after the `GROUP`.** It is still bound:

```sparql
?x a :Person ; :name ?name .
GROUP BY ?x { ?y :childOf ?x } [ ?n := COUNT(*) ]
```

A person with two names keeps two rows, each with the same count.

**Counting per value the pattern supplies.** Leave the key out of the body
before the `GROUP`. Bind it first instead when a value with nothing to count
should still get 0:

```sparql
GROUP BY ?d { ?p :dept ?d } [ ?n := COUNT(*) ]                # no row for an empty department
?d a :Dept . GROUP BY ?d { ?p :dept ?d } [ ?n := COUNT(*) ]   # 0 for an empty department
```

**Two `GROUP`s in one rule.** The second keeps the first one's result:

```sparql
?x a :Person .
GROUP BY ?x { ?y :childOf ?x } [ ?n := COUNT(*) ]
GROUP BY ?x { ?y :childOf ?x ; :age ?a FILTER(?a >= 18) } [ ?m := COUNT(*) ]
```

**Rank within a partition.** The keys come from before the `GROUP`, and the
comparison is a `FILTER` in the pattern:

```sparql
PREFIX : <http://example.org/>
RULE { ?p :rankInDept ?rank }
WHERE {
  ?p :dept ?dept ; :score ?score .
  GROUP BY ?dept ?score { ?o :dept ?dept ; :score ?s2 FILTER(?s2 > ?score) }
  [ ?better := COUNT(*) ]
  SET (?rank := ?better + 1)
}
```

**One value per item.** When a pattern variable has several values per item, it
multiplies that item's rows. With two orders of 100, one carrying two tags, `SUM`
over `{ ?o :amount ?a ; :tag ?t }` gives 300. Derive the items in a rule of
their own and aggregate those:

```sparql
PREFIX : <http://example.org/>
RULE { ?o :taggedAmount ?a } WHERE { ?o :amount ?a ; :tag ?t }
RULE { :all :total ?total }
WHERE { GROUP { ?o :taggedAmount ?a } [ ?total := SUM(?a) ] }
```

The total is 200, because the helper's head holds one triple per order. Keep
the item's identity in the helper's head: `:all :amountSeen ?a` would collapse
the two amounts into one. With the rule-tuples extension on,
`TUPLE(:taggedAmount, ?o, ?a)` keeps the helper relation out of the output
graph.

### Stratification

A rule with a `GROUP` is run-once, with the reason `aggregate (GROUP)`, and its
monotonicity is reported as `aggregation`. As for any run-once rule, every
dependency becomes `closed`, so whatever the pattern reads is complete before
the rule fires. A rule whose result feeds back into its own pattern forms a
cycle and is refused.

### Compilation

A `GROUP` compiles to an `OPTIONAL` subquery that groups the pattern by the `BY`
variables, joined to the elements before it. The pattern's own variables are
renamed (`?_agg0_y`), so the subquery shares only the keys with the rest of the
body. When the pattern supplies a key the elements before do not bind, the
subquery is joined without `OPTIONAL`, because an empty group has no value for
that key. For
`RULE { ?x :numChildren ?n } WHERE { ?x a :Person . GROUP BY ?x { ?y :childOf ?x } [ ?n := COUNT(*) ] }`,
`compileRule` returns:

```sparql
PREFIX : <http://example.org/>
INSERT {
  ?x :numChildren ?n
} WHERE {
  {
  ?x <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> :Person .
  OPTIONAL {
  SELECT ?x (COUNT(*) AS ?_agg0_count) (COUNT( * ) AS ?_agg0_v0) WHERE {
  ?_agg0_y :childOf ?x .
}
GROUP BY ?x
}
  BIND(IF(COALESCE(?_agg0_count, 0) > 0, ?_agg0_v0, 0) AS ?n)
  FILTER(BOUND(?n))
}
}
```

`?_agg0_count` tells an empty group (no subquery row) from a failed aggregate (a
row whose value is unbound). When a `BY` variable is used in the pattern only in
a `FILTER`, as `?score` is in the rank example, the subquery cannot compute it,
since SPARQL evaluates a subquery without the outer bindings. The subquery is
then seeded with the distinct key values from the elements before the `GROUP`,
which repeats those elements inside it.

### Test cases

`packages/srl/test/w3c-proposed/pr-1347/` holds the pull request's own syntax
tests, and `packages/srl/test/w3c-proposed/aggregates/` holds further cases for
syntax, well-formedness, stratification and evaluation, in the W3C suite's
format. Both run in `packages/api/test/lib/RuleSetExecutor.aggregatesProposed.test.ts`.
