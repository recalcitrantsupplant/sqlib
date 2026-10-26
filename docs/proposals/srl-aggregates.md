# Aggregates in SRL: design, decisions and notes

> **Superseded.** This records the `AGGREGATE PER` / `GROUP BY` design, which is
> kept on branch `feat/srl-aggregates` and tag `archive/srl-aggregates-per`.
> Branch `feat/srl-group` implements the `GROUP` syntax of
> [w3c/data-shapes#1347](https://github.com/w3c/data-shapes/pull/1347) instead:
> `GROUP BY ?k { … } [ ?n := COUNT(*) ]`, which collapses to the keys and
> results (this page's `GROUP BY` mode), with no `PER`, no `AVG`, no expression
> arguments, and `DISTINCT` on `COUNT` only.

This summarises the discussion of aggregates for SHACL 1.2 Rules (SRL), the
design implemented on branch `feat/srl-aggregates`, and the points that needed
working through along the way. The upstream discussion is
[w3c/data-shapes#840](https://github.com/w3c/data-shapes/issues/840).

The reference for the implemented syntax and semantics is
[the SRL reference](../reference/srl-language.md#aggregation-group).
This page records why it is that way.

## The upstream proposals

Three people have proposed or commented on syntax in #840:

| Who | Syntax | Grouping | Variables after the aggregate |
| --- | --- | --- | --- |
| Livio Robaldo (issue body) | `BIND(SELECT(SUM(?a), { P }) AS ?s)` | implicit: shared variable names | all outer variables |
| Andy Seaborne (2026-09-21) | `SET(?n := COUNT[?x] { P })`, or `COUNT { P }` grouping on all earlier variables | explicit `[?x]`, or implicit | keys and results only |
| Andy Seaborne (2026-10-01) | `AGG(<uri>, [?x] { P } (?a := COUNT(*), ?b := SUM(?z)))` | explicit | keys and results only |
| Livio Robaldo (2026-10-01) | `SET(?n, ?a := COUNT[?x], AVG[?y] { P })` | implicit: shared variable names | all outer variables |

osavkovic (2026-09-20) agreed that predicates inside an aggregate must not be in
a recursive dependency with the rule, and suggested the ASP aggregates
`#count`, `#sum`, `#max` and `#min` as the starting set.

The bracket means different things in the two later proposals. In Andy's
`COUNT[?x]` it lists the group keys; in Livio's `COUNT[?x]` it is the argument
being aggregated.

### Problems found in Livio's 2026-10-01 comment

- It reads Andy's example as saying the patterns before the aggregate are
  irrelevant. In Andy's model they supply the incoming rows, which is how `?x`
  is restricted to people who know `:alice` or `:bob`.
- It says correlating on shared variables "corresponds to GROUP BY". Joining
  first and then grouping by `?x` multiplies counts when the outer pattern has
  several rows per `?x`: a person with two friends and three children gets 6.
  Evaluating the inner pattern once per distinct `?x` gives 3.
- With implicit correlation, reusing a variable name inside the aggregate
  silently changes what is counted.
- Positional assignment (`?n, ?a := COUNT[..], AVG[..]`) separates each name
  from its function.
- Empty groups, errors in one of several assignments, and inner variables bound
  only later in the body are left undefined.

## The implemented design

```sparql
PREFIX : <http://example.org/>
RULE { ?x :numChildren ?n ; :oldestChild ?oldest }
WHERE {
  ?x a :Person .
  AGGREGATE PER ?x { ?y :childOf ?x ; :age ?age }
            ( ?n := COUNT(*), ?oldest := MAX(?age) )
}
```

The syntax follows Andy's general `AGG` form: an explicit variable list, an
inner pattern, and a list of named assignments. The choice to keep the outer
rows follows Livio.

### Join forms

| Form | What the inner pattern sees from outside | Bound afterwards |
| --- | --- | --- |
| `AGGREGATE PER ?x …` | the listed variables | every earlier variable, plus the results |
| `AGGREGATE { … }` | nothing: one result over the whole graph | every earlier variable, plus the results |
| `AGGREGATE PER *` | every inner variable bound earlier (Livio's implicit form) | every earlier variable, plus the results |
| `AGGREGATE GROUP BY ?x …` | the listed variables | the listed variables and the results only (Andy's collapse) |

### Semantics

1. The aggregate receives the rows produced by the elements before it.
2. The inner pattern is evaluated once for each distinct value of the listed
   variables among those rows.
3. Each function runs over the set of solutions of the inner pattern, with every
   inner variable included. `DISTINCT` removes duplicate argument values first.
4. `PER` adds the results to every incoming row; `GROUP BY` then collapses the
   rows to the listed variables and the results.
5. On an empty group `COUNT` and `SUM` give 0; `MIN`, `MAX` and `AVG` have no
   value and the row is dropped.
6. An error in any assignment drops the row, as an error in `SET` does.
7. A rule with an aggregate is run-once, so everything it counts is complete
   before it fires. Recursion through an aggregate is refused.

## Decisions

| Decision | Reason |
| --- | --- |
| Explicit `PER ?x` as the main form | Correlation is written down, so renaming or reusing a variable cannot change a count unnoticed |
| `PER *` and `GROUP BY` offered as syntax, not as a server setting | A rule's meaning should be visible in its text, not depend on configuration |
| Keep outer rows under `PER` | Avoids repeating the outer pattern after the aggregate (Andy's `foaf:name` example), and allows one result per outer row (see "Blank nodes in the head") |
| Count over the set of solutions with all inner variables | Matches SPARQL and Soufflé, so two children aged 10 both count towards `SUM`. ASP's default (aggregate over the tuple you name) would give 17 instead of 27 unless the child is included in the tuple |
| `COUNT(DISTINCT ?p)` inside the function | SRL has no `DISTINCT` of its own; without it, counting people rather than (person, role) pairs needs a helper rule |
| 0 for `COUNT` and `SUM` on an empty group | A person with no children should have a count of 0, not be missing |
| An unlisted inner variable used outside the aggregate is an error | Correlation is never implicit and never silently absent. Relaxing this to SPARQL's scoping later would not break any valid rule |
| No `HAVING` | A `FILTER` on the result after the aggregate does the same job |
| `SAMPLE` and `GROUP_CONCAT` refused | Their results depend on the order an engine produces rows in |
| Run-once, all dependencies closed | A count is only final once what it counts is complete |
| Stay within SPARQL 1.1 | Rules still compile to one SPARQL program, so an arbitrary SPARQL endpoint could run them |
| A deployment flag only, no per-version switch | Rule tuples need a per-version switch for their seed rows; an aggregate lives entirely in the rule text |

## Implementation

Branch `feat/srl-aggregates`, rebased on `main` at `de36aaa`, not pushed:

- `c15fdbc` adds the extension: grammar (`packages/srl/src/aggregates/`),
  well-formedness, stratification, compilation, formatting, the
  `ruleAggregates` feature flag (`FEATURE_RULE_AGGREGATES`, default off), API
  gating, and documentation.
- `95d2ebf` adds 64 test cases in the W3C suite's format under
  `packages/srl/test/w3c-proposed/aggregates/`, run through the executor on
  Oxigraph.
- `ddf8b80` types the grammar rule so the `any` ratchet stays at its baseline.

With the flag off, `AGGREGATE` is a syntax error wherever the server parses a
rule, and a stored aggregate rule fails its run by name instead of executing
its saved program.

### How it compiles

An aggregate becomes an `OPTIONAL` subquery grouped by the listed variables,
with the inner variables renamed so the subquery shares only the listed
variables with the outer body. A hidden count distinguishes an empty group from
a failed aggregate. When a listed variable appears inside only in a `FILTER`
(the rank idiom), the subquery is seeded with the outer rows' distinct key
values, which repeats the outer pattern inside it.

### Not done

- The editor grammar (`@kurrawongai/codemirror-lang-srl`) does not know
  `AGGREGATE` and colours it as an error.
- `COUNT(DISTINCT ?p ?r)` over several variables: SPARQL has no equivalent.
- A warning when a `PER` aggregate feeds a head that mints blank nodes.
- Accepting Andy's and Livio's own syntaxes behind a dialect switch. Each could
  be translated into the same internal form; the obstacle is that `COUNT[?x]`
  means different things in the two.
- Whether implicit correlation (`PER *`) should be the default, for consistency
  with how `NOT` already correlates on shared names.

## Points that needed clarification

### "Variables visible afterwards"

This means which variables the head and the later body elements can still use
once the aggregate has run. `GROUP BY` keeps its keys; what disappears are the
outer variables that are not keys. Under `GROUP BY ?x`, a `?name` matched before
the aggregate is unbound afterwards, as a non-grouped column is in SQL. Under
`PER ?x` it stays bound.

### The `PER` list is not a group key

Keeping every outer row is the same as grouping by every outer variable. The
list after `PER` only says which outer variables the inner pattern can see. So
there are two separate things:

| | Decided by |
| --- | --- |
| Which rows come out | always all outer variables (implicitly) |
| What the inner pattern correlates with | the `PER` list |

Adding `?name` to the list changes nothing unless the inner pattern mentions
`?name`, in which case it counts something different per name.

### `PER *`

`PER *` is `PER` with the list filled in: every inner variable bound by an
earlier element. It compiles identically. The difference is in what it catches:
with an explicit list, an unlisted shared name is an error; with `PER *`, it is
correlated automatically.

### `PER` as an outer join

`PER` behaves like a lateral left outer join from the outer rows to the
per-key results. It keeps a row whose group is empty only for `COUNT` and
`SUM`, which fill in 0; `MIN`, `MAX` and `AVG` drop the row. `GROUP BY` uses the
same join and then collapses the rows, so the join type is not what separates
the two forms.

### What decides how often the inner pattern runs

The distinct values of the listed variables among the outer rows, not the
number of inner solutions. With orders `:o1`–`:o3` from supplier `:A` and `:o4`
from `:B`, and outer pattern `?o :supplier ?x`, there are four outer rows but
two distinct `?x` values. The inner pattern runs twice and counts 3 for A and
1 for B. The four `?p :supplier ?x` matches are what is counted.

### Blank nodes in the head

A blank node in the head, including the reifier an RDF 1.2 annotation creates,
is minted once per row. Under `PER` the outer rows survive, so in the supplier
example A gets three `:summary` nodes, each with `:orders 3`. With a plain
triple head the copies merge and nothing is visible.

| Example | `PER` | `GROUP BY` |
| --- | --- | --- |
| Supplier summary, outer pattern through orders | 4 nodes | 2 |
| Per-person stats, Bob has two names | 3 (two for Bob, one for Amy with 0) | 2 |
| One share node per order carrying its supplier's total | 4, as intended | not allowed: `?o` is unbound after the collapse |
| Annotated `:orderCount` triple | 4 reifiers | 2 |

Each form has a case only it can express, which is an argument for offering
both.

### Set and bag semantics

Datalog uses sets; SPARQL uses bags (multisets of solutions). For SRL's inner
pattern (triple patterns, `FILTER`, `NOT`) the two give the same counts,
because a basic graph pattern over a set graph yields each distinct binding
once. The difference that matters is between counting all inner variables
(SPARQL, Soufflé) and counting the tuple you name (ASP):

| Data | All inner variables | ASP, tuple = age |
| --- | --- | --- |
| Children aged 10, 10, 7: `SUM` of ages | 27 | 17 |

Each default has a failure mode: counting all variables over-counts when the
pattern has a variable you did not mean to count (fixed with `DISTINCT`); ASP
under-sums when equal values collapse.

### Getting one value per item: helper rules, not ASP tuples

Counting every inner solution goes wrong when the pattern has a variable that
multiplies an item's rows and the aggregated value can repeat across items.
Orders `:o1` (100, tags `:urgent` and `:export`) and `:o2` (100, tag `:urgent`):

| Over `{ ?o :amount ?a ; :tag ?t }` | Result |
| --- | --- |
| `SUM(?a)` | 300: `:o1` counts once per tag |
| `SUM(DISTINCT ?a)` | 100: the two amounts collapse |
| intended | 200 |

ASP states the item directly: `#sum{ A,O : amount(O,A), tag(O,T) }` sums over
distinct `(A, O)` pairs. Three ways to get the same answer were considered:

| Approach | Verdict |
| --- | --- |
| `AGGREGATE { ?o :amount ?a NOT { NOT { ?o :tag ?t } } } ( ?total := SUM(?a) )` | Works today: a double `NOT` checks that a tag exists without adding rows. Hard to read |
| Multi-variable `DISTINCT`: `SUM(DISTINCT ?a, ?o)` | ASP's meaning exactly, with no change to existing syntax. Needs its own grammar rule (Traqula's aggregate takes one expression) and a separate subquery per assignment. Not implemented |
| A helper rule that derives one fact per item, then a plain aggregate | Chosen as the documented approach |

The helper-rule form:

```sparql
RULE { ?o :taggedAmount ?a } WHERE { ?o :amount ?a ; :tag ?t }
RULE { :all :total ?total } WHERE { AGGREGATE { ?o :taggedAmount ?a } ( ?total := SUM(?a) ) }
```

It gives 200 because the helper's head holds one triple per order, and a graph
is a set. It keeps rules as small steps, each of which can be inspected and
tested, and it states what one item is in a rule head rather than inside a
function call. Stratification runs the helper first without anything being
written for it. The costs:

- The intermediate triples stay in the output graph. With the rule-tuples
  extension on, `TUPLE(:taggedAmount, ?o, ?a)` keeps them out; the aggregate
  reads the tuple in its pattern.
- Each step needs a predicate name.
- The helper's head must keep the item's identity: `:all :amountSeen ?a` would
  collapse the amounts again.

Both forms run in `RuleSetExecutor.aggregates.test.ts`. Multi-variable
`DISTINCT` remains a possible later addition; adding it would not change the
meaning of any existing rule.

### ASP

Answer Set Programming, a logic programming paradigm descended from Datalog;
clingo is its best-known implementation. Its aggregates (`#count`, `#sum`, …)
can also appear inside recursion, given meaning by stable-model semantics. The
extension refuses that case through stratification.

### Rank is not recursion, and SPARQL can already rank

The rank rule compares each row with other rows of the same data, which is a
self-join; nothing it derives feeds back into its pattern. SPARQL 1.1 can
compute the same rank with `OPTIONAL` and `GROUP BY`:

```sparql
SELECT ?p (COUNT(?o) + 1 AS ?rank) WHERE {
  ?p :dept ?d ; :score ?s .
  OPTIONAL { ?o :dept ?d ; :score ?s2 FILTER(?s2 > ?s) }
} GROUP BY ?p ?d ?s
```

Within a department the ranks are continuous except at ties, which skip
(1, 2, 2, 4). `COUNT(DISTINCT ?s2)` gives dense ranking (1, 2, 2, 3). Ranks
like 1, 13, 27 would mean the partition variable is missing from the inner
pattern.

### Does the extension go beyond SPARQL?

No. Every `AGGREGATE` compiles to a SPARQL 1.1 program. What it saves is
writing the outer pattern twice, the `OPTIONAL` and `COALESCE` for zero counts,
the handling that tells an empty group from an error, and avoiding inflated
counts. SPARQL 1.1 lacks correlated subqueries; a proposed `LATERAL` operator
(SEP-0006, implemented in Apache Jena) would add them. Examples where a plain
subquery and `LATERAL` differ:

| Query | Plain subquery | `LATERAL` |
| --- | --- | --- |
| Latest post per author with `LIMIT 1` | one post overall | one per author |
| `COUNT` of children with `?x` not projected | every person gets the global count | per person, with 0 for none |
| Rank with `FILTER(?s2 > ?s)` on an outer `?s` | no rows: `?s` is unbound inside | correct ranks |

The second and third `LATERAL` results depend on whether outer bindings reach
variables the subquery does not project. That has not been checked against
Jena, and the status of `LATERAL` in SPARQL 1.2 has not been confirmed.

### Copying SPARQL's syntax instead

A SPARQL subquery as a body element would get scoping right through its
projection list, but it cannot give 0 for an empty group (SRL has no
`OPTIONAL`), it would have to be a restricted subset of SPARQL anyway, and the
working group has already chosen SRL-specific forms (`SET`, `NOT`) over
SPARQL's.
