# @sparql-query-lib/runtime-oxigraph

An [Oxigraph](https://github.com/oxigraph/oxigraph) executor for
[`@sparql-query-lib/runtime`](../runtime): run exported sqlib queries against an
in-process store, with no SPARQL endpoint anywhere.

Separate from the runtime on purpose — this pulls in ~960 KiB of WebAssembly,
two orders of magnitude more than the runtime itself. Import it lazily so an app
that talks to an endpoint never pays for it, and a page that does need it still
paints first:

```ts
import { fromBundle } from '@sparql-query-lib/runtime';
import bundle from './queries.json';

const { oxigraphExecutor } = await import('@sparql-query-lib/runtime-oxigraph');
const executor = await oxigraphExecutor({ data: turtleString });

const lib = fromBundle(bundle, { executor });
const { results } = await lib.query('people-by-city').select({ arguments: [...] });
```

`data` takes a Turtle string, or `{ content, format, baseIri }`, or an array of
them. Pass `store` instead to reuse a store you already loaded, and `rdfFormat`
to choose what CONSTRUCT and DESCRIBE return (default `text/turtle`).

Results come back in the same serialisations an HTTP endpoint returns — Oxigraph
is asked to produce them — so this executor and `httpExecutor` are
interchangeable behind the `Executor` interface.

## The store you pass, and the one you get back

`store` is typed `OxigraphStore`: `query`, `load` and `size`, which is all of
Oxigraph's `Store` this package touches. It is a structural subset rather than a
re-export, so nothing you write has to name Oxigraph's own types — and an
Oxigraph `Store` satisfies it, checked by this package's build rather than left
to hold. `executor.store` hands the store back, whether it was yours or the one
made for `data`, so a second executor can share it.

## When to use it

Ship the engine when the alternative is no answer at all, not merely a slower
one: there is no endpoint to reach, the data must not leave the browser, or the
page must work offline. Skip it when a reachable endpoint already holds the data,
especially when that data is far too large to ship.

It is the same engine the sqlib API runs — the API's Oxigraph has always been the
WebAssembly build — so results agree with the server's by construction.

Queries run on the calling thread. A heavy query will block the page; a Web
Worker is the answer, and nothing here prevents one.
