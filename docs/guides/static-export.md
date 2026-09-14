# Exporting a library as a static bundle

A library's read queries can be exported as a single JSON file and run from a
browser or a Node script with no sqlib server in the picture. Compilation happens
once, on the server, with the full SPARQL parser; the exported file carries the
compiled result, and `@sparql-query-lib/runtime` applies arguments to it without a
parser of any kind.

Development and testing still use the running API — authoring, input detection,
versioning, the editor, tests. The export is what you deploy.

## What the export produces

`sqlib export` writes an **export bundle**: JSON with `version: 1`, the library's
id and name, and a `queries` map keyed by a stable slug. Each entry carries

- `template`: the canonical query text as the generator renders it, the `slots`
  (each a half-open `[start, end)` span into that text plus the variables it
  declares), and the query's `prefixes`;
- `queryType`, one of `SELECT`, `ASK`, `CONSTRUCT`, `DESCRIBE`;
- `pageParameters`: the located spans of `LIMIT 000n` / `OFFSET 000n`
  placeholders, and the parameter names that fill them;
- `inferredInputs`: the variables of each parameter slot, which is what a
  generated form or a typed declaration is built from;
- `textHash`: a SHA-256 of `template.text`;
- provenance: the QueryVersion the entry was compiled from.

Optional members: `groups` (see [Query groups](#query-groups) below), per-query
`examples` drawn from the library's tests, `generatedAt`, and the `tags` the
export was filtered by.

The bundle is generated, never edited. Slots are offsets into `template.text`, so
editing that text by hand moves every slot after the edit without changing
anything that looks wrong. `fromBundle` checks the structure on load;
`verifyBundleIntegrity(bundle)` re-hashes the text and catches any edit, which is
worth calling for a bundle fetched from somewhere you do not control.

### Version 1 and what it promises

`version` is bumped for a change an existing reader cannot handle, and for nothing
else. A new optional field is additive and does not bump it, which holds only
because the reader ignores fields it does not recognise: a bundle written by a
newer exporter has to keep loading in an older runtime. A breaking change — a
removal, a changed type or meaning, a previously optional field becoming
load-bearing — bumps the version, and the runtime then refuses the bundle outright
rather than reading the half it understands. For a format whose fields are
offsets, a half-understood bundle would splice a `VALUES` block over the wrong span
and be wrong rather than broken.

`packages/runtime/test/fixtures/bundle-v1.json` is a committed bundle that CI loads
and runs on every build, alongside a minimal one carrying only the required fields,
so both halves of that rule are tests rather than intentions.

## Producing a bundle

From the command line, against the library store directly:

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json
```

This reads the store directly rather than calling a running server, so it works
against a stopped one. It requires the internal backend to be configured as
`oxigraph-persistent`; with any other configuration it exits with an error.

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `--library`, `-l` | library IRI | required | The library to export. |
| `--out`, `-o` | path | `queries.json` | Where to write the JSON. |
| `--tag` | comma-separated IRIs | none | Restrict to queries carrying these tags. Repeatable. |
| `--match` | `any`, `all` | `any` | Whether a query needs any of the tags or all of them. |
| `--typings` | flag | off | Also write a TypeScript declaration beside the JSON. |
| `--examples` | `all`, `first`, `none` | `all` | How many worked examples to draw from each query's tests. |
| `--expected` | flag | off | Carry each example's recorded result along as reference material. |
| `--html` | path, or bare flag | off | Also write a self-contained runnable page. A bare `--html` writes beside `--out`. |

The same export is available from a running API as
`GET /libraries/:id/export-bundle`, with the querystring parameters `tag`, `match`,
`examples`, `expected` and `format`. `format` takes `json` (default), `html` for
the page described below, or `ipynb` for a Jupyter notebook of worked calls.

The exporter re-verifies the bundle it is about to write — the same integrity check
a consumer runs — so a bundle that fails it is never written. Queries and groups
that cannot be exported are not fatal: each is reported on stderr with the reason,
and the reasons also appear on the generated page.

## Running a bundle

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

The payload is the one `POST /execute` takes, so moving between a hosted sqlib and
an exported bundle changes the transport rather than the calling code.
`lib.query(name).text(payload)` returns the substituted query without running it,
which is useful in tests and for showing someone what will be sent.

Argument values are SPARQL Results JSON terms. `iri()` and `literal()` build them;
`literal('2026', { datatype })` and `literal('Perth', { lang: 'en-AU' })` cover the
rest. A cell that is `null` or absent is UNDEF, and a whole `null` row — what a
JSON round-trip of an empty grid row produces — is a row in which every declared
cell is UNDEF.

### How arguments are applied

A query's parameters are declared in-band: a `VALUES` clause whose only row is all
`UNDEF` marks a parameter slot, and `LIMIT 000n` / `OFFSET 000n` mark named page
parameters. Those positions are a fact about the query and are the same on every
call, so the export records each slot's span in a canonical rendering of the query
text.

Applying arguments is then: serialise a `VALUES` block from the caller's rows, and
splice it over the recorded span. No parse, no regeneration, no string
concatenation of caller values into the query. Page parameters are spliced the same
way, over a span that covers the whole clause including the keyword, so an
unsupplied parameter leaves the placeholder text in place.

Argument sets are matched to slots by the variables they declare rather than by
position, so a saved payload that lists its variables in a different order than the
query declares them still applies. Two slots declaring the same variables are
interchangeable and are taken in order.

Caller values become query syntax, so each one is proven to sit inside its SPARQL
terminal production or rejected: IRIs against `IRIREF`, language tags against
`LANGTAG`, string literals escaped for exactly the four characters the grammar
requires. This is the same module the API runs, imported rather than
reimplemented, and the API's differential suite checks its output against the AST
path.

### Query groups

A query group travels in the bundle when its nodes are queries and its edges chain
SELECT rows into a downstream `VALUES` slot. `fromBundle(bundle).group(name)` runs
every node in topological order through the same handle a direct call uses, renames
rows crossing an edge by the edge's mapping, and unions and deduplicates where two
edges feed one slot. The caller supplies argument sets for every slot no edge
feeds; `limits` and `offsets` are offered to every node and taken by whichever
declares the name.

A group whose nodes are rule sets, ETL jobs or dynamic queries, whose edges move
RDF or a boolean, or whose end node has more than one data input, is left out of
the bundle with the reason reported. Those need a store to materialise
intermediates into, which the static runtime does not have.

## Typed query names: `--typings`

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json --typings
```

This writes a declaration beside the JSON so query names autocomplete and a
misspelling is a compile error:

```ts
import bundle from './queries.json' with { type: 'json' };

const lib = fromBundle(bundle);
lib.query('people-by-city');              // checked against the bundle's names
type Name = keyof typeof bundle.queries;  // and nameable
```

Two things on your side make that apply.

1. The declaration is named after the JSON — `queries.d.json.ts` for
   `queries.json`. That name is the only binding between the two, so keep them
   together and rename neither.
2. The tsconfig that compiles the import needs `"allowArbitraryExtensions": true`.

Under bundler module resolution the declaration's `QueryName`, `QueryCatalogue` and
`Bundle` types can also be imported from `'./queries.json'` by name. NodeNext
forbids named imports from a JSON module, so reach them through `typeof bundle`
there. For a bundle fetched at runtime rather than imported,
`fromBundle<Name>(await response.json())` types it the same way.

## A runnable page: `--html`

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json --html demo.html
```

`--html` writes one self-contained HTML file: the runtime inlined, the bundle
embedded, no build step and no assets. The page makes no external request except to
the endpoint the viewer types in, so it works from `file://` and offline. Open it,
enter a SPARQL endpoint, and every query in the bundle is runnable — edit the
arguments and watch the substituted query update beside the template, then run it
and see the results.

The library's tests come along as examples. A `TestCase` already names a query and
supplies arguments in exactly the shape the runtime takes, so each one becomes a
button that prefills a working call. `--examples all|first|none` chooses how many.
`--expected` additionally carries each test's recorded result, shown as reference
material rather than as an assertion: the endpoint you point the page at holds
different data from the one the test ran against. An example whose source test
depended on seeded data is marked as such, because its recorded output holds only
against that seed. The page performs no diffing or verdict.

The page is vanilla DOM with no framework. That makes it a reasonable thing to hand
to a coding assistant: one file containing the API surface, the calling convention
as working code, and worked input/output pairs, which is most of what is needed to
fold the library into a Vue, Angular or React app. The generated typings, when
exported, ride alongside.

The generated page does not include the Oxigraph executor. It needs an endpoint.

## The `<sqlib-args>` element

Filling in a query's arguments means writing SPARQL Results JSON, which is a poor
ask of anyone not already fluent in it. The bundle's `inferredInputs` names the
variables of every slot, so a form can be generated instead: one column per
variable, one row per binding, a kind (IRI, literal, UNDEF) for each cell.

That form is `<sqlib-args>`, a framework-free custom element shipped with the
runtime. The exported page inlines it and the sqlib web app imports it, so the
builder someone learns in one is the builder they use in the other. Each cell is
validated with the same `serializeTerm` that guards the query, so "the form says
this is fine" and "this will substitute" cannot drift apart.

```ts
import { defineArgsElement } from '@sparql-query-lib/runtime/args-element';

defineArgsElement();          // registers <sqlib-args>; the tag name is an argument

const el = document.querySelector('sqlib-args');
el.signature = { inputs: query.inferredInputs, limits: [...], offsets: [...] };
el.payload = { arguments: [...] };
el.addEventListener('change', (e) => {
  const { payload, valid } = e.detail;
});
```

- `signature` describes what the query expects and rebuilds the form.
- `payload` reads and writes the call payload, in the shape `query(...).select()`
  takes.
- `valid` is true when every bound cell would serialise.
- The `change` event carries `{ payload, valid }` and bubbles.

The element offers a JSON editor as well as the form, and falls back to it when a
payload arrives that the form cannot represent faithfully; in that state the text
is authoritative and `payload` reads from it. It renders into the light DOM
deliberately, so a host can style it; every class is prefixed `sqlib-args__`, and
`ARGS_ELEMENT_STYLES` is a default stylesheet a host can inject or ignore.

`defineArgsElement()` registers nothing where there is no `customElements` rather
than throwing, and every entry point imports without a DOM — a server render, a
worker or a Node script can load them. A DOM is needed to use the element, not to
import the module that declares it.

## Entry points

| Import | What it is |
| --- | --- |
| `@sparql-query-lib/runtime` | The library: `fromBundle`, `httpExecutor`, the term builders, the bundle validators. |
| `@sparql-query-lib/runtime/args-element` | `<sqlib-args>` and `defineArgsElement()`. |
| `@sparql-query-lib/runtime/browser` | Both of the above in one build. |

Use `./browser` for a page with no bundler: taking the root entry and the element as
two files would carry two copies of the term serialiser, and this entry is the build
where there is only one. It is what `--html` inlines — `dist/browser.cjs`, evaluated
with a `module`/`exports` pair and hung off `window.SQLIB`, which is why that file is
CommonJS. Under a bundler, import the root entry instead: `./browser` is neither
smaller nor fewer requests there, and it pulls the element in whether the page uses
it or not.

`packages/runtime/public-api.md` lists every exported name of every entry point with
its signature, generated from the built declarations. CI regenerates it and fails if
it has drifted.

## Running without an endpoint

For a page that carries its own data, add the Oxigraph executor from
`@sparql-query-lib/runtime-oxigraph`:

```ts
const { oxigraphExecutor } = await import('@sparql-query-lib/runtime-oxigraph');
const lib = fromBundle(bundle, { executor: await oxigraphExecutor({ data: turtle }) });
```

`data` takes a Turtle string, or `{ content, format, baseIri }`, or an array of
those. Pass `store` instead to reuse a store you already loaded, and `rdfFormat` to
choose what CONSTRUCT and DESCRIBE return (default `text/turtle`). `executor.store`
hands the store back, whether it was yours or the one made for `data`, so a second
executor can share it. Results come back in the same serialisations an HTTP endpoint
returns, so this executor and `httpExecutor` are interchangeable behind the
`Executor` interface.

It is the same engine the sqlib API runs — the API's Oxigraph has always been the
WebAssembly build — so results agree with the server's.

**Two costs decide whether to ship it.**

- **Size.** The package pulls in roughly 960 KiB of WebAssembly, two orders of
  magnitude more than the runtime itself, which is why it is a separate package.
  Import it lazily, as above, so an app that talks to an endpoint never pays for it
  and a page that does need it still paints first.
- **The main thread.** Queries run on the calling thread, so a heavy query blocks
  the page. A Web Worker is the answer, and nothing in the package prevents one.

Ship the engine when the alternative is no answer at all rather than a slower one:
there is no endpoint to reach, the data must not leave the browser, or the page must
work offline. Skip it when a reachable endpoint already holds the data, particularly
when that data is too large to ship.

## What the runtime cannot do

- **It cannot author queries.** No parser ships, so the browser cannot validate or
  compile new query text. A bundle is read-only by construction.
- **It carries no authorization.** An exported bundle grants whatever the endpoint
  grants its caller. Do not export queries whose safety depended on server-side
  scoping, and do not put anything in a template that should not be published.
- **Updates are not exported.** Read queries only: SELECT, ASK, CONSTRUCT,
  DESCRIBE. An update query is refused rather than exported.
- **Query groups are SELECT-chained only.** A group that moves RDF between nodes, or
  that runs a rule set or an ETL job, is skipped with a reason.
- **Bundles are generated, never edited.** See the integrity check above.

## Installation

```sh
npm install @sparql-query-lib/runtime
```

Neither `@sparql-query-lib/runtime` nor `@sparql-query-lib/runtime-oxigraph` has been
published to npm. Both are packaging-complete — CommonJS and ESM entry points with
types for both, and CI gates on `scripts/check-publishable.mjs`,
`check-installable.mjs` and `check-public-api.mjs` — but no release has been made.
Inside this repository they resolve through the pnpm workspace. They are the only
two packages in the monorepo that are not `private: true`.
