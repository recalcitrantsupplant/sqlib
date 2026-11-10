# @sparql-query-lib/runtime-oxigraph

An [Oxigraph](https://github.com/oxigraph/oxigraph) executor for
[`@sparql-query-lib/runtime`](../runtime). It runs exported sqlib queries
against a store in the same process, with no SPARQL endpoint.

It is a separate package because it adds about 960 KiB of WebAssembly. That is
two orders of magnitude more than the runtime. Import it lazily. An app that
uses an endpoint then does not load it, and a page that uses it paints first:

```ts
import { fromBundle } from '@sparql-query-lib/runtime';
import bundle from './queries.json';

const { oxigraphExecutor } = await import('@sparql-query-lib/runtime-oxigraph');
const executor = await oxigraphExecutor({ data: turtleString });

const lib = fromBundle(bundle, { executor });
const { results } = await lib.query('people-by-city').select({ arguments: [...] });
```

Options:

- `data` takes a Turtle string, `{ content, format, baseIri }`, or an array of
  them.
- `store` uses a store that you already loaded, in place of `data`.
- `rdfFormat` sets the format of CONSTRUCT and DESCRIBE results. The default is
  `text/turtle`.

Oxigraph serialises the results in the same formats as an HTTP endpoint. This
executor and `httpExecutor` are therefore interchangeable behind the `Executor`
interface.

The executor also has `update({ updateText })`, which runs a SPARQL UPDATE on
the store. It is available when the store has an `update` method. The Oxigraph
`Store` always has one.

## The store

`store` has the type `OxigraphStore`: `query`, `load`, `size` and an optional
`update`. These are the only parts of the Oxigraph `Store` that this package
uses. The type is a structural subset, and not a re-export, so your code does
not name the Oxigraph types. The build of this package checks that an Oxigraph
`Store` fits the type.

`executor.store` returns the store: yours, or the one made for `data`. A second
executor can then share it.

## When to use it

Use it when there is no other way to get an answer:

- there is no endpoint to reach;
- the data must stay in the browser;
- the page must work offline.

Do not use it when an endpoint that you can reach holds the data. This applies
most when the data is too large to send to the page.

The sqlib API runs the same engine, because its Oxigraph is the WebAssembly
build. Results are therefore the same as on the server.

Queries run on the calling thread, so a heavy query blocks the page. To prevent
this, run the executor in a Web Worker.
