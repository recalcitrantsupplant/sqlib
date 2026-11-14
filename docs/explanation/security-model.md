# Security model

This page describes what sqlib enforces, what it leaves to the deployment, and
the reasons for the defaults. Where a protection is designed but not built, the
page says so.

To report a vulnerability, and for a short summary of the deployment posture,
see [SECURITY.md](../../SECURITY.md).

## The two authentication legs

sqlib is between callers and triplestores, so authentication has two separate
legs.

**sqlib to a triplestore.** Service credentials, supplied by environment
variables and resolved for each backend. This is built and in use.

**A caller to sqlib.** Identity and authorization. The routes enforce OIDC
bearer token validation, with grants for each library and each backend. The
graph policy of a backend then limits which of its graphs a caller can read
(see [Backend graph policies](#backend-graph-policies)). A per-query ASK gate is
designed but not built.

## What `SQLIB_AUTH_MODE` does

There are four values. **The default is `disabled`.**

| Mode | Token required | Effect |
| --- | --- | --- |
| `disabled` (default) | no | Each request gets a full-access context. Each check runs and passes. |
| `dry-run` | no | If a token is sent, sqlib verifies it and resolves the grants. sqlib logs a request that would be denied as `would-deny`, and serves it. |
| `required` | yes | A request without a valid token gets `401`. If sqlib cannot fetch the JWKS endpoint, the request gets `503`, because the failure is on the server side. A token whose `kid` is not in the published key set gets `401`. For an unknown `kid`, sqlib fetches the key set again at most once in each 30-second period. |
| `anonymous` | no, and sqlib reads none | Each request is the one principal `urn:sqlib:principal:anonymous`, with the grants of that principal only. Enforcement is the same as in `required`: a failed check is refused, a graph policy narrows, a listing hides. No issuer is needed, nobody is an administrator, and nothing is recorded at request time. |

`anonymous` is the mode for a public deployment. Use it with
`SQLIB_READ_ONLY=true`, and grant `execute` on a library and `query:saved` on
its backends. Each visitor can then run the seeded queries. sqlib refuses SPARQL
that a visitor types, on `/sparql`, in a draft or through MCP. A grant of
`query:adhoc` on one backend allows ad-hoc text on that backend only.

Seed grants with `SQLIB_AUTH_SEED_GRANTS`, or have an administrator write them
on a writable instance of the same auth store. In this mode each caller is the
same principal. `SQLIB_AUTH_ALLOW_LIBRARY_CREATE=all` would therefore let anyone
create a library on a writable deployment. Set it to `admin` unless you want
that. The anonymous principal is a different principal from the authenticated
sentinel, so a grant to "everyone signed in" does not reach a visitor.

`dry-run` or `required` without an issuer stops the server at start. An issuer
without an audience also stops the server, unless
`SQLIB_AUTH_AUDIENCE_UNCHECKED=true` is set. With no audience, sqlib does not
check the `aud` claim, and it accepts a token that the issuer made for any other
application.

The request path has the same form in each mode. The auth plugin is an
`onRequest` hook, registered before any route. In `disabled` mode it adds a
full-access `AuthContext` to the request. No later code checks whether auth is
on, so an enforcement point is present in every mode.

`/health`, `/` and the protected-resource metadata
(`/.well-known/oauth-protected-resource` and its path-suffixed forms) are public
in each mode. Each 401 names that metadata in
`WWW-Authenticate: Bearer resource_metadata="…"`, so a client can find the
authorization server (RFC 9728). `/docs` and the routes under it are public
unless `SQLIB_AUTH_PROTECT_DOCS=true`. sqlib matches public routes by the route
pattern that Fastify registered (after `APP_BASE_PATH`). It does not match the
raw URL, so a route such as `/backends/:id/health` is not public because of its
last segment.

### What is verified

`tokenVerifier.ts` validates JWTs against the issuers you configure. sqlib is a
resource server only. It never issues, stores or resets a credential. It accepts
asymmetric algorithms only (`RS*`, `PS*`, `ES256`, `ES384`, `EdDSA`). It refuses
`HS*`, so a leaked public key cannot be used to make tokens. The key set comes
from `SQLIB_AUTH_JWKS_URI`. If that is not set, it comes from the OIDC discovery
document of the issuer, which must name the same issuer.

Claims become principals: the subject, each value of the configured group claim,
and a sentinel that matches each authenticated caller.

sqlib identifies a person by their issuer and `sub`, which do not change. For
display only, sqlib also keeps a label from the token: `email`, else
`preferred_username`, else `name`. The Access screen shows the label in place of
the subject. These are standard OIDC claims, but an access token carries them
only if the identity provider adds them, usually when the client asks for the
`email` or `profile` scope. With none of them, the screen shows the subject. A
label never decides access. An email or username can change or be given to a
different person, so grants stay on the subject.

### What is authorized

A grant is `(principal, resource, modes)`. There are two resource kinds.

A library grants `read`, `write`, `execute`, `delete` and `control`. `execute`
is separate from `read`, so you can let a caller run the saved queries of a
library without letting them read the query text.

A backend grants two operations, each at two levels:

| Mode | Allows |
| --- | --- |
| `query:saved` | Run saved queries (a stored version) against the backend, and read its metadata. |
| `query:adhoc` | Also run query text that the caller writes, on `/sparql` or as a draft. |
| `update:saved` | Run saved updates, and revert a patch. |
| `update:adhoc` | Also run update text that the caller writes, upload data, apply a patch and clear the store. |

`adhoc` includes `saved`, so a grant of `query:adhoc` passes a check for
`query:saved`. The Access screen shows two controls for each backend, one for
each operation, with three values: none, saved, ad hoc.

An environment grants `promote` (move its version pointers) and `execute` (run
only the versions it points to). Library modes never include them. See
[environments.md](environments.md).

Library grants and backend grants are separate. `execute` on a library runs its
saved entities, and each backend they run on needs its own backend grant. A
`defaultBackend`, on a query, a library or an environment, is for clients and
published tools only. It chooses the backend that a client offers first, and it
grants nothing. `/execute` never uses it as a fallback. A query run must name its `backendId`. All backend checks
happen in `GuardedSparqlExecutor`, which wraps each executor that a request
gets. A saved update reached through `/execute` therefore needs `update:saved`,
the same as any other route.

Resolution is additive. The effective grant set is the union of the grants of
all principals of the caller. There is no order, no precedence and no deny rule.
More grants can only give more access, so a grant set is easy to audit.

Enforcement is a plugin-scoped `preHandler` on twelve entity route plugins. The
comment on `entityGuard.ts` gives the reason: a check in each handler fails when
someone adds a new handler and forgets it, and a plugin-scoped guard also covers
routes added later. Handlers add their own checks where the rule is about an
entity other than the one in the path: creation from a request body, execution,
and any access to a second entity.

sqlib logs each allow, deny and would-deny as an audit event, with the decision,
the resource, the mode and the grant that gave the result. Token claims are
never written to the log.

## What is not authenticated

**`/mcp` has no authorization for each tool.** The MCP endpoint is on the same
Fastify instance as the API, so the `onRequest` hook of the auth plugin covers
it. Under `required`, sqlib refuses a request with no bearer token before the
transport sees it. A token that is present goes with each `app.inject` call, so
tools run with the grants of the caller.

Each MCP session belongs to the caller that created it: a digest of the
`Authorization` header, or of the issuer and subject of the verified token. A
request on that session from a different caller gets 403, so a leaked session id
does not give access to the session. sqlib has no per-tool authorization. Under
the default `disabled` mode, sqlib checks no token, and it identifies callers
only by the `Authorization` header they send.
`packages/mcp-server/test/http-server.test.ts` checks that `/mcp` refuses a
request with no bearer token under `required`.

**The in-app assistant has no authorization of its own.** Its route module
registers no entity guard and calls no enforcement helper. Its header says:

> Unauthenticated, like `/mcp` beside it. That is not an oversight, it is the
> gap the plan names: both doors are blocked on the caller-authorization model,
> and until then this is a single-tenant, local-or-trusted-network feature.

For an operator: in a default deployment, anyone who can reach the port can use
both routes, and network access is their only access control. Put the server
behind a layer that enforces your own access control.

The assistant does have a limit on what it can do. Its tool allowlist is
read-only:

- Each catalogue tool that changes server state is absent from the list.
- Its writes go through draft tools, which put the change in the session for a
  person to save.
- `sparql.proxyQuery` is always excluded. `/sparql` executes UPDATEs, so this
  tool would let the assistant write to the triplestore of the user without the
  draft step.
- A list of forbidden name patterns stops a new catalogue tool from becoming
  available to the assistant without a decision.
- `execute.run` is allowed, because it runs an entity that a person already
  saved.

This allowlist also limits prompt injection. The context of the assistant
contains entity content that users can write: query text, descriptions and
results. The allowlist limits what an instruction hidden in that content can do.

## Backend graph policies

A backend can have a graph policy: a saved SELECT that decides, for each caller,
which graphs of that backend the caller can read. The original design named
three tiers, and the policy is the second:

1. A grant on the backend decides whether a caller can run anything on it.
2. The policy then limits what a query reads.
3. A policy graph with an ASK gate for each query. This tier is not built.

### How a policy is set

An administrator sets two fields on the backend, together:

- `graphPolicyQueryVersion`: a query version, pinned. Later edits to the query
  have no effect until the administrator pins the new version.
- `graphPolicyBackend`: the backend the policy runs on. It must be an *auth
  backend* (`authBackend: true`) or the library store.

sqlib checks the policy when it is saved. A policy that could never run gets 400
at save time, so it does not fail each later request. The rules:

- The policy must be a SELECT.
- It can project only `?graph`, `?defaultGraph` and `?namedGraph`.
- It can declare only the two single-variable slots
  `VALUES ?authUser { UNDEF }` and `VALUES ?authGroup { UNDEF }`, and no LIMIT
  or OFFSET parameters.
- A backend cannot be its own policy backend.
- An auth backend cannot have a policy.

An auth backend holds access data. Only administrators can query it, through any
route, so nobody else can read the rules that decide access.

### How a policy is applied

For each read, sqlib runs the policy on the auth backend with the caller bound:

- `?authUser` gets the user principal IRI of the caller.
- `?authGroup` gets one row for each group principal IRI in the token. With no
  groups it gets zero rows, so a group rule matches nothing.

The result becomes a dataset:

- `?graph` fills both the default graphs and the named graphs.
- `?defaultGraph` and `?namedGraph` fill one part each.
- A part that the policy does not project is empty. The caller reads no graphs
  there.

sqlib intersects that dataset with any dataset that the caller asked for (the
graph picker, `defaultGraphs`/`namedGraphs` on `/sparql` and `/execute`) and
with dataset edges in a query group. It sends the intersection as the SPARQL
protocol parameters `default-graph-uri` and `named-graph-uri`, or as the dataset
options of Oxigraph. These override `FROM` and `FROM NAMED` in the query text.
sqlib sends an empty part as `urn:sqlib:empty-dataset`, a graph that contains
nothing. With no parameter, the endpoint would use its whole dataset.

sqlib caches results for each backend and caller for
`SQLIB_AUTH_POLICY_CACHE_SECONDS` (default 60). A change to the policy on the
backend clears the cache. So does an update to an auth backend through sqlib.
Other changes to the access data, such as an edit to a data graph that loads the
auth backend, take effect within the cache time.

### Who is not policed

- **Administrators and sqlib itself.** sqlib does not narrow a caller with full
  access (each caller in `disabled` mode) or with the administrator grant. It
  also does not narrow its own internal queries (`{ internal: true }`). To see
  what a person would read, use `Test as` on the Access screen.
- **Updates.** The policy narrows the `WHERE` clause of an update, as it
  narrows a read. sqlib sends the narrowed dataset as `using-graph-uri` and
  `using-named-graph-uri`, and does not change the update text. sqlib refuses
  with `403` a policed update in these cases:
  - The text has `USING`, `USING NAMED` or `WITH`, because the protocol does
    not let a dataset replace those clauses
    (`GRAPH_POLICY_UPDATE_NAMES_GRAPHS`).
  - The text has `DELETE WHERE`, which cannot take a dataset
    (`GRAPH_POLICY_UPDATE_DELETE_WHERE`).
  - The backend cannot apply an update dataset, as with an in-process Oxigraph
    0.5.13 store (`GRAPH_POLICY_UPDATE_UNSUPPORTED`).

  The policy does not limit the graphs an update writes to: an
  update names them in its own text. The `update:*` modes therefore allow
  writes to any graph of the backend. Give update modes only to callers who can
  write the whole backend.
- **Browser backends and exported bundles.** These send queries from the
  browser directly to the endpoint, so sqlib never sees them.
- **Data graphs.** An in-process backend loaded from data graphs has the same
  privacy as the libraries that hold those graphs. Anyone with `read` on such a
  library can read the graph through the Data graphs routes. Keep these graphs
  in a library that only administrators can read.
- **The patch log.** A patch holds what an update wrote, in each graph. On a
  policed backend, a read of the patch log needs `update:saved`. `query:saved`
  is not sufficient.

### Fail closed

In `required` mode, each failure to evaluate a policy refuses the request with
503 and a generic message. Failures include an unknown version, an auth backend
that sqlib cannot reach, a policy that no longer passes the checks, and a
result that is not SPARQL JSON. In `dry-run` mode, sqlib logs the failure and
the narrowing as would-deny audit events, and runs the query without narrowing.

### What stays the job of the deployment

- **sqlib does not remove `SERVICE`.** A query with `SERVICE` on a policed
  backend runs, with a warning (the `X-Sqlib-Warning` header on `/sparql`),
  because the dataset does not limit the remote endpoint. On an in-process
  backend, there is nothing to reach: the Node build of Oxigraph has no service
  handler, so a `SERVICE` clause fails the query. On an HTTP backend, turn
  federation off in the store if the policy must hold.
- **sqlib must be the only path to the store.** If callers can reach the SPARQL
  endpoint directly, the policy does not apply to them. Keep a policed store on
  a private network.

To try this on one machine, with Rauthy as the source of the groups, run
`just demo-graph-access` (see [Deploying](../guides/deploying.md#a-demo-of-graph-access)).

## The caller in saved queries

Grants decide *which* queries a caller can run. They cannot decide *for whom* a
query runs. If a query takes the caller as a parameter, it trusts the value that
the caller sends. Any saved query can therefore declare the slots that a graph
policy reads, `VALUES ?authUser { UNDEF }` and `VALUES ?authGroup { UNDEF }`, and
sqlib fills them from the sign-in. The rules are in
`guides/publishing-tools.md` ("The caller").

`completeArgumentSets` (`packages/runtime`) fills the slots. Each substitution
goes through this step, on the template path and on the AST path. It takes a
`caller` option with three states:

- An identity fills the slots.
- `null` means no caller, and fills both slots with zero rows.
- No option, for a text that declares a slot, is refused.

The third state makes the design fail closed. If a route does not pass the
caller, the slot does not run open (which would match each caller). The run
fails. The wrappers of the API (`applyExecutionArguments`, `invokeCallable`)
take the caller as a required field, so the compiler lists each call site.

No caller is signed in for a full-access context (`disabled` mode, or `dry-run`
without a valid token), for `anonymous` mode (its one principal identifies
nobody), and for the internal work of sqlib. A route refuses such a run with
`401` or `403` before it starts. The zero rows are a second protection behind
that refusal.

sqlib also fills the slots in ad-hoc text on `POST /sparql`. This gives the
caller nothing new, because a caller who can run ad-hoc text can type any IRI
into it.

## Backend credentials

A `Backend` entity stores an `authEnvKey`: a name that matches `^[A-Z0-9_]+$`.
It stores no secret. The old `username` and `password` fields are removed from
the data model, and schema validation refuses a request that has them.

At execution, `backendAuth.ts` reads from the environment of the server:

```
SQLIB_BACKEND_<KEY>_USERNAME + SQLIB_BACKEND_<KEY>_PASSWORD   → Basic
SQLIB_BACKEND_<KEY>_AUTH_HEADER                               → used verbatim
```

Basic has precedence over a header. With neither, the request goes out without
credentials. One function builds the header for each caller on the server side:
the executor, the capability probe and the prefix service. A second copy of the
function would be a second place where a store could start to return 401.

This has three results:

- An export of a library, a copy of its `.nq` snapshot, or a dump of its
  triplestore contains no credentials.
- To rotate a credential, change the environment and restart. No entity changes.
- Anyone who can execute against a backend uses those credentials. For this
  reason the routes without authentication (above) are important. The library
  does not hold the secret, but it holds the ability to use it.

The library storage backend is for administrators only, even when a caller has
grants on other backends, because a direct read of it goes around the entity
layer.

Grants and principals are not in the library store. They are in the
`urn:sqlib:auth` graph of a separate auth store: one SQLite file by default, one
N-Quads file, or a separate SPARQL dataset (`SQLIB_AUTH_STORE_TYPE`). The SQLite
store also keeps an audit trail in `auth_events`: the quads that each change
added and removed, with the time. As a result:

- A backup, restore or reset of the library store does not change access
  control.
- No export or library-store query reaches the auth store.
- When you delete a library or a backend, sqlib removes the grants that name it.
- The static export bundle carries no authorization. An exported bundle gets
  what the endpoint gives its caller. Do not export a query whose safety depends
  on scoping on the server.

## Why ETL and the assistant are off by default

Both defaults limit capability. They say nothing about maturity. The comments on
the flags give the same reason.

**ETL.** `FEATURE_ETL` and `FEATURE_PLAYGROUND_ETL` are false by default. ETL
accepts any DuckDB SQL. DuckDB SQL can read any file on the host, and with the
httpfs extension it can send outbound requests. An ETL tool needs this to read
its sources, and it is also the risk. A capability this wide must not appear
after an upgrade without a decision.

Under the flag, the DuckDB instance starts with each capability off and locked.
These settings enforce limits. Each was measured against the binding in use:

- `enable_external_access=false` at instance creation blocks file reads, network
  reads and `INSTALL`. A running database cannot turn it on again. This is the
  only hard boundary.
- Autoinstall and autoload are off, so extensions do not load on demand.
- `lock_configuration=true`, set on a boot connection before any SQL from a
  caller runs, blocks each later `SET`, also from another connection to the same
  instance. Without it, submitted SQL can change its own profile.

sqlib offers no directory allowlist, because DuckDB does not enforce one. The
instance config of the binding refuses `allowed_directories`. Set over SQL, it is
accepted and enforces nothing. With it set and the configuration locked,
`read_csv('/etc/passwd')` still returns rows. A setting that appears to limit ETL
to a directory, and does not, would give a false sense of safety. File access is
therefore all or nothing. `ETL_DUCKDB_ALLOW_HTTP` also turns on file access,
because one DuckDB setting controls both. Deadlines and a memory limit are on by
default.

Under `required`, each route that stores or runs ETL SQL needs administrator
access. A library grant is not sufficient:

- `POST /etl-jobs/preview`, through `adminSuffixes` on its route plugin.
- `POST /etl-jobs/:id/versions`, `POST /etl-jobs/:id/execute` and
  `POST /playground/etl/execute`, through a `requireAdmin` call in the handler.
  A suffix would match each method on the path, reads included.

A stored version counts, because a later run executes its SQL. A library grant
lets a caller change their own queries. It does not mean that they can read the
file system of the host, and the reach of submitted SQL is the process and its
host. A test mounts the real route plugins and checks that a principal with each
library mode, but without administrator access, is refused. A route added
without a guard fails it, and so does a route whose guard is removed.

Under the default `disabled` mode there is no principal and each request has full
access, so those checks do nothing. **In a default deployment, the flag is the
protection.** The authorization check is not.

The MCP catalogue has no `etl.*` tools, so neither an MCP client nor the
assistant can reach ETL.

**The assistant.** `FEATURE_ASSISTANT` is false by default for three reasons: it
has no authentication, it calls a paid third-party provider, and it can reach a
configured backend. The caller supplies the provider key with each request, so
the server holds no key.

## How caller values reach SPARQL

sqlib never concatenates argument values into query text.

There are two paths, and both use the same validation:

- The AST path parses the query, finds the `VALUES` clauses whose only row is
  all `UNDEF`, and replaces that row with term nodes built from the supplied
  bindings.
- The template path, shared with the exported runtime, puts serialised terms
  at recorded offsets in the query text.

`packages/runtime/src/sparql-terms.ts` gives the security property. Its header
states the contract:

> **The security contract is validation, not sanitisation.** Every value is
> either provably inside its SPARQL terminal production or rejected. We never
> try to make a dangerous value safe by rewriting it, except for the one
> production where the grammar defines an escape mechanism (string literals).

In detail:

- An IRI is refused if it contains a character that `IRIREF` forbids between the
  angle brackets: `< > " { } | ^ \` and each character below U+0021.
- A language tag must match `LANGTAG` exactly, because language tags have no
  escape mechanism.
- In a string literal, the four reserved characters are escaped and nothing else
  changes, so the round trip is byte-exact.

The AST path validates through the same serialiser and discards the string.
There is one definition of a valid value, so the two paths always accept the
same inputs.

This fixed a real defect. The generator of the parser escapes string literals
but writes IRIs and language tags as given, so `<` + rawIri + `>` could add terms
to a `VALUES` block:

```
{ type: 'uri', value: 'http://e/a> <http://e/b' }
→ VALUES ?l { <http://e/a> <http://e/b> }     // two rows, valid SPARQL
```

The caller could choose which rows a parameterised filter matched.
`packages/compiler/test/parser.injection.test.ts` checks the fix in two ways: a
table of hostile values that must be refused, and a property-based test. The
property-based test checks that each string that passes validation gives exactly
one row in the query. It counts the rows by parsing the output again with a
separate parser.

**What this prevents.** A supplied argument cannot end its own production and
reach the query structure around it. It cannot add rows or clauses, close a
graph pattern, or add an update.

**What it does not prevent.** It does not limit what the query itself does. A
saved query with `SERVICE` federates. A saved update writes. `POST /sparql`
takes any query text, with only a backend grant as a check. Parameter values are
safe. The query that uses them is what a person with write access to the library
wrote.

An update must use POST. `GET /sparql` returns 405 for an UPDATE. A page that a
visitor opens can make their browser send a GET (a link, an image, a prefetch).
CORS stops the page from reading the response, but the request still runs.

## A read-only deployment

`SQLIB_READ_ONLY=true` refuses each write to the state of sqlib. The catalogue
changes only when you redeploy, and the browser keeps what a visitor writes. The
setting is separate from `SQLIB_AUTH_MODE` and needs no principal. See
[configuration](../reference/configuration.md#read-only-deployments) for the
gate and its exceptions.

The setting has a narrow effect:

- It stops sqlib from storing what a visitor sends.
- It authenticates nobody.
- It does not stop a visitor from reading the whole catalogue.
- It does not decide whether a *backend* accepts a write. `POST /sparql` still
  sends an update to the store, and the store applies its own rules.

To make your stores immutable, configure those stores as read-only.

**Browser backends.** The SPA lets a visitor register a SPARQL endpoint in their
own browser (`localStorage`). The tab runs those queries directly. The endpoint,
the query text, any header that the visitor adds, and the results never reach
the server.

This replaces an inline-endpoint field, which sent the endpoint to sqlib and made
the server fetch it. On a public site, a server that fetches a URL from a caller
can be used for request forgery against any host it can reach. For the same
reason, `POST /backends/probes` is not one of the read-only exceptions: it would
be the same risk.

The cost is CORS. A browser can read an endpoint only if the endpoint sends
`Access-Control-Allow-Origin`. An endpoint that answers curl can therefore fail
from the page. The SPA reports this case with its own message, and does not show
a generic network failure.

## Before you expose sqlib

1. **Choose a value for `SQLIB_AUTH_MODE`.** The default is `disabled`, which
   means no authentication. Set an issuer, and use `dry-run` to see what would
   be denied before you change to `required`.
2. **Do not expose `/mcp` or the assistant to a network you do not control.**
   Neither has its own authorization. If the API is reachable, so are they.
3. **For a demo, set `SQLIB_READ_ONLY=true`.** On a public deployment, refusing
   writes is what keeps the catalogue intact. Under `disabled` mode each visitor
   has full access, so without this flag anyone can edit or delete anything.
4. **Make sqlib the only path to your stores.** Put a firewall between the
   SPARQL endpoints and everything except sqlib. A path around sqlib cancels
   each authorization decision that sqlib makes.
5. **Keep `FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL` and `FEATURE_ASSISTANT` off**
   until you decide that the deployment can accept them. If you turn ETL on,
   give DuckDB only the capabilities you need, and use the container to confine
   the process.
6. **Turn off the sections you do not use.** When a feature flag is off, its
   routes are not registered. A request gets no route at all, which is stronger
   than 403.
7. **Check `SQLIB_AUTH_PROTECT_DOCS` and `SQLIB_AUTH_ALLOW_LIBRARY_CREATE`.**
   By default, `/docs` is public, and any authenticated principal can create a
   library.
8. **Keep backend credentials in the environment.** Never put a secret in an
   entity field. Make sure that `authEnvKey` names the key you expect.
9. **Do not run two sqlib processes against one library store.** Each process
   has its own cache, and neither is told when the other writes. Back up the
   auth store (`SQLIB_AUTH_STORE_DIR`, or its SPARQL dataset) and the library
   store, because they are separate. Copy a live SQLite store with
   `sqlite3 auth.sqlite ".backup copy.sqlite"`, so the copy includes its WAL.
   With [backup to blob storage](../guides/deploying.md#backup-to-blob-storage)
   on, the bucket holds both stores, with the grants. Keep it private and
   encrypted, and let only the sqlib identity write to it.
10. **Review what you export.** A static bundle carries no authorization. Only
    read queries can be exported. Updates cannot.
11. **List the browser origins that can call the API in `SQLIB_CORS_ORIGINS`.**
    If it is not set, a production deployment allows no origin. This is correct
    when the API serves the SPA from its own origin. A listed origin gets
    credentialed access. `*` allows any origin without credentials. See
    [configuration](../reference/configuration.md#server-and-transport).
12. **A hosted multi-tenant deployment on shared infrastructure must keep ETL
    off.** No setting makes any SQL safe to offer to tenants who do not trust
    each other.

## Related

- [SECURITY.md](../../SECURITY.md): reporting, scope and the short posture
  summary.
- [architecture.md](architecture.md): where the auth plugin is in the request
  path.
- [guides/etl.md](../guides/etl.md): what ETL gives a caller when you turn it on.
- [guides/deploying.md](../guides/deploying.md): run the image.
- [guides/static-export.md](../guides/static-export.md): what a bundle carries.
- [reference/feature-flags.md](../reference/feature-flags.md): each flag and its
  default.
- [reference/configuration.md](../reference/configuration.md): each
  `SQLIB_AUTH_*` and `ETL_DUCKDB_*` variable.
