# Feature flags

Seventeen boolean flags decide which sections of the product a build offers. A
flag is read on the server, where it decides whether routes are registered, and
again in the browser build, where it decides whether a section and the controls
leading to it are drawn. The two read separate environments, so a deployment
sets both.

The list, the environment variable names and the defaults live in
`packages/types/src/featureFlags.ts`, which both halves import.

## Values

A flag's value is parsed leniently, case-insensitively, after trimming:

- `0`, `false`, `off`, `no`, `disabled` mean off.
- `1`, `true`, `on`, `yes`, `enabled` mean on.
- Unset, empty, or anything else falls back to the flag's default.

## The flags

| Key | Environment variable | Default | What is absent when it is off |
| --- | --- | --- | --- |
| `queries` | `FEATURE_QUERIES` | on | The Notebook and Query rail sections; the `/queries` and `/execute` routes |
| `queryGroups` | `FEATURE_QUERY_GROUPS` | on | The Groups rail section; the `/query-groups` routes |
| `rulesSuite` | `FEATURE_RULES_SUITE` | on | The Rules rail section; the `/rules`, `/data-blocks` and `/rule-sets` routes |
| `benchmarks` | `FEATURE_BENCHMARKS` | on | The Bench rail section; the `/benchmark-experiments` routes |
| `tests` | `FEATURE_TESTS` | on | The Tests rail section, the Tests tab on record pages, the run bar's "create test" target and the rules screen's "Save as test"; the `/tests` routes |
| `dataGraphs` | `FEATURE_DATA_GRAPHS` | on | The Graphs rail section and the doors into it. The `/data-graphs` routes stay registered |
| `tupleSets` | `FEATURE_TUPLE_SETS` | on | The Tuples rail section and the doors into it. The `/tuple-sets` routes stay registered |
| `argumentSets` | `FEATURE_ARGUMENT_SETS` | on | The Argument sets rail section and the doors into it. The `/argument-sets` routes stay registered while `queries` or `queryGroups` is on |
| `etl` | `FEATURE_ETL` | **off** | The `/etl-jobs` routes, and the startup writability check on the ETL output directory |
| `backends` | `FEATURE_BACKENDS` | on | The Backends rail section. The `/backends` routes stay registered unconditionally |
| `settings` | `FEATURE_SETTINGS` | on | The settings entry in the rail |
| `rulesAllowInvalidSave` | `FEATURE_RULES_ALLOW_INVALID_SAVE` | **off** | The ability to save a rule, data block or rule set version that does not parse. With it off, `allowInvalidSave: true` in a request body has no effect |
| `ruleTuples` | `FEATURE_RULE_TUPLES` | **off** | The SRL rule-tuples extension — see below |
| `playgroundQueries` | `FEATURE_PLAYGROUND_QUERIES` | on | The unsaved query playground. `/playground` is registered when this or `playgroundRules` is on |
| `playgroundRules` | `FEATURE_PLAYGROUND_RULES` | on | The unsaved rules playground |
| `playgroundEtl` | `FEATURE_PLAYGROUND_ETL` | **off** | The ETL rail section |
| `assistant` | `FEATURE_ASSISTANT` | **off** | The in-app build assistant; the `/assistant` routes |

Route-level refusal is a `404 Not Found`: a request to a route behind a flag
that is off reaches nothing, which is the same answer a route that was never
added gives.

## Why four flags default off

The four off-by-default flags are off for stated reasons, not by oversight.

**`etl` and `playgroundEtl`.** Both ETL surfaces accept arbitrary DuckDB SQL.
That is a read primitive over the host filesystem, and with the `httpfs`
extension loaded it is an outbound-request primitive as well. ETL is an operator
flow that someone sets up deliberately, so it should not appear on a deployment
because that deployment was upgraded. See the [ETL guide](../guides/etl.md).

**`assistant`.** The in-app assistant is unauthenticated, it calls a paid
provider, and it can reach a configured backend. See
[the security model](../explanation/security-model.md).

**`ruleTuples`.** The extension it gates is not conformant SPARQL-RL, so a
document written with it on cannot be read by other tooling. A build that has
not asked for the extension should not offer an author a way to write such a
document; see the section below.

`rulesAllowInvalidSave` is off because saving a document that does not parse is
a deliberate choice rather than a normal one. It is on in the rules-conformance
recipe, because about a third of the W3C suite's documents are meant to be
unparseable and are stored anyway.

The flags that default on grant no capability the deployment did not already
have. A test runs a callable that is runnable from its own screen. A data graph
is reference RDF you paste into your own library. A tuple set is tabular input
you register in your own library, spliced into a `VALUES` clause at execution
rather than loaded into a store. Argument sets have been reachable from the
query screen since they existed; their flag exists so the rail section can be
hidden without touching the query screen's Inputs tab, which is the same entity
seen from its callable.

## Two rules the codebase follows

**A switched-off feature has no doors.** A control that leads into a section
this build does not draw is absent, not disabled. A greyed control reads as
"broken" where the truth is "not a thing here", and a link into a section that
is not drawn navigates nowhere. This is why the flag has to be consulted where
the control is written, not only where the section is.

**An input is not a feature.** `tupleSets`, `dataGraphs` and `argumentSets` name
entities that are consumed from screens which are not their own section: a query
fills a `VALUES` clause from a tuple set, a rule set runs against a data graph, a
callable is called with an argument set. Turning one of these off hides its rail
section and the doors into it, and does not stop a callable that names one from
resolving and running. This is why their routes stay registered: a saved query
whose argument set is unreachable is a query that cannot run.

Three test files enforce these rules by inventory — each door is listed, with
the condition that holds it, so a new door fails the suite until someone says
which condition applies:

- `packages/web/test/inputSectionDoors.test.ts` — the doors into `tupleSets`,
  `dataGraphs` and `argumentSets`, and the reads that must keep working.
- `packages/web/test/testsFeatureDoors.test.ts` — every door into the tests
  feature.
- `packages/web/test/ruleTuplesDoors.test.ts` — every surface mentioning the
  rule-tuples extension, and the separation from tuple sets.

## `ruleTuples`: the SRL rule-tuples extension

`FEATURE_RULE_TUPLES`, default **off**.

Two switches govern this feature and they answer different questions. A rule set
version's `tuplesEnabled` is the *document's* setting, chosen per version by its
author. The `ruleTuples` flag is the *deployment's* setting, and it sits above
the toggle: with the flag off no request can turn the toggle on, send seed rows,
or have a `TUPLE( … )` parsed.

### What it gates

- The `TUPLE( … )` syntax in an SRL document. See
  [the SRL reference](srl-language.md#the-rule-tuples-extension).
- A rule set version's `tuplesEnabled` toggle and its `tupleSeeds`.
- The tuple seed input on a rule set execute.
- In the browser build, the toggle itself, the named-tuples input block, and any
  pick that leads to either. They are absent, not disabled.

### What it does not gate

The `TupleSet` entity, the Tuples rail section and argument sets are a different
thing that shares the word "tuple". A tuple set is a saved table of RDF terms
that fills a query's `VALUES` clause; it is governed by `tupleSets`, its rail
stays drawn, and it keeps working with `ruleTuples` off. See
[concepts](../concepts.md) for the distinction.

### What a caller sees

With the flag off, a request that asks for the extension is refused with
`400` and the message:

```
The rule-tuples extension is not enabled on this server
```

A request "asks for the extension" when it carries `tuples: true`, a non-empty
`tupleSeeds`, or a `tuplesEnabled` of true. The refusal covers the SRL preview,
the SRL import, and the document analyzer. On a rule set execute the tuple seed
input is refused by the body schema rather than by the handler, so the message
is the validator's; either way the run does not start.

A document containing `TUPLE( … )` that *does not* claim the extension is not
refused with that message. It is read as conformant SRL, in which `TUPLE` is not
in the grammar, so the analyzer answers `200` with `valid: false` and a syntax
error. A caller that asked for the extension is told why it cannot have it; a
caller that did not is told its document is not SRL.

Reading a rule set version that was saved when the extension was available also
respects the flag: `tuplesEnabled` comes back as `false` and `tupleSeeds` as
empty, rather than echoing what an older version stored.

### The residual

The generated contract in `packages/contracts` and the MCP tool schemas built
from it are static artefacts. They still describe `tuples` and `tupleSeeds`, so
a client reading them will believe the fields exist. The server refuses them.
The route schemas registered at runtime do drop the fields, so the API
documentation a running server serves does not advertise them.

The gate's behaviour is pinned by
`packages/api/test/routes/ruleTuplesGate.test.ts`.

## The browser build

`packages/web` is built ahead of time, so its flags are resolved at build time
by `packages/web/nuxt.config.ts`. For each flag it reads
`NUXT_PUBLIC_FEATURE_<NAME>` first and falls back to the plain
`FEATURE_<NAME>`, then hands the result to the same `buildFeatureFlags` the API
uses, so an unset variable lands on the same default in both halves.

```
NUXT_PUBLIC_FEATURE_ETL  ??  FEATURE_ETL  ??  the default (off)
```

The `Justfile` recipes show the pairing: `run-local-rules-tests` sets
`FEATURE_*` for the API and `run-frontend-rules` sets the matching
`NUXT_PUBLIC_FEATURE_*` for the SPA, because the two are separate processes and
each reads its own environment. Setting them only on the API would leave the
rail showing sections the API no longer serves.

## Overriding a deployed static build

A built SPA can be re-flagged without rebuilding. The plugin
`packages/web/src/plugins/runtime-config.client.ts` fetches `/config.json` at
startup and merges what it finds over the build-time values:

```json
{
  "apiBaseUrl": "https://sqlib.example.org",
  "featureFlags": { "etl": false, "assistant": false }
}
```

Keys are the flag keys, not the environment variable names, and a partial object
is merged over the build-time flags rather than replacing them. The same file
also overrides `authIssuer`, `authClientId`, `authAudience` and `authScope`. A
missing file, a response that is not JSON, or a parse failure logs a warning and
leaves the build-time values in place, so a deployment that serves no
`/config.json` behaves exactly as it was built.

This changes the browser only. The server's own flags come from its environment,
and a flag turned on in `/config.json` that the API has off produces a section
whose requests answer `404`.
