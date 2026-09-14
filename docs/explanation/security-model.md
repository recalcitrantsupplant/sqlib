# Security model

This page describes what sqlib actually enforces, what it deliberately does not,
and why the defaults are where they are. Where a protection is designed but not
shipped, it says so.

For reporting a vulnerability and for the short deployment summary, see
[SECURITY.md](../../SECURITY.md).

## The two authentication legs

sqlib sits between callers and triplestores, so there are two separate questions
and they have separate answers.

**sqlib to a triplestore.** Service credentials, supplied by environment
variable, resolved per backend. Shipped and in use.

**A caller to sqlib.** Identity and authorization. Partly shipped: OIDC bearer
token validation with per-library and per-backend grants exists and is enforced
at the routes. The parts that would scope *what data within a store* a caller
may see are designed and not shipped.

## What `SQLIB_AUTH_MODE` does

Three values. **The default is `disabled`.**

| Mode | Token required | Effect |
| --- | --- | --- |
| `disabled` (default) | no | Every request gets a synthetic full-access context. Every check exists and passes. |
| `dry-run` | no | A token, if presented, is verified and grants resolved; a request that would be denied is logged as `would-deny` and served anyway. |
| `required` | yes | A request without a valid token gets `401` (or `503` if the JWKS endpoint cannot be reached, because that failure is the server's, not the caller's). |

Setting `dry-run` or `required` without configuring an issuer is a startup
error, not a silent fallback.

The design decision behind all three is that the request path is the same shape
in every mode. The auth plugin is registered as an `onRequest` hook before any
route, and `disabled` mode decorates a full-access `AuthContext` rather than
skipping the decoration. Nothing downstream branches on "is auth on", so an
enforcement point cannot be accidentally absent in one mode and present in
another.

`/health` and `/` are public in every mode. `/docs` is public unless
`SQLIB_AUTH_PROTECT_DOCS=true`.

### What is verified

`tokenVerifier.ts` validates JWTs against issuers you configure. sqlib is a
resource server only: it never issues, stores or resets a credential. Only
asymmetric algorithms are accepted (`RS*`, `PS*`, `ES256`, `ES384`); `HS*` is
excluded so that a leaked public key cannot mint tokens.

Claims become principals: the subject, each value of the configured group claim,
and a sentinel matching every authenticated caller.

### What is authorized

Grants are `(principal, resource, modes)` over two resource kinds. A library
grants `read`, `write`, `execute`, `delete` and `control`; a backend grants
`use` and `write`. Execute is deliberately independent of read, so "may run the
library's saved queries" and "may read their text" are separable.

Resolution is additive: the effective grant set is the union over all of a
caller's principals. There is no ordering, no precedence and no deny rule.
Composition can only widen access, which is what keeps a grant set auditable.

Enforcement is a plugin-scoped `preHandler` registered on twelve entity route
plugins rather than a check written into each handler. The comment on
`entityGuard.ts` gives the reason: a per-handler check is only as good as the
next handler somebody adds, whereas a plugin-scoped guard covers routes that do
not exist yet. Handlers still add explicit checks where the rule is not "the
entity named in the path" — creation from a request body, execution, and
anything reaching a second entity.

Every allow, deny and would-deny is logged as an audit event with the decision,
the resource, the mode and the grant that produced it. Token claims are never
serialised into the log.

## What is not authenticated

**`/mcp` has no authentication of its own.** The MCP endpoint is registered on
the same Fastify instance as the API, so the auth plugin's `onRequest` hook does
cover it: under `required`, a request with no bearer token is refused before the
transport sees it, and a token that is present is forwarded onto every
`app.inject` call so tools run under that caller's grants. What does not exist
is anything MCP-specific — no per-session identity, no per-tool authorization —
and under the default `disabled` mode nothing is checked at all. The repository
has no test pinning `/mcp` behaviour under `required`.

**The in-app assistant has no authorization of its own.** Its route module
registers no entity guard and calls no enforcement helper. Its own header states
the position:

> Unauthenticated, like `/mcp` beside it. That is not an oversight, it is the
> gap the plan names: both doors are blocked on the caller-authorization model,
> and until then this is a single-tenant, local-or-trusted-network feature.

The practical reading for an operator: in a default deployment, anyone who can
reach the port can use both doors, and network reachability is the only access
control they have. Put the server behind something that enforces your own.

The assistant does have a capability boundary of a different kind. Its tool
allowlist is read-only by construction: every catalogue tool that mutates server
state is absent rather than disabled, its writes go through draft tools that
stage into the session for a human to save, and `sparql.proxyQuery` is excluded
at any setting because `/sparql` executes UPDATEs and that would be a write
channel to the user's triplestore around the draft gate. A list of forbidden
name patterns exists so a newly added catalogue tool cannot quietly become
assistant-reachable. `execute.run` is allowed, on the argument that it runs an
artifact a human already saved.

Note the interaction with prompt injection: the assistant's context is fed by
user-writable entity content — query text, descriptions, results — so the
allowlist is what bounds the damage an instruction hidden in that content can
do.

## The caller-authorization model that is not shipped

A three-tier model is designed. Tier 1 — claims mapped to allowed backends, so
a caller without a grant on a backend cannot execute anything against it — is
what ships, as the backend grants described above. Tiers 2 and 3 are not
implemented:

- **Named-graph scoping.** Injecting `default-graph-uri` / `named-graph-uri` on
  every proxied request so the caller's own `FROM` cannot widen the dataset.
  Nothing in `packages/api/src` sets either parameter.
- **A policy graph with an ASK gate.** Not present.

Two consequences follow from the absence, and neither is obvious from the
presence of an auth layer:

- **`SERVICE` is not stripped or allowlisted.** A federated query reaches
  whatever endpoint it names, from the server. sqlib parses every query, so the
  check is available; it is not implemented.
- **Write authorization by graph does not exist.** An update names its target
  graphs in its own body, and the SPARQL protocol's dataset parameters scope
  only the `WHERE` clause, so the design records that this tier would be
  read-side only even if it shipped.

The whole model also rests on a precondition that is a deployment property, not
a code property: **sqlib is only an enforcement point if it is the only network
path to the store.** If callers can reach the SPARQL endpoint directly, nothing
sqlib does about authorization matters.

## Backend credentials

A `Backend` entity stores an `authEnvKey` — a name, constrained to
`^[A-Z0-9_]+$`. It stores no secret. The legacy `username` and `password` fields
were removed from the data model, and a request carrying them is rejected by
schema validation.

At execution, `backendAuth.ts` reads from the server's own environment:

```
SQLIB_BACKEND_<KEY>_USERNAME + SQLIB_BACKEND_<KEY>_PASSWORD   → Basic
SQLIB_BACKEND_<KEY>_AUTH_HEADER                               → used verbatim
```

Basic takes precedence over a header; absent both, the request goes out
unauthenticated. One function builds the header for every server-side caller —
the executor, the capability probe, the prefix service — because a second copy
is a second place for a store to start answering 401.

Three properties follow. Exporting a library, copying its `.nq` snapshot or
dumping its triplestore carries no credentials. Rotating a credential is an
environment change and a restart, with no entity edit. And anyone who can
execute against a backend is using those credentials, which is exactly why the
unauthenticated doors above matter: the library does not hold the secret, but it
holds the ability to spend it.

Two adjacent notes. The library storage backend is reserved for administrators
even when a caller holds grants elsewhere, because reading it directly would
bypass the entity layer and the auth graph stored in it. And the static export
bundle carries no authorization of its own: an exported bundle grants whatever
the endpoint grants its caller, so a query whose safety depended on server-side
scoping should not be exported.

## Why ETL and the assistant default off

Both defaults are capability grants, not maturity judgements. The flag comments
state it in those terms.

**ETL.** `FEATURE_ETL` and `FEATURE_PLAYGROUND_ETL` default false. ETL accepts
arbitrary DuckDB SQL, which is a host filesystem read primitive and, with the
httpfs extension, an outbound request primitive. That is the feature — a
pipeline that cannot express its own extraction is not an ETL tool — and it is
the risk. A capability with that blast radius should not appear because somebody
upgraded.

Underneath the flag, the DuckDB instance is configured with every capability off
and locked. What actually enforces something, measured against the binding in
use rather than taken from documentation:

- `enable_external_access=false` at instance creation blocks file reads, network
  reads and `INSTALL`, and cannot be re-enabled on a running database. This is
  the one hard boundary available.
- Disabling autoinstall and autoload stops extensions appearing on demand.
- `lock_configuration=true`, applied on a boot connection before any caller SQL
  runs, blocks every later `SET`, including from another connection on the same
  instance. Without it, submitted SQL rewrites its own profile.

A directory allowlist is deliberately not offered, because it does not work:
`allowed_directories` is rejected by the binding's instance config, and when set
over SQL it is accepted and enforces nothing — with it set and the configuration
locked, `read_csv('/etc/passwd')` still returns rows. A knob that appears to
confine ETL to a directory but does not is worse than no knob, so filesystem
access is all-or-nothing. `ETL_DUCKDB_ALLOW_HTTP` implies filesystem access,
because DuckDB gates both on one setting. Deadlines and a memory limit are on by
default.

Under `required`, both SQL-taking routes need administrator access rather than a
library grant: `POST /etl-jobs/preview` through `adminSuffixes` on its route
plugin, `POST /playground/etl/execute` through an explicit check. A library
grant answers the wrong question — "may do anything to my own queries" is not
"may read the host filesystem", and the blast radius of submitted SQL is the
process and its host, not an entity. That pair is checked by a test that mounts
the real route plugins and requires a principal holding every library mode, and
not administrator, to be refused — both a route added without a guard and a
guard deleted from a route fail it.

Under the default `disabled` mode there is no principal and every request
carries full access, so those checks are no-ops. **The flag, not the
authorization check, is what protects a default deployment.**

No `etl.*` tools exist in the MCP catalogue, so neither an MCP client nor the
assistant can reach ETL at all.

**The assistant.** `FEATURE_ASSISTANT` defaults false for three reasons stated
together: it is unauthenticated, it calls a paid third-party provider, and it
can reach a configured backend. The provider key is supplied by the caller per
request precisely so the server does not hold one.

## How caller values reach SPARQL

Argument values are never concatenated into query text.

Two paths exist and both go through the same validation. The AST path parses the
query, finds the `VALUES` clauses whose only row is all `UNDEF`, and replaces
that row with term nodes built from the supplied bindings. The template path,
shared with the exported runtime, splices serialised terms into recorded offsets
in the query text.

The security property is provided by `packages/runtime/src/sparql-terms.ts`, and
its own header states the contract:

> **The security contract is validation, not sanitisation.** Every value is
> either provably inside its SPARQL terminal production or rejected. We never
> try to make a dangerous value safe by rewriting it, except for the one
> production where the grammar defines an escape mechanism (string literals).

Concretely: an IRI is rejected if it contains any character `IRIREF` forbids
between the angle brackets (`< > " { } | ^ \` and everything below U+0021); a
language tag must match `LANGTAG` exactly, because language tags have no escape
mechanism; a string literal's four reserved characters are escaped, and nothing
else is touched, so the round trip is byte-exact.

The AST path validates through the same serialiser and discards the string, so
there is one definition of "is this value representable" and the two paths
cannot drift into accepting different inputs.

This is a fix for a real hole rather than a precaution. The parser's generator
escapes string literals but emits IRIs and language tags verbatim, so
`<` + rawIri + `>` was enough to add terms to a `VALUES` block:

```
{ type: 'uri', value: 'http://e/a> <http://e/b' }
→ VALUES ?l { <http://e/a> <http://e/b> }     // two rows, valid SPARQL
```

The caller chose which rows a parameterised filter matched.
`packages/api/test/lib/parser.injection.test.ts` pins the fix in two ways: a
table of hostile values that must be rejected, and a property-based test
asserting that every string surviving validation yields exactly one row in the
resulting query, counted by re-parsing the output with an independent parser.

**What this prevents.** A supplied argument cannot terminate its own production
and reach the surrounding query structure. It cannot add rows, add clauses,
close a graph pattern or append an update.

**What it does not prevent.** It says nothing about what the query itself is
allowed to do. A saved query containing `SERVICE` federates; a saved update
writes. `POST /sparql` takes arbitrary query text, subject only to a backend
grant. Parameter values are safe; the query that consumes them is whatever
somebody with write access to the library put there.

## Before you expose this

1. **Decide what `SQLIB_AUTH_MODE` is.** The default is `disabled`, which means
   no authentication. Set an issuer and use `dry-run` to see what would be
   denied before switching to `required`.
2. **Do not expose `/mcp` or the assistant to a network you do not control.**
   Neither has authorization of its own. If the API is reachable, so are they.
3. **Make sqlib the only path to your stores.** Firewall the SPARQL endpoints to
   sqlib. Any bypass path voids every authorization decision sqlib makes.
4. **Leave `FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL` and `FEATURE_ASSISTANT` off**
   unless you have decided the deployment can carry them. If you turn ETL on,
   grant no DuckDB capability you do not need, and confine the process with the
   container rather than with a directory allowlist that does not work.
5. **Turn off the sections you are not using.** A feature flag that is off means
   the routes are never registered, which is a stronger statement than a 403.
6. **Check `SQLIB_AUTH_PROTECT_DOCS` and `SQLIB_AUTH_ALLOW_LIBRARY_CREATE`.**
   `/docs` is public by default, and library creation is open to any
   authenticated principal by default.
7. **Keep backend credentials in the environment.** Never put a secret in an
   entity field. Confirm `authEnvKey` names the key you think it does.
8. **Do not run two sqlib processes against one library store.** Each holds its
   own cache and neither is told when the other writes.
9. **Review what you export.** A static bundle carries no authorization, and
   updates are not exportable — read queries only.
10. **A hosted multi-tenant deployment cannot enable ETL on shared
    infrastructure.** There is no setting that makes arbitrary SQL safe to offer
    to tenants who do not trust one another.

## Related

- [SECURITY.md](../../SECURITY.md) — reporting, scope and the short posture
  summary.
- [architecture.md](architecture.md) — where the auth plugin sits in the request
  path.
- [guides/etl.md](../guides/etl.md) — what enabling ETL grants, in full.
- [guides/deploying.md](../guides/deploying.md) — running the image.
- [guides/static-export.md](../guides/static-export.md) — what a bundle carries.
- [reference/feature-flags.md](../reference/feature-flags.md) — every flag and
  its default.
- [reference/configuration.md](../reference/configuration.md) — every
  `SQLIB_AUTH_*` and `ETL_DUCKDB_*` variable.
