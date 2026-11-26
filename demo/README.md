# Rail demo

The Rail demo shows every part of sqlib on one small, made-up library. It runs
in demo mode: read-only, with no sign-in. A visitor is a guest until they pick
Alice, Bob, Carol or Dana under "Switch user" in the account menu. Each person
sees more of the Rail operations store. Dana is an administrator.

## Run it

| Command | What it runs |
| --- | --- |
| `just demo` | The API on :3005 and the web UI on :3001, from this checkout |
| `just build-docker && just build-demo-docker && just run-demo-docker` | The demo API image on :3005. Run the web UI with `just run-frontend` |

The first `just demo` seeds `tmp/demo/store/library.sqlite`, in about 10 s.
Later starts reuse it. Run `just clean-demo` to seed again, for example after
you change a manifest. `Dockerfile.demo` seeds the store at image build, so the
image starts with it.

## What is in it

| Library | Contents |
| --- | --- |
| **Rail network** (`libraries/rail/`) | 16 stations, 4 lines, weekday and weekend timetables, fares. 26 queries with every form of parameter, 5 query groups, a tuple set, 3 rule sets (recursion; `GROUP` and `NOT`; a `DATA` block), 13 tests (one fails on purpose), 4 benchmarks, 2 ETL jobs over CSV rows, 3 environments (prod keeps two queries at version 1), published tools, a map, 3 notebooks |
| **Rail operations (administrators)** (`libraries/rail-admin/`) | The public, finance and staff graphs, their two backends and the graph policy behind Rail's *access* queries. Only Dana sees this library |
| **Learn SPARQL** (`libraries/sparql-tutorial/`) | A course of ten lessons on SPARQL 1.1 queries, on the Rail store. Each lesson has worked examples and an exercise, which is a test |
| **SPARQL in sqlib** (`libraries/sqlib-tutorial/`) | A course of five lessons on what sqlib adds: `VALUES … { UNDEF }` parameters, `LIMIT 0001` and `OFFSET 0002` parameters, saved queries and versions, and argument sets |

## The tutorials

The two courses open in the tutorial MCP App: call `app_tutorial_open` with
`libraryId` set to `urn:sqlib:library:sparql-tutorial` or
`urn:sqlib:library:sqlib-tutorial`, from a client that renders MCP Apps. The
web UI shows the same lessons as tags, the exercises as tests, and each
solution as the current version of a query.

Each course is built from the files in its directory:

| File | Contents |
| --- | --- |
| `library.md` | The course description |
| `lessons/NN-*/lesson.md` | The objectives of the lesson: the description of its numbered tag |
| `lessons/NN-*/example*.rq`, `example*.md` | A worked example and its description |
| `lessons/NN-*/starter.rq`, `solution.rq` | Version 1 and the current version of the exercise query |
| `lessons/NN-*/expected*.srj`, `expected.nt` | The expected result of each case of the exercise test |

When you change a solution or an argument set, write the expected results
again, and read the diff. A wrong solution writes a matching wrong expectation.

```sh
just demo   # in another terminal
node demo/scripts/tutorial-expected.mjs http://localhost:3005 demo/libraries/sparql-tutorial demo/libraries/sqlib-tutorial
```

The `demo` CI job fails when an exercise does not pass with its solution.

## Graph access

The graph policy decides which graphs of Rail operations a caller reads. Run
*Graphs I can read* in Rail as each person:

| Person | Groups | Graphs |
| --- | --- | --- |
| Guest | | public |
| Alice | analysts | public, finance |
| Bob | hr | public, finance, staff |
| Carol | | public, staff |
| Dana | admins (administrator) | public, finance, staff |

The private graphs are in a second library because a grant applies to a whole
library. A visitor who can read a library can open its data graphs.

## Files

| Path | Contents |
| --- | --- |
| `libraries/<name>/seed.json` | One library's manifest, with the query text, Turtle, SRL, CSV, notebooks and expected test results beside it |
| `people.json` | The demo people (`SQLIB_DEMO_PEOPLE`) |
| `grants.ttl` | What a guest may do (`SQLIB_AUTH_SEED_GRANTS`). Every person also holds a guest's grants |
| `server.env` | The demo server's settings |
| `scripts/seed.sh` | Starts an API with writes open, plays each manifest back and stops the API |
| `scripts/seed-library.mjs` | Plays one manifest back over the API |
| `scripts/demo-issuer.mjs` | Makes a token for each person while seeding, so each entity names the person who wrote it |
| `scripts/tutorial-expected.mjs` | Writes the expected results of the tutorial exercises from their solutions |

The store is built from these files and is not kept in git. A built store is
about 1.7 MB. The text files are about 250 KB, and a change to a query is a
one-line diff.

The manifests, `people.json` and the two `.mjs` scripts are also in the
`sqlib-demo` repository, which deploys the hosted demo. Change them here first.
The `sqlib-demo` check compares its copies with this directory at the sqlib
revision it pins.
