# sqlib documentation

Read [concepts.md](concepts.md) first. It defines Library, Query, QueryGroup,
DataGraph, TupleSet, ArgumentSet, RuleSet and the other terms that the rest of
the pages use.

## Guides

Each guide covers one task.

- [guides/running-and-configuring.md](guides/running-and-configuring.md): start a server, and choose where the library lives and what queries run against.
- [guides/rest-api-walkthrough.md](guides/rest-api-walkthrough.md): create a library, save a parameterised query and run it over HTTP.
- [guides/query-groups.md](guides/query-groups.md): chain queries on the canvas, and send the results of one query into the next.
- [guides/notebooks.md](guides/notebooks.md): write a runnable notebook about a library, with prose between the queries and a name for each result.
- [guides/rules-and-srl.md](guides/rules-and-srl.md): write SHACL 1.2 inference rules and run them against a graph.
- [guides/mcp-clients.md](guides/mcp-clients.md): connect an MCP client to the server, and see which tools it gets.
- [guides/publishing-tools.md](guides/publishing-tools.md): publish the queries of a library as MCP tools and HTTP routes for an application.
- [guides/mcp-app.md](guides/mcp-app.md): edit, run and save a query inside a chat client, teach SPARQL rules there with a lesson library, and test this locally.
- [guides/static-export.md](guides/static-export.md): export a library as a self-contained page that runs without the server.
- [guides/testing-and-conformance.md](guides/testing-and-conformance.md): attach tests to a query or rule set, and run a conformance suite.
- [guides/etl.md](guides/etl.md): build RDF from tabular sources with DuckDB SQL.
- [guides/prefixes.md](guides/prefixes.md): manage namespace prefixes across a library.
- [guides/deploying.md](guides/deploying.md): run the container image and the static web app in production.
- [guides/observability.md](guides/observability.md): send traces, metrics and logs to a collector, and find slow queries.

## Reference

- [reference/configuration.md](reference/configuration.md): each environment variable, its default and its effect.
- [reference/feature-flags.md](reference/feature-flags.md): each feature flag, its environment variable, its default and what it turns off.
- [reference/entity-model.md](reference/entity-model.md): each entity type, its fields and its relationships.
- [reference/srl-language.md](reference/srl-language.md): SRL syntax, constructs and constraints.
- [reference/scripts.md](reference/scripts.md): the package scripts and the scripts under `scripts/`, and what each one runs.

## Explanation

- [explanation/architecture.md](explanation/architecture.md): the packages, the process that runs each one, and the path of a request.
- [explanation/versioning-and-immutability.md](explanation/versioning-and-immutability.md): why each entity has a stable pointer and immutable versions, and what this gives you.
- [explanation/environments.md](explanation/environments.md): named version pointers (dev, prod) in a library, how a run resolves them, and who can move them.
- [explanation/storage-and-caching.md](explanation/storage-and-caching.md): where the library and the auth store live (SQLite by default), how the query backends compare, and what the in-memory cache does.
- [explanation/security-model.md](explanation/security-model.md): what the auth layer enforces, what it leaves open, and the reasons.
- [explanation/rdf-patch.md](explanation/rdf-patch.md): how sqlib calculates the effect of an update query before it applies it.
- [explanation/inline-inputs-and-the-rail.md](explanation/inline-inputs-and-the-rail.md): where a saved input lives, why a graph pasted into a call is saved as a data graph, and what the rail shows about the source of each input.

## Design records

- [design/mcp-app.md](design/mcp-app.md): a query bench that a chat client
  shows inline (MCP Apps, SEP-1865). The queries of a session are saved as
  library entities. The MVP is built; see [guides/mcp-app.md](guides/mcp-app.md).
- [design/assistant-surfaces.md](design/assistant-surfaces.md): the places
  where a Claude conversation can run (MCP connector, in the app with the key of
  a user, hosted on the sqlib key, local on the subscription of a user), why the
  hosted surface does not use a subscription, and which code serves each one.
- [design/auth-architecture.md](design/auth-architecture.md): one
  authorization server in front of sqlib, with sqlib as a resource server only.
  It covers how people, MCP clients and unattended applications get a token, why
  Google and GitHub sign-in need a broker, and why auth is free and in core.

## Examples

- [examples/sudoku-solver-ruleset.md](examples/sudoku-solver-ruleset.md): a
  rule set that solves a Sudoku by inference, from start to end.

[CONTRIBUTING.md](../CONTRIBUTING.md) gives contributor setup, the CI checks and
the commit conventions. [SECURITY.md](../SECURITY.md) tells you how to report a
vulnerability, and describes the security posture of a deployment.
