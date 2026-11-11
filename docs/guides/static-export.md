# Exporting a library as a static bundle

You can export the read queries of a library as one JSON file. A browser or a
Node script can then run them without a sqlib server. The server compiles the
queries once, with the full SPARQL parser. The exported file holds the compiled
result. `@sparql-query-lib/runtime` applies arguments to it, and needs no
parser.

Authoring, input detection, versioning, the editor and tests still use the
running API. You deploy the export.

## What the export produces

`sqlib export` writes an **export bundle**. This is JSON with `version: 1`, the
id and name of the library, and a `queries` map keyed by a stable slug. Each
entry has:

- `template`: the canonical query text from the generator; the `slots`, each a
  half-open `[start, end)` span in that text with the variables that it
  declares; and the `prefixes` of the query.
- `queryType`: `SELECT`, `ASK`, `CONSTRUCT` or `DESCRIBE`.
- `pageParameters`: the spans of the `LIMIT 000n` / `OFFSET 000n` placeholders,
  and the parameter names that fill them.
- `inferredInputs`: the variables of each parameter slot. A generated form or a
  typed declaration is built from these.
- `textHash`: a SHA-256 of `template.text`.
- provenance: the QueryVersion that sqlib compiled the entry from.

Optional members:

- `groups`. See [Query groups](#query-groups).
- `examples` for each query, taken from the tests of the library.
- `generatedAt`.
- `tags`, the tags that filtered the export.
- `etlJobs`, for the [`sqlib` CLI](cli.md). Each job has its SQL, column
  mapping, chunk size, CONSTRUCT `template`, `textHash` and provenance. sqlib
  compiles the template as it compiles a query, with exactly one slot for the
  rows. The bundle does not hold the backend of the job.
- `ruleSets`, for the [`sqlib` CLI](cli.md). Each rule set has its SRL document
  (`srl`, with DATA blocks), a `textHash` of the document, and its rule and
  data block counts. It also has its tuple seed rows when the rule-tuples
  extension is on for it, and provenance.

The browser runtime validates `etlJobs` and `ruleSets` and checks their hashes.
It does not run them: ETL needs DuckDB, and rules need the SRL compiler.

Do not edit a bundle. Generate it again. Slots are offsets into
`template.text`, so a manual edit of the text moves each slot after the edit,
and the result can look correct. `fromBundle` checks the structure when it
loads. `verifyBundleIntegrity(bundle)` calculates the hash of the text again,
and finds any edit. Call it for a bundle from a source that you do not control.

### Version 1 and what it promises

`version` changes only for a change that an existing reader cannot read. A new
optional field does not change it. This works because the reader ignores fields
that it does not know, so an older runtime can load a bundle from a newer
exporter.

A breaking change increases the version. Examples are a removed field, a
changed type or meaning, or an optional field that becomes necessary. The
runtime then refuses the bundle. It does not read the part that it knows. The
fields are offsets, so a bundle read in part would put a `VALUES` block over the
wrong span, and give wrong results with no error.

`packages/runtime/test/fixtures/bundle-v1.json` is a committed bundle. CI loads
and runs it on each build. CI also runs a minimal bundle with only the required
fields. Tests therefore check both parts of the rule.

## Producing a bundle

From the command line, against the library store:

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json
```

This reads the store directly, and calls no running server, so it works when
the server is stopped. The internal backend must be `oxigraph-persistent`. With
any other configuration, the command exits with an error.

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `--library`, `-l` | library IRI | required | The library to export. |
| `--out`, `-o` | path | `queries.json` | Where to write the JSON. |
| `--tag` | comma-separated IRIs | none | Export only queries with these tags. Repeatable. |
| `--match` | `any`, `all` | `any` | Whether a query needs any of the tags or all of them. |
| `--typings` | flag | off | Also write a TypeScript declaration next to the JSON. |
| `--examples` | `all`, `first`, `none` | `all` | How many worked examples to take from the tests of each query. |
| `--expected` | flag | off | Include the recorded result of each example, for reference. |
| `--html` | path, or bare flag | off | Also write a self-contained page that runs the queries. A bare `--html` writes next to `--out`. |
| `--no-queries` | flag | off | Omit the queries of the library. A query group still holds the queries that it runs. |
| `--no-groups` | flag | off | Omit the query groups of the library. |
| `--no-etl` | flag | off | Omit the ETL jobs of the library. A tag filter also omits them, because jobs have no tags. |
| `--no-rule-sets` | flag | off | Omit the rule sets of the library. |

A running API gives the same export at `GET /libraries/:id/export-bundle`. The
query string parameters are `tag`, `match`, `examples`, `expected`, `queries`,
`groups`, `etl`, `ruleSets` and `format`. `format` is `json` (the default),
`html` for the page described below, or `ipynb` for a Jupyter notebook of worked
calls. `sqlib pull` calls this route. A request that turns off all four members
gets a 400. The script refuses the same request.

The exporter checks the bundle before it writes it, with the integrity check
that a consumer runs. It never writes a bundle that fails. An entry that cannot
be exported does not stop the export. The exporter reports each one on stderr
with the reason, and the generated page also shows the reasons.

### From the web app

**Export…** on the main page, next to the name of the active library, opens the
same export. **Contents** lists what to include: queries (with or without their
worked examples), query groups, ETL jobs and rule sets. Each one is selected by
default. Query groups, ETL jobs and rule sets show only when their screens are
on. When nothing is selected, the dialog says so and exports nothing.

- **Bundle (.json)** downloads or copies the bundle with those contents.
- **Runnable page (.html)** downloads the page described below. It runs queries
  and groups only, so one of those must be selected. It never shows ETL jobs or
  rule sets.

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

The payload is the one that `POST /execute` takes. A move between a hosted sqlib
and an exported bundle changes the transport, and the calling code stays the
same. `lib.query(name).text(payload)` returns the query with arguments applied,
and does not run it. Use it in tests, and to show a person what the call will
send.

Each argument is a SPARQL Results JSON document:

- The short form above omits `head`, and fills slots in order.
- The full form, `{ head: { vars }, results: { bindings } }`, is matched by its
  variables. You can pass a SELECT result back as it is.
- Omit a slot to run it without its filter. Give it zero rows to match nothing.
- Blank nodes are refused.

Argument values are SPARQL Results JSON terms. `iri()` and `literal()` build
them. Use `literal('2026', { datatype })` and `literal('Perth', { lang: 'en-AU' })`
for typed and language-tagged literals. A cell that is `null` or absent is
UNDEF. A whole `null` row is a row in which each declared cell is UNDEF. A JSON
round trip of an empty grid row gives this.

### How arguments are applied

A query declares its parameters in its text. A `VALUES` clause whose only row is
all `UNDEF` marks a parameter slot. `LIMIT 000n` / `OFFSET 000n` mark named page
parameters. These positions are a property of the query, and are the same on
each call. The export therefore records the span of each slot in a canonical
form of the query text.

To apply arguments, the runtime makes a `VALUES` block from the rows of the
caller, and puts it over the recorded span. The runtime does no parse and no
regeneration. It never joins caller values into the query as strings. Page
parameters use the same method, over a span that covers the whole clause with
the keyword. A parameter with no value therefore leaves the placeholder text in
place.

The runtime matches arguments to slots by the variables that they declare.
A saved payload that lists its variables in a different order from the query
therefore still applies. Two slots that declare the same variables are
interchangeable, and the runtime fills them in order. A slot that no argument
names runs without its filter. An argument that names no free slot is refused.

Caller values become query syntax. The runtime therefore checks that each value
fits its SPARQL terminal production, and refuses it if not:

- IRIs against `IRIREF`;
- language tags against `LANGTAG`;
- string literals, escaped for the four characters that the grammar requires.

The API runs the same module, imported. The differential suite of the API
checks its output against the AST path.

### Query groups

A bundle holds a query group when its nodes are queries, and its edges pass
SELECT rows into a `VALUES` slot of a later node. `fromBundle(bundle).group(name)`:

- runs each node in topological order, through the same handle as a direct
  call;
- renames the rows on each edge by the mapping of the edge;
- joins and deduplicates the rows when two edges feed one slot.

The caller supplies argument sets for the slots that no edge feeds and that
need a filter. A slot that the caller omits runs with no filter. `limits` and
`offsets` go to each node, and each node that declares the name uses it.

The bundle omits these groups, and reports the reason:

- a group with nodes that are rule sets, ETL jobs or dynamic queries;
- a group with edges that move RDF or a boolean;
- a group whose end node has more than one data input.

These groups need a store for the intermediate results, and the static runtime
has none.

## Typed query names: `--typings`

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json --typings
```

This writes a declaration next to the JSON. Query names then autocomplete, and a
misspelt name is a compile error:

```ts
import bundle from './queries.json' with { type: 'json' };

const lib = fromBundle(bundle);
lib.query('people-by-city');              // checked against the bundle's names
type Name = keyof typeof bundle.queries;  // and nameable
```

For this to work:

1. The declaration has the name of the JSON file: `queries.d.json.ts` for
   `queries.json`. The name is the only link between the two files. Keep them
   in the same directory, and do not rename either.
2. The tsconfig that compiles the import needs `"allowArbitraryExtensions": true`.

With bundler module resolution, you can also import the `QueryName`,
`QueryCatalogue` and `Bundle` types from `'./queries.json'` by name. NodeNext
does not allow named imports from a JSON module. With NodeNext, use
`typeof bundle`. For a bundle that you fetch at run time,
`fromBundle<Name>(await response.json())` gives the same types.

## A runnable page: `--html`

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json --html demo.html
```

`--html` writes one self-contained HTML file. It contains the runtime and the
bundle, and needs no build step and no assets. The page makes no external
request, except to the endpoint that the viewer types. It therefore works from
`file://` and offline.

Open the page, and enter a SPARQL endpoint. You can then run each query in the
bundle. When you edit the arguments, the query with the arguments applied
updates next to the template. Run it to see the results.

The tests of the library become examples. A `TestCase` names a query and gives
arguments in the shape that the runtime takes. Each test case therefore becomes
a button that fills in a working call. `--examples all|first|none` sets how
many.

`--expected` also includes the recorded result of each test, for reference. The
page does not assert it, because the endpoint of the page holds different data
from the endpoint of the test. The page marks an example whose test used seeded
data, because its recorded output is correct only for that seed. The page makes
no comparison and gives no verdict.

The page uses plain DOM, with no framework. You can give it to a coding
assistant. The one file has the API, the calling convention as working code,
and worked input and output pairs. This is most of what an assistant needs to
add the library to a Vue, Angular or React app. When you export the typings,
give them too.

The generated page does not include the Oxigraph executor. It needs an endpoint.

## The `<sqlib-args>` element

To fill in the arguments of a query, a person must write SPARQL Results JSON.
Many people do not know this format. The `inferredInputs` of the bundle name
the variables of each slot, so the runtime can generate a form: one column for
each variable, one row for each binding, and a kind (IRI, literal, UNDEF) for
each cell.

The form is `<sqlib-args>`, a custom element with no framework, shipped with the
runtime. The exported page includes it, and the sqlib web app imports it. A
person who learns the form in one place can use it in the other. Each cell is
checked with `serializeTerm`, the function that guards the query. A value that
the form accepts therefore always substitutes.

The element omits a slot with no rows from the payload that it emits, so the
query runs without that filter. A slot with zero rows in a payload means "match
nothing". The form cannot show the difference, so the element shows such a
payload as JSON.

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

- `signature` describes the inputs of the query, and builds the form again.
- `payload` reads and writes the call payload, in the shape that
  `query(...).select()` takes.
- `valid` is true when each bound cell would serialise.
- The `change` event has `{ payload, valid }` and bubbles.

The element has a JSON editor as well as the form. It changes to the JSON
editor when it gets a payload that the form cannot show exactly. In that state,
the text is the source of truth, and `payload` reads from it.

The element renders into the light DOM, so a host can style it. Each class
starts with `sqlib-args__`. `ARGS_ELEMENT_STYLES` is a default stylesheet that a
host can add or ignore.

Where there is no `customElements`, `defineArgsElement()` registers nothing and
does not throw. Each entry point imports without a DOM, so a server render, a
worker or a Node script can load them. The element needs a DOM only when you use
it.

## Entry points

| Import | What it is |
| --- | --- |
| `@sparql-query-lib/runtime` | The library: `fromBundle`, `httpExecutor`, the term builders, the bundle validators. |
| `@sparql-query-lib/runtime/args-element` | `<sqlib-args>` and `defineArgsElement()`. |
| `@sparql-query-lib/runtime/browser` | Both of the above in one build. |

Use `./browser` for a page with no bundler. If you load the root entry and the
element as two files, the page gets two copies of the term serialiser. This
entry has one copy. `--html` includes it: `dist/browser.cjs`, evaluated with a
`module`/`exports` pair and attached to `window.SQLIB`. For this reason the file
is CommonJS.

With a bundler, import the root entry. There, `./browser` is not smaller and
does not save requests, and it includes the element whether the page uses it or
not.

`packages/runtime/public-api.md` lists each exported name of each entry point,
with its signature. It is generated from the built declarations. CI generates it
again, and fails if it has changed.

## Running without an endpoint

For a page that holds its own data, add the Oxigraph executor from
`@sparql-query-lib/runtime-oxigraph`:

```ts
const { oxigraphExecutor } = await import('@sparql-query-lib/runtime-oxigraph');
const lib = fromBundle(bundle, { executor: await oxigraphExecutor({ data: turtle }) });
```

The options:

- `data` takes a Turtle string, `{ content, format, baseIri }`, or an array of
  those.
- `store` uses a store that you already loaded. Pass it in place of `data`.
- `rdfFormat` sets the format that CONSTRUCT and DESCRIBE return. The default is
  `text/turtle`.

`executor.store` returns the store, yours or the one made for `data`, so a
second executor can use it. Results have the same serialisations that an HTTP
endpoint returns. This executor and `httpExecutor` are therefore
interchangeable behind the `Executor` interface.

The sqlib API runs the same engine. The Oxigraph of the API has always been the
WebAssembly build, so its results agree with the results of the server.

### Writing through an executor

`Executor` has an optional `update(request)` for a SPARQL UPDATE. A bundle holds
read queries only, so a page never needs it. It is for code that writes, for
example a rule set that adds inferred triples.

- The Oxigraph executor has `update` when its store has it. The real `Store`
  always has it.
- `httpExecutor` has `update` only when you give it an `updateEndpoint`. Most
  servers take updates at a different URL from queries, for example `/update`
  and `/query` in Fuseki:

```ts
const executor = httpExecutor('https://example.org/ds/query', {
  updateEndpoint: 'https://example.org/ds/update',
});
await executor.update?.({ updateText: 'INSERT DATA { <urn:a> <urn:b> <urn:c> }' });
```

**Two costs decide whether to ship the engine.**

- **Size.** The package adds about 960 KiB of WebAssembly. This is about a
  hundred times the size of the runtime, so it is a separate package. Import it
  lazily, as above. An app that uses an endpoint then does not load it, and a
  page that needs it still renders first.
- **The main thread.** Queries run on the calling thread, so a slow query blocks
  the page. Use a Web Worker. The package does not prevent one.

Ship the engine when, without it, the page can give no answer:

- there is no endpoint to reach;
- the data must not leave the browser;
- the page must work offline.

Do not ship it when an endpoint that the page can reach already holds the data,
and especially when that data is too large to ship.

## What the runtime cannot do

- **It cannot author queries.** It has no parser, so the browser cannot
  validate or compile new query text. A bundle is read-only.
- **It has no authorization.** An exported bundle grants what the endpoint
  grants its caller. Do not export queries that are safe only because of a scope
  on the server. Do not put anything in a template that must not be published.
- **Updates are not exported.** The export holds read queries only: SELECT, ASK,
  CONSTRUCT and DESCRIBE. The exporter refuses an update query.
- **Query groups must chain SELECT rows.** The exporter skips a group that moves
  RDF between nodes, or that runs a rule set or an ETL job, and gives the
  reason.
- **It does not run ETL jobs or rule sets.** A bundle holds them for the
  [`sqlib` CLI](cli.md), which has DuckDB and the SRL compiler.
- **Do not edit bundles.** See the integrity check above.

## Installation

```sh
npm install @sparql-query-lib/runtime
```

Status:

- Done: `@sparql-query-lib/runtime` and `@sparql-query-lib/runtime-oxigraph` are
  ready to package. Each has CommonJS and ESM entry points, with types for both.
  CI checks `scripts/check-publishable.mjs`, `check-installable.mjs` and
  `check-public-api.mjs`.
- To do: publish a release to npm.

In this repository, the packages resolve through the pnpm workspace. The
packages of the `sqlib` CLI can also be published, as ESM only. See
[cli.md](cli.md).
