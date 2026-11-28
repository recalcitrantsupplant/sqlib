# The API in a browser Worker

This directory builds the sqlib API to run in a dedicated Web Worker, with no
server. The Rail demo uses it to deploy as static files
(`demo/scripts/build-browser-site.sh`). Other deployments run the Node server.

## How it works

The bundle is the API from `src/index.ts`, unchanged. Fastify starts in the
Worker with no socket. Each request from the page goes through
`app.inject()`, so the API's own routes, schemas and hooks answer it.

`build.mjs` bundles it with esbuild and replaces the Node built-ins:

| Node module | In the Worker |
| --- | --- |
| `node:sqlite` | `shims/sqlite.mjs`, on `@sqlite.org/sqlite-wasm` (`oo1`, synchronous) |
| `fs`, `fs/promises` | `shims/fs.mjs`, an in-memory file system. Build-time files (people, grants, system-store assets, ETL output) are seeded into it |
| `http`, `https` | `shims/http.mjs`, the request and response objects that `light-my-request` needs |
| `crypto` | `shims/crypto.mjs`: Web Crypto, and `@noble/hashes` for the synchronous `createHash` |
| `stream`, `events` | `readable-stream` and `events` from npm |
| `undici` | `shims/undici.mjs`, the browser's `fetch` |
| `worker_threads` | `shims/worker_threads.mjs`. The build sets `SQLIB_QUERY_WORKERS=0` |
| `pino` | `shims/pino.cjs`, a console logger |
| `@duckdb/node-api` | `shims/duckdb.mjs`, on `@duckdb/duckdb-wasm`, in a nested Worker started on the first ETL call |
| everything else | `unenv` |

Swagger, the assistant, OpenTelemetry and `pino-pretty` are left out.
`process.env` is fixed at build time from `demo/server.env`, with the paths
moved under `/opt/sqlib-demo` and the settings in `demoEnv()` in `build.mjs`.

## Build

```sh
node browser/build.mjs [outdir]     # default: dist-browser/
```

The outdir holds:

| File | Size, gzip | Loaded |
| --- | --- | --- |
| `sqlib-api-worker.js` | 1.03 MB | At start |
| `oxigraph.wasm` | 1.51 MB | At start |
| `sqlite3.wasm` | 0.41 MB | At start |
| `sqlib-duckdb.js` | 0.05 MB | On the first ETL call |

The page also serves `library.sqlite` beside them. duckdb-wasm itself
(`duckdb-eh.wasm`, 34 MB, 7.6 MB gzip) comes from jsDelivr by default, because
one file of that size is larger than some static hosts accept. Set
`duckdbBaseUrl` to serve it from elsewhere.

| Setting | Use |
| --- | --- |
| `SQLIB_BROWSER_MINIFY=false` | Do not minify |
| `SQLIB_BROWSER_ETL_OUTPUT=<dir>` | Embed the seeded ETL runs' output files |
| `SQLIB_BROWSER_META=<file>` | Write the esbuild metafile, to see what takes the space |

## The protocol

`protocol.ts` defines the messages. The page sends `init` once, with the URLs
of the library and the WebAssembly, and the API base URL that the page uses.
The Worker sets `SQLIB_OGC_BASE_URL` from it, so OGC API Features links lead
back to the Worker. The Worker answers `ready` or `failed`.
After that, each `request` gets one `response`, with the status, headers and
body bytes. `packages/web/src/lib/browserApi.ts` is the client in the web app.

Persistence is off in the demo (`persist: false`): each load starts from the
library file. With `persist: true` the shim keeps the database in OPFS through
the `opfs-sahpool` VFS.

## Limits

- One request runs at a time. The web app restarts the Worker when a request
  takes more than 60 s.
- Queries on an outside endpoint go from the visitor's browser. The endpoint
  must send CORS headers, and an HTTPS page cannot call an `http://` endpoint.
- MCP, published tools for outside clients and sign-in need a server and are
  not in this build.
- Every graph in the library is downloaded to every visitor. Graph access
  rules are shown, but the data is in the visitor's browser.

## Tests

The scripts in `test/` run in headless Chromium through Playwright.
`scripts/ci/browser-demo.sh` runs the first three in CI.

| Script | Checks |
| --- | --- |
| `parity.mjs <dist> <server URL>` | The same calls to a server and to the Worker give the same status and body |
| `site.mjs <site> <out> [route ...]` | Screens load with no error and no request to another origin |
| `runs.mjs <site> <out> <route> ...` | Run works on each screen |
| `smoke.mjs <dist> [route ...]` | Starts the Worker and prints a few responses |
| `duck.mjs <dist> <sql>` | Prints the rows the DuckDB adapter gives for one query |
| `compare.mjs <site A> <site B>` | Times app start and screen changes on two deployments |

`harness.html` is the page that `parity.mjs` and `smoke.mjs` open. Copy it
into the outdir with `library.sqlite`.
