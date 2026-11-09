# Testing and conformance reports

A test in sqlib is a call to something that the library can already run, with
an expectation about the result. Tests are a library feature. A test of a query
(arguments in, bindings out) has the same shape as a test of a rule set (a data
graph in, an inference graph out).

To run a suite and to export a report is one call. The library declares tests,
and does not keep their results. A run therefore answers in the format that the
`Accept` header of the caller asks for. There is no stored run to read later.

The `tests` feature flag is on by default. See
[Feature flags](../reference/feature-flags.md).

## What a Test is

A **Test** is the stable pointer. It has:

- a name and a description;
- the `subject` (a Query, QueryGroup or RuleSet IRI) and `subjectKind`;
- the library that it belongs to, and its tags;
- its `currentVersion`;
- an optional `criterion`: the IRI of an external test that this test
  implements. A conformance report cites it.

The subject is on the Test, so the Tests tab of a record page can filter by
subject without a read of each version.

A **TestVersion** holds the fields that define a correct result. They are
versioned together, because each one has meaning only with the others:

- `subjectVersion` pins the subject to one of its versions. When it is not set,
  the run uses the current version of the subject. A regression test usually
  wants the current version. A conformance test wants the version that it was
  written against.
- `expectationKind` selects the comparator: `bindings`, `boolean`, `graph`,
  `analysis` or `smoke`. The kind follows the output of the subject, and is
  independent of its entity type. A CONSTRUCT query and a rule set both produce
  a graph, and sqlib compares them in the same way.
- `backend`, when the test runs against a live endpoint.
- `cases`, the parametrised cases in `position` order.
- `maxIterations`, `timeoutMs` and `comment`.

The inputs of a test decide whether it is hermetic. No separate flag is needed:

- A case with a `dataGraphVersion` runs against a temporary store loaded from
  that graph. It is deterministic.
- A version with a `backend` runs against a live endpoint. Its result depends on
  the environment.

A **TestCase** holds the inputs and the expectation together, because a change
to the arguments changes the correct result. It has:

- `position` and an optional `name`;
- the `argumentSetVersion` that supplies the arguments;
- the `dataGraphVersion` or `dataGraphs` that load the store;
- `tupleSeeds` and `sqlFixture`;
- `expected`, `expectedFormat` and `ordered`;
- `maxDurationMs`.

A test with one case is an ordinary test. A test with several cases is a
parametrised test. A null `expected` with the kind `smoke` is a smoke test: the
subject runs, converges, and gives no error.

### Time budgets

`maxDurationMs` is an optional time budget for one case, in whole milliseconds.

- The runner times the whole case: load its data, run the subject, compare.
- It checks correctness first. A wrong result stays wrong, with its diff.
- A correct result that took longer than the budget is **slow**. The case gets
  `passed: false` and `slow: true`, so the test fails in CI.
- The run counts slow cases in `slowCount`, separately from `failedCount`.
- The budget does not stop the run. A slow case still runs to the end, so sqlib
  still checks it for correctness.

The runner applies the budget on each run, against the backend that the run
used. The run history records that backend, so you can compare one case across
stores. `TestVersion.timeoutMs` has a different purpose: it stops a run that
takes too long.

The `analysis` kind makes an assertion about the subject document itself, and
ignores its output. With it, a test can assert that a document *must be
rejected*. Such a document has no output to compare. The expectation names the
check and the expected verdict:

```json
{ "check": "syntax" | "wellformed" | "stratification", "accepted": true | false }
```

The runner checks an `analysis` expectation before it runs anything. It builds
the SRL document of the subject again from the stored rules and data blocks, and
runs the named check. It uses the same functions as the test harness of the SRL
package: `parseRuleSet`, `checkWellFormed` and `stratify`. The expectation must
name the check, because a document can have legal syntax and also fail
stratification.

## Running tests

There are two routes. Both negotiate their response format:

- `POST /tests/:id/run` runs one test, with all of its cases.
- `POST /tests/run` runs a suite. Select the suite in one of two ways:
  - `{"tags": [...], "match": "any" | "all"}` selects each test with those tags.
    `any` takes the union, and `all` takes the intersection.
  - `{"tests": [...]}` selects the named tests, in the given order.

A body with both selectors, or with neither, gets a 400. The `tests` form covers
a suite that no tag describes: the whole list, one heading of it, or the
failures of the last run. The web app uses it to export those scopes. If a named
test does not exist, the request gets a 404 and nothing runs.

The suite response has `requested`, `passed`, `failed`, and one entry for each
selected test. This includes the tests that could not run. A test that cannot
run gives a verdict in the suite, with no error status, so one broken test does
not stop the count for the others. On `POST /tests/:id/run`, a test that cannot
run gives a 400. There is no run to export, and CI reads a JUnit file with zero
tests as a pass.

In the web app, the export control is next to the Run buttons: next to Run on the
page of a test, and under the tag picker in the Tests rail for a tagged suite.
When you select a format, the app runs the test and saves the report. No screen
exports from stored results, because sqlib stores none.

## Export formats

| `Accept` | Format | Filename |
| --- | --- | --- |
| *(absent)*, `application/json`, `*/*` | The ordinary run response | — |
| `application/xml`, `text/xml` | JUnit XML | `test-results.xml` |
| `text/turtle`, `application/x-turtle` | EARL 1.0, extended | `test-results.ttl` |
| `text/turtle;profile="earl"` | EARL 1.0, conformance profile | `earl-report.ttl` |
| `text/markdown`, `text/x-markdown` | GitHub Actions job summary | `test-results.md` |
| `text/csv` | One row for each case | `test-results.csv` |
| `application/vnd.sqlib.test-report+json` | Flat, versioned JSON | `test-results.json` |

Two formats share a media type. A `profile` parameter selects between them,
because both are Turtle, and the difference is the shape of EARL. Bare
`text/turtle` means the same as it did before the conformance profile existed,
so no existing CI step changes what it downloads.

The `profile` parameter:

- is matched without regard to case, quoted or bare;
- selects the conformance report for `earl`, `w3c` or
  `https://www.w3.org/TR/EARL10-Schema/`;
- selects the extended report for `profile=sqlib` or `profile=extended`;
- gives a 406 for any other value, as an unknown media type does.

Negotiation follows q-values. A tie goes to the type that the caller wrote
first. `q=0` excludes a type. An `Accept` header that names none of these
formats gets a **406**. The server does not fall back to JSON, because a CI step
that asked for XML and got JSON would pass and report nothing. A wildcard does
not ask for an export: `*/*` and `application/json` return the run response, so
an ordinary browser fetch gives a known result.

### Outcomes

Each format has three states. A test that *could not run* is different from a
test that *failed*.

| Run | EARL `earl:outcome` | JUnit | CSV / JSON `outcome` |
| --- | --- | --- | --- |
| each case passed | `earl:passed` | bare `<testcase>` | `passed` |
| comparator mismatch, or the subject threw | `earl:failed` | `<failure>` | `failed` |
| `TestNotRunnableError`, `TestVersionError` | `earl:cantTell` | `<error>` | `cantTell` |

A slow case (correct, but over its `maxDurationMs`) is `earl:failed`. EARL has
no other verdict for a run that completed. The extended EARL report adds
`sqlib:slow true` to its result. JUnit writes `<failure type="slow">`. The job
summary shows it in a Slow column.

### Examples

One test, as JUnit:

```bash
curl -sS -X POST "$SQLIB/tests/$(printf %s "$TEST_IRI" | jq -sRr @uri)/run" \
  -H 'Accept: application/xml' \
  -H 'Content-Type: application/json' \
  -d '{}' > test-results.xml
```

A tagged suite, as CSV:

```bash
curl -sS -X POST "$SQLIB/tests/run" \
  -H 'Accept: text/csv' \
  -H 'Content-Type: application/json' \
  -d '{"tags":["urn:sqlib:tag:negation"],"match":"any"}' > test-results.csv
```

A suite of named tests, as extended EARL:

```bash
curl -sS -X POST "$SQLIB/tests/run" \
  -H 'Accept: text/turtle' \
  -H 'Content-Type: application/json' \
  -d '{"tests":["urn:sqlib:test:a","urn:sqlib:test:b"]}' > test-results.ttl
```

### In a GitHub Actions job

```yaml
name: sqlib tests
on: [push, pull_request]

jobs:
  sqlib:
    runs-on: ubuntu-latest
    steps:
      - name: Run the tagged suite
        env:
          SQLIB: ${{ vars.SQLIB_URL }}
        run: |
          # The run route answers 200 with the verdicts inside it — a failing
          # test is a report, not an HTTP error — so the job is failed below,
          # from the report, rather than by curl's exit status.
          curl -sS --fail-with-body -X POST "$SQLIB/tests/run" \
            -H 'Accept: application/xml' \
            -H 'Content-Type: application/json' \
            -d '{"tags":["urn:sqlib:tag:conformance"]}' > test-results.xml

      - name: Publish results
        # Annotates the pull request with each failure, and fails the job when
        # the report contains one.
        uses: mikepenz/action-junit-report@v5
        if: always()
        with:
          report_paths: test-results.xml
```

Each export is a separate run of the suite. A job that needs two formats
therefore runs the suite two times. For a slow suite, get the JSON export once,
and convert or assert locally. It has all the data that the other row formats
show:

```bash
curl -sS -X POST "$SQLIB/tests/run" \
  -H 'Accept: application/vnd.sqlib.test-report+json' \
  -H 'Content-Type: application/json' \
  -d '{"tags":["urn:sqlib:tag:conformance"]}' > results.json

jq -e '.totals.casesFailed == 0 and .totals.casesCantTell == 0' results.json
```

### The JSON export

The JSON export and the run response are two different shapes. The needs of the
web app set the run response, and it can change with them. The JSON export is
the shape for scripts to depend on. It is versioned and flat, with one row for
each case. The CSV has the same rows:

```json
{
  "format": "sqlib-test-report",
  "version": 1,
  "suite": "urn:sqlib:tag:conformance",
  "ranAt": "2026-08-14T09:32:11.000Z",
  "totals": {
    "tests": 2, "testsPassed": 1, "testsFailed": 1, "testsNotRun": 0,
    "cases": 3, "casesPassed": 2, "casesFailed": 1, "casesCantTell": 0,
    "durationMs": 24
  },
  "cases": [
    {
      "testId": "urn:sqlib:test:t1",
      "testVersionId": "urn:sqlib:test-version:tv1",
      "caseId": "urn:sqlib:test-version:tv1#case-1",
      "caseName": "Berlin",
      "position": 1,
      "outcome": "failed",
      "durationMs": 7,
      "subject": "urn:sqlib:query:q1",
      "subjectVersionId": "urn:sqlib:query-version:7",
      "backend": "urn:sqlib:backend:b1",
      "argumentSetVersion": "urn:sqlib:argument-set-version:a1",
      "dataGraphVersion": null,
      "expectationKind": "bindings",
      "hermetic": true,
      "ranAt": "2026-08-14T09:32:11.000Z",
      "message": "1 missing row",
      "detail": "{\"missing\":[{\"city\":\"Berlin\"}]}"
    }
  ]
}
```

`version` changes only for a breaking change to that shape.

The CSV has the same columns, except `detail`. A comparator diff is multi-line
JSON, and a cell that holds one is hard to read. The diff is in the JSON export
and in the JUnit `<failure>` body.

### Adding a format

Each format is a pure function of `TestReportInput`. The routes already hold
this input in memory when they answer. To add a format:

1. Add a file under `packages/api/src/lib/reportFormats/`.
2. Add an entry in `TEST_REPORT_FORMATS`.

No route changes, and no new state is needed. Row formats build on `toRows()` in
`rows.ts`, so they always agree about the contents of a run. EARL does not use
`toRows()`. An assertion is a graph of linked nodes, and a row would lose the
structure that makes it queryable.

## The extended EARL report

`Accept: text/turtle` returns one `earl:Assertion` for each case. Each assertion
names its case as the criterion (`earl:test`), and points to an
`earl:TestResult` with the outcome.

Each assertion also has the dimensions that the run fixed: `sqlib:refSubject`,
`sqlib:refBackend`, `sqlib:refArgumentSet` and `sqlib:dataGraphVersion`.
`BenchmarkObservation` uses the same properties, so one query can join verdicts
and timings.

A test that could not run is an `earl:cantTell` assertion that names its
version. If the report omitted broken tests, the suite would look better than
the run was.

The document is Turtle, so that a person can read it as well as a parser. It
declares prefixes, writes `rdf:type` as `a`, and gives each subject one block.

There is no report sink. sqlib stores nothing about a run in the library, or in
any other place. A caller who wants the report in a triplestore already has it,
and can load it there.

## The W3C conformance report

`Accept: text/turtle;profile="earl"` returns the report for a W3C implementation
report. It is a separate report over the same run. A filter that removed the
`sqlib:` triples from the extended report would not be enough. In the extended
report, the core EARL terms point to the wrong resources for a submission.

| | Extended (`text/turtle`) | Conformance (`;profile="earl"`) |
| --- | --- | --- |
| `earl:subject` | the subject *version* that ran | the implementation, one `doap:Project` for each report |
| `earl:test` | the case, a `urn:sqlib:test-case:` id | `Test.criterion`, the upstream manifest entry |
| `earl:assertedBy` | `urn:sqlib:software` | the configured assertor, a person or the software |
| granularity | one assertion for each case | one assertion for each test |
| vocabularies | `earl:`, `sqlib:`, `dct:`, `sdo:` | `earl:`, `doap:`, `foaf:`, `dct:` only, enforced |

The change from cases to tests is pessimistic:

- any failed case fails the criterion;
- a test that produced no cases is `earl:cantTell`;
- a test passes only when all of its cases pass.

A majority verdict would let a parametrised test that passes in part show as a
pass upstream.

Assertions are blank nodes. Only the report that contains an assertion refers to
it. A minted `urn:sqlib:assertion:` subject would be one more identifier that a
reviewer cannot resolve.

### What has to be configured first

A conformance report is a claim by a person or an organisation about a release
of a piece of software, tested against a suite at a known location. The code
does not know these three facts. A fork that submits its own results is a
different project, asserted by a different person, possibly against a copy of
the suite in a different location.

All of these settings are in `packages/api/package.json`. This is one committed
file, with no environment variables. Most settings use npm fields that already
exist, because two descriptions of one release will at some time disagree.
sqlib reads the file once, on the first report, from next to the built `dist/`.
The production image already copies the manifest, so the settings are in it and
in no separate file.

```jsonc
{
  "name": "@sparql-query-lib/api",
  "version": "1.0.0",
  "description": "Fastify backend for the SPARQL Query Library",
  "homepage": "https://example.org/sqlib",
  "repository": "git+https://example.org/sqlib.git",
  "author": "A. Maintainer <am@example.org> (https://example.org/people/am)",

  "earlReport": {
    "projectName": "sqlib",
    "projectIri": "https://example.org/sqlib#project",
    "programmingLanguages": ["TypeScript"],
    "suiteBaseIri": "https://w3c.github.io/rdf-tests/shacl/shacl12/"
  }
}
```

From the npm fields:

| Field | Goes to |
| --- | --- |
| `version` | `dct:hasVersion`, `doap:revision`: the release that the run tested |
| `description` | `doap:description` |
| `homepage` | `doap:homepage` |
| `repository` | `doap:repository`, with the npm prefixes `git+` and `git://` normalised |
| `author` | the assertor: `foaf:name` from the name, `earl:assertedBy` and `foaf:homepage` from the URL. The `Name <email> (url)` shorthand and the object form both work. |
| `name` | `doap:name`, unless `earlReport.projectName` overrides it. It does, because the package is not the whole project |

From the `earlReport` key, for values that npm has no field for:

| Key | Goes to | Notes |
| --- | --- | --- |
| `projectIri` | `earl:subject`, the `doap:Project` node | Must be dereferenceable for a submission. A `urn:` leaves the banner in place. |
| `projectName` | `doap:name` | |
| `projectDescription` | `doap:description` | Overrides the npm `description`, which describes the API package. |
| `downloadPage` | `doap:download-page` | Where a reviewer gets a copy to check the claim. |
| `programmingLanguages` | `doap:programming-language` | Default `["TypeScript"]`. |
| `assertor.iri` / `.name` / `.homepage` | `earl:assertedBy`, `foaf:name`, `foaf:homepage` | Overrides `author`. The default is the project: an unattended run asserts about itself, and EARL has a term for this. |
| `assertor.kind` | `foaf:Person`, `foaf:Organization` or `earl:Software` | Inferred. A named assertor is a person, unless you set a different kind. |
| `suiteBaseIri` | the base IRI for each manifest | Default `https://w3c.github.io/rdf-tests/shacl/shacl12/`. sqlib adds a trailing slash if it is missing. |

A named assertor also adds `doap:developer` on the project. A report from a
named person and a report from the software about itself are different
evidence, and a reviewer must be able to tell them apart.

`suiteBaseIri` has an important effect that is easy to miss:

- `eval/manifest.ttl` writes its entry IRIs with an absolute prefix.
- `syntax/manifest.ttl` declares `PREFIX : <manifest#>`, so `:test_1` is
  relative.
- `:test_1` resolves to the criterion IRI that a reviewer will try to look up.

Set `suiteBaseIri` to the published location of the snapshot in
`packages/srl/test/w3c`, and the IRIs are correct. With a wrong value, each
syntax assertion cites a manifest that does not exist.

This repository has these fields filled in. The subject is the GitHub
repository, and the assertor is the maintainer, named by ORCID. A report from
this repository has no banner. `earlPlain.test.ts` checks this, so if any field
becomes empty, the suite fails before a reviewer sees the report.

Other cases:

- **Placeholder fields.** The document has a `NOT READY TO SUBMIT` banner that
  names the placeholder subject.
- **Tests with no `criterion`.** The top of the document states this. sqlib does
  not cite its own ids without a note.
- **A field with an IRI that cannot be serialised**, for example with a space or
  an angle bracket. sqlib drops the field at load time. The result is a missing
  `doap:homepage`, and the report route does not give a 500 later.
- **A manifest that does not parse.** sqlib uses the built-in defaults, so the
  report has the banner.

### `Test.criterion`

An assertion must name its criterion. The `urn:sqlib:test:` ids of sqlib have no
meaning outside the library. `Test.criterion` holds the external test that a
test implements. For the W3C suite, this is the IRI of the manifest entry.
`packages/api/src/lib/w3cRulesSuite/manifest.ts` reads it from the manifests,
and the seeder writes it.

The criterion is separate from the `$id` of the test. An id is library content:
you can rename it, version it again, or seed it twice. The criterion is the
fixed resource that upstream and this test both refer to.

- Seeded suites get it automatically. This includes stores seeded before the
  field existed: the seeder adds it on the next start, and reports the count as
  `testsLinked`.
- Any test can have one. It is an ordinary optional field on `Test`, also over
  the REST API. A second conformance suite therefore needs only a seeder that
  sets `criterion`.
- A test without one is still reported, and cites its own IRI. A note at the top
  of the document gives the number of such tests.

### What comes out

```turtle
# EARL 1.0 conformance report — urn:sqlib:tag:w3c-evaluation
# 2 assertion(s), one per test
# Subject: sqlib 0.9.1 <https://example.org/sqlib#project>

@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix earl: <http://www.w3.org/ns/earl#> .
@prefix doap: <http://usefulinc.com/ns/doap#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://example.org/sqlib#project>
    a doap:Project, earl:TestSubject, earl:Software ;
    doap:name "sqlib" ;
    doap:homepage <https://example.org/sqlib> ;
    doap:programming-language "TypeScript" ;
    dct:hasVersion "0.9.1" ;
    doap:revision "0.9.1" ;
    doap:developer <https://example.org/people/am> .

<https://example.org/people/am>
    a foaf:Person, earl:Assertor ;
    foaf:name "A. Maintainer" .

_:assertion0
    a earl:Assertion ;
    earl:assertedBy <https://example.org/people/am> ;
    earl:subject <https://example.org/sqlib#project> ;
    earl:test <https://w3c.github.io/rdf-tests/shacl/shacl12/eval-basic-01> ;
    earl:mode earl:automatic ;
    earl:result _:result0 .

_:result0
    a earl:TestResult ;
    earl:outcome earl:passed ;
    dct:date "2026-09-07T09:32:11.000Z"^^xsd:dateTime .
```

### Producing one in CI

```yaml
- name: EARL conformance report
  env:
    SQLIB: ${{ vars.SQLIB_URL }}
  run: |
    curl -sS -X POST "$SQLIB/tests/run" \
      -H 'Accept: text/turtle;profile="earl"' \
      -H 'Content-Type: application/json' \
      -d '{"tags":["urn:sqlib:tag:w3c-evaluation","urn:sqlib:tag:w3c-document-check"],"match":"any"}' \
      > earl-report.ttl
    # The banner is the check: a report that still names the placeholder
    # subject is not a submission, and failing here is cheaper than a reviewer
    # discovering it.
    ! grep -q 'NOT READY TO SUBMIT' earl-report.ttl

- uses: actions/upload-artifact@v4
  with:
    name: earl-report
    path: earl-report.ttl
```

## Seeding the W3C SHACL 1.2 Rules suite locally

A snapshot of the suite, at a pinned commit, is in `packages/srl/test/w3c`.
Seeding makes each manifest entry into ordinary library entities: a DataGraph, a
RuleSet and a Test. The ordinary test runner runs them, and the Tests screen
shows them.

A separate harness would need graph comparison, blank-node isomorphism, and a
verdict with a diff. The runner already does all of these. Two implementations
would in time give different answers.

The suite has two shapes of entry:

- `eval/`, `eval2/` and `examples/` become a rule set run against a data graph.
  The expectation is a `graph` expectation against the expected inference graph
  of the suite.
- `syntax/`, `wellformed/` and `stratification/` become a rule set that holds
  the document. The expectation is an `analysis` expectation that names the
  check and whether the check must accept. Nothing runs, so a test can assert
  that a document must *not* parse.

### Running it

```sh
just run-local-rules-tests     # API on :3005, rules-only, the suite loaded
just run-frontend-rules        # the web app with the matching feature set
just clean-local-rules-tests   # throw the store away and seed a fresh one
```

`run-local-rules-tests` sets `SEED_W3C_RULES_SUITE=true` and a feature set for
rules:

- on: `FEATURE_RULES_SUITE`, `FEATURE_TESTS`, `FEATURE_DATA_GRAPHS`,
  `FEATURE_RULES_ALLOW_INVALID_SAVE`, `FEATURE_QUERIES` and
  `FEATURE_QUERY_GROUPS`;
- off: `FEATURE_BENCHMARKS` and `FEATURE_ETL`.

It uses a separate store directory (`./tmp/rules-tests-store`), so the
conformance suite never goes into your working library.

`run-frontend-rules` sets the matching `NUXT_PUBLIC_FEATURE_*` variables. The
API and the web app are separate processes, and each reads its own environment.
If you set the flags on the API only, the rail would show sections that the API
does not serve.

The flags do different things in the two processes:

- `FEATURE_QUERIES`, `FEATURE_QUERY_GROUPS`, `FEATURE_BENCHMARKS` and
  `FEATURE_ETL` remove their routes from the API, and hide their sections in the
  app.
- `FEATURE_BACKENDS` only hides the section. `/backends` is always registered.

Seeding happens at startup, and only when `SEED_W3C_RULES_SUITE=true`. An
ordinary instance therefore never seeds. A seeding problem never stops the
server. sqlib logs these cases and continues:

- a store that already has the suite;
- a snapshot that is not on disk;
- a document that the library cannot express.

If `rulesSuite` or `tests` is off, sqlib seeds nothing and logs a warning. If
`FEATURE_RULES_ALLOW_INVALID_SAVE` is off, the seeder still runs, but it cannot
store the intentionally invalid documents and skips them. These are all the
tests that assert that a document is rejected.

Seeding is idempotent by design. Each parent entity gets an id from its name in
the suite, and each step skips a complete artefact. A restart seeds nothing
again. If a seed stops part way, the next seed adds the missing version, so the
library is not left incomplete.

The suite goes into its own library, `urn:sqlib:library:w3c-shacl12-rules`. It
does not go into the system library or your library. To read the snapshot from a
different directory, set `W3C_RULES_SUITE_DIR`.

### Storing a rejected document

The seeder stores the negative entries through the invalid-save override. This
is the flag behind the save-anyway button of the rule editor. The entries open
in the rules editor with the error from the parser in red, so that you can see
them.

Two questions are separate here: does the writer accept a rule, and does the
document conform? `RuleGrammarValidator` asks whether sqlib can run the text as
SRL or SPARQL. This check is stricter than the three conformance checks. A
document with legal syntax can fail it, for the same defect that the test
asserts.

The seeder therefore does not choose the override from the result of the parse.
Before it writes, it asks the validator whether any part of the rule set would be
refused. If so, it writes the whole rule set through the override. This also
stops a writer from leaving a rule set half built, for example when the writer
refuses the third of five rules.

A version with a rule that the grammar rejected gets no stratification report.
Stratification needs an AST, and a partial report would describe a rule set that
nobody wrote.

### Tags

The seeder tags each entry on two axes that the directory layout does not give:
what the entry *exercises*, and what it *asserts*. There are three families and
21 tags, from `packages/api/src/lib/w3cRulesSuite/tags.ts`:

- kind: `evaluation` or `document check`;
- assertion: `must accept`, `must reject` or `expects error`;
- feature: `templates`, `negation`, `data blocks`, `blank nodes`, `RDFS`,
  `property paths`, `reification` and others.

An entry has one kind tag, at most one assertion tag, and one or more feature
tags. The mean is three tags for each entry.

The seeder infers features from entry names. The manifests have no
`dct:subject` and no keywords, and the names follow a consistent taxonomy
(`syntax-template-bad-01`, `eval-neg-data-01`). Each matching rule applies, so an
entry can be about negation and about data blocks. An entry that matches no
feature rule gets no feature tag, and goes into the Untagged group. When this
happens, add a rule.

There is no tag for each manifest directory. The first version had six, one for
each of `eval/`, `syntax/` and the others, which held the axis that `Test.group`
held before. sqlib removed them, because the name of each entry starts with its
directory, so the tag repeated the first word of the row.

`stratification/`, `wellformed/` and `examples/` name a feature, so these three
keep a feature tag. For example, the tag tells you what `stratification-01`
checks. To select one directory as a suite, use a kind tag with a feature tag, or
the `tests` selector on `POST /tests/run`.

The seeder puts the same tags on the rule set of the entry and on its rules, as
well as on the test. They are one artefact in three rails. If you group the Rules
list by tag, you get the same headings as in the Tests list. A rule set that
several entries share carries the union of their tags. For example, `rdfs.srl`
is used by six tests. Data graphs and data blocks get no tags, because they are
inputs to the rule set and are not under test.

Tags are ordinary entities, so you can rename, recolour and delete them. A new
seed also tags a store that is older than the tags. It applies the union to
tests, rule sets and rules that already exist. A new run of the recipe therefore
upgrades a library, and needs no clean store.

Tagging never removes a tag, so a tag that you added manually stays after each
start. In a store seeded before the directory tags were removed, those tags also
stay, with no entries. Delete them from Manage tags, or seed a clean store.

To see the axes, group the Tests list by tag in the sidebar. To run one tag or
several, use the tag button next to Run all, or the run button on a tag heading.
This is the same `POST /tests/run` selection as above. A script or a CI job can
therefore ask for "the negation tests" with no selection code of its own.
