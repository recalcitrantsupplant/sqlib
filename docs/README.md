# sqlib documentation

Start with [concepts.md](concepts.md). It defines Library, Query, QueryGroup,
DataGraph, TupleSet, ArgumentSet, RuleSet and the rest of the vocabulary that
every other page assumes.

## Guides — doing something

- [guides/running-and-configuring.md](guides/running-and-configuring.md) — how do I start a server, and which knobs decide what it does?
- [guides/rest-api-walkthrough.md](guides/rest-api-walkthrough.md) — how do I create a library, save a parameterised query and run it over HTTP?
- [guides/query-groups.md](guides/query-groups.md) — how do I chain queries on the canvas and feed one's results into the next?
- [guides/rules-and-srl.md](guides/rules-and-srl.md) — how do I write SHACL 1.2 inference rules and run them against a graph?
- [guides/mcp-clients.md](guides/mcp-clients.md) — how do I point an MCP client at the server and what can it then do?
- [guides/static-export.md](guides/static-export.md) — how do I export a library as a self-contained page that runs without the server?
- [guides/testing-and-conformance.md](guides/testing-and-conformance.md) — how do I attach tests to a query or rule set and run a conformance suite?
- [guides/etl.md](guides/etl.md) — how do I build RDF from tabular sources with DuckDB SQL?
- [guides/prefixes.md](guides/prefixes.md) — how do I manage namespace prefixes across a library?
- [guides/deploying.md](guides/deploying.md) — how do I run the container image and the static web app for real?

## Reference — looking something up

- [reference/configuration.md](reference/configuration.md) — every environment variable, its default and its effect.
- [reference/feature-flags.md](reference/feature-flags.md) — the feature flags, their env vars, defaults and what each turns off.
- [reference/entity-model.md](reference/entity-model.md) — every entity type, its fields and its relationships.
- [reference/srl-language.md](reference/srl-language.md) — SRL syntax, its constructs and its constraints.
- [reference/scripts.md](reference/scripts.md) — the package scripts and the scripts under `scripts/`, and what each one runs.

## Explanation — understanding why

- [explanation/architecture.md](explanation/architecture.md) — what the packages are, what runs in which process and how a request travels.
- [explanation/versioning-and-immutability.md](explanation/versioning-and-immutability.md) — why entities split into a stable pointer and immutable versions, and what that buys.
- [explanation/storage-and-caching.md](explanation/storage-and-caching.md) — where the library actually lives, and what the in-memory cache is for.
- [explanation/security-model.md](explanation/security-model.md) — what the auth layer enforces, what it does not, and why some doors are open.
- [explanation/rdf-patch.md](explanation/rdf-patch.md) — how an update query's effect is derived before it is applied.

## Examples

- [examples/sudoku-solver-ruleset.md](examples/sudoku-solver-ruleset.md) — a
  worked rule set that solves a Sudoku by inference, end to end.

Contributor setup, the CI checks and commit conventions are in
[CONTRIBUTING.md](../CONTRIBUTING.md). Reporting a vulnerability and the
deployment security posture are in [SECURITY.md](../SECURITY.md).
