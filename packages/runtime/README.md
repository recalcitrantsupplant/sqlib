# @sparql-query-lib/runtime

Run a library's parameterised SPARQL queries from a static page — no sqlib server.

`sqlib export` compiles each query once, on the server, with the real parser: the
canonical query text plus the span of every parameter slot. Applying arguments to
that artifact is "serialise a VALUES block, splice it over a span", which needs no
parser at all. That is the whole idea; the runtime is about 2 KiB compressed.

Development and testing still use the full sqlib API — authoring, input detection,
versioning, the editor. The export is what you deploy.

## Install

```sh
npm install @sparql-query-lib/runtime
```

> Not on the registry yet. The package has CommonJS and ESM entry points with types for both,
> and CI gates its packaging (see `scripts/check-publishable.mjs`, `check-installable.mjs` and
> `check-public-api.mjs`), but no release has been made. Inside this repo it resolves through
> the pnpm workspace.

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

The payload is the one `POST /execute` takes, so moving between hosted sqlib and
an exported bundle is a change of transport, not of calling code. `query(...).text(payload)`
returns the substituted query without running it — useful in tests, and for
showing a user what will be sent.

Argument values are SPARQL Results JSON terms. `iri()` and `literal()` build them;
`literal('2026', { datatype })` and `literal('Perth', { lang: 'en-AU' })` cover the
rest. A cell that is `null` or absent is UNDEF, and a whole `null` row — what a
JSON round-trip of a grid produces for an empty row — is a row in which every
declared cell is. A row is an `ArgumentRow`, so a misspelt variable or a bare
string where a term belongs is a compile error rather than a runtime one.

### Producing a bundle

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json --tag urn:sqlib:tag:public --typings
```

or `GET /libraries/:id/export-bundle` from a running API. `--typings` writes a
declaration beside the JSON so query names autocomplete and a misspelling is a
compile error:

```ts
import bundle from './queries.json' with { type: 'json' };

const lib = fromBundle(bundle);
lib.query('people-by-city');              // checked against the bundle's names
type Name = keyof typeof bundle.queries;  // and nameable
```

Two things on your side make that apply. The file is named `queries.d.json.ts`
for `queries.json` — that name is the only binding between the two, so keep them
together and rename neither — and the tsconfig that compiles the import needs
`"allowArbitraryExtensions": true`. Under bundler resolution the declaration's
`QueryName`, `QueryCatalogue` and `Bundle` types can also be imported from
`'./queries.json'` by name; NodeNext forbids named imports from a JSON module,
so reach them through `typeof bundle` there. For a bundle fetched at runtime
rather than imported, `fromBundle<Name>(await response.json())` types it the
same way.

### A page that runs the library

```sh
pnpm --filter @sparql-query-lib/api export:bundle \
  --library urn:sqlib:library:main --out queries.json --html demo.html
```

`--html` writes one self-contained HTML file — the runtime inlined, the bundle
embedded, no build step and no assets. Open it, type in a SPARQL endpoint, and
every query is runnable: edit the arguments as JSON and watch the substituted
query update beside the template, then run it and see the results.

The library's own **tests come along as examples**. A `TestCase` already names a
query and supplies arguments in exactly the shape the runtime takes, so each one
becomes a button that prefills a working call. `--examples all|first|none` (all
by default) chooses how many; `--expected` additionally carries each test's
recorded result, shown as reference material rather than as an assertion —
the endpoint you point the page at holds different data from the one the test
ran against.

The page is deliberately plain — vanilla DOM, no framework. That makes it a good
thing to hand to a coding assistant: one file containing the API surface, the
calling convention as working code, and worked input/output pairs, which is most
of what is needed to fold the library into a Vue, Angular or React app.

### Running without an endpoint

For a page that carries its own data, add the Oxigraph executor — kept in a
separate package because it is ~960 KiB of WebAssembly, and imported lazily so
first paint never waits on it:

```ts
const { oxigraphExecutor } = await import('@sparql-query-lib/runtime-oxigraph');
const lib = fromBundle(bundle, { executor: await oxigraphExecutor({ data: turtle }) });
```

## What this is not

- **It cannot author queries.** No parser ships, so the browser cannot validate or
  compile new query text. A bundle is read-only by construction.
- **It carries no authorization.** An exported bundle grants whatever the endpoint
  grants its caller. Do not export queries whose safety depended on server-side
  scoping.
- **Updates are not exported.** Read queries only: SELECT, ASK, CONSTRUCT, DESCRIBE.
- **Bundles are generated, never edited.** Slot positions are offsets into the
  query text, so editing that text by hand silently moves them. `fromBundle`
  checks the structure on load; `verifyBundleIntegrity(bundle)` re-hashes the text
  and is worth calling for a bundle fetched from somewhere you do not control.

## The bundle format

A bundle carries `version: 1`, and that number is the compatibility promise:

- **A version-1 bundle stays readable by every runtime that reads version 1.** A
  bundle you committed a year ago keeps working when you upgrade this package.
- **A newer exporter can add optional fields without a bump**, and this reader
  ignores fields it does not know — so re-exporting against an upgraded server
  does not require upgrading the package in step.
- **A breaking change bumps the version, and the runtime then refuses it** rather
  than reading the half it recognises. The fields are spans into the query text; a
  half-understood bundle would splice over the wrong one and be wrong rather than
  broken.

`test/fixtures/bundle-v1.json` is a committed bundle that CI loads and runs on
every build, so the first promise is a test rather than an intention.

## The surface

### Entry points

| Import | What it is |
| --- | --- |
| `@sparql-query-lib/runtime` | the library — `fromBundle`, `httpExecutor`, the term builders |
| `@sparql-query-lib/runtime/args-element` | `<sqlib-args>`, a framework-free argument editor; `defineArgsElement()` registers it |
| `@sparql-query-lib/runtime/browser` | both of the above, in one build |

`./browser` is for a page with no bundler. Taking the root entry and the element
as two files would carry two copies of the term serialiser — harmless, but the
sort of duplication that invites someone to ask which is authoritative — and this
entry is the build where there is only one. It is what `--html` inlines:
`dist/browser.cjs`, evaluated with a `module`/`exports` pair and hung off
`window.SQLIB`, which is the whole of what a plain HTML page has to do and the
reason that file is CommonJS. Under a bundler, import the root entry instead —
`./browser` is neither smaller nor fewer requests there, and it pulls the element
in whether the page uses it or not.

**Every entry point imports without a DOM**, including the two that carry the element: a
server render, a worker or a Node script can load them, and `defineArgsElement()` registers
nothing where there is no `customElements` rather than throwing. A DOM is needed to *use* the
element, not to import the module that declares it.

[`public-api.md`](./public-api.md) lists every exported name of every entry point, with its
signature, generated from the built declarations. CI regenerates it and fails if it has drifted,
so a change to what this package hands out is always visible in the diff that causes it.

## Safety

Caller values become query syntax, so every one is proven to sit inside its SPARQL
terminal production or rejected: IRIs against `IRIREF`, language tags against
`LANGTAG`, string literals escaped for exactly the four characters the grammar
requires. This is the same module the API runs, imported rather than reimplemented,
and the API's differential suite checks its output against the AST path.
