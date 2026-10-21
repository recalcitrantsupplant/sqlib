# Design: authentication, identity providers and who gets a token

**Status: decided, partly built.** The API half is shipped: bearer-token
verification, principals, grants, audit and the three auth modes. See
[explanation/security-model.md](../explanation/security-model.md) for what it
enforces today. This page records the architecture those pieces belong to, the
identity-provider question that prompted it, the broker survey behind the
choice of reference broker, and the work that is still open, in the order to do
it. The code cites an earlier design note by section number (`design §3.1` and
so on). That note was never checked in; this page replaces it, and the appendix
maps the citations onto it.

Prices and vendor capabilities below were checked in October 2026 and will
drift. Each is marked where it could not be confirmed on the vendor's own page.

## The question

sqlib has to say who a caller is before it can say what they may do. Three
kinds of caller exist, and a design that serves one of them badly serves the
product badly:

| Caller | Example | How it arrives |
| --- | --- | --- |
| A person in the browser | The SPA in `packages/web` | Redirect-based sign-in, then API calls |
| An MCP client | Claude, ChatGPT, Claude Code against `/mcp` | A bearer token the client obtained on its own |
| An unattended application | A pipeline, a portal, another service in production | A token obtained with no person present |

The question this page settles is where those callers get their token, and in
particular whether "sign in with Google", "sign in with GitHub", Entra ID and
AAF can be offered without each of them leaking into sqlib's code.

## The constraint that decides it

sqlib is a **resource server**. It verifies a JSON Web Token (JWT) with the
issuer's published keys, checks the audience, and derives principals from the
claims. It never performs a login, never holds a client secret, and never issues
a credential. `packages/api/src/auth/tokenVerifier.ts` is the whole of that
contract.

One consequence is easy to miss: **the identity provider must issue a JWT
access token for sqlib's audience.** The SPA sends `access_token`, not the ID
token, and a token has to name sqlib as its audience or verification refuses to
start (`SQLIB_AUTH_AUDIENCE_UNCHECKED` is the deliberate exception). Measured
against that, the providers people ask for split cleanly:

| Provider | What it issues | Fits the constraint |
| --- | --- | --- |
| Entra ID, Keycloak, Auth0, Zitadel, Logto | JWT access tokens with a custom API audience | Yes |
| AWS Cognito | JWT access tokens carrying `client_id` rather than `aud` | Only with the audience check off |
| Google | Opaque access tokens; only the ID token is a JWT | No |
| GitHub | OAuth 2.0 only: no ID token, no JWKS, no discovery document | No |
| AAF Central | OIDC; access-token format is the federation's choice | Not to be assumed |

Google and GitHub cannot be issuers for sqlib directly, and nothing in sqlib's
code can change that. GitHub does not issue JWTs at all. What changes it is
putting an authorization server that sqlib trusts between those providers and
sqlib.

## The architecture

One authorization server that the deployment owns or rents, sqlib as a pure
resource server behind it, and authorization inside sqlib. This is the ordinary
OAuth 2.1 split, and it is also the shape the
[MCP authorization specification (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
requires of an MCP server, so sqlib has to end up here regardless of the
identity-provider question.

The broker is a deployment choice, not a dependency. sqlib's whole contract
with it is three settings: an issuer URL, an audience, and a dot-path to the
group claim. Anything that publishes OIDC discovery and a key set satisfies it.
A self-hosted deployment gets a small broker in the compose profile; an Azure
deployment can point the same three settings at Entra External ID; an AWS
deployment at Cognito; a customer deployment at whatever that customer already
runs. Nothing in sqlib's code knows which one is behind the URL.

```
 Google   GitHub   Entra ID   AAF        identity sources: swappable, federated
    \        |        |        /
     +-------+--------+-------+
             |  federation
     +----------------------+
     |  Authorization       |  one issuer, one key set, one subject per person
     |  server ("broker")   |  code + PKCE for browsers
     |                      |  client credentials for machines
     |                      |  dynamic client registration for MCP clients
     +----------------------+
        |              |
   JWT  |              |  JWT
 +------+------+  +----+-------------------+
 |  SPA        |  |  MCP clients, CLI,     |
 |  public     |  |  pipelines, other      |
 |  client     |  |  services              |
 +------+------+  +----+-------------------+
        |              |   bearer token on every call
     +----------------------------+
     |  sqlib API and /mcp        |  verifies the JWT locally
     |  resource server           |  claims -> principals
     |  grants in the auth graph  |  principals -> library and backend modes
     +----------------------------+
```

What the MCP specification (revision 2026-07-28) pins on each side, because
it decides the broker requirements below:

- The MCP server **MUST** serve OAuth 2.0 Protected Resource Metadata (RFC
  9728) and **MUST** validate that a token's audience is itself (RFC 8707).
- MCP clients **MUST** send the `resource` parameter on every authorization
  and token request, so the broker has to accept it and put it in `aud`.
- Authorization servers and clients **SHOULD** support Client ID Metadata
  Documents (CIMD): a client identifies itself with an HTTPS URL that serves
  its metadata, and the broker fetches it. Dynamic Client Registration (RFC
  7591) is **MAY**, and deprecated in favour of CIMD. Pre-registration remains
  valid and is what a broker without either needs.
- The broker **SHOULD** return `iss` on authorization responses (RFC 9207).

### How each caller gets its token

| Caller | Grant | What sqlib sees |
| --- | --- | --- |
| Person in the browser | Authorization code with PKCE. The SPA is a public client with no secret. | A `user` principal plus its group principals. |
| MCP client | The client discovers the broker from sqlib's protected-resource metadata, registers itself dynamically, and runs the same code flow in the user's browser. | The person's principal. The client holds nothing of its own. |
| Unattended application acting as itself | Client credentials. A confidential client with a secret or a private key. | A `client` principal, granted modes like any other. `principals.ts` already classifies a token whose `azp` equals its `sub` this way. |
| Application acting for a signed-in person | Token exchange (RFC 8693). The application swaps the person's token for one addressed to sqlib. | The person's principal. The application cannot exceed what the person may do. |

The fourth row is the one to insist on when an application fronts sqlib for
people. The shortcut, one person's long-lived token shared by an application,
cannot be rotated without that person and leaves the audit log unable to tell
the application from the person.

### The broker is not in the data path

Traffic through the broker is the sign-in and the token steps, and nothing
else:

1. The browser is redirected to the broker, and from there to Google, GitHub or
   whichever source the person picks. The broker redirects back with a token for
   sqlib's audience.
2. Every API call goes straight from the caller to sqlib with that token.
3. sqlib verifies the token with the broker's public key set, fetched once and
   cached for ten minutes (`createRemoteJWKSet` in `tokenVerifier.ts`). There is
   no per-request call to the broker.
4. The caller refreshes its token at the broker once per token lifetime, in the
   background.

A broker outage therefore stops new sign-ins and nothing else: callers with a
token keep working until it expires, and sqlib keeps verifying against the
cached keys. Query execution, MCP traffic and results never touch the broker.

### Where authorization lives

In sqlib, and only in sqlib. The broker supplies identity and, at most, coarse
group membership through one claim that `SQLIB_AUTH_CLAIM_GROUPS` names.
Library and backend grants are sqlib's domain model and stay in sqlib's auth
graph, keyed on the stable subject the broker issues. Pushing sqlib's modes into
broker roles is the common long-term mistake: it couples every grant change to
an identity-administration process and makes "who can execute against this
backend" unanswerable from sqlib's own audit log.

Account linking is the broker's job for the same reason in reverse. A person
who signs in with Google today and GitHub tomorrow is one subject at the
broker, so sqlib's grants follow them. Without a broker, sqlib would have to
build that itself.

## Why not the alternatives

**A backend-for-frontend.** The API becomes a confidential OAuth client, does
the code exchange server-side and holds a cookie session. It is the right
answer for a browser-only application, and it is what a Nuxt module such as
`nuxt-oidc-auth` implements. It is wrong here on three counts. The web build is
`ssr: false` and static-deployable, and those modules require a Nuxt server.
MCP clients and unattended applications still need bearer tokens, so a token
issuer runs beside the session store and there are two auth systems. And
sqlib's "never holds a client secret" property is lost for no gain.

**Social logins wired into sqlib directly.** GitHub never fits, Google needs
ID-token verification as a special case, each provider's quirks leak into the
app, and account linking becomes sqlib's problem. The identity differences
between providers are real and large; the broker is the one place where they
are somebody else's product.

**Accepting ID tokens per issuer.** A small change: a per-issuer flag so the
SPA sends `id_token` for Google and the API verifies it against the client id.
It serves Google and nothing else, and it mixes two token kinds into one
verification path. Rejected in favour of the broker, which covers the same case
with no code.

**sqlib as its own identity provider.** Passwords, resets, multi-factor
authentication and federation are a product in themselves. The resource-server
position is the explicit refusal of that product, and it stands.

**An authorization server embedded in the sqlib process.** Considered
seriously, because it is the one-container story and it is the Node option.
Better Auth (MIT, 30k stars) has an `mcp` plugin that targets the 2026-07-28
profile: protected-resource metadata, CIMD, JWT access tokens bound to a
`resource`, client credentials, Google, GitHub and Microsoft sign-in built in,
generic OIDC and SAML through its SSO plugin, and account linking. It mounts on
Fastify as one catch-all route, and the MCP specification allows the
authorization server to be hosted with the resource server. Because sqlib's
verifier only sees an issuer URL and a key set, it could point at itself with
no change to enforcement. Deferred, not rejected, for three reasons that are
posture rather than code: sqlib would hold the Google and GitHub client
secrets, user sessions and a login page, which is the identity-provider role
the previous paragraph refuses; its OAuth provider and MCP plugins carried
three CVEs in 2026, two rated critical, so auth fixes would ride sqlib's
release train; and it needs a SQL store (a SQLite file for one instance,
Postgres for more) that sqlib does not have. If the one-container story proves
to matter commercially, build it as a separate optional package behind the
same seam. Nothing in this design has to change for that.

## Broker requirements and candidates

A broker qualifies when it has all of:

- OpenID Connect discovery and a JWKS endpoint, with asymmetric signing.
- Resource indicators (RFC 8707), or at least a configurable audience, so a
  token can name sqlib in `aud`.
- Identity brokering to Google, GitHub, Entra ID and a generic OIDC provider
  (for AAF).
- Authorization code with PKCE for public clients, client credentials for
  confidential ones, token exchange for on-behalf-of calls.
- CIMD, or failing that dynamic client registration, so MCP clients can
  register themselves. Without either, every MCP client is a manual
  registration at the broker, which is workable for a known set of clients.
- A group or role claim that one dot-path can name.

### Survey, October 2026

| Broker | Form | Database | Google, GitHub, generic OIDC | MCP 2026-07-28 readiness | Verdict |
| --- | --- | --- | --- | --- | --- |
| Rauthy 0.37 | Rust, one container, about 60 MB RAM, Apache-2.0 | Embedded (Hiqlite); Postgres optional | GitHub has a template; others are configured as generic OIDC. Upstream providers are marked beta. | CIMD advertised since 0.35.2, RFC 8707 since 0.36.0, token exchange since 0.36.1, dynamic registration, client credentials. | **Reference broker.** Smallest clean answer that already does the MCP work. |
| Keycloak 26.8 | Java, about 750 MB to 2 GB, a few seconds to start with an optimised build | Postgres | All, mature | Its own compliance table says "experimental" for 2026-07-28: CIMD and resource indicators each sit behind a feature flag. | Works. Heavy. For deployments that already run it. |
| Zitadel v4 | Go, now two containers (core plus login UI) | Postgres | All | Dynamic registration off by default; registered apps do not get JWT tokens by default. | Not lighter than it looks. |
| Dex | Go, small | SQLite, Postgres, etcd | All, federation only | No CIMD, no dynamic registration, client credentials behind a flag. | Fine on Kubernetes. Weak for MCP clients. |
| Auth0 | Hosted | n/a | All | Full. | No functional gap. Priced per active user, with sharp steps. |
| Entra External ID | Hosted (Azure) | n/a | Google, Facebook, Apple, generic OIDC. **No GitHub.** | No dynamic registration or CIMD; MCP clients are pre-registered. | The zero-cost choice on Azure. |
| Cognito user pool | Hosted (AWS) | n/a | Google, Facebook, Amazon, Apple, generic OIDC, SAML. **No GitHub.** | No dynamic registration, no token exchange. Access tokens carry `client_id`, not `aud`, so sqlib runs with `SQLIB_AUTH_AUDIENCE_UNCHECKED` and a custom scope. | Only if already on AWS. |
| Authelia, Pocket ID | Go, tiny | SQLite | Neither accepts an upstream provider. | n/a | Not brokers. |
| Logto | Node | Postgres; official sizing asks for 8 GiB | All | Not checked | Not small. |

Two Rauthy details matter to sqlib. Client-credentials tokens have a null
`sub` unless `client_credentials_map_sub` is set, and `principals.ts` requires
a subject, so the realm sets it. And resource indicators are denied by default
per client (`allowed_resources`), so the SPA client and every machine client
list sqlib's resource identifier.

### Cost, per month, small deployment

List prices, October 2026. The self-hosted figures are compute only.

| Option | Cost | Note |
| --- | --- | --- |
| Entra External ID | $0 up to 50,000 monthly active users | About $0.03 per user beyond that; third-party figure, not confirmed on Microsoft's page. |
| Cognito | $0 up to 10,000 monthly active users, but only 50 for users arriving by OIDC or SAML federation | Then $0.0055 (Lite) or $0.015 (Essentials) per user. Entra and AAF users are federated users. |
| Auth0 | $0 up to 25,000 monthly active users | A custom login domain needs a paid plan, from $35 (B2C) or $150 (B2B). |
| Zitadel Cloud | $0 up to 100 daily active users | Pro $100 for 25,000 daily active users. |
| Rauthy on Azure Container Apps, 0.25 vCPU, 0.5 GiB | About $3 to $6 with one replica mostly idle; about $20 if busy all month; $0 while scaled to zero | Azure bills an idle replica at roughly an eighth of the active vCPU rate. The embedded database needs a persistent volume, a dollar or two more. |
| Rauthy on AWS Fargate, same size | About $9 | Plus a load balancer if there is not one already. |
| Keycloak, 1 vCPU, 2 GiB, plus the smallest managed Postgres | About $80 plus $12 to $15 on Azure; about $38 plus $13 on AWS | Five times Rauthy for no gain at this scale. |

Scale to zero is possible with Rauthy because it starts in about a second;
the platform cold start is the several seconds that count. What wakes it is a
sign-in, a token refresh, sqlib's key-set fetch (at most once per ten minutes,
and only on an unseen key), or a machine client fetching a token. The one
place a cold broker touches sqlib is that key-set fetch: if it times out, that
request gets a 503. One replica, which the idle rate makes nearly free, avoids
both that and a cold start on sign-in. Zero replicas is for a demo or a
single-user instance.

### Identity sources versus brokers

The names people reach for play two different roles, and only one of them can
be the broker. An **identity source** is where a person proves who they are;
the broker federates to it. The **broker** is what mints the token for sqlib's
audience and what MCP clients and machines talk to. Google, Facebook and GitHub
are sources only: none offers a custom audience, brokering to other sources,
or client credentials for a third-party API, and GitHub is not OIDC at all.
Everything in the survey table above is a broker, and each can also be a
source for another broker.

Two deployment facts to state in the deployment guide so nobody discovers them
after registering a tenant: GitHub sign-in needs Rauthy, Keycloak or Auth0,
not Entra External ID or Cognito; and self-registering MCP clients need CIMD
or dynamic registration, which the two cloud services lack. Where a chosen
broker supports a direct-to-source hint (`idp_hint` on Rauthy, `kc_idp_hint`
on Keycloak, `connection` on Auth0), the SPA can show its own "sign in with
Google" button and skip the broker's picker.

## What changes in sqlib, in order

The resource-server half exists. The work is at the edges. Each item below is
one deliverable with its own acceptance check, in the order to do them. None
of them changes the enforcement layer (`enforce.ts`, `entityGuard.ts`,
`executionScope.ts`, the grant store); a change there is out of scope for this
design and should be questioned.

1. **Protected-resource metadata and the 401 challenge.**
   Serve `GET /.well-known/oauth-protected-resource` (and the path-suffixed
   form RFC 9728 allows for `/mcp`) with `resource` set to a new
   `SQLIB_AUTH_RESOURCE` setting, `authorization_servers` listing the
   configured issuers, `bearer_methods_supported: ["header"]`, and
   `scopes_supported`. Add `resource_metadata="<that URL>"` to the
   `WWW-Authenticate` header the auth plugin already sends on a 401, and a
   `scope` parameter if sqlib defines scopes. `SQLIB_AUTH_RESOURCE` defaults to
   the audience when unset, since for an MCP client they are the same value.
   Public in every mode, like `/health`. Files:
   `packages/api/src/auth/plugin.ts`, `packages/api/src/auth/config.ts`,
   `packages/api/src/server/registerRoutes.ts`, and
   `packages/mcp-server/src/http-server.ts` for the standalone MCP transport.
   Accept: a test under `packages/api/test/auth/` that mounts the real plugin
   under `required` and asserts the document's fields and the header on a
   tokenless `/mcp` request; `docs/guides/mcp-clients.md` shows connecting
   Claude with no manual client configuration.

2. **Rauthy compose profile and realm.**
   A `rauthy` service in the compose files beside the existing ones, with a
   persistent volume for its embedded database, and a checked-in
   configuration that defines: the resource identifier and audience; a public
   PKCE client for the SPA with redirect `<origin>/auth/callback`; one
   confidential machine client with `client_credentials_map_sub` on; CIMD and
   `allowed_resources` enabled for ephemeral clients; and upstream provider
   placeholders for Google, GitHub, Entra and a generic OIDC entry for AAF.
   Secrets come from `.env`, never from the checked-in file. Accept: on a
   clean checkout, `docker compose --profile auth up` plus
   `SQLIB_AUTH_MODE=required` lets a person sign in through the SPA and run a
   query, and a machine client gets a token and calls `/auth/me` as a `client`
   principal.

3. **The SPA reads the authorization server from the metadata.**
   Today the SPA takes issuer, client id, audience and scope from
   `config.json`. Have it read `/.well-known/oauth-protected-resource` first
   and take the issuer and resource from it, keeping only `authClientId` and
   `authScope` in its own configuration; the explicit `authIssuer` stays as an
   override. Pass `resource` on the authorization and token requests
   (`oidc-client-ts` supports it as an extra parameter). Accept: a deployment
   whose `config.json` sets only the client id signs in against the broker
   named by the API. Files: `packages/web/src/composables/useAuth.ts`,
   `packages/web/src/plugins/runtime-config.client.ts`,
   `docs/reference/configuration.md`.

4. **Deployment guide: one broker, four configurations.**
   In `docs/guides/deploying.md`, the three sqlib settings side by side for
   Rauthy (from item 2), Entra External ID, Cognito, and a customer's own
   Keycloak or Entra workforce tenant, each with the `SQLIB_AUTH_CLAIM_GROUPS`
   value and any audience caveat (`roles` or `groups` for Entra,
   `cognito:groups` plus `SQLIB_AUTH_AUDIENCE_UNCHECKED` for Cognito,
   `eduperson_entitlement` or `eduperson_scoped_affiliation` for AAF). State
   the two capability facts from "Identity sources versus brokers" plainly.
   Add the free-tier line: self-hosters get the full auth stack and bring
   their own broker. Accept: a reader can pick a broker and fill in the three
   settings without reading this page.

5. **Browser token storage.**
   `oidc-client-ts` keeps the user in `localStorage`. Move to in-memory
   storage with refresh-token rotation (`offline_access`, with the broker
   configured to rotate). A hardening step; the flow does not change. Confirm
   silent renew against Rauthy before switching. Accept: no token in
   `localStorage` after sign-in; a reload re-establishes the session through
   refresh without a redirect where the broker allows it.

6. **Nothing for unattended callers.** Client principals, grants on them and
   the `client` token type already exist. Token exchange is entirely the
   broker's. Verify, do not build: the compose profile's machine client is the
   check.

Multiple issuers (`SQLIB_AUTH_ISSUERS_JSON`) stay supported. A deployment where
a partner's Entra tenant already mints tokens with a sqlib audience can trust
that tenant directly beside the broker, at the cost of one more issuer to
administer; the metadata document then lists both. The SPA, however, signs in
against one issuer; the broker is the one that gives people a choice of
provider.

## Operating it

- **Token lifetimes.** Access tokens of five to sixty minutes; refresh tokens
  rotated on use. Shorter access tokens cost one broker round trip per
  lifetime per caller and nothing at sqlib.
- **Key rotation.** The broker rotates signing keys; sqlib picks the new key up
  on the next unknown `kid`, rate-limited to one refetch per thirty seconds.
  No restart, no configuration change.
- **Credential rotation for machines.** Prefer a private-key JWT over a client
  secret. Either way the rotation is at the broker and sqlib holds nothing.
- **Caching in unattended callers.** One token request per lifetime, not per
  call. A caller that fetches a token per request is a load problem for the
  broker, not for sqlib.
- **Outage.** Broker down: no new sign-ins, everything with a token continues.
  JWKS unreachable on a cold start: sqlib answers 503, not 401, because the
  failure is the server's.

## Free and paid

Authentication stays in core and ships free. It is not a module, and it is not
a paid feature. Two reasons are structural and one is commercial.

It is cross-cutting: an `onRequest` hook, a guard on every entity route plugin,
a scope on every executor. A feature that can be absent has to be designed so
that nothing breaks when it is absent, and "an enforcement point missing in one
configuration" is the exact failure the three-mode design exists to prevent.

It is the security property, and the MCP specification's precondition. Gating
it means the free product runs open and cannot be a compliant MCP server.

And it does not gate the real cost. The labour is the broker, the registrations
at each provider, claim mapping and identity operations, all of which sit
outside sqlib's code whichever way it is licensed. That labour is the service,
and it belongs to the hosted offer:

| Free, in the repository | Paid, in the hosted deployment |
| --- | --- |
| Verification, principals, grants, audit, the three modes | sqlib and its store run, backed up, upgraded, under an SLA |
| The compose profile with a broker, and the setup guide | The broker run for the customer, with their providers registered and tested |
| Protected-resource metadata for MCP | A dedicated issuer and audience per customer; tenant isolation |
| | Audit retention, grant administration, onboarding of a customer's own identity provider |

Self-hosters get the full auth stack and bring their own broker. That sentence
is the free-tier line and should appear in the deployment guide.

## Open decisions

1. **The licence.** The repository's licence is review and evaluation only.
   "Free" above is only true in writing once the core carries a licence that
   says so.
2. **Rauthy's upstream providers are beta.** GitHub has a template and was
   the only one documented when surveyed. Item 2 above must include a real
   Google login and, when a registration is available, a real AAF login
   against the test federation, and record the date each was verified. If
   either fails, Keycloak is the fallback reference broker and the compose
   profile grows a Postgres.
3. **Browser token storage.** In-memory with refresh rotation is proposed;
   confirm `oidc-client-ts` silent renew behaves against Rauthy before
   switching.
4. **The resource identifier.** The value of `aud` and of the metadata
   document's `resource` field. The canonical URL of the deployment's `/mcp`
   endpoint is the usual choice (the MCP specification's canonical-URI rules
   apply), and it has to be decided before any client is registered.
5. **The embedded option.** Whether a one-container deployment matters enough
   commercially to build the embedded Better Auth package described under
   "Why not the alternatives". Not before items 1 to 4 ship.

## Appendix: where the code's section citations point

The code cites the original note by section. Until the comments are updated,
this is the mapping.

| Citation | Topic | Where it is now |
| --- | --- | --- |
| §3, §3.1 | Auth plugin, token verification | `auth/plugin.ts`, `auth/tokenVerifier.ts`; "The constraint that decides it" above; security-model "What is verified" |
| §3.2 | Principal canonicalisation | `auth/principals.ts`; security-model "What is verified" |
| §4.2, §4.4, §4.5 | Modes vocabulary, grant resolution, the authenticated sentinel | `auth/vocabulary.ts`, `auth/grants.ts`; security-model "What is authorized" |
| §4.3 | Curated backends and escalation | `auth/executionScope.ts`, `auth/enforce.ts`; security-model "The caller-authorization model" |
| §5, §5.4 | AuthStore, bootstrap | `auth/AuthStore.ts`, `auth/bootstrap.ts` |
| §6 | `/auth` routes | `routes/auth.ts` |
| §7, §7.1, §7.2 | Enforcement, entity guard, execution scope | `auth/enforce.ts`, `auth/entityGuard.ts`, `auth/executionScope.ts`; architecture "The request path" |
| §8.1 | The SPA's sign-in | `packages/web/src/composables/useAuth.ts`; "How each caller gets its token" above |
| §9 | Audit | `auth/audit.ts` |
| §10 | Configuration | `auth/config.ts`; reference/configuration "Authentication" |

## Related

- [explanation/security-model.md](../explanation/security-model.md) — what is
  enforced today and what is not.
- [reference/configuration.md](../reference/configuration.md#authentication) —
  every `SQLIB_AUTH_*` variable.
- [guides/deploying.md](../guides/deploying.md) — running the image with auth
  on.
- [guides/mcp-clients.md](../guides/mcp-clients.md) — connecting an MCP client
  to `/mcp`.
- [design/assistant-surfaces.md](assistant-surfaces.md) — the other place a
  credential decides the architecture.
- [MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
  [Rauthy](https://github.com/sebadob/rauthy),
  [Keycloak as an MCP authorization server](https://www.keycloak.org/securing-apps/mcp-authz-server),
  [Better Auth MCP plugin](https://better-auth.com/docs/plugins/mcp) — the
  external sources the survey rests on.
