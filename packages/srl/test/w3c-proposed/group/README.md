# Proposed SPARQL-RL tests: `GROUP` and aggregation

These are the `GROUP` tests proposed for the W3C SPARQL-RL suite in the
data-shapes working notes `notes-1347/proposed-tests.html`, written on
2026-10-26. The files here were generated from the lists in the notes'
generator, `notes-1347/gen-proposed-tests.py`, so their text matches the notes.
The one exception is `eval-group-13`, described below.

The notes are written against `gh-pages` at `a6ed26f7`, with three open SRL
pull requests assumed merged:

| Pull request | Commit | What the tests depend on |
| --- | --- | --- |
| [w3c/data-shapes#1375](https://github.com/w3c/data-shapes/pull/1375) | `a3eac70d` | A comma between aggregation assignments. |
| [w3c/data-shapes#1377](https://github.com/w3c/data-shapes/pull/1377) | `a8ad0e5e` | The well-formedness conditions, with the group pattern starting from the keys bound before the `GROUP`, and `evalAggregate`. |
| [w3c/data-shapes#1376](https://github.com/w3c/data-shapes/pull/1376) | `007d5333` | The specification's example, in which a key with no match gets no result. |

Each folder uses the suite's layout and vocabulary, and the comment above each
entry in its `manifest.ttl` says what that test checks. The notes give the
reasoning for each test.

| Folder | Positive | Negative |
| --- | --- | --- |
| `syntax/` | 14 | 26 |
| `wellformed/` | 11 | 15 |
| `stratification/` | 4 | 3 |
| `eval/` | 23 | |

They run in `packages/api/test/lib/RuleSetExecutor.aggregatesProposed.test.ts`,
which reads the manifests with the vendored suite's reader. It runs the
evaluation tests through the executor on Oxigraph, with the `ruleAggregates`
flag on.

## Change from the notes: `eval-group-13`

In the notes, `eval-group-13` is

```
RULE { ?t ?st ?n } WHERE {
    ?t rdf:type :Team
    GROUP BY ?t ?st { ?t :owns ?c . ?c :status ?st } [ ?n := COUNT(*) ]
}
```

The head `?t ?st ?n` can generate a triple that matches `?t :owns ?c` in the
group pattern. Under the specification's Rule Dependency section, the rule
therefore has a closed dependency on itself, and the rule set is not
stratifiable. sqlib refuses it for that reason.

The copy here uses `WHERE DATA`, which matches against the base graph and gives
the rule no dependencies. On this test's data the inferred triples are the
same. The notes' version needs the same change, or a head with a constant
predicate, before it is proposed upstream.
