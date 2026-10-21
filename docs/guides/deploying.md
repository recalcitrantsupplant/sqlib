# Deploying the server image and the web UI

A deployment has two parts: one container image serving the API and the MCP
endpoint, and a static build of the web UI served from anywhere that serves
files. The web build is published as an image too — as a
[bundle to copy out](#the-bundle-image), not as something to run. They are independent — the UI is configured at load time with the URL of
whichever API it should talk to.

Read [before you expose it](#before-you-expose-it) before putting either on a
network you do not control. The defaults are development defaults.

## The published image

`.github/workflows/publish-image.yml` builds the repository-root `Dockerfile`
and pushes to GHCR (in a second job it does the same for `Dockerfile.web`, the
UI bundle described below), authenticating with the workflow's own `GITHUB_TOKEN`
(`packages: write`); no registry secret is configured. The image reference
defaults to `ghcr.io/<repository owner, lower-cased>/sqlib` — named for the
repository — and can be overridden with the `IMAGE` environment variable.

`scripts/ci/docker-build-push.sh` decides the tags:

| Tag | When |
| --- | --- |
| `sha-<first 12 characters of the commit sha>` | always |
| `latest` | when the ref being built is the trunk branch |
| `<X.Y.Z>` | when building a `vX.Y.Z` git tag, or when `RELEASE_VERSION` is set |

So a push to the trunk branch publishes `sha-…` and `latest`; pushing a
`v0.1.0` tag publishes `0.1.0`; and running the workflow manually with a version
input publishes `0.1.0` and also creates the git tag and a GitHub Release.

The same script builds without pushing when `PUSH` is not `true`, which is what
running it locally does. `just build-docker TAG` is the shorter route to a local
image.

One image serves every runtime mode. `APP_MODE` selects:

| `APP_MODE` | Serves | Port |
| --- | --- | --- |
| `dual-http` (image default) | REST API and MCP at `/mcp` | `HTTP_PORT`, default 3000 |
| `api` | REST API only | `PORT`, default 3000 |
| `mcp-http` | MCP only | `MCP_HTTP_PORT`, default 3333 |

## Running the image

```bash
docker run -p 3000:3000 \
  -e APP_MODE=dual-http \
  -e INTERNAL_BACKEND_TYPE=oxigraph-persistent \
  -e LIBRARY_STORAGE_DIR=/app/packages/api/storage/library-store \
  -e INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS=60000 \
  -v sqlib-storage:/app/packages/api/storage \
  <image>:<tag>
```

`/app/packages/api/storage` is declared as a volume and created in the image
owned by `node` (uid 1000), so a fresh Docker volume is writable. A host bind
mount, or a named volume seeded by an older image, keeps the ownership it
already has and must be chowned to `1000:1000` — otherwise the first write
fails with `EACCES`.

Choosing where the library lives, and what queries execute against, is covered
in [running and configuring](running-and-configuring.md). For a store larger
than a few million triples, or where losing the writes since the last
checkpoint is unacceptable, run a SPARQL server and set
`INTERNAL_BACKEND_TYPE=http`.

The image is built on Debian rather than Alpine, deliberately: DuckDB community
extensions — which ETL loads — are not published for musl at the DuckDB version
this repository runs. The image build asserts its own libc and fails if that
ever changes.

## The web UI

`packages/web` is a Nuxt 4 application with `ssr: false`.
`pnpm --filter @sparql-query-lib/web generate` produces a static site under the
package's Nuxt output directory, which any static host can serve.
`nuxt build` instead produces a Nitro server, which is the right output only if
you intend to run Node in front of the files.

### The bundle image

The same static build is also published as a container image,
`ghcr.io/<owner>/sqlib-web`, tagged in step with the server image
(`sha-<short>` on every trunk push, `latest` on trunk, `X.Y.Z` on a release).

It is a carrier, not a runtime. There is no server in it: the files sit at
`/site` on a busybox base, and the image exists so that a particular build of
the UI has a name you can pin, pull, diff and roll back to — `sqlib-web:0.4.1`
rather than "the zip somebody built on their laptop". A deployment pipeline
that already knows how to pull images needs nothing new to fetch a UI build.

Three ways to get the files out:

```sh
# Copy them out of a container that is never started
id=$(docker create ghcr.io/<owner>/sqlib-web:<tag>)
docker cp "$id":/site ./dist && docker rm "$id"

# Stream them out
docker run --rm ghcr.io/<owner>/sqlib-web:<tag> tar -C /site -cf - . | tar -xf - -C ./dist

# Use it as a stage in another image
COPY --from=ghcr.io/<owner>/sqlib-web:<tag> /site /usr/share/nginx/html
```

`./dist` is then what you upload — `swa deploy ./dist`, `az storage blob upload-batch`,
`aws s3 sync`, an nginx image, whatever the host takes. Locally,
`just build-web-image <tag>` builds it and `just extract-web-bundle <tag> <dest>`
runs the first recipe above.

`docker run` with no command prints those recipes and the contents of
`/bundle-info.json`, which records the version, the commit and the build time —
the same values as the image's OCI labels, kept as a file because the labels do
not survive `docker cp`.

Nothing environment-specific is baked in. The bundle is built with no
`NUXT_PUBLIC_*` values set, so one image serves every environment and the
deployment supplies `/config.json` beside `index.html`, as below.

The one exception is the path the site is served from. Nuxt writes it into
every page's asset links when the bundle is generated, so the published image
works only at the root of a host. To serve the UI under a path on a site that
belongs to something else, build the bundle for that path:

```sh
docker build -f Dockerfile.web --build-arg NUXT_APP_BASE_URL=/dev-console/sqlib/ -t sqlib-web:dev-console .
```

That bundle works at `/dev-console/sqlib/` and nowhere else. It reads its
`config.json` from beside its own `index.html`, at
`/dev-console/sqlib/config.json`, and its sign-in callback is
`/dev-console/sqlib/auth/callback`, which is the redirect URI to register with
the identity provider. The host's SPA fallback for a record link is then that
path's `200.html`.

A host that serves a directory of files serves this unchanged: `nuxt generate`
prerenders an `index.html` per page and per workspace section (`/queries`,
`/rules`, `/backends`, …), so those links resolve without a rewrite rule. A
link to one record — `/queries/<id>` — carries the record's id and cannot be
prerendered, so it needs the host's SPA fallback: serve `200.html` for a path
with no file (nginx: `try_files $uri $uri/ /200.html;`; Azure Static Web Apps:
`navigationFallback` in `staticwebapp.config.json`, which the deployment adds
beside `/config.json` — it is deployment configuration, not part of the
bundle). A host with no fallback rule at all serves `404.html` for such a path,
which loads the app all the same, with a 404 status.

### Runtime configuration through `/config.json`

The build bakes in defaults from `NUXT_PUBLIC_*` variables — `apiBaseUrl`
defaults to `http://localhost:3000` — but a client-side plugin
(`packages/web/src/plugins/runtime-config.client.ts`) fetches `/config.json`
before the app starts and overrides them. That is what lets one build serve
several environments.

```json
{
  "apiBaseUrl": "https://api.example.org",
  "featureFlags": { "etl": false, "assistant": false },
  "authClientId": "sqlib-web",
  "authScope": "openid profile email",
  "authTokenStorage": "memory",
  "authRequireLogin": false
}
```

The recognised keys are `apiBaseUrl`, `featureFlags` (merged over the built-in
flags, so a partial object is fine), the OIDC settings (`authIssuer`,
`authClientId`, `authAudience`, `authScope`, `authTokenStorage`), and
`authRequireLogin`. Against an API with auth on, `authClientId` is the only
OIDC setting the file needs: the app reads the issuer and the resource from
the API's protected-resource metadata, and sends `resource` on its
authorization request and code exchange. `authIssuer` overrides the issuer the API
names. `authAudience` is sent as an `audience` parameter, for a broker that
wants one. `authTokenStorage` is `memory` by default; see
[configuration](../reference/configuration.md#the-web-application). The file is not in the repository: the deployment places it
beside `index.html`.

The UI signs in only when the API's `/health` reports an enforcing auth mode.
`authRequireLogin: true` makes it sign in whatever the API reports. That is for
an API whose authentication is done by a gateway in front of it: the API runs
`SQLIB_AUTH_MODE=disabled`, the gateway refuses a request without a valid bearer
token, and the UI gets a token from the OIDC settings above and sends it on
every request. The gateway has to let `/health` through without a token, or the
UI cannot read the API's mode. A missing file, a non-2xx response, or a response that is not
`application/json` leaves the build-time defaults in place and logs a warning to
the browser console — so a typo in the path degrades to "the UI talks to
`localhost`" rather than to a blank page.

Host-level application settings are not a substitute. A static site's server
settings never reach a client-side bundle; `/config.json` is a file the browser
fetches, which is why it works.

The flags a UI shows and the flags its API serves are set independently. A UI
whose flags exceed its API's will draw sections whose routes are unregistered.

## One worked deployment example

`infrastructure/` holds generic Bicep templates for one way to host the two
parts on Azure. They are an example, not the recommended path — the image runs
anywhere a container runs, and the UI anywhere static files are served.

- `main.bicep` deploys the image to Azure Container Apps: a Log Analytics
  workspace, a Container App environment (or an existing one), and a Container
  App with external HTTPS ingress. Its parameters cover the registry login,
  image name and tag, `targetPort` (default 3000), CPU and memory (default 0.5
  cores, 1.0 GB), and arrays of environment variables and secrets — an
  environment variable references a secret by `secretRef`. It outputs the
  application URL.
- `swa.bicep` deploys the UI to Azure Static Web Apps and sets application
  settings. Those settings do not reach the browser, so `/config.json` above is
  still what points the SPA at its API.
- `main.parameters.example.json` and `swa.parameters.example.json` are the
  shapes to copy. A real parameters file contains registry passwords and
  backend credentials; keep it out of version control.

## Authentication: one broker in front

sqlib is a resource server. It verifies a JWT access token and never signs
anyone in. The sign-in, the identity providers and the tokens come from one
authorization server (the "broker") that the deployment chooses.
[The auth design](../design/auth-architecture.md) says why.

Self-hosters get the full auth stack and bring their own broker.

### What sqlib needs from the broker

Three settings, whichever broker it is:

1. `SQLIB_AUTH_ISSUER`: the broker's issuer URL, exactly as tokens carry it in
   `iss`. sqlib finds the keys through the issuer's OIDC discovery document.
2. `SQLIB_AUTH_AUDIENCE`: the value the broker puts in `aud` for sqlib. Set
   `SQLIB_AUTH_RESOURCE` to the same value: the canonical URL of `/mcp`, for
   example `https://sqlib.example.org/mcp`. MCP clients ask for a token for
   that value.
3. `SQLIB_AUTH_CLAIM_GROUPS`: the dot-path to the claim with group or role
   membership.

The SPA needs one more value, the client id the broker gave it
(`authClientId` in `/config.json`). Register `<SPA origin>/auth/callback` as
its redirect URL.

### Choosing a broker

Two facts decide most choices:

- **GitHub sign-in needs Rauthy, Keycloak or Auth0.** Entra External ID and
  Cognito cannot federate to GitHub.
- **Self-registering MCP clients need CIMD or dynamic client registration.**
  Rauthy, Keycloak (behind feature flags) and Auth0 have them. Entra External
  ID and Cognito have neither, so each MCP client must be registered by hand,
  and the person connecting it must enter that client id.

| Broker | `SQLIB_AUTH_ISSUER` | `SQLIB_AUTH_AUDIENCE` | `SQLIB_AUTH_CLAIM_GROUPS` | Caveats |
| --- | --- | --- | --- | --- |
| Rauthy (reference; [the compose profile](#the-local-auth-profile)) | `https://<host>/auth/v1/` | The resource, listed in each client's `allowed_resources` and `default_aud` | `groups` (the client must allow the `groups` scope) | Signs with EdDSA by default; sqlib accepts it. Turn on `client_credentials_map_sub`, or machine tokens have no `sub`. |
| Entra External ID | `https://<tenant id>.ciamlogin.com/<tenant id>/v2.0` | The API's application ID URI | `roles` (app roles) or `groups` | No GitHub. No CIMD or dynamic registration. |
| Cognito user pool | `https://cognito-idp.<region>.amazonaws.com/<pool id>` | Unset, with `SQLIB_AUTH_AUDIENCE_UNCHECKED=true` | `cognito:groups` | Access tokens carry `client_id`, not `aud`; restrict access with a custom scope. No GitHub, no dynamic registration, no token exchange. Only 50 free federated users. |
| A customer's Keycloak | `https://<host>/realms/<realm>` | The client scope's audience mapper value | `realm_access.roles`, or `groups` with a group mapper | Turn on the CIMD and resource-indicator feature flags for MCP clients. |
| A customer's Entra workforce tenant | `https://login.microsoftonline.com/<tenant id>/v2.0` | The API's application ID URI | `roles` or `groups` | Request v2 access tokens (`accessTokenAcceptedVersion: 2`) so `iss` matches. |

AAF is an identity source, not a broker: federate the broker to it as a
generic OIDC provider. Use `eduperson_entitlement` or
`eduperson_scoped_affiliation` as the group claim if the broker passes it
through.

A partner whose Entra tenant already mints tokens with sqlib's audience can be
trusted directly beside the broker, with `SQLIB_AUTH_ISSUERS_JSON`. The
protected-resource metadata then lists both issuers. The SPA signs in against
the first one.

### Machines and applications

- **An application acting as itself** uses the client-credentials grant with
  its own confidential client. sqlib sees a `client` principal, which you grant
  modes like any other. Cache the token for its lifetime; do not fetch one per
  call.
- **An application acting for a signed-in person** uses token exchange
  (RFC 8693) at the broker, and calls sqlib with the exchanged token. sqlib sees
  the person. Do not share one person's long-lived token with an application.

### The local auth profile

`docker-compose.mcp-https-image.yml` has an `auth` profile: Rauthy 0.37.2 on
`http://localhost:8080`, and a one-shot `rauthy-setup` service that configures
it through Rauthy's admin API (`rauthy/setup.sh`). It is for trying the full
stack on one machine. It uses plain HTTP and an insecure cookie mode, so do
not expose it.

1. Copy `.env.auth.example` to `.env`. Fill in the Rauthy secrets as its
   comments say.
2. Build the image (`docker build -t sparql-query-lib:aca-local .`) and make
   the certificates (`just setup-local-https`).
3. Start it:

   ```bash
   docker compose -f docker-compose.mcp-https-image.yml --profile auth up
   ```

4. Read the machine client's secret from the setup log. It is printed once,
   when the client is created:

   ```bash
   docker compose -f docker-compose.mcp-https-image.yml logs rauthy-setup
   ```

5. Run the SPA against it, with only the client id configured:

   ```bash
   NUXT_PUBLIC_API_BASE_URL=https://localhost:3443 \
   NUXT_PUBLIC_AUTH_CLIENT_ID=sqlib-web \
   NUXT_PUBLIC_AUTH_SCOPE="openid profile email groups" \
   pnpm --filter @sparql-query-lib/web dev
   ```

6. Open `http://localhost:3001` and sign in as `admin@localhost` with
   `RAUTHY_ADMIN_PASSWORD`. Rauthy puts that user in the `admin` group, which
   `.env.auth.example` makes a sqlib administrator.

`rauthy-setup` defines:

- `sqlib-web`: a public client with PKCE, refresh tokens and RS256, and the
  resource in `allowed_resources` and `default_aud`.
- `sqlib-machine`: a confidential client for client credentials and token
  exchange, with the same audience. Get a token with the secret in the request
  body:

  ```bash
  curl -d grant_type=client_credentials -d client_id=sqlib-machine \
    --data-urlencode client_secret=<secret> \
    -d resource=https://localhost:3443/mcp \
    http://localhost:8080/auth/v1/oidc/token
  ```

- One upstream provider for each of Google, GitHub, Entra ID and AAF whose
  client id is set in `.env`. Register
  `http://localhost:8080/auth/v1/providers/callback` as the redirect URL at the
  provider.

Rauthy also has CIMD and dynamic client registration on, with the resource
allowed, so an MCP client can connect to `https://localhost:3443/mcp` with no
configuration.

The setup is safe to run again (`docker compose -f
docker-compose.mcp-https-image.yml run --rm rauthy-setup`): it updates the
clients and leaves existing providers alone. Rauthy reads the API key
definition only when it first creates its database. To start again, remove
the `rauthy-data` volume.

## Before you expose it

This repository is pre-1.0 and source-available for review (see `LICENSE`). No
release has been published. Settle each of the following before a deployment is
reachable by anyone but you.

**Authentication is off by default.** `SQLIB_AUTH_MODE` defaults to `disabled`,
which gives every request full access. `dry-run` validates tokens and logs what
would have happened without refusing anything; `required` refuses. An enforcing
mode needs at least one issuer — `SQLIB_AUTH_ISSUER` with `SQLIB_AUTH_AUDIENCE`,
or `SQLIB_AUTH_ISSUERS_JSON` for several — and refuses to start without one. It
also refuses an issuer with no audience, because without one any token that
issuer minted for any application would be accepted; set
`SQLIB_AUTH_AUDIENCE_UNCHECKED=true` only if that is really what you want.
`SQLIB_AUTH_ADMIN_PRINCIPALS` names the principals that are administrators at
boot. [Authentication: one broker in front](#authentication-one-broker-in-front)
says what to put in front.

**`/mcp` is unauthenticated in the default mode**, like the rest of the API, and
it is a complete tool surface over every library and backend on the server. If
the deployment serves `dual-http` or `mcp-http`, either enforce authentication
or do not publish that path. See [connecting an MCP client](mcp-clients.md).

**CORS allows no browser origin by default.** `SQLIB_CORS_ORIGINS` lists the
origins that may read the API and `/mcp` (comma-separated). Unset, a production
deployment allows none, which is what you want when the SPA and the API share an
origin; if the SPA is served from another one, list it. A listed origin gets
credentialed access; `*` allows every origin and never sends credentials. See
[configuration](../reference/configuration.md#server-and-transport).

**Check the feature flags.** `etl`, `playgroundEtl` and `assistant` default off
for stated reasons: ETL takes arbitrary DuckDB SQL, which is a host filesystem
read primitive and, with the httpfs extension, an outbound request primitive;
the assistant is unauthenticated, calls a paid provider, and can reach a
configured backend. Turning any of them on is a deliberate decision about what
the deployment's callers may do. `ruleTuples` is off because the extension it
enables is not conformant SHACL 1.2 Rules. The full list, with defaults, is in
[feature flags](../reference/feature-flags.md).

**Backend credentials are entity data.** A registered HTTP backend can carry a
username and password, and the library store holds them. Treat the store as
containing secrets: give it a volume with restricted access, and supply the
library's own endpoint credentials (`LIBRARY_STORAGE_SPARQL_USERNAME` /
`_PASSWORD`) through the platform's secret mechanism rather than a plain
environment variable.

**ETL output is a filesystem write.** If ETL is on, `ETL_OUTPUT_DIR` must exist
and be writable by uid 1000, and it accumulates one file per execution with no
retention policy. The server checks the directory at boot and logs the fix if it
is not writable, and
`pnpm --filter @sparql-query-lib/api smoke:storage` asks the same question
inside a container without booting the server.

**Persistence is a volume.** With `INTERNAL_BACKEND_TYPE=oxigraph-persistent`
the entire library is in the container's memory and on its disk. Without a
volume mounted at the storage path, everything is lost when the container is
replaced.

**Observability.** OpenTelemetry is initialised whenever the API is loaded, and
`OTEL_ENABLED` defaults to on. OTLP export happens only when
`NODE_ENV=development`, to `OTEL_EXPORTER_OTLP_ENDPOINT` (default
`http://localhost:4318`); otherwise traces and metrics go to the console. Set
`OTEL_ENABLED=false` if you want neither.

## Scaling to zero

An instance that is stopped when idle and started on the next request pays its
startup on that request, so startup stops being a deployment detail and becomes
latency someone waits for. The image is set up for this: response serialisers
compile on first use rather than at boot, the SPARQL grammars and the DuckDB
binding are built on first use, and a V8 compile cache ships in the image so the
first container to start is already warm. Turning off the
[feature flags](../reference/configuration.md#feature-flags) you do not serve and
setting `OTEL_ENABLED=false` are the two things left worth doing yourself; see
[startup time](../reference/configuration.md#startup-time).

Two things about the store matter more than any of that:

**An in-memory store is empty on every cold start.**
`INTERNAL_BACKEND_TYPE=oxigraph-memory` keeps nothing between runs, so a
scale-to-zero deployment that uses it comes back with an empty library every
time. Use `oxigraph-persistent` with the snapshot on a volume that survives the
container — it is the same in-memory Oxigraph, with a `.nq` snapshot restored at
boot and written on a timer. The restore is the one part of startup that grows
with your data: roughly one second per 180,000 quads.

**A container killed without warning loses everything since the last
checkpoint.** The snapshot is written every
`INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` (default 60s) and on `SIGTERM`. If
the platform stops idle instances by killing them, or its shutdown grace period
is shorter than the dump takes, up to a checkpoint interval of writes is gone.
Shorten the interval if writes matter, and check that your platform sends
`SIGTERM` and waits for the process to exit.
