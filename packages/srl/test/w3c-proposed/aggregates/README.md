# Proposed SPARQL-RL tests: `AGGREGATE`

Test cases for the rule-aggregates extension, written for the proposal in
[w3c/data-shapes#840](https://github.com/w3c/data-shapes/issues/840). They use
the W3C suite's layout and vocabulary (`shacl12-test-suite/tests/sparql-rl/`),
so each folder can be copied upstream and its `manifest.ttl` entries merged
into the matching upstream manifest if the proposal is taken up.

The syntax and semantics they test are described in
[the SRL reference](../../../../../docs/reference/srl-language.md#the-rule-aggregates-extension).
They run here in `packages/api/test/lib/RuleSetExecutor.aggregatesProposed.test.ts`,
which reads the manifests with the same reader as the vendored suite and runs
the evaluation cases through the real executor on Oxigraph, with the
`ruleAggregates` flag on. The same file checks that every positive syntax case
is rejected with the extension off.

## Syntax

| Test | Expected | What it checks |
| --- | --- | --- |
| `syntax-aggregate-01` | accepted | PER with one listed variable. |
| `syntax-aggregate-02` | accepted | No variable list: one result over the whole graph. |
| `syntax-aggregate-03` | accepted | PER * correlates on every shared variable bound earlier. |
| `syntax-aggregate-04` | accepted | GROUP BY with one listed variable. |
| `syntax-aggregate-05` | accepted | Several listed variables. |
| `syntax-aggregate-06` | accepted | Every function, DISTINCT, and an expression argument. |
| `syntax-aggregate-07` | accepted | Keywords are case-insensitive, including a lowercase aggregate beside the keyword a. |
| `syntax-aggregate-08` | accepted | The pattern may hold FILTER and NOT. |
| `syntax-aggregate-09` | accepted | An empty pattern. |
| `syntax-aggregate-10` | accepted | An aggregate inside WHERE DATA. |
| `syntax-aggregate-bad-01` | rejected | SAMPLE depends on row order, so it is not an AGGREGATE function. |
| `syntax-aggregate-bad-02` | rejected | GROUP_CONCAT depends on row order, so it is not an AGGREGATE function. |
| `syntax-aggregate-bad-03` | rejected | An AGGREGATE inside another AGGREGATE. |
| `syntax-aggregate-bad-04` | rejected | An AGGREGATE inside a NOT. |
| `syntax-aggregate-bad-05` | rejected | SET inside the pattern. |
| `syntax-aggregate-bad-06` | rejected | No assignment. |
| `syntax-aggregate-bad-07` | rejected | An assignment that is not an aggregate function. |
| `syntax-aggregate-bad-08` | rejected | An aggregate inside an aggregate argument. |
| `syntax-aggregate-bad-09` | rejected | An aggregate function in a FILTER, outside AGGREGATE. |
| `syntax-aggregate-bad-10` | rejected | PER with no variables. |
| `syntax-aggregate-bad-11` | rejected | GROUP BY with no variables. |
| `syntax-aggregate-bad-12` | rejected | An aggregate in a rule head. |

## Well-formedness

| Test | Expected | What it checks |
| --- | --- | --- |
| `wellformed-aggregate-01` | accepted | The outer row is kept, so ?name, bound before the aggregate, can reach the head. |
| `wellformed-aggregate-02` | accepted | A listed variable used only in the pattern's FILTER: the rank idiom. |
| `wellformed-aggregate-03` | accepted | Two aggregates may each have their own variable called ?y. |
| `wellformed-aggregate-04` | accepted | A later pattern may join on a result. |
| `wellformed-aggregate-05` | accepted | A FILTER on a result after the aggregate does the work of HAVING. |
| `wellformed-aggregate-06` | accepted | PER * with no shared variable is a whole-graph aggregate. |
| `wellformed-aggregate-bad-01` | rejected | A listed variable must be bound before the aggregate. |
| `wellformed-aggregate-bad-02` | rejected | A listed variable must be used in the pattern. |
| `wellformed-aggregate-bad-03` | rejected | ?y is used inside and before the aggregate without being listed: correlation must be written down. |
| `wellformed-aggregate-bad-04` | rejected | ?y is used inside and after the aggregate without being listed. |
| `wellformed-aggregate-bad-05` | rejected | ?y is used inside the aggregate and in the head. |
| `wellformed-aggregate-bad-06` | rejected | PER * correlates only on what is bound before it, so ?y bound after it clashes. |
| `wellformed-aggregate-bad-07` | rejected | A result must be a new variable. |
| `wellformed-aggregate-bad-08` | rejected | The same result twice in one aggregate. |
| `wellformed-aggregate-bad-09` | rejected | A result assigned again by a later SET. |
| `wellformed-aggregate-bad-10` | rejected | A result that is also a pattern variable. |
| `wellformed-aggregate-bad-11` | rejected | An argument variable the pattern does not bind. |
| `wellformed-aggregate-bad-12` | rejected | After GROUP BY only the listed variables and the results are bound, so ?name cannot reach the head. |
| `wellformed-aggregate-bad-13` | rejected | After GROUP BY, a FILTER cannot use an unlisted earlier variable. |
| `wellformed-aggregate-bad-14` | rejected | A FILTER inside the pattern sees only the listed variables from outside, so ?lo is not bound there. |

## Stratification

| Test | Expected | What it checks |
| --- | --- | --- |
| `stratification-aggregate-01` | accepted | The aggregate counts a relation another rule derives, which puts it in a later stratum. |
| `stratification-aggregate-02` | accepted | A chain: a count feeds a second aggregate in a later stratum. |
| `stratification-aggregate-03` | accepted | A recursive rule below an aggregate over its result. |
| `stratification-aggregate-bad-01` | rejected | The result feeds the pattern of the same rule. |
| `stratification-aggregate-bad-02` | rejected | Two rules in a cycle through an aggregate. |
| `stratification-aggregate-bad-03` | rejected | The aggregate reads a predicate that a rule in its own cycle derives through a positive edge. |

## Evaluation

Each case runs its rule set against a data file and compares the inferred
triples with `<name>-results.ttl`.

| Data file | Contents |
| --- | --- |
| `data-family.ttl` | `:bob` (names "Bob" and "Robert") with children aged 10, 10 and 7; `:amy` (name "Amy") with none |
| `data-scores.ttl` | `:a`–`:d` in `:sales` scoring 90, 85, 85, 70; `:e`, `:f` in `:ops` scoring 60, 50 |
| `data-staff.ttl` | `:ann` in `:sales` with two roles; `:bo` in `:sales` with one |
| `data-parents.ttl` | `:bob :parentOf :c1, :c2` and `:c3 :childOf :bob`; `:amy` with none |
| `data-strings.ttl` | `:x` with string values, `:y` with the integers 1 and 2 |
| `data-empty.ttl` | nothing |

| Test | What it checks |
| --- | --- |
| `eval-aggregate-01` | COUNT per person: a person with no children gets 0. |
| `eval-aggregate-02` | SUM counts every solution, so two children aged 10 both count; an empty group sums to 0. |
| `eval-aggregate-03` | SUM(DISTINCT) adds each value once. |
| `eval-aggregate-04` | Every outer row is kept: Bob has two names and each row has 3 children, not 6. |
| `eval-aggregate-05` | MIN, MAX and AVG have no value on an empty group, so Amy's row is dropped. |
| `eval-aggregate-06` | COUNT(*) counts solutions; COUNT(DISTINCT ?p) counts people. Ann has two roles. |
| `eval-aggregate-07` | Rank within a department: 1 plus the number of people in it with a higher score. Ties share a rank. |
| `eval-aggregate-08` | Dense rank with PER *, counting distinct higher scores. |
| `eval-aggregate-09` | GROUP BY gives the same counts where the head uses only the listed variable and the result. |
| `eval-aggregate-10` | The aggregate counts :childOf only after the rule deriving it is complete, so Bob gets 3 and no partial count. |
| `eval-aggregate-11` | WHERE DATA counts only the given graph: the derived :childOf triples are not counted. |
| `eval-aggregate-12` | An aggregate error drops the row: SUM over strings has no value, SUM over numbers does. |
| `eval-aggregate-13` | On an empty graph a whole-graph COUNT is 0 and a MAX has no value. |
| `eval-aggregate-14` | A FILTER on the result after the aggregate keeps only people with more than one child. |
| `eval-aggregate-15` | Two aggregates in one rule, each with its own ?y. |
| `eval-aggregate-16` | NOT inside the pattern: count the children not aged 7. |
