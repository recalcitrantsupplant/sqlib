# Authoring and running SHACL 1.2 rules

sqlib stores and runs inference rules written in SRL, the rule language of the
SHACL 1.2 Rules specification. This guide describes:

- the entities of a rule set,
- how to write a document,
- what stratification requires,
- how to run a rule set against a data graph.

The grammar is in the [SRL language reference](../reference/srl-language.md).

The `rulesSuite` flag (`FEATURE_RULES_SUITE`, default on) controls SRL support.
See [feature flags](../reference/feature-flags.md).

## Rules, data blocks and rule sets

A **rule** is one `RULE` production. It has a head of triple templates, and a
body that says when they apply.

```srl
PREFIX : <http://example/>

RULE { ?x :dependsOn ?y } WHERE { ?x :callsService ?y }
```

A **data block** is a `DATA { … }` block of ground triples. The parser rejects a
document that puts a variable in a data block. sqlib adds the data blocks to the
evaluation graph before any rule runs. Data blocks are part of the rule set, so
their triples appear in the inference graph that the run returns. The base graph
is separate: the caller supplies it for each run.

A **rule set** is the unit that you run. It is a versioned entity. Each version
lists the rule versions and data block versions that it contains. One rule can
therefore belong to several rule sets. A rule set version is an immutable
snapshot of the combination.

An **SRL document** is the text form of a rule set. It has a prologue of
`PREFIX` and `BASE` declarations, then rules and data blocks in any order.

To import a document into a rule set, send it to `POST /rule-sets/:id/srl`.
sqlib splits it into one rule version for each rule, and makes a new rule set
version. sqlib stores each rule in canonical form, with IRIs expanded and no
prologue. An edit that changes only prefixes is therefore no content change, and
a second import of the same rules makes no new rule versions.

The rule set version also keeps the document as written. `GET
/rule-sets/:id/srl` returns it with the prefixes, layout and comments of its
author, and reports `documentSource: "stored"`. Some versions have no stored
document: older versions, and versions built from a list of rule versions. For
these, sqlib generates the document from the canonical rules. The `prologue`
query parameter gives the prefixes to print. The response reports
`documentSource: "generated"`.

## Writing a document

A rule body can contain a basic graph pattern, and these constructs:

| Construct | Effect |
| --- | --- |
| `FILTER(…)` | an ordinary SPARQL filter |
| `NOT { … }` | the pattern must not match |
| `NOT DATA { … }` | the pattern must not match *the input*; triples inferred so far are ignored |
| `SET (?v := expr)` | bind `?v` to the value of an expression |
| `WHERE DATA { … }` | evaluate the whole body against the input, and ignore inferred triples |

```srl
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX :    <http://example/>

DATA {
  :componentA rdf:type :Component .
}

RULE :exposure { ?x :exposedTo ?v } WHERE {
  ?x :dependsOn ?y .
  ?y :hasVulnerability ?v .
}

RULE { ?x :status :safeToDeploy } WHERE {
  ?x rdf:type :Component .
  NOT { ?x :status :criticallyExposed }
}
```

The optional IRI after `RULE` names the rule. sqlib expands it as it expands any
other IRI. `:exposure` and the same IRI written in full are therefore the same
name. Execution records attribute results to that name.

A body differs from a SPARQL group pattern in three ways:

- sqlib evaluates a body **in order**. A `FILTER` or `SET` can refer only to
  variables that are bound earlier in the body. In SPARQL, a `FILTER` applies to
  its whole group.
- A `NOT` can name a variable that a later element binds. Inside the `NOT`, that
  variable is unbound. `NOT { ?x :q ?y } ?x :p ?y` fires only if no `:q` triple
  exists. For a check on each solution, write the `NOT` after the patterns that
  bind its variables.
- `SET` cannot bind a variable again that the body already binds.

The body must bind every variable in the head. Variables inside a `NOT` are
existentially quantified in the negated pattern, so they are not bindings.

The parser checks these well-formedness conditions in
`packages/srl/src/wellformed.ts`. Each failure has the severity `error`:

| Category | Condition |
| --- | --- |
| `unbound-head` | a head variable is not bound by the body |
| `set-rebinds` | a `SET` binds a variable that is already bound |
| `use-before-bind` | a `FILTER` or `SET` uses a variable before it is bound |
| `aggregate-scope` | a variable breaks the scope rules of `GROUP` |

A document can have correct syntax and still fail these conditions.

Two more checks mark rules that are legal but probably wrong. In each case, one
name refers to two separate variables:

| Category | Severity | Marks |
| --- | --- | --- |
| `group-shadowing` | `warning` | A variable in a `GROUP` pattern has the name of a variable bound before the `GROUP`, and is not listed after `BY`. The pattern sees only its keys, so the two variables are separate. To use the same value, list the variable after `BY`. |
| `not-before-binding` | `info` | A variable in a `NOT` is unbound when the `NOT` runs, and a later element binds it. To test the same value, move the `NOT` after that element. |

Only errors make a document ill-formed. Each issue has `from` and `to`, the
range of the analysed text that it is about. The unit is UTF-16 code units: the
string indices of JavaScript and the positions of CodeMirror. When the document
was parsed with `sourceLocations: true`, the range is the variable. `POST
/rule-sets/srl/analyze` parses this way. Otherwise the range is the whole rule.

`POST /rule-sets/srl/analyze` returns what an editor needs while you write:

- the line range and label of each rule and data block,
- the stratum and monotonicity of each rule,
- the dependency edges between rules,
- any well-formedness issues.

A syntax error returns `valid: false` with the message of the parser, and no
4xx status. In an editor, a half-written document is the usual case.

`POST /rule-sets/srl/compile` gives each rule as standalone SPARQL. The default
form is `INSERT { head } WHERE { body }`. With `flavour: "construct"`, the form
is `CONSTRUCT { head } WHERE { body }`. This is one pass of the rule, and it
returns the triples without writing them. Paste it into another endpoint to see
what a rule would add.

The compiler translates the SRL constructs as follows:

| SRL | SPARQL |
| --- | --- |
| `NOT { P }` | `FILTER NOT EXISTS { P }`, in a group when a later pattern binds one of its variables, so that the filter cannot see that binding |
| `SET (?v := E)` | `BIND(E AS ?v) FILTER(BOUND(?v))`, in a group |
| `WHERE DATA`, `NOT DATA` | a `GRAPH <urn:sqlib:srl:ground>` pattern, over a copy of the input that the executor keeps |

## Stratification

Rule R **depends on** rule S when a body pattern of R can match a head template
of S. There are three kinds of dependency:

| Kind | When | Order |
| --- | --- | --- |
| **positive** | the usual case | R is in the same stratum as S or a later one |
| **negative** | the body pattern is in a `NOT` | R is in a later stratum than S, so the absence that R tests is final |
| **closed** | R is a run-once rule | R is in a later stratum than S, for the same reason |

A rule is run-once when its head makes a blank node, or its body contains a
`SET`. Each firing of such a rule gives a new answer, so iteration of the rule
has no fixpoint. The specification therefore evaluates the rule once in its
stratum, after everything that it reads is complete. The closed dependencies
make sure of this order.

A document is **not stratifiable** when a dependency cycle contains a negative
or a closed edge. Execution refuses such a rule set. An answer from it would
depend on an iteration limit.

```
RuleSetVersion urn:… is not stratifiable: Non-stratifiable cycle involving: …
```

The report names the rules in the cycle. When the cycle contains a run-once rule,
the report also gives the reason that the rule is run-once: `blank-node head` or
`assignment (SET)`. A document that is not stratifiable has no strata, so the
report gives none.

The rule set editor shows the same result:

- Run is disabled, with the reason.
- The gutter marks each rule in the cycle with ⊘, where a stratum number
  usually shows.
- The Stratification tab draws the cycle. It labels each dependency with the
  pattern and the head that cause it, for example
  `NOT ?s :p "ABC" → :s :p "ABC"`. Each dependency links to its lines.
- The tab gives the reason that the rules have no order, and three ways to
  break the cycle: rewrite one `NOT`; write it as `NOT DATA` if it must test
  only the input; or make a pattern narrower, so that it does not match the
  head of the other rule.

Evaluation runs one stratum at a time, in ascending order. In a stratum, the
run-once rules fire on the first pass and not again. The other rules iterate to
the fixpoint of that stratum. Then the next stratum starts.

`maxIterations` limits the iterations of one stratum. A run of several strata
can therefore report more iterations in total than the limit. The default is 5.

sqlib calculates stratification for each **rule version**. The rules of one
version run as one SPARQL program, so one run-once rule makes its whole version
run-once. An import of an SRL document puts each rule in its own version, so
each rule gets its own stratum.

## Running a rule set

```
POST /rule-sets/{id}/execute
{
  "version": 3,
  "dataGraphVersionId": "urn:sqlib:data-graph-version:…",
  "inferenceFormat": "text/turtle",
  "maxIterations": 10
}
```

Supply the base graph for each run, with one of these:

- `dataGraphVersionId`, a pinned version;
- `dataGraphId`, the current version of the graph;
- `dataGraphInline` with `dataGraphInlineFormat`.

If you omit `version`, the current version of the rule set runs.
`inferenceFormat` is `application/n-triples` (the default), `text/turtle`,
`application/rdf+xml` or `application/ld+json`.

The response contains:

- `status`: `converged`, `cycle`, `maxIterations` or `failed`.
- `iterations`: one entry for each pass. Each entry names the stratum that it
  evaluated. For each rule, it gives the duration, the triples inserted and
  deleted, and samples of them.
- `dataBlocks` and `seededQuads`: what the data blocks added.
- `finalGraphContent` and `finalGraphContentType`: the inference graph in the
  requested format. `finalGraphNQuads` has the same graph as N-Quads.

`POST /rule-sets/{id}/execute/stream` takes the same body. It reports the same
run as server-sent events, one for each pass.

Two environment variables limit a run:

- `RULE_EXECUTION_TIMEOUT_MS` (default 30000) for each rule evaluation;
- `RULE_EXECUTION_SAMPLE_LIMIT` (default 10) for the number of example quads in
  each record.

A query group can also run a rule set, as a rule set node that receives RDF on
an incoming `RDF_GRAPH` edge. See [query groups](query-groups.md).

## The W3C conformance suite

The SHACL 1.2 Rules test suite is in `packages/srl/test/w3c`. The file `SOURCE`
in that directory records the pinned commit. The pinned snapshot has six
categories:

| Directory | Entries | Asserts |
| --- | --- | --- |
| `syntax/` | 212 | the document parses, or must not |
| `wellformed/` | 33 | the well-formedness conditions |
| `stratification/` | 21 | a document that cannot be stratified is rejected |
| `eval/` | 59 | the inference graph a run produces |
| `eval2/` | 6 | the same, on larger inputs |
| `examples/` | 5 | the examples from the specification |

To run them on your computer, in a separate store:

```bash
just run-local-rules-tests   # API and MCP on http://localhost:3005
just run-frontend-rules      # the UI, with the flags that API serves
```

The recipe sets `SEED_W3C_RULES_SUITE=true`. This loads each manifest entry into
a library as an ordinary `Test`:

- An eval entry becomes a rule set run against a data graph. The expected
  inference graph is the expectation.
- An entry of the three document categories becomes an analysis expectation
  that names the check.

The tests run on the Tests screen, through the usual test runner. Seeding is
idempotent, so a restart seeds nothing again.

Two flags have an effect on the suite:

- `FEATURE_RULES_SUITE` and `FEATURE_TESTS` must both be on. Otherwise nothing
  is seeded.
- `FEATURE_RULES_ALLOW_INVALID_SAVE=true` lets sqlib store the documents that
  are intentionally unparseable. About a third of the suite asserts rejection.
  These documents open in the editor with the error from the parser. Without
  the flag, sqlib skips them.

`W3C_RULES_SUITE_DIR` sets a different location for the suite. Use it for a
deployment that ships `packages/api` without the monorepo.

[Testing and conformance](testing-and-conformance.md) describes how tests are
written, run and reported, and the conformance report from the results of the
suite.

## The rule-tuples extension

SRL in this repository has an extension, `TUPLE( … )`. With it, a rule can read
and write ordered tuples of RDF terms, in addition to triples. The extension is
**not part of SHACL 1.2 Rules**. Other tools cannot read a document that uses
it.

The `ruleTuples` feature flag (`FEATURE_RULE_TUPLES`) controls the extension.
Its default is **off**. When the flag is off:

- The server refuses a request that uses the extension: a `tuplesEnabled` rule
  set version, a `tupleSeeds` document, or a tuple seed input on an execute. The
  error is `The rule-tuples extension is not enabled on this server`.
- The UI shows no control for the extension.
- A document that contains `TUPLE( … )` is a syntax error:

```
SRL syntax error: TUPLE requires the rule-tuples extension (parse with { tuples: true })
```

The `TupleSet` entity and the `tupleSets` flag are a separate feature with a
similar name. A tuple set is a saved table of RDF terms that sqlib puts into the
`VALUES` clause of a query. Queries and argument sets use it. The `ruleTuples`
flag has no effect on it.

## Aggregation with `GROUP`

`GROUP` calculates `COUNT`, `SUM`, `MIN` and `MAX` over a pattern in a rule
body:

```sparql
PREFIX : <http://example.org/>
RULE { ?x :numChildren ?n }
WHERE { ?x a :Person . GROUP BY ?x { ?y :childOf ?x } [ ?n := COUNT(*) ] }
```

The syntax follows the grammar in
[w3c/data-shapes#1347](https://github.com/w3c/data-shapes/pull/1347). That pull
request is not merged. Until it is, the `ruleAggregates` feature flag
(`FEATURE_RULE_AGGREGATES`) controls `GROUP`, with the default **off**. When the
flag is off, a document that contains `GROUP` is a syntax error:

```
SRL syntax error: GROUP requires the rule-aggregates extension (parse with { aggregates: true })
```

[The SRL reference](../reference/srl-language.md#aggregation-group) gives the
value of a `GROUP`, the variables that stay bound after it, and how it
stratifies and compiles.
