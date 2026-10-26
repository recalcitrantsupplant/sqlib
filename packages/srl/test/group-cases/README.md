# sqlib's GROUP cases

sqlib's own test cases for `GROUP` aggregation. They predate the suite's
`GROUP` tests, which are now in the vendored W3C snapshot in [`../w3c/`](../w3c/SOURCE),
and they are kept because they check sqlib's implementation in more detail than
a conformance suite needs to. They use the W3C suite's layout and vocabulary,
so they are read with the same manifest reader.

They assert the semantics of
[w3c/data-shapes#1377](https://github.com/w3c/data-shapes/pull/1377): every
earlier variable stays bound after the `GROUP`; a `BY` variable may come from
before the `GROUP` or from its pattern; a key whose pattern has no solutions
forms no group, so its row is dropped whatever the functions are; a pattern
variable that is not a `BY` variable is local to the `GROUP`, whatever is bound
before or after it. Assignments are separated by commas, as in
[w3c/data-shapes#1375](https://github.com/w3c/data-shapes/pull/1375).

Until #1377, these cases gave `COUNT` and `SUM` of an empty group the value 0.
The evaluation cases that depended on that now expect no row instead.

The syntax and semantics are described in
[the SRL reference](../../../../docs/reference/srl-language.md#aggregation-group).
They run in `packages/api/test/lib/RuleSetExecutor.groupCases.test.ts`,
which reads the manifests with the same reader as the vendored suite and runs
the evaluation cases through the executor on Oxigraph, with the
`ruleAggregates` flag on. The same file checks that every positive syntax case
is rejected with the flag off.

## Syntax

| Test | Expected | What it checks |
| --- | --- | --- |
| `syntax-group-agg-01` | accepted | GROUP BY with one variable. |
| `syntax-group-agg-02` | accepted | No BY: one group over every input row. |
| `syntax-group-agg-03` | accepted | Several BY variables, with no separator. |
| `syntax-group-agg-04` | accepted | Every function, and DISTINCT in COUNT, with a comma between assignments. |
| `syntax-group-agg-05` | accepted | Keywords are case-insensitive. |
| `syntax-group-agg-06` | accepted | The pattern may hold FILTER and SET. |
| `syntax-group-agg-07` | accepted | An empty pattern. |
| `syntax-group-agg-08` | accepted | A GROUP inside WHERE DATA. |
| `syntax-group-agg-09` | accepted | Assignments laid out one per line. |
| `syntax-group-agg-10` | accepted | A triple pattern starting with ( may follow the block, which ends the GROUP. |
| `syntax-group-agg-11` | accepted | An empty block may be written with space inside. |
| `syntax-group-agg-bad-01` | rejected | SAMPLE is not an aggregation function. |
| `syntax-group-agg-bad-02` | rejected | GROUP_CONCAT is not an aggregation function. |
| `syntax-group-agg-bad-03` | rejected | AVG is not an aggregation function. |
| `syntax-group-agg-bad-04` | rejected | A GROUP inside another GROUP. |
| `syntax-group-agg-bad-05` | rejected | A GROUP inside a NOT. |
| `syntax-group-agg-bad-06` | rejected | NOT inside the pattern. |
| `syntax-group-agg-bad-07` | rejected | An assignment that is not an aggregation function. |
| `syntax-group-agg-bad-08` | rejected | An aggregation function inside an aggregation function. |
| `syntax-group-agg-bad-09` | rejected | An aggregation function in a FILTER, outside GROUP. |
| `syntax-group-agg-bad-10` | rejected | No comma between assignments. |
| `syntax-group-agg-bad-11` | rejected | Parentheses around an assignment. |
| `syntax-group-agg-bad-12` | rejected | Assignments in parentheses rather than a [ ] block. |
| `syntax-group-agg-bad-13` | rejected | An expression argument to SUM. |
| `syntax-group-agg-bad-14` | rejected | An aggregation function in a rule head. |

## Well-formedness

| Test | Expected | What it checks |
| --- | --- | --- |
| `wellformed-group-agg-01` | accepted | The rank idiom: the keys come from before the GROUP, and the person matched after it joins on them. |
| `wellformed-group-agg-02` | accepted | Two GROUPs may each have their own pattern variable called ?y. |
| `wellformed-group-agg-03` | accepted | A later pattern may join on a result. |
| `wellformed-group-agg-04` | accepted | A FILTER on a result after the GROUP does the work of HAVING. |
| `wellformed-group-agg-05` | accepted | A BY variable the pattern does not use is carried through the GROUP. |
| `wellformed-group-agg-06` | accepted | A variable first used after the GROUP is bound there as usual. |
| `wellformed-group-agg-07` | accepted | A second GROUP may list the first one's result as a key. |
| `wellformed-group-agg-08` | accepted | A BY variable the body before the GROUP does not bind is supplied by the pattern. |
| `wellformed-group-agg-09` | accepted | A pattern variable used again after the GROUP is a new variable, as after a NOT (#690). |
| `wellformed-group-agg-10` | accepted | Augment mode: an earlier variable reaches the head through the GROUP. |
| `wellformed-group-agg-11` | accepted | Augment mode: a FILTER after the GROUP may use an earlier variable that is not a key. |
| `wellformed-group-agg-12` | accepted | A second GROUP keeps the first one's result without listing it. |
| `wellformed-group-agg-13` | accepted | ?y bound before the GROUP and ?y in its pattern are different variables. |
| `wellformed-group-agg-bad-01` | rejected | ?y belongs to the pattern, so nothing binds it for the head. |
| `wellformed-group-agg-bad-02` | rejected | A result must be a new variable. |
| `wellformed-group-agg-bad-03` | rejected | The same result twice in one GROUP. |
| `wellformed-group-agg-bad-04` | rejected | A result assigned again by a later SET. |
| `wellformed-group-agg-bad-05` | rejected | A result that is also a pattern variable. |
| `wellformed-group-agg-bad-06` | rejected | An argument variable the pattern does not bind. |
| `wellformed-group-agg-bad-07` | rejected | A FILTER in the pattern sees only the BY variables from outside, so ?lo is not bound there. |
| `wellformed-group-agg-bad-08` | rejected | A SET in the pattern must not re-bind a variable. |
| `wellformed-group-agg-bad-09` | rejected | A SET target in the pattern is a pattern variable, so it cannot reach the head. |

## Stratification

| Test | Expected | What it checks |
| --- | --- | --- |
| `stratification-group-agg-01` | accepted | The GROUP counts a relation another rule derives, which puts it in a later stratum. |
| `stratification-group-agg-02` | accepted | A chain: a count feeds a second GROUP in a later stratum. |
| `stratification-group-agg-03` | accepted | A recursive rule below a GROUP over its result. |
| `stratification-group-agg-bad-01` | rejected | The result feeds the pattern of the same rule. |
| `stratification-group-agg-bad-02` | rejected | Two rules in a cycle through a GROUP. |
| `stratification-group-agg-bad-03` | rejected | The GROUP reads a predicate that a rule in its own cycle derives through a positive edge. |

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
| `data-people.ttl` | `:alice` (names "Alice" and "Ali") with two children aged 10; `:bob` with one aged 7; `:carol` with none; departments `:sales` (Alice, Bob), `:eng` (Carol) and `:hr` (nobody) |

| Test | What it checks |
| --- | --- |
| `eval-group-agg-01` | COUNT per person: a person with no children forms no group and gets no count. |
| `eval-group-agg-02` | SUM counts every solution, so two children aged 10 both count; an empty group gives no sum. |
| `eval-group-agg-03` | COUNT(DISTINCT ?a) counts each age once. |
| `eval-group-agg-04` | Bob has two names. Listing ?name in BY carries it through: each name row gets the count of 3, not 6. |
| `eval-group-agg-05` | MIN and MAX have no value on an empty group, so Amy's row is dropped. |
| `eval-group-agg-06` | COUNT(*) counts solutions; COUNT(DISTINCT ?p) counts people. Ann has two roles. |
| `eval-group-agg-07` | Rank within a department: 1 plus the number of people in it with a higher score. Ties share a rank. The top score forms no group, so it gets no rank. |
| `eval-group-agg-08` | Dense rank, counting distinct higher scores. The top score gets no rank. |
| `eval-group-agg-09` | COUNT(DISTINCT *) equals COUNT(*): the solutions of a pattern are already distinct. |
| `eval-group-agg-10` | The GROUP counts :childOf only after the rule deriving it is complete, so Bob gets 3 and no partial count. |
| `eval-group-agg-11` | WHERE DATA counts only the given graph: the derived :childOf triples are not counted. |
| `eval-group-agg-12` | An aggregation error drops the row: SUM over strings has no value, SUM over numbers does. |
| `eval-group-agg-13` | On an empty graph a GROUP with no BY forms no group, so neither COUNT nor MAX gives a value. |
| `eval-group-agg-14` | A FILTER on the result after the GROUP keeps only people with more than one child. |
| `eval-group-agg-15` | Two GROUPs in one rule; the second lists the first one's result as a key. Each person has an empty group in one of them, so nothing is inferred. |
| `eval-group-agg-16` | SET in the pattern: each child's age next year, summed. |
| `eval-group-agg-17` | An empty block keeps the earlier rows whose pattern matches, as COUNT does. |
| `eval-group-agg-18` | A GROUP with no BY makes one group of every match of its pattern, and adds the result to every earlier row. |
| `eval-group-agg-19` | Augment mode: earlier variables reach the head; two names do not double a count; no children gives no row. |
| `eval-group-agg-20` | The pattern supplies the key: a department nobody works in has no row. |
| `eval-group-agg-21` | The key is bound before the GROUP: a department nobody works in has no row. |
| `eval-group-agg-22` | One key from before the GROUP, one only from the pattern: an empty group gives no row. |
| `eval-group-agg-23` | A second GROUP keeps the first one's result without listing it. |
| `eval-group-agg-24` | A pattern variable used again after the GROUP is a new variable (#690). |
| `eval-group-agg-25` | A pattern variable with the name of one bound before the GROUP is a new variable. |
