# Feature flags

Twenty-one boolean flags decide which sections of the product a build offers. Two
processes read each flag:

- The server reads it to decide whether to register routes.
- The browser build reads it to decide whether to show a section, and the
  controls that lead to it.

The two read separate environments, so a deployment sets both.

The list, the environment variable names and the defaults are in
`packages/types/src/featureFlags.ts`. The server and the browser build both
import it.

## Values

sqlib trims the value of a flag, and parses it without regard to case:

- `0`, `false`, `off`, `no`, `disabled` mean off.
- `1`, `true`, `on`, `yes`, `enabled` mean on.
- Unset, empty, or any other value gives the default of the flag.

## The flags

| Key | Environment variable | Default | What is absent when it is off |
| --- | --- | --- | --- |
| `notebook` | `FEATURE_NOTEBOOK` | on | The Notebook rail section and the links into it. `/notebook` stays reachable by URL |
| `queries` | `FEATURE_QUERIES` | on | The Query rail section; the `/queries`, `/execute` and `/sparql` routes, and `/detect-inputs` / `/detect-outputs`. The Notebook has its own flag above |
| `queryGroups` | `FEATURE_QUERY_GROUPS` | on | The Groups rail section; the `/query-groups` routes |
| `rulesSuite` | `FEATURE_RULES_SUITE` | on | The Rules rail section; the `/rules`, `/data-blocks` and `/rule-sets` routes |
| `benchmarks` | `FEATURE_BENCHMARKS` | on | The Bench rail section; the `/benchmark-experiments` routes |
| `tests` | `FEATURE_TESTS` | on | The Tests rail section, the Tests tab on record pages, the run bar's "create test" target and the rules screen's "Save as test"; the `/tests` routes |
| `dataGraphs` | `FEATURE_DATA_GRAPHS` | on | The Graphs rail section and the controls that lead to it. The `/data-graphs` routes stay registered |
| `tupleSets` | `FEATURE_TUPLE_SETS` | on | The Tuples rail section and the controls that lead to it. The `/tuple-sets` routes stay registered |
| `argumentSets` | `FEATURE_ARGUMENT_SETS` | on | The Argument sets rail section and the controls that lead to it. The `/argument-sets` routes stay registered while `queries`, `queryGroups` or the `/tests` routes are on |
| `mcp` | `FEATURE_MCP` | on | The MCP rail section: the MCP URL of the deployment, and the steps to add it to a chat client. The MCP server itself stays available |
| `etl` | `FEATURE_ETL` | **off** | The `/etl-jobs` routes, and the startup writability check on the ETL output directory |
| `backends` | `FEATURE_BACKENDS` | on | The Backends rail section. The `/backends` routes stay registered unconditionally |
| `settings` | `FEATURE_SETTINGS` | on | The settings entry in the rail |
| `rulesAllowInvalidSave` | `FEATURE_RULES_ALLOW_INVALID_SAVE` | **off** | The ability to save a rule, data block or rule set version that does not parse. With it off, `allowInvalidSave: true` in a request body has no effect |
| `ruleTuples` | `FEATURE_RULE_TUPLES` | **off** | The SRL rule-tuples extension. See below |
| `ruleAggregates` | `FEATURE_RULE_AGGREGATES` | **off** | SRL `GROUP` aggregation, until w3c/data-shapes#1347 is merged. See below |
| `playgroundQueries` | `FEATURE_PLAYGROUND_QUERIES` | on | The unsaved query playground, which runs through `/execute`. It has no route of its own |
| `playgroundRules` | `FEATURE_PLAYGROUND_RULES` | on | The unsaved rules playground; `POST /playground/rules/execute` |
| `playgroundEtl` | `FEATURE_PLAYGROUND_ETL` | **off** | The ETL rail section; `POST /playground/etl/execute` |
| `assistant` | `FEATURE_ASSISTANT` | **off** | The in-app build assistant; the `/assistant` routes |
| `ogc` | `FEATURE_OGC` | **off** | OGC API Features: the `/ogc/{slug}` routes. See [publishing OGC collections](../guides/publishing-ogc-collections.md) |

A route behind a flag that is off answers `404 Not Found`. This is the same
answer as for a route that does not exist.

## Why five flags default off

Five flags are off by default, for these reasons.

**`etl` and `playgroundEtl`.** Both ETL surfaces accept arbitrary DuckDB SQL.
This SQL can read the host filesystem. With the `httpfs` extension loaded, it
can also make outbound requests. An operator must set up ETL intentionally, so
it must not appear on a deployment after an upgrade. See the
[ETL guide](../guides/etl.md).

**`assistant`.** The in-app assistant has no authentication, calls a paid
provider, and can reach a configured backend. See
[the security model](../explanation/security-model.md).

The provider SDK of the assistant (`ai`, `@ai-sdk/*`) is an optional dependency
of the api package. Nothing else uses it, because MCP clients use their own
model. To build a server image without it, pass
`--build-arg WITH_ASSISTANT=false` to `docker build`. If `FEATURE_ASSISTANT` is
on and the packages are missing, the server still starts and logs a warning.
Each assistant turn then fails with a message that names the missing packages.

**`ruleTuples`.** Its extension is not part of SHACL 1.2 Rules, so other tools
cannot read a document that uses it. A build that did not ask for the extension
must not give an author a way to write such a document. See the section below.

**`ruleAggregates`.** Off for the same reason as `ruleTuples`: `GROUP` is not
yet in SHACL 1.2 Rules.

`rulesAllowInvalidSave` is off because a person should save a document that does
not parse only by an explicit choice. It is on in the rules-conformance recipe,
because about a third of the documents in the W3C suite are intentionally
unparseable, and sqlib must store them.

The flags that are on by default grant no new capability to the deployment:

- A test runs a callable that you can already run from its own screen.
- A data graph is reference RDF that you paste into your own library.
- A tuple set is tabular input that you register in your own library. sqlib puts
  it into a `VALUES` clause at execution, and does not load it into a store.
- The query screen has always shown argument sets. Their flag lets you hide the
  rail section, and keep the Inputs tab of the query screen, which shows the
  same entity from its callable.

## Two rules the codebase follows

**A feature that is off has no doors.** A "door" is a control that leads into a
section. When this build does not show the section, the control is removed, and
not disabled. A grey control looks broken, when the feature is only absent. A
link into a section that is not shown goes nowhere. Each control must therefore
read the flag where the control is written, as well as where the section is.

**An input is not a feature.** `tupleSets`, `dataGraphs` and `argumentSets` name
entities that other screens use: a query fills a `VALUES` clause from a tuple
set, a rule set runs against a data graph, and a callable is called with an
argument set. When one of these flags is off, its rail section and the doors to
it are hidden. A callable that names such an entity still resolves and runs. For
this reason, their routes stay registered: a saved query whose argument set
cannot be read cannot run.

Three test files enforce these rules with an inventory. Each door is listed, with
the condition that controls it. A new door fails the suite until a person states
its condition.

- `packages/web/test/inputSectionDoors.test.ts`: the doors into `tupleSets`,
  `dataGraphs` and `argumentSets`, and the reads that must keep working.
- `packages/web/test/testsFeatureDoors.test.ts`: each door into the tests
  feature.
- `packages/web/test/ruleTuplesDoors.test.ts`: each surface that mentions the
  rule-tuples extension, and the separation from tuple sets.

## `ruleTuples`: the SRL rule-tuples extension

`FEATURE_RULE_TUPLES`, default **off**.

Two switches control this feature, at two levels:

- `tuplesEnabled` on a rule set version is the setting of the *document*. The
  author sets it for each version.
- The `ruleTuples` flag is the setting of the *deployment*, and it controls the
  toggle. With the flag off, no request can turn the toggle on, send seed rows,
  or get a `TUPLE( … )` parsed.

### What it gates

- The `TUPLE( … )` syntax in an SRL document. See
  [the SRL reference](srl-language.md#the-rule-tuples-extension).
- The `tuplesEnabled` toggle of a rule set version, and its `tupleSeeds`.
- The tuple seed input on a rule set execute.
- In the browser build: the toggle, the named-tuples input block, and each
  option that leads to either. They are removed, and not disabled.

### What it does not gate

The `TupleSet` entity, the Tuples rail section and argument sets are a separate
feature with the same word, "tuple". A tuple set is a saved table of RDF terms
that fills the `VALUES` clause of a query. The `tupleSets` flag controls it. Its
rail stays, and it keeps working with `ruleTuples` off. See
[concepts](../concepts.md) for the difference.

### What a caller sees

With the flag off, a request that asks for the extension is refused with
`400` and the message:

```
The rule-tuples extension is not enabled on this server
```

A request asks for the extension when it has `tuples: true`, a non-empty
`tupleSeeds`, or a `tuplesEnabled` of true. The refusal covers the SRL preview,
the SRL import, and the document analyser. On a rule set execute, the body
schema refuses the tuple seed input before the handler runs, so the message
comes from the validator. In both cases, the run does not start.

A document that contains `TUPLE( … )`, and *does not* ask for the extension,
gets a different answer. sqlib reads it as conformant SRL, whose grammar has no
`TUPLE`. The analyser answers `200` with `valid: false` and a syntax error. A
caller that asked for the extension learns why it cannot have it. A caller that
did not ask learns that its document is not SRL.

A read of a rule set version saved when the extension was available also
follows the flag. `tuplesEnabled` is `false`, and `tupleSeeds` is empty,
whatever the older version stored.

### The residual

The generated contract in `packages/contracts`, and the MCP tool schemas built
from it, are static artefacts. They still describe `tuples` and `tupleSeeds`,
so a client that reads them assumes that the fields exist. The server refuses
them. The route schemas registered at run time remove the fields, so the API
documentation of a running server does not show them.

`packages/api/test/routes/ruleTuplesGate.test.ts` checks the behaviour of the
gate.

## `ruleAggregates`: SRL `GROUP` aggregation

`FEATURE_RULE_AGGREGATES`, default **off**.

The flag decides whether the server parses `GROUP`, the aggregation element of
[w3c/data-shapes#1347](https://github.com/w3c/data-shapes/pull/1347). See
[the SRL reference](srl-language.md#aggregation-group).

Status:

- Done: the flag, while the pull request is not merged.
- To do: when it merges, `GROUP` becomes part of SRL, and the flag is removed.

This flag has no switch for each version. `ruleTuples` needs one, because a rule
set version holds seed rows that have meaning only with that extension on. A
`GROUP` is completely inside the rule text.

With the flag off, `GROUP` is a syntax error in each place where the server
parses a rule: a rule save, the rule set analyser and SRL preview, the SRL
import, the rules playground, and stratification. The message names the parse
option of the flag:

```
SRL syntax error: GROUP requires the rule-aggregates extension (parse with { aggregates: true })
```

A rule saved while the flag was on keeps its compiled program. Its rule set
version keeps a stored stratification report. A run can therefore reach the rule
without a parse. The executor checks each rule for `GROUP` before it runs it.
With the flag off, the run ends with status `failed` and the error:

```
RuleVersion <id> uses the rule-aggregates extension, which is not enabled on this server
```

The W3C conformance checks always parse with `GROUP` off, whatever the flag is.
While the pull request is open, a document that uses `GROUP` is therefore not
reported as conformant.

The SPA reads `NUXT_PUBLIC_FEATURE_RULE_AGGREGATES`, and shows nothing different
for it.

## The browser build

`packages/web` is built ahead of time, so `packages/web/nuxt.config.ts` resolves
its flags at build time. For each flag, it reads `NUXT_PUBLIC_FEATURE_<NAME>`
first, and then the plain `FEATURE_<NAME>`. It passes the result to the same
`buildFeatureFlags` function as the API. An unset variable therefore gets the
same default in both.

```
NUXT_PUBLIC_FEATURE_ETL  ??  FEATURE_ETL  ??  the default (off)
```

The `Justfile` recipes show the pair. `run-local-rules-tests` sets `FEATURE_*`
for the API, and `run-frontend-rules` sets the matching `NUXT_PUBLIC_FEATURE_*`
for the SPA. The two are separate processes, and each reads its own
environment. If you set the flags on the API only, the rail shows sections that
the API does not serve.

## Overriding a deployed static build

You can change the flags of a built SPA without a rebuild. The plugin
`packages/web/src/plugins/runtime-config.client.ts` fetches `/config.json` at
startup, and merges its values over the build-time values:

```json
{
  "apiBaseUrl": "https://sqlib.example.org",
  "featureFlags": { "etl": false, "assistant": false }
}
```

Use the flag keys, such as `etl`. The environment variable names do not work
here. A partial object is merged over the build-time flags, and replaces only
the keys that it has. The same file also overrides `authIssuer`,
`authClientId`, `authAudience`, `authScope`, `authTokenStorage` and
`authRequireLogin`. A missing file, a response that is not JSON, or a parse
failure logs a warning, and the build-time values stay. A deployment that
serves no `/config.json` therefore works as it was built.

This file changes the browser only. The server gets its flags from its
environment. If `/config.json` turns on a flag that is off on the API, the
section shows, and its requests answer `404`.
