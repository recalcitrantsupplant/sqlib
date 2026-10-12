# Benchmark argument sources

Status: proposal, not built.

This proposal decides where a benchmark's argument values come from, and how a
run selects among them. It also records why a read-only deployment does not run
benchmarks.

## Current behaviour

These facts are from `packages/api/src/lib/BenchmarkRunner.ts` and
`packages/api/src/lib/ArgumentSetService.ts`.

- The Argument sets axis of a benchmark holds stored argument sets, plus the
  "No arguments" entry.
- The runner makes one request for each case × backend × argument set ×
  repeat.
- `ArgumentSetService.exportRuntimePayload` puts every row of a set into one
  `VALUES` block. A set with 50 rows gives one request with 50 rows, not 50
  requests. There is no way to time one value against another.
- `BenchmarkRunner.buildTasks` pins each argument set to its current version
  when the run starts, and records that version on each observation.
  `executeQueryVersion` then passes the set id, not the pinned version id, so
  the rows are read from the current version at request time. If the set gets a
  new version during a run, a request can use rows that differ from the
  recorded version.
- An argument set binding can already take rows from tuple set versions
  (`tupleSetVersions`). Tuple sets import CSV and other tabular formats
  (`POST /tuple-sets/preview`, `POST /tuple-sets/:id/versions/from-etl`).
- The benchmark Arguments panel
  (`packages/web/src/components/benchmarks/BenchmarkArgumentSetPanel.vue`)
  shows five sources. Only "Fixed list" works. "Range sweep", "Seeded random",
  "From a query" and "CSV" are disabled.

## Two separate problems

**Generation** is how the candidate values are made. A SPARQL `SELECT` can
make all of the values the disabled sources describe:

| Disabled source | SPARQL that produces it |
| --- | --- |
| Range sweep | `VALUES ?n { 1 2 4 8 16 }`, or a numbers graph with `FILTER` |
| Seeded random | `ORDER BY RAND() LIMIT 20` (unseeded, see below) |
| From a query | Any `SELECT` over the dataset |
| CSV | Not needed: a tuple set already imports CSV |

A `SELECT` result in SPARQL Results JSON is already the format an argument set
holds, so no conversion is needed.

**Selection** is which of those values a run sends, and how. SPARQL cannot do
this part well:

- `RAND()` takes no seed. Two runs of the same query return different values,
  so their timings are not comparable.
- A query resolved at run time can return different rows on different backends,
  or after the dataset changes. Then the stores do not answer the same question.
- Whether to send all rows in one request or one row for each request is a
  property of the run, not of the values.

## Recommendation

Restrict the benchmark axis to argument sets. Add a way to fill an argument set
version from a `SELECT` query. Do selection in the runner.

| Option | Reproducible | Same values on every backend | Work |
| --- | --- | --- | --- |
| Argument sets only (today) | Yes | Yes | None, but values are typed by hand |
| Argument sets, or a query run at benchmark time | No, unless the run stores the rows | Only if resolved once on one backend | A second source type in the runner, the plan and the UI |
| **Argument sets, filled from a query (recommended)** | Yes | Yes | One new API route and one editor action |

A query run at benchmark time must store its rows to make the run reproducible.
A stored set of rows from a query is an argument set version, so the second
option becomes the third with more code.

## Plan

1. **Fix the version mismatch.** Pass the pinned `argumentSetVersionId` to
   `exportRuntimePayload` in `executeQueryVersion` and
   `executeQueryGroupVersion`. Add a runner test that makes a new version
   during a run and checks the request used the pinned rows.
2. **Fill a set from a query.** Add
   `POST /argument-sets/:id/versions/from-query`. The body names a query
   version (or `SELECT` text) and a backend. The route runs the query, checks
   that the result variables match the set's binding, and writes a new version
   with the rows. The version records the source query version, the backend and
   the time. A read-only deployment refuses the route, because it writes.
3. **Expose it in the editor.** Add "Fill from query" to the argument set
   editor. In the benchmark Arguments panel, remove the disabled sources and
   the disabled seed field. Show the set's provenance instead: "typed",
   "from tuple set …", or "from query … on backend …".
4. **Add selection to the runner.** Give each argument set entry on a
   benchmark two settings:
   - Mode: "all rows in one request" (today's behaviour) or "one request for
     each row".
   - Sample: all rows, or N rows chosen by a seeded shuffle in sqlib. The run
     records the seed and the row positions it used, so a later run can repeat
     the selection.

   "One request for each row" multiplies the expansion count by the row count,
   so the Plan footer must show it.
5. **Show example results on a read-only deployment.** See the next section.

## Read-only deployments

`SQLIB_READ_ONLY=true` refuses `POST /benchmark-experiments/:id/versions/:version/run`
(`packages/api/src/config/readOnly.ts`), and the web Run button is disabled
there. The route is refused for two reasons:

- The runner writes a run record and its observations.
- Skipping those writes, as `POST /tests/run` does, would still let any visitor
  start a run of up to thousands of requests against the deployment's backends.

To show what a benchmark produces on a public site, ship example runs with the
seeded catalogue. This needs a seed path for `BenchmarkRun`,
`BenchmarkObservation`, `BenchmarkNodeObservation` and
`BenchmarkIterationObservation` records, because runs are stored outside the
entity cache that the current seeding writes through
(`packages/api/src/server/seed.ts`). The Runs tab then shows the seeded runs
with no other change.

## Open questions

- Does "one request for each row" substitute one row into `VALUES`, or bind the
  variable directly? Both send one row. A one-row `VALUES` block can produce a
  different query plan than an inlined constant on some stores.
- Should a set filled from a query refresh itself on a schedule? This proposal
  says no: a new version is made only when someone asks for one, so a benchmark
  keeps its values until its author changes them.
