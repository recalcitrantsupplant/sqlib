# HTTP QUERY method for SPARQL HTTP backends

Status: implemented, 2026-11-11. The section "Implementation" lists what is in the code and what is not.

## Answer

QUERY applies to SPARQL queries only. An HTTP backend needs one new setting value, `queryMethod: 'query'`. It does not need a method setting for updates.

- RFC 10008 (June 2026) defines QUERY as safe and idempotent. A server must not change state because of a safe request, so a SPARQL update cannot use it.
- SPARQL 1.1 Protocol §2.2 and the SPARQL 1.2 Protocol draft both say an update "must be invoked using the HTTP POST method". POST is the only legal value, so a setting for it has nothing to choose.
- Oxigraph refuses an update sent with QUERY: "SPARQL updates are not compatible with the QUERY HTTP method" (400). Source: `cli/src/main.rs` on Oxigraph `main`.
- sqlib already sends every update as a POST, whatever `queryMethod` says (`packages/api/src/server/HttpSparqlExecutor.ts:73-85`, `packages/web/src/lib/browserBackendExecution.ts:135`).

Two update settings could be useful later. They are separate from this proposal:

- An update URL. Server-side HTTP backends use one `endpoint` for queries and updates (`packages/api/src/routes/sparql.ts`, `updateUrl: backendEndpoint`). Fuseki can serve `/query` and `/update` apart. The exported runtime already has `updateEndpoint` (`packages/runtime/src/executor.ts:133`).
- An update body encoding: form (`update=`) or direct (`application/sparql-update`). The API sends a form. The browser and the runtime send direct.

## What sqlib does today

| Path | Query method choice | Dataset (`default-graph-uri`, `named-graph-uri`) | Update |
|---|---|---|---|
| API, `HttpSparqlExecutor` | `queryMethod` `post` (default) or `get` | Forces a POST form body, also on a `get` backend | POST form, `using-graph-uri` in the body (#165) |
| API, ad hoc `endpoint` on `/sparql` | Request field `queryMethod`, `get` or `post` | As above | As above |
| Web, browser backends | `queryMethod` `get`, `post` or `null` (length heuristic, 1800 chars) | In the URL, for GET and POST | POST `application/sparql-update`, parameters in the URL |
| Runtime, `httpExecutor` | `method` `auto`, `GET` or `POST` (1800 chars) | In the URL for GET, in a form body for POST | POST `application/sparql-update` to `updateEndpoint` |

The stored value is an IRI in `sqlibQueryMethod` (`packages/api/src/persistence/namespaces.ts:692`), with the terms `post` and `get`.

## Proposed configuration

Add `query` as a third value everywhere a query method is chosen:

1. Add the term `query` to `sqlibQueryMethod`. The IRI is `https://sparql-query-lib/query-method/query`.
2. Add `'query'` to the enums in `packages/contracts/src/generated/backend.ts` and `sparql.ts` (through the generator).
3. Add `'QUERY'` to the runtime `method` option.
4. Add a third choice to the method buttons in `BackendWorkArea.vue` and `InlineEndpointAdder.vue`. Label it `QUERY`.

Keep `post` as the default. Do not add an `update` method setting.

## Request shape

Send a QUERY request as a direct body, as SPARQL 1.2 Protocol §2.1 asks ("similar to ... POST"):

```
QUERY /sparql?default-graph-uri=...&named-graph-uri=... HTTP/1.1
Content-Type: application/sparql-query
Accept: application/sparql-results+json

SELECT ...
```

Reasons for the direct body:

- Oxigraph accepts QUERY with `application/sparql-query` and with a form body.
- Fuseki dispatches a request by the `query` parameter or the content type (`Dispatcher.chooseOperation`). I think Jetty parses a form body for POST and PUT only, so Fuseki would not see `query=` in a QUERY form body. I have not tested this. A direct body avoids the question.
- RFC 10008 §2.7 makes the request content part of the cache key. A direct body gives a cache the query text with no form encoding.

## Graph parameters

A direct body puts `default-graph-uri` and `named-graph-uri` in the URL. The API sends a dataset in a form body today because a long graph list outgrows a URL. Fuseki answered 414 at 10,000 graphs, and an 8 KB proxy limit holds about 145 graphs (comment in `HttpSparqlExecutor.ts:98-101`).

Rule for a `query` backend:

1. With no dataset, or with a URL of at most 1800 characters, send QUERY with the parameters in the URL.
2. With a longer URL, send a POST form body, as today.

Browser backends need no length rule. Their direct POST puts the dataset in the URL already, and QUERY uses the same URL.

Updates are not affected. The update dataset in #165 and the design in #166 (`using-graph-uri`, `using-named-graph-uri` in a form body) stay on POST.

## Fallback when a server refuses QUERY

A server that does not know QUERY can answer 405, 501 or 400. Fuseki 5.5.0, which sqlib tests against, has `errorMethodNotAllowed("Not a GET or POST request")` in `SPARQLQueryProcessor`, so I expect 405 if the request reaches that code. I have not checked whether Fuseki's dispatcher refuses the request earlier with another status.

Proposed behaviour:

1. On 405 or 501 to a QUERY request, send the same query once as a POST and use that result.
2. Remember the refusal per backend in process memory for 10 minutes. Send POST for that backend during that time.
3. Log one warning per backend: the backend id, the status, and that sqlib fell back to POST.
4. Do not fall back on 400. A 400 can be a syntax error in the query, and a retry would hide it.
5. The connection probe (`packages/api/src/lib/backendProbe.ts`) could send `QUERY` with `ASK {}` when the backend uses `query`. A 405 or 501 would then show on the backend page before a run. This is not implemented.

A retry is acceptable here because the operation is a query. RFC 10008 makes QUERY idempotent, and a SPARQL query does not change the store.

## Caching, proxies and CORS

- **HTTP caches.** RFC 10008 §2.7 allows a cache to store a QUERY response, with the body in the cache key. Few deployed caches do this. The ecosystem tracker (`ebremer/RFC10008support`, refreshed 2026-11-06) lists nginx as an open PR, Varnish and HAProxy with nothing, and Cloudflare workerd as open. Expect no cache benefit today. GET stays the method to choose for HTTP caching of short queries.
- **Proxies and gateways.** Envoy 1.40.0 passes QUERY. Earlier Envoy refuses HTTP/1.1 QUERY. The Kubernetes API server proxy refuses it with 405. nginx has no merged support; I think it forwards an unknown method, but I have not tested it. The fallback above covers a proxy that answers 405.
- **CORS.** QUERY is not a CORS-safelisted method (RFC 10008 §4). Every browser QUERY is preflighted, and the server must list `QUERY` in `Access-Control-Allow-Methods`. Oxigraph echoes the requested method, so it allows QUERY. A browser POST with `application/sparql-query` is preflighted already, so a browser backend loses nothing against `post`. It loses the preflight-free GET that `null` gives to short queries.
- **Browser cache.** I think browsers do not cache QUERY responses. Not tested.
- **Read-only enforcement by method.** QUERY lets a gateway allow reads and block writes by method alone. With POST, a gateway must read the body to tell a query from an update. This is the main gain for sqlib deployments today.
- **Logs.** The query text stays out of URLs and access logs, as with POST.

## Server and client support

| Software | QUERY for SPARQL queries | Evidence |
|---|---|---|
| Oxigraph server 0.5.5 to 0.5.7 | `/query` only | `cli/src/main.rs` at the tags |
| Oxigraph server 0.5.8 and later | `/query` and `/sparql`; form or direct body; update refused with 400 | `cli/src/main.rs` at `v0.5.8`, `v0.5.13` |
| Oxigraph JS binding (in-process) | Not applicable | No HTTP |
| Apache Jena Fuseki 5.5.0 to 6.1.0 | No | `SPARQLQueryProcessor.java` has no `METHOD_QUERY` |
| Apache Jena Fuseki 6.2.0 | Yes, `SPARQLQueryProcessor` accepts GET, POST, QUERY | Source at tag `jena-6.2.0`. Form body not verified |
| Comunica 5.4.0 | Yes (client) | Tracker row, PR #1778 |
| QLever, GraphDB, Virtuoso, Stardog | Unknown | No source found |
| Node.js 22 `fetch` | Sends QUERY with a body | Tested here: a Node `http` server received method `QUERY`, `Content-Type: application/sparql-query`, body `ASK {}` |
| undici `Agent.request` (API executor) | Expected to work; undici 8.6.0 and later list QUERY | Tracker row. Not tested here |
| Browsers, `fetch()` | Sends QUERY as an extension method, with a preflight | Fetch allows any method token. No browser has a stated position. Not tested here |

## Implementation

Done:

1. Vocabulary, contracts and enums: `query` in `sqlibQueryMethod`, the Backend schemas and the `/sparql` request schema.
2. `HttpSparqlExecutor`: the QUERY branch, the URL length rule and the fallback. The refusal memory is per query URL, in process memory.
3. `browserBackendExecution.ts`: the QUERY branch and the fallback. Refusals are kept per endpoint for the life of the page, with the same 10 minute limit.
4. Runtime `httpExecutor`: `method: 'QUERY'`, the URL length rule and the fallback, per executor.
5. Web: a `QUERY` choice in the backend query method control.
6. Unit tests for each branch. A run of the real `HttpSparqlExecutor` against a local Node `http` server: undici 8.12.4 sent `QUERY /sparql?default-graph-uri=urn%3Ag` with `Content-Type: application/sparql-query`, and after a 405 sent the same query as a POST form.
7. `docs/reference/configuration.md`: the three values.

To do:

1. The probe change in step 5 of the fallback.
2. An integration test against Oxigraph server 0.5.13, and against Fuseki 6.2.0 if the test image moves from 5.5.0.

## Not checked

- Fuseki 6.2.0 with a QUERY form body, and the status code that Fuseki 5.5.0 returns for QUERY on a live server.
- undici `Agent.request` with QUERY in the API's undici version.
- QUERY support in QLever, GraphDB, Virtuoso and Stardog.

## Sources

- RFC 10008, The HTTP QUERY Method: https://www.rfc-editor.org/info/rfc10008
- SPARQL 1.2 Protocol editor's draft, §2.1 and §2.2: https://w3c.github.io/sparql-protocol/spec/
- W3C sparql-protocol issue #40: https://github.com/w3c/sparql-protocol/issues/40
- RFC 10008 ecosystem tracker: https://github.com/ebremer/RFC10008support
- Oxigraph server source: https://github.com/oxigraph/oxigraph/blob/main/cli/src/main.rs
- Jena Fuseki source: https://github.com/apache/jena/blob/jena-6.2.0/jena-fuseki2/jena-fuseki-core/src/main/java/org/apache/jena/fuseki/servlets/SPARQLQueryProcessor.java
