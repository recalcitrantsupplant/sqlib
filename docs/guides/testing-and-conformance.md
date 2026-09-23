# Testing and conformance reports

A test in sqlib is an invocation of something the library already knows how to
run, plus an expectation about the result. Tests are a library feature rather than
a rules feature: a test of a query (arguments in, bindings out) has the same shape
as a test of a rule set (a data graph in, an inference graph out).

Running a suite and exporting a report are the same call. The library declares
tests and does not accumulate their results, so there is no stored run to address
later — a run answers in whatever format the caller's `Accept` header asks for.

The `tests` feature flag is on by default. See
[Feature flags](../reference/feature-flags.md).

## What a Test is

A **Test** is the stable pointer. It carries the name and description, the
`subject` (a Query, QueryGroup or RuleSet IRI) and `subjectKind`, the library it
belongs to, its tags, its `currentVersion`, and optionally a `criterion` — the IRI
of an external test this one implements, which is what a conformance report cites.
The subject lives on the Test rather than on a version so that a record page's
Tests tab can filter by subject without opening every version.

A **TestVersion** holds the things that change what "correct" means, versioned
together because they only mean anything together:

- `subjectVersion`, pinning the subject to one of its versions, or unset to
  resolve the subject's current version at run time. A regression test wants
  "whatever it is now"; a conformance test wants the version it was written
  against.
- `expectationKind`, which selects the comparator: `bindings`, `boolean`, `graph`,
  `analysis` or `smoke`. It is typed by what the subject produces rather than by
  the subject's entity type — a CONSTRUCT query and a rule set both produce a
  graph and are compared the same way.
- `backend`, when the test runs against a live endpoint.
- `cases`, the parametrised cases in `position` order.
- `maxIterations`, `timeoutMs`, `comment`.

Whether a test is hermetic falls out of its inputs rather than a separate flag: a
case with a `dataGraphVersion` runs against an ephemeral store seeded from that
graph and is deterministic; a version with a `backend` runs against a live
endpoint and is environment-dependent.

A **TestCase** pairs the inputs with the expectation, because changing the
arguments changes what is correct. It holds `position` and an optional `name`, the
`argumentSetVersion` that supplies the arguments, the `dataGraphVersion` or
`dataGraphs` that seed the store, `tupleSeeds`, `sqlFixture`, `expected` and
`expectedFormat`, and `ordered`. One case is an ordinary test; several cases are a
parametrised one. A null `expected` with kind `smoke` is a smoke test: it runs,
converges, and does not error.

The `analysis` kind asserts something about the subject document rather than about
its output, which is how a test that a document *must be rejected* is expressible —
such a document has no output to compare. The expectation names the check and the
verdict it expects:

```json
{ "check": "syntax" | "wellformed" | "stratification", "accepted": true | false }
```

The runner answers an `analysis` expectation before invoking anything. It
reconstructs the subject's SRL document from the stored rules and data blocks and
runs the named check, through the same `parseRuleSet` / `checkWellFormed` /
`stratify` functions the SRL package's own harness uses. The check is named rather
than inferred, because a document can be legal syntax and badly stratified at the
same time.

## Running tests

Two routes, both of which negotiate their response format:

- `POST /tests/:id/run` runs one test, its cases inside it.
- `POST /tests/run` runs a suite, selected one of two ways:
  - `{"tags": [...], "match": "any" | "all"}` — every test carrying those tags
    (`any` unions, `all` intersects).
  - `{"tests": [...]}` — the tests named, in the order named.

A body carrying both selectors, or neither, is a 400: a run selects one way or the
other. The `tests` form covers a suite no tag describes — the whole list, one
heading of it, the failures of the last run — and is what the web app uses to
export those scopes. A named test that does not exist is a 404 and nothing runs.

The suite response carries `requested`, `passed`, `failed`, and one entry per
selected test, including the ones that could not run. A test that cannot run comes
back as a verdict inside the suite rather than as an error status, so one broken
member does not cost the rest their tally. On `POST /tests/:id/run`, by contrast,
a test that cannot run is a 400: there is no run to export, and a JUnit file
reporting zero tests reads to CI as a pass.

In the web app the export control sits with the Run buttons rather than in a menu
of its own — beside Run on a test's page, and under the tag picker in the Tests
rail for a tagged suite. Picking a format runs the test and saves the report.
Nothing is exported from stored results anywhere, because there are none.

## Export formats

| `Accept` | Format | Filename |
| --- | --- | --- |
| *(absent)*, `application/json`, `*/*` | The ordinary run response | — |
| `application/xml`, `text/xml` | JUnit XML | `test-results.xml` |
| `text/turtle`, `application/x-turtle` | EARL 1.0, extended | `test-results.ttl` |
| `text/turtle;profile="earl"` | EARL 1.0, conformance profile | `earl-report.ttl` |
| `text/markdown`, `text/x-markdown` | GitHub Actions job summary | `test-results.md` |
| `text/csv` | One row per case | `test-results.csv` |
| `application/vnd.sqlib.test-report+json` | Flattened, versioned JSON | `test-results.json` |

Two of those share a media type and are distinguished by a `profile` parameter,
because both are Turtle and the difference is which shape of EARL you want. Bare
`text/turtle` still means what it meant before the conformance profile existed, so
no existing CI step changes what it downloads. `profile` is matched
case-insensitively, quoted or bare, and answers to `earl`, `w3c` or
`https://www.w3.org/TR/EARL10-Schema/`; `profile=sqlib` or `profile=extended` names
the extended report explicitly. A profile no format claims is a 406, for the same
reason an unknown media type is.

Negotiation follows q-values, breaking ties in the order the caller wrote, and
`q=0` means "not this one". An `Accept` naming none of these formats is a **406**
rather than a silent fallback to JSON: a CI step that asked for XML and quietly
received JSON is a step that looks green while reporting nothing. A wildcard is not
a request for an export — `*/*` and `application/json` return the run response, so
an ordinary browser fetch stays predictable.

### Outcomes

Every format distinguishes three states, because a test that *could not run* is not
a test that *failed*.

| Run | EARL `earl:outcome` | JUnit | CSV / JSON `outcome` |
| --- | --- | --- | --- |
| every case passed | `earl:passed` | bare `<testcase>` | `passed` |
| comparator mismatch, or the subject threw | `earl:failed` | `<failure>` | `failed` |
| `TestNotRunnableError`, `TestVersionError` | `earl:cantTell` | `<error>` | `cantTell` |

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

A suite the caller picks, as extended EARL:

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

Each export is a separate run of the suite, so a job wanting two formats runs the
suite twice. For an expensive suite, take the JSON export once and convert or
assert locally — it carries everything the other row-based formats render:

```bash
curl -sS -X POST "$SQLIB/tests/run" \
  -H 'Accept: application/vnd.sqlib.test-report+json' \
  -H 'Content-Type: application/json' \
  -d '{"tags":["urn:sqlib:tag:conformance"]}' > results.json

jq -e '.totals.casesFailed == 0 and .totals.casesCantTell == 0' results.json
```

### The JSON export

Deliberately distinct from the run response. The run response is shaped by what the
web app needs and is free to follow it; the JSON export is the shape a script is
invited to depend on. It is versioned and flat — one row per case, the same rows
the CSV emits:

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

`version` is bumped only for a breaking change to that shape.

The CSV carries the same columns except `detail`: a comparator diff is multi-line
JSON, and a cell holding one destroys the readability the format exists for. The
diff is in the JSON export and in the JUnit `<failure>` body.

### Adding a format

Each format is a pure function of `TestReportInput`, which the routes already hold
in memory by the time they answer. Add a file under
`packages/api/src/lib/reportFormats/` and an entry in `TEST_REPORT_FORMATS`; no
route changes and no new state. Row-based formats build on `toRows()` in `rows.ts`,
so they cannot disagree about what a run contained. EARL deliberately does not: an
assertion is a graph of linked nodes, and flattening it into a row would lose the
structure that makes it queryable.

## The extended EARL report

`Accept: text/turtle` returns one `earl:Assertion` per case, each naming its own
case as the criterion (`earl:test`) and pointing at an `earl:TestResult` carrying
the outcome. The dimensions the run fixed travel with each assertion —
`sqlib:refSubject`, `sqlib:refBackend`, `sqlib:refArgumentSet`,
`sqlib:dataGraphVersion` — which are the properties `BenchmarkObservation` already
uses, so one query can span verdicts and timings. A test that could not run is an
`earl:cantTell` assertion naming its version, because a suite that drops its broken
members exports as a greener suite than the one that ran.

The document is Turtle rather than N-Triples so it can be read as well as parsed:
prefixes are declared, `rdf:type` is written `a`, and each subject gets one block.

There is no report sink. Nothing about a run is persisted in the library, and that
is honoured by not persisting the run anywhere at all. A caller who wants the
report in a triplestore has it in hand and can load it wherever they like.

## The W3C conformance report

`Accept: text/turtle;profile="earl"` returns the report you attach to a W3C
implementation report. It is a different report over the same run rather than the
extended one with the `sqlib:` triples filtered out, because filtering would not
have been enough: the core EARL terms in the extended report point at the wrong
things for a submission.

| | Extended (`text/turtle`) | Conformance (`;profile="earl"`) |
| --- | --- | --- |
| `earl:subject` | the subject *version* that ran | the implementation, one `doap:Project` per report |
| `earl:test` | the case, a `urn:sqlib:test-case:` id | `Test.criterion`, the upstream manifest entry |
| `earl:assertedBy` | `urn:sqlib:software` | the configured assertor, a person or the software |
| granularity | one assertion per case | one assertion per test |
| vocabularies | `earl:`, `sqlib:`, `dct:`, `sdo:` | `earl:`, `doap:`, `foaf:`, `dct:` — a whitelist, enforced |

The collapse from cases to tests is pessimistic: any failing case fails the
criterion, a test that produced no cases is `earl:cantTell`, and only a clean sweep
passes. Reporting the majority verdict would let a partly-passing parametrised test
read upstream as a pass.

Assertions are blank nodes. An assertion is only ever spoken about by the report
containing it, and a minted `urn:sqlib:assertion:` subject would be one more
identifier a reviewer cannot resolve.

### What has to be configured first

A conformance report is a claim by somebody about a specific release of a piece of
software, tested against a suite published at a known location. The code knows none
of those three: a fork submitting its own results is a different project, asserted
by a different person, possibly against a republished suite.

All of it lives in `packages/api/package.json` — one committed file, no environment
variables. Most of it in npm fields that are already there, because a release
described in two places is a release that will eventually be described
inconsistently. The file is read once, on the first report, from beside the built
`dist/`, which is also why it lives in the manifest rather than a file of its own:
the production image already copies it.

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
| `version` | `dct:hasVersion`, `doap:revision` — the release the run was made against |
| `description` | `doap:description` |
| `homepage` | `doap:homepage` |
| `repository` | `doap:repository`, with npm's `git+` / `git://` prefixes normalised |
| `author` | the assertor: `foaf:name` from the name, `earl:assertedBy` and `foaf:homepage` from the URL. Both the `Name <email> (url)` shorthand and the object form work. |
| `name` | `doap:name`, unless `earlReport.projectName` overrides it, which it does — the package is not the project |

From the `earlReport` key, for what npm has no field for:

| Key | Goes to | Notes |
| --- | --- | --- |
| `projectIri` | `earl:subject`, the `doap:Project` node | Must be dereferenceable for a submission; a `urn:` leaves the banner in place. |
| `projectName` | `doap:name` | |
| `downloadPage` | `doap:download-page` | Where a reviewer gets a copy to check the claim. |
| `programmingLanguages` | `doap:programming-language` | Defaults to `["TypeScript"]`. |
| `assertor.iri` / `.name` / `.homepage` | `earl:assertedBy`, `foaf:name`, `foaf:homepage` | Overrides `author`. Defaults to the project: an unattended run self-asserts, which is true and is a shape EARL has a term for. |
| `assertor.kind` | `foaf:Person`, `foaf:Organization` or `earl:Software` | Inferred: naming an assertor implies a person unless you say otherwise. |
| `suiteBaseIri` | the base each manifest is resolved against | Defaults to `https://w3c.github.io/rdf-tests/shacl/shacl12/`; a trailing slash is added if omitted. |

Naming an assertor also adds `doap:developer` on the project: a report asserted by a
named person and one asserted by the software about itself are different evidence,
and a reviewer is entitled to tell them apart.

`suiteBaseIri` is load-bearing in a way that is easy to miss. `eval/manifest.ttl`
writes its entry IRIs against an absolute prefix, but `syntax/manifest.ttl` declares
`PREFIX : <manifest#>`, so `:test_1` is relative — and what it resolves to is
exactly the criterion IRI a reviewer will try to look up. Point it at wherever the
snapshot in `packages/srl/test/w3c` was published and the IRIs come out right; leave
it wrong and every syntax assertion cites a manifest that does not exist.

Until those fields are filled in, the document carries a `NOT READY TO SUBMIT`
banner naming the placeholder subject. A run of tests that declare no `criterion`
says so at the top rather than quietly citing sqlib's own ids. A field holding an
IRI that could not be serialised as one — a stray space, an angle bracket — is
dropped at load time rather than failing the report route later: the result is a
missing `doap:homepage`, not a 500. A manifest that will not parse at all gives the
built-in defaults, and therefore the banner.

### `Test.criterion`

An assertion has to name the criterion it is about, and sqlib's own `urn:sqlib:test:`
ids mean nothing outside the library. `Test.criterion` holds the external test a
test implements — for the W3C suite, the manifest entry IRI, read from the manifests
by `packages/api/src/lib/w3cRulesSuite/manifest.ts` and written by the seeder. It is
deliberately not the test's `$id`: an id is library content and can be renamed,
re-versioned or seeded twice, while the criterion is the fixed thing upstream and
this test both refer to.

- Seeded suites get it automatically, including stores seeded before the field
  existed: the seeder backfills it on the next boot, reporting the count as
  `testsLinked`.
- Any test can carry one. It is an ordinary optional field on `Test`, over the REST
  API too, so a second conformance suite needs only a seeder that sets `criterion`.
- A test without one is still reported, citing its own IRI, with a note at the top
  of the document saying how many did that.

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

A snapshot of the suite is vendored at a pinned commit under
`packages/srl/test/w3c`. Seeding turns each manifest entry into ordinary library
entities — a DataGraph, a RuleSet and a Test — run by the ordinary test runner and
visible on the ordinary Tests screen. Anything a bespoke harness would have had to
build (graph comparison, blank-node isomorphism, a verdict with a diff) the runner
already does, and doing it twice is how the two would come to disagree.

The two shapes the suite takes:

- `eval/`, `eval2/` and `examples/` become a rule set run against a data graph, with
  a `graph` expectation against the suite's expected inference graph.
- `syntax/`, `wellformed/` and `stratification/` become a rule set holding the
  document, with an `analysis` expectation naming the check and whether it should
  accept. Nothing is executed, which is what makes the documents that must *not*
  parse expressible.

### Running it

```sh
just run-local-rules-tests     # API on :3005, rules-only, the suite loaded
just run-frontend-rules        # the web app with the matching feature set
just clean-local-rules-tests   # throw the store away and seed a fresh one
```

`run-local-rules-tests` sets `SEED_W3C_RULES_SUITE=true` and a rules-focused
feature set: `FEATURE_RULES_SUITE`, `FEATURE_TESTS`, `FEATURE_DATA_GRAPHS`,
`FEATURE_RULES_ALLOW_INVALID_SAVE`, `FEATURE_QUERIES` and `FEATURE_QUERY_GROUPS` on,
`FEATURE_BENCHMARKS` and `FEATURE_ETL` off. It uses a store directory of its own
(`./tmp/rules-tests-store`) so a conformance suite never lands in the library you
were working in.

`run-frontend-rules` sets the matching `NUXT_PUBLIC_FEATURE_*` variables. The API
and the web app are separate processes and each reads its own environment, so
setting the flags only on the API would leave the rail showing sections the API no
longer serves. The two sets of flags also do different jobs: `FEATURE_QUERIES`,
`FEATURE_QUERY_GROUPS`, `FEATURE_BENCHMARKS` and `FEATURE_ETL` unregister their
routes on the API as well as hiding their sections in the app, while
`FEATURE_BACKENDS` only hides the section, because `/backends` is registered
unconditionally.

Seeding happens on boot and only when `SEED_W3C_RULES_SUITE=true`, so it never
surprises an ordinary instance. It is never fatal: a store that already has the
suite, a snapshot that is not on disk, or a document the library cannot express are
each logged and passed over rather than stopping the server. If `rulesSuite` or
`tests` is off, nothing is seeded and a warning says so. If
`FEATURE_RULES_ALLOW_INVALID_SAVE` is off the seeder still runs, but the
deliberately-invalid documents cannot be stored and are skipped — and those are
every test that asserts a document is rejected.

Seeding is idempotent by construction: every parent entity gets an id derived from
its name in the suite, and each step skips a complete artefact. Restarting re-seeds
nothing, and a seed interrupted half way repairs the missing version rather than
leaving a library that looks finished.

The suite lands in its own library, `urn:sqlib:library:w3c-shacl12-rules`, rather
than in the system library or yours. Set `W3C_RULES_SUITE_DIR` to read the snapshot
from somewhere other than `packages/srl/test/w3c`.

### Storing a document is not judging it

The negative entries are stored through the invalid-save override — the flag behind
the rule editor's save-anyway button — and open in the rules editor with the
parser's complaint in red, which is the point of having them visible.

Whether the writers accept a rule is a different question from whether the document
conforms. `RuleGrammarValidator` asks "is this SRL or SPARQL we can execute", which
is stricter than any of the three checks, and a document can be legal syntax and
still be refused by it for the very defect the test exists to assert. So the seeder
does not decide the override from whether the document parsed: it asks the validator
up front whether anything it is about to write would be refused, and if so writes
the whole rule set through the override. Asking up front is also what stops a rule
set being left half-built by a writer that refuses the third of five rules. A
version holding a rule the grammar rejected gets no stratification report, because
stratifying needs an AST and a partial report would describe a rule set nobody
wrote.

### Tags

The seeder tags each entry on two axes the directory layout cannot give you: what
it *exercises* and what it *asserts*. Three families, 21 tags, from
`packages/api/src/lib/w3cRulesSuite/tags.ts`:

- kind: `evaluation` or `document check`;
- assertion: `must accept`, `must reject` or `expects error`;
- feature: `templates`, `negation`, `data blocks`, `blank nodes`, `RDFS`, `property
  paths`, `reification` and others.

An entry carries one of the first, at most one of the second, and one or more of the
third, averaging three tags. The features are inferred from entry names, because the
manifests carry no `dct:subject` and no keywords, and the names are a consistent
taxonomy (`syntax-template-bad-01`, `eval-neg-data-01`). Every matching rule applies
rather than the first, since an entry can be about negation and about data blocks at
once. An entry matching no feature rule takes no feature tag and lands in the
Untagged group, which is the signal to add a rule.

There is no tag per manifest directory. There was — one `eval/`, `syntax/`, … tag
each, holding the axis `Test.group` used to — and it went because every entry's name
already opens with its directory, so those six tags restated the first word of the
row they labelled. `stratification/`, `wellformed/` and `examples/` are directories
that name a feature rather than a location, and those three keep a feature tag,
which is how `stratification-01` says what it checks. Selecting a directory as a
suite is a kind tag plus a feature, or the `tests` selector on `POST /tests/run`.

The same set goes on the entry's rule set and on the rules inside it, not on the
test alone: they are one artefact seen from three rails, and grouping the Rules list
by tag should give the headings the Tests list just gave you. A rule set several
entries share — `rdfs.srl` is six tests — carries the union of theirs. Data graphs
and data blocks are left untagged, being the inputs a rule set runs over rather than
the thing under test.

Tags are ordinary entities, so they can be renamed, recoloured and deleted like any
others, and re-seeding tags a store that predates them: the union is applied to
tests, rule sets and rules that already exist, so re-running the recipe upgrades a
library rather than needing a clean. Tagging never removes, so a tag you added by
hand survives every boot — and so do the retired directory tags, as empty tags, in a
store seeded before they went. Delete them from Manage tags, or re-seed a clean
store.

Group the Tests list by tag in the sidebar to see the axes, and run a tag — or
several — from the tag button beside Run all, or from the run button on a tag
heading. That is the same `POST /tests/run` selection described above, which is what
lets a script or a CI job ask for "the negation tests" without reimplementing
selection.
