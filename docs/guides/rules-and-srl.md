# Authoring and running SPARQL-RL rules

sqlib stores and runs inference rules written in SRL, the SPARQL Rule Language
defined by [SPARQL 1.2 RL](https://www.w3.org/TR/sparql12-rl/) (SPARQL-RL).
This guide covers the entities a rule set is made of, how to write a document,
what stratification requires of it, and how to run one against a data graph.
The grammar itself is in the [SRL language reference](../reference/srl-language.md).

SRL support is behind the `rulesSuite` flag (`FEATURE_RULES_SUITE`, default on);
see [feature flags](../reference/feature-flags.md).

## Rules, data blocks and rule sets

A **rule** is one `RULE` production: a head of triple templates and a body that
says when they apply.

```srl
PREFIX : <http://example/>

RULE { ?x :dependsOn ?y } WHERE { ?x :callsService ?y }
```

A **data block** is a `DATA { … }` block of ground triples — no variables are
allowed in one, and the parser rejects a document that puts one there. Data
blocks are seeded into the evaluation graph before any rule runs, and they are
part of the rule set, so their triples appear in the inference graph the run
returns. They are separate from the base graph, which is data the caller
supplies per run.

A **rule set** is the unit you run. It is a versioned entity whose version lists
the rule versions and data block versions it contains, so the same rule can
belong to several rule sets and a version is an immutable snapshot of the
combination.

An **SRL document** is the textual form of all of that: a prologue of
`PREFIX`/`BASE` declarations, then rules and data blocks in any order. A
document is imported into a rule set with `POST /rule-sets/:id/srl`, which
splits it into one rule version per rule and mints a new rule set version.
Rules are stored canonically, with IRIs expanded and no prologue, so a
prefix-only edit is provably not a content change and re-importing does not
churn versions. `GET /rule-sets/:id/srl` renders the set back as one document,
taking a `prologue` query parameter for the prefixes to print.

## Writing a document

Beyond a plain basic graph pattern, a rule body may contain:

| Construct | Means |
| --- | --- |
| `FILTER(…)` | an ordinary SPARQL filter |
| `NOT { … }` | the pattern must not match |
| `NOT DATA { … }` | the pattern must not match *the input*, ignoring anything inferred so far |
| `SET (?v := expr)` | bind `?v` to an expression's value |
| `WHERE DATA { … }` | evaluate the whole body against the input, not the growing graph |

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

The optional IRI after `RULE` names the rule. It is expanded like any other
IRI, so `:exposure` and a rule named with the same IRI written in full are the
same name, and execution records attribute results to it.

Three things a body does differently from SPARQL:

- A body is evaluated **in order**. A `FILTER` or `SET` may only reference
  variables bound earlier in the body, where SPARQL scopes a `FILTER` to its
  whole group.
- `SET` may not re-bind a variable the body already binds.
- Every variable in a head must be bound by the body. Variables inside `NOT`
  are existentially quantified within the negated pattern and do not count as
  bindings.

Those are the three well-formedness conditions the parser checks
(`packages/srl/src/wellformed.ts`), reported as `unbound-head`, `set-rebinds`
and `use-before-bind`. A document can be syntactically legal and still fail
them.

While a document is being written, `POST /rule-sets/srl/analyze` returns what an
editor needs: the line range and label of every rule and data block, each rule's
stratum and monotonicity, the dependency edges between rules, and any
well-formedness issues. A syntax error comes back as `valid: false` with the
parser's message rather than as a 4xx, because a half-written document is the
normal case there.

`POST /rule-sets/srl/compile` renders each rule as standalone SPARQL:
`INSERT { head } WHERE { body }` by default, or `CONSTRUCT { head } WHERE
{ body }` with `flavour: "construct"` — one pass of the rule, returning the
triples instead of writing them, which is what to paste into another endpoint to
see what a rule would add. In the compiled form `NOT { P }` becomes
`FILTER NOT EXISTS { P }`, `SET (?v := E)` becomes `BIND(E AS ?v)
FILTER(BOUND(?v))` inside a group, and `WHERE DATA` / `NOT DATA` become a
`GRAPH <urn:sqlib:srl:ground>` pattern over a copy of the input the executor
keeps.

## Stratification

A rule R **depends on** rule S when a body pattern of R can match a head
template of S. The dependency is:

- **positive** ordinarily — R must not be evaluated in an earlier stratum than
  S;
- **negative** when the body pattern sits under a `NOT` — R must be strictly
  later, so that what it looks for the absence of is already complete;
- **closed** when R is a *run-once* rule — again strictly later, for the same
  reason.

A rule is run-once when its head mints a blank node or its body contains a
`SET`. Either makes every firing produce a fresh answer, so iterating the rule
has no fixpoint; the specification's answer is to evaluate it exactly once, per
stratum, after everything it reads is complete. That is what promoting its
outgoing dependencies to closed guarantees.

A dependency cycle containing a negative or a closed edge cannot be layered, so
the document is **not stratifiable**. Execution refuses such a rule set outright
rather than producing an answer that depends on an iteration limit:

```
RuleSetVersion urn:… is not stratifiable: Non-stratifiable cycle involving: …
```

The report names the rules in the cycle, and a cycle rejected for a run-once
rule also names why that rule is run-once (`blank-node head`,
`assignment (SET)`).

Evaluation then proceeds one stratum at a time, in ascending order. Within a
stratum the run-once rules fire on the pass that activates it and never again,
and the remaining rules iterate to that stratum's own fixpoint before the next
stratum starts. `maxIterations` bounds a single stratum's iterations, not the
whole run, so a multi-stratum run can report more total iterations than the
limit. The default is 5.

Stratification is computed per **rule version**, and a version's rules run as
one SPARQL program, so one run-once rule makes its whole version run-once.
Importing an SRL document splits it into one rule per version, which restores
per-rule precision.

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

The base graph is supplied per run, as one of `dataGraphVersionId` (pinned),
`dataGraphId` (the graph's current version) or `dataGraphInline` with
`dataGraphInlineFormat`. Omitting `version` runs the rule set's current version.
`inferenceFormat` is one of `application/n-triples` (the default),
`text/turtle`, `application/rdf+xml` or `application/ld+json`.

The response carries:

- `status` — `converged`, `cycle`, `maxIterations` or `failed`;
- `iterations` — one entry per pass, each naming the stratum it evaluated and,
  per rule, its duration, the triples it inserted and deleted, and samples of
  them;
- `dataBlocks` and `seededQuads` — what the data blocks contributed;
- `finalGraphContent` and `finalGraphContentType` — the inference graph
  serialised in the requested format, with `finalGraphNQuads` beside it.

`POST /rule-sets/{id}/execute/stream` takes the same body and reports the same
run as server-sent events, for a client that wants each pass as it happens.

Two environment variables bound a run: `RULE_EXECUTION_TIMEOUT_MS` (default
30000) per rule evaluation, and `RULE_EXECUTION_SAMPLE_LIMIT` (default 10) for
how many example quads each record carries.

Rule sets are also runnable from a query group, as a rule set node handed RDF by
an incoming `RDF_GRAPH` edge — see [query groups](query-groups.md).

## The W3C conformance suite

The SPARQL-RL test suite is vendored at `packages/srl/test/w3c`, pinned to
a commit recorded in `SOURCE` beside it. Its six categories, at the pinned
snapshot:

| Directory | Entries | Asserts |
| --- | --- | --- |
| `syntax/` | 139 | the document parses, or must not |
| `wellformed/` | 8 | the well-formedness conditions |
| `stratification/` | 10 | a document that cannot be stratified is rejected |
| `eval/` | 35 | the inference graph a run produces |
| `eval2/` | 6 | the same, on larger inputs |
| `examples/` | 5 | the examples from the specification |

To run them locally, in a store of their own:

```bash
just run-local-rules-tests   # API and MCP on http://localhost:3005
just run-frontend-rules      # the UI, with the flags that API serves
```

The recipe sets `SEED_W3C_RULES_SUITE=true`, which loads every manifest entry
into a library as an ordinary `Test`: the eval categories as a rule set run
against a data graph with the expected inference graph as the expectation, and
the three document categories as an analysis expectation naming the check. They
run on the ordinary Tests screen through the ordinary test runner. Seeding is
idempotent, so restarting re-seeds nothing.

Two flags matter to it. `FEATURE_RULES_SUITE` and `FEATURE_TESTS` must both be
on or nothing is seeded. `FEATURE_RULES_ALLOW_INVALID_SAVE=true` is what lets
the deliberately unparseable documents be stored at all — about a third of the
suite asserts rejection — and they open in the editor with the parser's
complaint against them. Without it those entries are skipped.

`W3C_RULES_SUITE_DIR` points the loader at a copy elsewhere, for a deployment
that ships `packages/api` without the monorepo around it.

How tests are expressed, run and reported — including the conformance report the
suite's results produce — is in
[testing and conformance](testing-and-conformance.md).

## The rule-tuples extension

SRL in this repository has an extension, `TUPLE( … )`, which lets a rule read
and write ordered tuples of RDF terms alongside triples. It is **not conformant
SPARQL-RL**, so a document written with it cannot be read by other
tooling.

It is gated by the `ruleTuples` feature flag (`FEATURE_RULE_TUPLES`), which
defaults **off**. With the flag off the server refuses any request that asks for
it — a rule set version's `tuplesEnabled`, a `tupleSeeds` document, or a tuple
seed input on an execute — with `The rule-tuples extension is not enabled on
this server`, the UI draws no control that mentions it, and a document
containing `TUPLE( … )` is a syntax error:

```
SRL syntax error: TUPLE requires the rule-tuples extension (parse with { tuples: true })
```

This is unrelated to the `TupleSet` entity and the `tupleSets` flag, which share
the word. A tuple set is a saved table of RDF terms spliced into a query's
`VALUES` clause; it is reachable from queries and argument sets, and this flag
does not affect it.
