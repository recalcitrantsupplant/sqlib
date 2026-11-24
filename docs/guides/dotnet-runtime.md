# Running a bundle from .NET

`SparqlQueryLib.Runtime` is a .NET library that runs the parameterised queries
of an exported bundle with no sqlib server. It is a port of the part of
`@sparql-query-lib/runtime` that turns a bundle, a query name and a payload into
query text. It also has a thin HTTP client that sends the text to a SPARQL
endpoint. The source is in [`dotnet/`](../../dotnet). The design is in issue
#252.

The contract is `QueryHandle.text(payload)` in
[`packages/runtime/src/library.ts`](../../packages/runtime/src/library.ts). For
each bundle and payload, the .NET library returns the same text, or refuses
with the same error type and the same message. A wrong slot span gives a valid
query with wrong results and no error, so both runtimes are checked against one
set of golden cases. See [Conformance](#conformance).

For a developer who uses the library,
[`dotnet/GETTING-STARTED.md`](../../dotnet/GETTING-STARTED.md) goes step by
step from installing .NET to a query against an endpoint. It is built on the
console example in [`dotnet/examples/QuickStart`](../../dotnet/examples/QuickStart/Program.cs).

The package README, [`dotnet/README.md`](../../dotnet/README.md), shows the
install, the API and the error types. This guide gives the workflow, the value
pattern subset, the differences from the TypeScript runtime, the tests and the
release.

## Workflow

1. Write and test the queries in the sqlib web app.
2. Add test cases to each query. The export carries them into the bundle as
   `examples`. Each example is a valid payload.
3. Export the bundle. See [static-export.md](static-export.md), "Producing a
   bundle". `QueryLibrary.Load` accepts a bare bundle and the
   `{ bundle, skipped }` envelope of `GET /libraries/:id/export-bundle`.
4. Commit the bundle to the .NET application, or load it at start-up.
5. In the application, build each call from a payload and send the text to the
   endpoint.

To test the application against the bundle, run each example:

```csharp
foreach (var query in library.Queries)
foreach (var example in query.Examples)
{
    var text = query.Text(example.PayloadJson);
    // Send text, and compare the result with example.Expected
    // when example.DataDependent is false.
}
```

## What it runs

| Bundle section | Loaded and checked | Run |
| --- | --- | --- |
| `queries` | Yes | Yes |
| `groups` | Yes, including the cycle check | No |
| `etlJobs`, `ruleSets`, `updates` | Yes, including each `textHash` | No |

The loader runs every structural check of `assertValidBundle` in
[`bundle.ts`](../../packages/runtime/src/bundle.ts), in the same order and with
the same messages. It then checks each `textHash`. It ignores fields that it
does not know.

## Payloads

A payload is the `CallPayload` of the TypeScript runtime, as JSON or as the
typed `CallPayload` class:

- `arguments`: SPARQL Results JSON documents, matched to slots by `head.vars`.
  The short form `{ "bindings": [...] }` fills the slots in order.
- `limits` and `offsets`: an array of `{ "name", "value" }`, or a
  `{ "name": value }` map.

The rules for empty slots, input policies, identity slots and page parameters
are the rules of the TypeScript runtime. [static-export.md](static-export.md),
"How arguments are applied", describes them.

`query.Text(json)` and `query.Text(payload)` give the same text for the same
payload. `LibraryTests.TypedPayloadMatchesTheJsonPayload` checks this.

## Value patterns

A slot's `inputPolicies` entry can carry a `valuePattern`. The TypeScript
runtime compiles it as `new RegExp(pattern, 'u')`, and refuses a bound value
that does not match. .NET reads some constructs differently from JavaScript:

- `$` also matches before a final newline.
- `\d`, `\w`, `\s` and `\b` match Unicode characters outside ASCII.
- `.` and a negated class consume one UTF-16 code unit. JavaScript in Unicode
  mode consumes one code point.

`ValuePattern.Translate` writes a JavaScript pattern as a .NET pattern with
the same matches:

| JavaScript | .NET translation |
| --- | --- |
| `$` | `\z` |
| `\d`, `\w` | `[0-9]`, `[A-Za-z0-9_]`, written as `\uXXXX` ranges |
| `\s` | The JavaScript white space and line terminator set, as explicit ranges |
| `\b`, `\B` | Lookarounds over `[A-Za-z0-9_]` |
| `.` | One code point other than a line terminator: a BMP character or a surrogate pair |
| `[^...]`, `\D`, `\W`, `\S` | One code point outside the set: a BMP character or a surrogate pair |
| A literal outside the BMP | The surrogate pair in a non-capturing group |
| `(...)`, `(?<name>...)` | `(?:...)` |

The loader compiles every pattern. It refuses a bundle with a pattern that
JavaScript refuses, with the message "is not a valid regular expression:". It
also refuses a pattern that JavaScript accepts but that uses a construct this
library does not translate. That message names the construct and ends "which
this runtime does not translate to a .NET regular expression". The constructs
are:

- A Unicode property escape (`\p{...}`, `\P{...}`).
- A back-reference (`\1`, `\k<name>`).
- A character class member outside the Basic Multilingual Plane, or a
  surrogate code point in a class.
- A lone surrogate.
- `\D`, `\W` or `\S` inside a character class.
- A modifier group (`(?i:...)`).
- A group name with a character outside `[A-Za-z0-9_$]`.
- A quantifier bound above 2147483647.

A refusal happens on load, so an application does not start with a bundle
that it cannot run in full. To use one of these constructs, remove it from the
pattern in sqlib and export again.

Each match has a timeout, 1 s by default. A match that runs longer raises
`RegexMatchTimeoutException`. Set `BundleLoadOptions.ValuePatternTimeout` to
change it, or to `Regex.InfiniteMatchTimeout` to wait as JavaScript does.

## Differences from the TypeScript runtime

| Case | TypeScript runtime | .NET library | Reason |
| --- | --- | --- | --- |
| A `template.prefixes` entry that is not two strings | Loads it | Refuses the bundle: "template.prefixes[i] must be a [prefix, namespace] pair of strings." | A typed prefix table needs the check. No exporter writes such an entry. |
| A value pattern match that runs too long | Runs until it ends | `RegexMatchTimeoutException` after 1 s | A server needs a bound on the work per request. |
| A byte order mark before the bundle JSON | `JSON.parse` refuses it | Skips it | Files saved by Windows tools often start with one. |
| A payload that makes TypeScript raise a `TypeError`, such as `null` in place of an argument document | `TypeError` | A missing member reads as undefined, and the later checks decide | The goldens hold no such case, so this outcome is not checked. |
| A JSON number with more than 15 significant digits, on .NET Framework | Correctly rounded | Can differ in the last bit | `double.Parse` on .NET Framework is not correctly rounded. .NET Core 3.0 and later are. |
| A value pattern outside the subset | Runs it | Refuses the bundle | See [Value patterns](#value-patterns). |

## Conformance

The golden cases are in
[`packages/runtime/test/conformance/goldens.json`](../../packages/runtime/test/conformance/goldens.json).
They are generated. Do not edit the file.

- [`cases.ts`](../../packages/runtime/test/conformance/cases.ts) builds the
  inputs: bundles, payloads and value patterns. It includes seeded random
  payloads and patterns, so a change to it changes many cases.
- [`conformance.test.ts`](../../packages/runtime/test/conformance.test.ts)
  runs each case with the TypeScript runtime and compares the outcomes with
  the file. A difference fails the `test` job.
- The .NET suite reads the same file and checks each case. The `dotnet` job
  runs it.

The file holds three sections:

| Section | Each case | Count |
| --- | --- | --- |
| `load` | A bundle, and the load outcome | 55 |
| `calls` | A bundle, a query name and a payload, and the text or the error | 287 |
| `valuePatterns` | A pattern and a value, and the match result or the error | 214 |

An outcome is the text, or the error type name and message. For an invalid
regular expression the case holds only the message prefix, because the rest
of the message comes from the JavaScript engine.

The .NET suite also runs every case under the `tr-TR`, `ar-SA` and `de-DE`
cultures, which change casing, digits and number formats.

When a change to the TypeScript runtime changes an outcome on purpose:

1. Rewrite the file:

   ```sh
   SQLIB_UPDATE_GOLDENS=1 pnpm --filter @sparql-query-lib/runtime exec vitest run test/conformance.test.ts
   ```

2. Read the diff of `goldens.json`. Each changed case is a change in behaviour.
3. Make the same change in `dotnet/`, and run the .NET suite.
4. Commit both in one pull request.

## Running the tests

The `dotnet` job in [`ci.yml`](../../.github/workflows/ci.yml) runs
[`scripts/ci/dotnet.sh`](../../scripts/ci/dotnet.sh). To run it locally, install
the .NET 8 and .NET 10 SDKs, then:

```sh
bash scripts/ci/dotnet.sh
```

The script runs the tests on `net8.0` and `net10.0` against the `net8.0`
library build. It then runs them again against the `netstandard2.0` build
(`-p:TestNetStandard=true`), which is the build a .NET Framework application
loads. Then it runs the QuickStart example, and last it packs the package into
`dotnet/artifacts`.

To review without installing .NET, run the tests in the SDK container from the
repository root:

```sh
docker run --rm -v "$PWD":/src -w /src/dotnet mcr.microsoft.com/dotnet/sdk:10.0 \
  dotnet test test/SparqlQueryLib.Runtime.Tests -f net10.0
```

The container writes `bin/` and `obj/` folders owned by root into
`dotnet/`. `git status` ignores them.

Not run in CI:

- The tests on .NET Framework itself. They need Windows.
- A query against a live endpoint. `SparqlEndpointTests` uses a fake
  `HttpMessageHandler`.

## Release

The package is `SparqlQueryLib.Runtime` on nuget.org. release-please versions
it as a second package in
[`.release-please-config.json`](../../.release-please-config.json):

- Component `dotnet`. Tags are `dotnet-vX.Y.Z`. The first version is 0.1.0.
- A conventional commit that changes a file under `dotnet/` goes into the
  release pull request of this package. Other commits go to the server
  release.
- `separate-pull-requests` is on, so the server and the package each have
  their own release pull request. Merge one to release that one only.
- release-please writes the version into the csproj, between the
  `x-release-please-start-version` and `x-release-please-end` markers, and
  writes `dotnet/CHANGELOG.md`.

When a `dotnet` release is created, the `nuget` job in
[`release-please.yml`](../../.github/workflows/release-please.yml) runs the
tests, packs, and runs [`scripts/ci/nuget-push.sh`](../../scripts/ci/nuget-push.sh).
That script refuses to push when the packed version is not the tagged version.
nuget.org does not let a version be replaced, so a wrong push cannot be undone.

The job pushes with nuget.org trusted publishing. The `NuGet/login` step
exchanges the job's GitHub OIDC token for an API key that is valid for 1 hour,
so the repository stores no API key. To set it up:

1. On nuget.org, open your user menu, then **Trusted Publishing**. Add a
   GitHub Actions policy with the owner `recalcitrantsupplant`, the
   repository `sqlib` and the workflow file `release-please.yml`. Leave the
   environment empty.
2. In the repository settings, add the `NUGET_USER` secret: the nuget.org
   profile name that owns the policy. Do not use the email address.
3. Merge a `dotnet` release pull request. The first push registers the package
   ID `SparqlQueryLib.Runtime`.

The policy names the workflow file, so keep the `nuget` job in
`release-please.yml`. A job in another workflow file gets no key.

A bundle format change needs a release of both runtimes. State the bundle
versions that a release reads in `dotnet/README.md` and in the package
description.

## Worked example: a paged search with a Jena text index

This example is the first intended use. It has not been run against Jena.

```sparql
PREFIX luc: <urn:jena:lucene:index#>
PREFIX ex: <http://example.org/>
SELECT ?focus ?identifier (GROUP_CONCAT(DISTINCT ?altName; separator="; ") AS ?altNames)
WHERE {
  {
    SELECT ?focus WHERE {
      VALUES (?term ?filter ?pageSize ?start) { (UNDEF UNDEF UNDEF UNDEF) }
      (?hit ?focus ?weight ?total) luc:query ("index" "fields" ?term ?filter "sort" ?pageSize ?start) .
    }
  }
  OPTIONAL { ?focus ex:identifier ?identifier }
  OPTIONAL { ?focus ex:alternateName ?altName }
}
GROUP BY ?focus ?identifier
```

Paging happens inside the text index. Each `GROUP BY` covers one page, and the
caller loops over the pages.

These facts follow from the runtime:

- `?pageSize` and `?start` are cells of a VALUES slot. Send them as typed
  literals, such as `"25"^^<http://www.w3.org/2001/XMLSchema#integer>`. Page
  parameters (`LIMIT 0001`) do not apply.
- The four variables are one slot. Mark it `require`. An omitted slot removes
  the VALUES block, and the property function then runs with unbound arguments.
- The bundle holds the text that the generator writes. The list arguments of
  `luc:query` can be spelled differently from the source.

Check these before the application relies on the query:

- Export the query, and confirm that it compiles to a verified template.
- Confirm that Jena binds the VALUES variables before it evaluates
  `luc:query`. `packages/compiler/test/lateral.jena.test.ts` records that Jena
  can evaluate a property function apart from its VALUES. `LATERAL` can be
  necessary.
- Pages are stable only when the index sorts on a unique key. Name an
  identifier field in the sort argument.
- Offset paging slows as the offset grows. Time a page deep into a result of a
  few million hits.
- Two multi-valued columns on one record multiply each other's rows.
  `DISTINCT` in each `GROUP_CONCAT` removes the duplicates.
- A filter that names a field that the index does not hold returns every
  record or no record, depending on the Jena build. Check the filter fields
  against the index configuration.
