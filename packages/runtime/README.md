# @sparql-query-lib/runtime

Runs the parameterised SPARQL queries of a library from a static page, with no
sqlib server.

`sqlib export` compiles each query once, on the server, with the full parser.
The result is the canonical query text, and the span of each parameter slot. To
apply arguments, the runtime makes a VALUES block and puts it over a span. This
needs no parser, so the runtime is about 2 KiB compressed.

Authoring, input detection, versioning and the editor still use the full sqlib
API. You deploy the export.

## Install

```sh
npm install @sparql-query-lib/runtime
```

Status:

- Done: the package has CommonJS and ESM entry points, with types for both. CI
  checks its packaging with `scripts/check-publishable.mjs`,
  `check-installable.mjs` and `check-public-api.mjs`.
- To do: publish a release to npm. In this repository, the package resolves
  through the pnpm workspace.

## Use

```ts
import { fromBundle, httpExecutor, iri, literal } from '@sparql-query-lib/runtime';
import bundle from './queries.json';

const lib = fromBundle(bundle, {
  executor: httpExecutor('https://example.org/sparql'),
});

const { results } = await lib.query('people-by-city').select({
  arguments: [{ bindings: [{ city: iri('http://example.org/Perth') }] }],
  limits: { 1: 20 },
});
```

The payload is the one that `POST /execute` takes. A move between a hosted sqlib
and an exported bundle changes the transport, and the calling code stays the
same. `query(...).text(payload)` returns the query with the arguments applied,
and does not run it. Use it in tests, and to show a user what the call will
send.

Argument values are SPARQL Results JSON terms. `iri()` and `literal()` build
them. Use `literal('2026', { datatype })` and `literal('Perth', { lang: 'en-AU' })`
for typed and language-tagged literals. A cell that is `null` or absent is
UNDEF. A whole `null` row is a row in which each declared cell is UNDEF. A JSON
round trip of an empty grid row gives this. A row is an `ArgumentRow`, so a
misspelt variable, or a bare string in place of a term, is a compile error.

### Producing a bundle

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json --tag urn:sqlib:tag:public --typings
```

Or use `GET /libraries/:id/export-bundle` on a running API. `--typings` writes a
declaration next to the JSON. Query names then autocomplete, and a misspelt name
is a compile error:

```ts
import bundle from './queries.json' with { type: 'json' };

const lib = fromBundle(bundle);
lib.query('people-by-city');              // checked against the bundle's names
type Name = keyof typeof bundle.queries;  // and nameable
```

For this to work:

1. The declaration has the name `queries.d.json.ts` for `queries.json`. The name
   is the only link between the two files. Keep them in the same directory, and
   do not rename either.
2. The tsconfig that compiles the import needs `"allowArbitraryExtensions": true`.

With bundler resolution, you can also import the `QueryName`, `QueryCatalogue`
and `Bundle` types from `'./queries.json'` by name. NodeNext does not allow
named imports from a JSON module. With NodeNext, use `typeof bundle`. For a
bundle that you fetch at run time, `fromBundle<Name>(await response.json())`
gives the same types.

### A page that runs the library

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json --html demo.html
```

`--html` writes one self-contained HTML file. It contains the runtime and the
bundle, and needs no build step and no assets. Open it, and type a SPARQL
endpoint. You can then run each query. When you edit the arguments as JSON, the
query with the arguments applied updates next to the template. Run it to see the
results.

The **tests of the library become examples**. A `TestCase` names a query, and
gives arguments in the shape that the runtime takes. Each test case therefore
becomes a button that fills in a working call. `--examples all|first|none` (all
by default) sets how many. `--expected` also includes the recorded result of
each test, for reference. The page does not assert it, because the endpoint of
the page holds different data from the endpoint of the test.

The page uses plain DOM, with no framework. You can give it to a coding
assistant. The one file has the API, the calling convention as working code, and
worked input and output pairs. This is most of what an assistant needs to add
the library to a Vue, Angular or React app.

### Running without an endpoint

For a page that holds its own data, add the Oxigraph executor. It is a separate
package, because it is about 960 KiB of WebAssembly. Import it lazily, so the
first paint does not wait for it:

```ts
const { oxigraphExecutor } = await import('@sparql-query-lib/runtime-oxigraph');
const lib = fromBundle(bundle, { executor: await oxigraphExecutor({ data: turtle }) });
```

## Limits

- **It cannot author queries.** It has no parser, so the browser cannot validate
  or compile new query text. A bundle is read-only.
- **It has no authorization.** An exported bundle grants what the endpoint grants
  its caller. Do not export queries that are safe only because of a scope on the
  server.
- **Updates are not exported.** The export holds read queries only: SELECT, ASK,
  CONSTRUCT and DESCRIBE.
- **Do not edit bundles.** Generate them again. Slot positions are offsets into
  the query text, so a manual edit of the text moves them, with no error.
  `fromBundle` checks the structure when it loads. `verifyBundleIntegrity(bundle)`
  calculates the hash of the text again. Call it for a bundle from a source that
  you do not control.

## The bundle format

A bundle has `version: 1`. That number is the compatibility promise:

- **Each runtime that reads version 1 can read a version-1 bundle.** A bundle that
  you committed a year ago still works after you upgrade this package.
- **A newer exporter can add optional fields without a new version number.** This
  reader ignores fields that it does not know. After the server is upgraded, you
  can export again without an upgrade of this package.
- **A breaking change increases the version, and the runtime then refuses the
  bundle.** It does not read the part that it knows. The fields are spans into the
  query text. A bundle read in part would put a VALUES block over the wrong span,
  and give wrong results with no error.

`test/fixtures/bundle-v1.json` is a committed bundle. CI loads and runs it on each
build, so a test checks the first promise.

## The surface

### Entry points

| Import | What it is |
| --- | --- |
| `@sparql-query-lib/runtime` | the library: `fromBundle`, `httpExecutor`, the term builders |
| `@sparql-query-lib/runtime/args-element` | `<sqlib-args>`, an argument editor with no framework. `defineArgsElement()` registers it |
| `@sparql-query-lib/runtime/browser` | both of the above, in one build |

Use `./browser` for a page with no bundler. If you load the root entry and the
element as two files, the page gets two copies of the term serialiser. This entry
has one copy. `--html` includes it: `dist/browser.cjs`, evaluated with a
`module`/`exports` pair and attached to `window.SQLIB`. A plain HTML page needs
only this, and for this reason the file is CommonJS.

With a bundler, import the root entry. There, `./browser` is not smaller and does
not save requests, and it includes the element whether the page uses it or not.

**Each entry point imports without a DOM**, including the two that hold the
element. A server render, a worker or a Node script can load them. Where there
is no `customElements`, `defineArgsElement()` registers nothing and does not
throw. The element needs a DOM only when you *use* it.

[`public-api.md`](./public-api.md) lists each exported name of each entry point,
with its signature. It is generated from the built declarations. CI generates it
again, and fails if it has changed. A change to the exports of this package
therefore always shows in the diff that causes it.

## Safety

Caller values become query syntax. The runtime therefore checks that each value
fits its SPARQL terminal production, and refuses it if not:

- IRIs against `IRIREF`;
- language tags against `LANGTAG`;
- string literals, escaped for the four characters that the grammar requires.

The API runs the same module, imported. The differential suite of the API checks
its output against the AST path.
