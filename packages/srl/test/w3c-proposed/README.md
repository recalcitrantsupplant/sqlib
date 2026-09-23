# Proposed SPARQL-RL tests: the order of `NOT`

Tests we'd like to contribute to the W3C suite
(`w3c/data-shapes`, `shacl12-test-suite/tests/sparql-rl/`). They use the suite's
own layout and vocabulary, so `eval/` and `wellformed/` can be copied into the
matching upstream directories and their manifest entries merged into the
upstream `manifest.ttl` files.

They run here through the real executor in
`packages/api/test/lib/RuleSetExecutor.negationOrder.test.ts`, which reads these
manifests with the same reader as the vendored suite.

## Why

An SRL rule body is a sequence. A `NOT` is checked against the bindings made
*before* it, so a variable that is bound only *after* it is free inside the
negation, and the `NOT` asks "does this match anywhere at all?". A SPARQL
`FILTER NOT EXISTS` sees its whole group wherever it is written. So an
implementation that translates `NOT` to `FILTER NOT EXISTS` in place gets the
SPARQL answer, and nothing in the current suite notices:

- the only upstream rule with a `NOT` ahead of its binder is
  `stratification/stratification-04.srl`, which is a stratification test, so
  nothing checks what it infers;
- every evaluation test puts the `NOT` after the patterns that bind its
  variables, where the two readings agree.

`FILTER` and `SET` don't need tests like these. Using a variable before it is
bound makes the rule ill-formed, so no valid rule can tell the two readings
apart.

## Evaluation tests

Data files:

| File | Triples |
| --- | --- |
| `data-neg-order-1.ttl` | `:a :p 1 . :b :p 2 . :a :q 1 .` |
| `data-neg-order-2.ttl` | `:a :p 1 . :b :p 2 . :a :owner :o1 . :b :owner :o2 . :o1 :banned true .` |
| `data-neg-order-3.ttl` | `:other :p "XYZ" .` |
| `data-empty.ttl` | nothing |

"Literal SPARQL" is what `FILTER NOT EXISTS` written in the same place infers.
We checked it by running these tests against sqlib's compiler before the fix.
The controls give the same answer both ways. They make sure an implementation
can't pass the other tests just by treating an early `NOT` as always failing.

| Test | Body | Data | SRL (expected) | Literal SPARQL |
| --- | --- | --- | --- | --- |
| 01 (control) | `?x :p ?y NOT { ?x :q ?y }` | 1 | `:b :r 2` | same |
| 02 | `NOT { ?x :q ?y } ?x :p ?y` | 1 | nothing | `:b :r 2` |
| 03 (control) | `NOT { ?x :zz ?y } ?x :p ?y` | 1 | `:a :r 1`, `:b :r 2` | same |
| 04 | `?x :p ?any NOT { ?x :q ?y } ?z :p ?y` | 1 | `:b :r 1`, `:b :r 2` | adds `:a :r 2` |
| 05 (control) | `stratification-04.srl` as is | empty | `:sz :p "abc"` | same |
| 06 | `stratification-04.srl` as is | 3 | nothing | `:sz :p "abc"` |
| 07 (control) | `?x :p ?v SET (?y := ?v) NOT { ?x :q ?y }` | 1 | `:b :r 2` | same |
| 08 | `?x :p ?y NOT { NOT { ?o :banned true } ?x :owner ?o }` | 2 | `:a :r 1`, `:b :r 2` | `:a :r 1` |
| 09 | `NOT DATA { ?x :q ?y } ?x :p ?y` | 1 | nothing | `:b :r 2` |
| 10 | `WHERE DATA { NOT { ?x :q ?y } ?x :p ?y }` | 1 | nothing | `:b :r 2` |

Every head is `?x :r ?y`, except in 05 and 06, which use the upstream rule set
unchanged.

- **06** makes `stratification-04` check results. Its `NOT { ?s :p "XYZ" }`
  comes before the `SET` that binds `?s`, so any `:p "XYZ"` triple blocks the
  rule. In SPARQL only `:sz :p "XYZ"` would.
- **04** has one shared variable bound before the `NOT` and one bound after it.
  This catches an implementation that only handles a `NOT` placed first.
- **08** puts the misplaced `NOT` inside another `NOT`, where the bindings made
  before the outer `NOT` are already in scope.
- **09** and **10** cover the ground-graph forms, which implementations often
  compile down a separate path.

## Well-formedness tests

| Test | Body | Expected |
| --- | --- | --- |
| `wellformed-neg-order-01` | `?x :p ?y NOT { ?x :q ?z FILTER ( ?z != ?y ) }` | accepted |
| `wellformed-neg-order-bad-01` | `NOT { ?x :q ?z FILTER ( ?z != ?y ) } ?x :p ?y` | rejected |
| `wellformed-neg-order-bad-02` | `NOT { ?x :q ?z SET ( ?w := ?y ) } ?x :p ?y` | rejected |

These rely on our reading of the negation condition: the inner pattern must be
well-formed given the variables bound before the `NOT`, so a `FILTER` or `SET`
inside it can't use a variable that is bound only later in the outer body.

## Points to raise with the spec alongside the tests

- The "Relationship between SPARQL-RL and SPARQL" section maps `NOT` to
  `FILTER NOT EXISTS` without saying that the two differ when the `NOT` comes
  before a binder of one of its variables.
- The spec could close the gap with one more well-formedness condition: a
  variable of a negation that is bound elsewhere in the body must be bound
  before the negation. That would make `NOT` behave like `FILTER` and `SET`,
  whose misplacement is already an error rather than a change of meaning.
  `stratification-04` would then be ill-formed and need rewriting.
- Or, if the global "matches anywhere" reading is intended, the spec should say
  so, and tests like these would pin it down.
