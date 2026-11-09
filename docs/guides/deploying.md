# Deploying the server image and the web UI

A deployment has two parts:

- one container image that serves the API and the MCP endpoint;
- a static build of the web UI, which any file server can serve.

The web build is also published as an image, as a
[bundle to copy out](#the-bundle-image). The image does not run a server. The
two parts are independent. At load time, the UI reads the URL of the API that it
must use.

Read [before you expose it](#before-you-expose-it) before you put either part on
a network that you do not control. The defaults are for development.

## The published image

`.github/workflows/publish-image.yml` builds the `Dockerfile` at the root of the
repository, and pushes it to GHCR. A second job does the same for
`Dockerfile.web`, the UI bundle described below. The workflow authenticates with
its own `GITHUB_TOKEN` (`packages: write`), so no registry secret is configured.
The default image reference is `ghcr.io/<repository owner, lower-cased>/sqlib`.
The `IMAGE` environment variable overrides it.

`scripts/ci/docker-build-push.sh` decides the tags:

| Tag | When |
| --- | --- |
| `sha-<first 12 characters of the commit sha>` | always |
| `latest` | when the ref being built is the trunk branch |
| `<X.Y.Z>` | when building a `vX.Y.Z` git tag, or when `RELEASE_VERSION` is set |

For example:

- A push to the trunk branch publishes `sha-…` and `latest`.
- A push of the tag `v0.1.0` publishes `0.1.0`.
- A manual run of the workflow with a version input publishes `0.1.0`, and also
  makes the git tag and a GitHub Release.

When `PUSH` is not `true`, the script builds and does not push. A local run
does this. `just build-docker TAG` is a shorter way to build a local image.

One image serves each runtime mode. `APP_MODE` selects the mode:

| `APP_MODE` | Serves | Port |
| --- | --- | --- |
| `dual-http` (image default) | REST API and MCP at `/mcp` | `HTTP_PORT`, default 3000 |
| `api` | REST API only | `PORT`, default 3000 |
| `mcp-http` | MCP only | `MCP_HTTP_PORT`, default 3333 |

## Running the image

```bash
docker run -p 3000:3000 \
  -e APP_MODE=dual-http \
  -e LIBRARY_STORAGE_DIR=/app/packages/api/storage/library-store \
  -e SQLIB_AUTH_STORE_DIR=/app/packages/api/storage/auth \
  -v sqlib-storage:/app/packages/api/storage \
  <image>:<tag>
```

The library store is the default, `sqlite`: `library.sqlite` in
`LIBRARY_STORAGE_DIR`. With auth on, grants go to `auth.sqlite` in
`SQLIB_AUTH_STORE_DIR`. Set both directories to absolute paths on the volume.
Their defaults are relative to the working directory. In the `dual-http` and
`mcp-http` modes, the working directory is `/app/packages/mcp-server`, which is
not on the volume.

The image declares `/app/packages/api/storage` as a volume, and makes it with
the owner `node` (uid 1000). A new Docker volume is therefore writable. A host
bind mount, or a named volume from an older image, keeps its existing
ownership. Change its owner to `1000:1000`, or the first write fails with
`EACCES`.

[Running and configuring](running-and-configuring.md) tells you how to choose
where the library is stored, and what queries run against.
[Storage and caching](../explanation/storage-and-caching.md) compares the
options. For a library larger than the process memory, or one that more than one
sqlib instance writes, run a SPARQL server and set `INTERNAL_BACKEND_TYPE=http`.

The image is built on Debian. Alpine is not suitable, because DuckDB community
extensions, which ETL loads, are not published for musl at the DuckDB version of
this repository. The image build checks its own libc, and fails if it changes.

## The web UI

`packages/web` is a Nuxt 4 application with `ssr: false`.
`pnpm --filter @sparql-query-lib/web generate` makes a static site in the Nuxt
output directory of the package. Any static host can serve it. `nuxt build`
makes a Nitro server. Use it only if you will run Node in front of the files.

### The bundle image

The same static build is also published as a container image,
`ghcr.io/<owner>/sqlib-web`. Its tags follow the server image: `sha-<short>` on
each trunk push, `latest` on trunk, and `X.Y.Z` on a release.

The image only carries the files. It has no server: the files are at `/site` on
a busybox base. With the image, each build of the UI has a name that you can
pin, pull, compare and roll back to, for example `sqlib-web:0.4.1`. A deployment
pipeline that can pull images needs nothing new to fetch a UI build.

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

Then upload `./dist` with the tool that the host takes: `swa deploy ./dist`,
`az storage blob upload-batch`, `aws s3 sync`, or an nginx image. Locally,
`just build-web-image <tag>` builds the image, and
`just extract-web-bundle <tag> <dest>` runs the first recipe above.

`docker run` with no command prints those recipes and the contents of
`/bundle-info.json`. That file records the version, the commit and the build
time. These are the same values as the OCI labels of the image. They are also in
a file, because the labels are lost on `docker cp`.

The bundle contains no settings for an environment. It is built with no
`NUXT_PUBLIC_*` values, so one image serves each environment. The deployment
supplies `/config.json` next to `index.html`, as described below.

The one exception is the path that the site is served from. When Nuxt generates
the bundle, it writes this path into the asset links of each page. The published
image therefore works only at the root of a host. To serve the UI under a path
on a site that belongs to a different application, build the bundle for that
path:

```sh
docker build -f Dockerfile.web --build-arg NUXT_APP_BASE_URL=/dev-console/sqlib/ -t sqlib-web:dev-console .
```

That bundle works only at `/dev-console/sqlib/`:

- It reads `config.json` from next to its own `index.html`, at
  `/dev-console/sqlib/config.json`.
- Its sign-in callback is `/dev-console/sqlib/auth/callback`. Register this
  redirect URI with the identity provider.
- The SPA fallback of the host for a record link is `200.html` in that path.

A host that serves a directory of files serves the bundle with no change.
`nuxt generate` prerenders an `index.html` for each page and each workspace
section (`/queries`, `/rules`, `/backends`, …), so those links resolve without
a rewrite rule.

A link to one record, such as `/queries/<id>`, has the id of the record, and
cannot be prerendered. It needs the SPA fallback of the host: serve `200.html`
for a path with no file.

- nginx: `try_files $uri $uri/ /200.html;`
- Azure Static Web Apps: `navigationFallback` in `staticwebapp.config.json`.
  The deployment adds this file next to `/config.json`. It is deployment
  configuration, and is not part of the bundle.

A host with no fallback rule serves `404.html` for such a path. This page also
loads the app, with a 404 status.

### Runtime configuration through `/config.json`

The build includes defaults from the `NUXT_PUBLIC_*` variables. For example,
`apiBaseUrl` defaults to `http://localhost:3000`. Before the app starts, a
client-side plugin (`packages/web/src/plugins/runtime-config.client.ts`)
fetches `/config.json`, and its values override the defaults. One build can
therefore serve several environments.

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

The recognised keys:

- `apiBaseUrl`;
- `featureFlags`, merged over the built-in flags, so a partial object is
  correct;
- the OIDC settings: `authIssuer`, `authClientId`, `authAudience`, `authScope`
  and `authTokenStorage`;
- `authRequireLogin`.

Against an API with auth on, the file needs only one OIDC setting,
`authClientId`. The app reads the issuer and the resource from the
protected-resource metadata of the API. It sends `resource` on its
authorization request and its code exchange.

- `authIssuer` overrides the issuer that the API names.
- `authAudience` is sent as an `audience` parameter, for a broker that needs
  one.
- `authTokenStorage` is `memory` by default. See
  [configuration](../reference/configuration.md#the-web-application).

The file is not in the repository. The deployment puts it next to `index.html`.

The UI signs in only when `/health` of the API reports an enforcing auth mode.
With `authRequireLogin: true`, the UI always signs in. Use this for an API
behind a gateway that does the authentication:

- The API runs with `SQLIB_AUTH_MODE=disabled`.
- The gateway refuses a request without a valid bearer token.
- The UI gets a token with the OIDC settings above, and sends it on each
  request.

The gateway must let `/health` through without a token. If not, the UI cannot
read the mode of the API.

If the file is missing, the response is not 2xx, or the response is not
`application/json`, the UI keeps the build-time defaults and logs a warning to
the browser console. A typing error in the path therefore gives a UI that talks
to `localhost`, and does not give a blank page.

Application settings on the host do not replace `/config.json`. The server
settings of a static site never reach a client-side bundle. `/config.json` works
because the browser fetches it.

The flags of a UI and the flags of its API are set separately. If the UI has
flags on that the API does not, it shows sections whose routes do not exist.

## One worked deployment example

`infrastructure/` has generic Bicep templates for one way to host the two parts
on Azure. They are an example. The image runs on any container platform, and
the UI on any static file host.

- `main.bicep` deploys the image to Azure Container Apps: a Log Analytics
  workspace, a Container App environment (or an existing one), and a Container
  App with external HTTPS ingress. Its parameters are the registry login, the
  image name and tag, `targetPort` (default 3000), CPU and memory (default 0.5
  cores, 1.0 GB), and arrays of environment variables and secrets. An
  environment variable refers to a secret by `secretRef`. The output is the
  application URL.
- `swa.bicep` deploys the UI to Azure Static Web Apps, and sets application
  settings. Those settings do not reach the browser, so the SPA still gets the
  URL of its API from `/config.json`.
- `main.parameters.example.json` and `swa.parameters.example.json` are the
  shapes to copy. A real parameters file contains registry passwords and
  backend credentials. Do not put it in version control.

## Authentication: one broker in front

sqlib is a resource server. It verifies a JWT access token, and never signs
anyone in. The sign-in, the identity providers and the tokens come from one
authorization server, the "broker", that the deployment chooses.
[The auth design](../design/auth-architecture.md) gives the reasons.

A self-hosted deployment gets the full auth stack, and supplies its own broker.

### What sqlib needs from the broker

sqlib needs three settings, for any broker:

1. `SQLIB_AUTH_ISSUER`: the issuer URL of the broker, exactly as tokens carry it
   in `iss`. sqlib finds the keys through the OIDC discovery document of the
   issuer.
2. `SQLIB_AUTH_AUDIENCE`: the value that the broker puts in `aud` for sqlib. Set
   `SQLIB_AUTH_RESOURCE` to the same value: the canonical URL of `/mcp`, for
   example `https://sqlib.example.org/mcp`. MCP clients ask for a token for
   that value.
3. `SQLIB_AUTH_CLAIM_GROUPS`: the dot-path to the claim with group or role
   membership.

The SPA needs one more value: the client id that the broker gave it
(`authClientId` in `/config.json`). Register `<SPA origin>/auth/callback` as
its redirect URL.

### Choosing a broker

Two facts decide most choices:

- **GitHub sign-in needs Rauthy, Keycloak or Auth0.** Entra External ID and
  Cognito cannot federate to GitHub.
- **Self-registering MCP clients need CIMD or dynamic client registration.**
  Rauthy, Keycloak (behind feature flags) and Auth0 have them. Entra External
  ID and Cognito have neither. With them, you must register each MCP client
  manually, and the person who connects it must enter that client id.

| Broker | `SQLIB_AUTH_ISSUER` | `SQLIB_AUTH_AUDIENCE` | `SQLIB_AUTH_CLAIM_GROUPS` | Caveats |
| --- | --- | --- | --- | --- |
| Rauthy (reference; [the compose profile](#the-local-auth-profile)) | `https://<host>/auth/v1/` | The resource, listed in each client's `allowed_resources` and `default_aud` | `groups` (the client must allow the `groups` scope) | Signs with EdDSA by default; sqlib accepts it. Turn on `client_credentials_map_sub`, or machine tokens have no `sub`. |
| Entra External ID | `https://<tenant id>.ciamlogin.com/<tenant id>/v2.0` | The API's application ID URI | `roles` (app roles) or `groups` | No GitHub. No CIMD or dynamic registration. |
| Cognito user pool | `https://cognito-idp.<region>.amazonaws.com/<pool id>` | Unset, with `SQLIB_AUTH_AUDIENCE_UNCHECKED=true` | `cognito:groups` | Access tokens carry `client_id`, not `aud`; restrict access with a custom scope. No GitHub, no dynamic registration, no token exchange. Only 50 free federated users. |
| A customer's Keycloak | `https://<host>/realms/<realm>` | The client scope's audience mapper value | `realm_access.roles`, or `groups` with a group mapper | Turn on the CIMD and resource-indicator feature flags for MCP clients. |
| A customer's Entra workforce tenant | `https://login.microsoftonline.com/<tenant id>/v2.0` | The API's application ID URI | `roles` or `groups` | Request v2 access tokens (`accessTokenAcceptedVersion: 2`) so `iss` matches. |

AAF is an identity source, and cannot be the broker. Federate the broker to it
as a generic OIDC provider. If the broker passes it through, use
`eduperson_entitlement` or `eduperson_scoped_affiliation` as the group claim.

A partner whose Entra tenant already makes tokens with the audience of sqlib can
be trusted directly, next to the broker, with `SQLIB_AUTH_ISSUERS_JSON`. The
protected-resource metadata then lists both issuers. The SPA signs in with the
first one.

### Machines and applications

- **An application acting as itself** uses the client-credentials grant with
  its own confidential client. sqlib sees a `client` principal. Grant it modes
  as for any other principal. Cache the token for its lifetime. Do not fetch a
  new token for each call.
- **An application acting for a signed-in person** uses token exchange
  (RFC 8693) at the broker, and calls sqlib with the exchanged token. sqlib sees
  the person. Do not share one person's long-lived token with an application.

### The local auth profile

`docker-compose.mcp-https-image.yml` has an `auth` profile: Rauthy 0.37.2 on
`http://localhost:8080`, and a one-shot `rauthy-setup` service that configures
it through the admin API of Rauthy (`rauthy/setup.sh`). Use it to try the full
stack on one computer. It uses plain HTTP and an insecure cookie mode, so do
not expose it.

1. Copy `.env.auth.example` to `.env`. Fill in the Rauthy secrets as its
   comments say.
2. Build the image (`docker build -t sparql-query-lib:aca-local .`) and make
   the certificates (`just setup-local-https`).
3. Start it:

   ```bash
   docker compose -f docker-compose.mcp-https-image.yml --profile auth up
   ```

4. Read the secret of the machine client from the setup log. It is printed once,
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
allowed. An MCP client can therefore connect to `https://localhost:3443/mcp`
with no configuration.

You can run the setup again safely (`docker compose -f
docker-compose.mcp-https-image.yml run --rm rauthy-setup`). It updates the
clients, and does not change existing providers. Rauthy reads the API key
definition only when it first makes its database. To start again, remove the
`rauthy-data` volume.

### A dev stack behind Rauthy

`just dev-auth` runs sqlib as `just dev` does, with each feature flag on, in
`required` mode behind a local Rauthy. Use it to try grants, the Access screen,
and other functions that depend on the caller. It needs Docker, `openssl` and
`jq`.

```bash
just dev-auth
```

1. It starts Rauthy (`just rauthy-up`) in Docker on `http://localhost:8080`,
   from `docker-compose.auth-demo.yml`. `rauthy/setup.sh` creates the
   clients, and `rauthy/demo-users.sh` creates the test people.
2. It starts the API on `:3005` and the SPA on `:3001`. The SPA sends you to
   Rauthy to sign in. Rauthy and the API accept only those two addresses. If a
   different program uses `:3001`, the recipe stops, and does not serve the SPA
   on a different port.
3. It prints the passwords. The first run writes them, with new secrets, to
   `tmp/auth-demo/.env` (ignored by git). Later runs keep them.

| Sign in as | Rauthy group | In sqlib |
| --- | --- | --- |
| `admin@localhost` | `admin` | an administrator: sees **Access** |
| `alice@localhost` | `analysts` | no grants until you give some |
| `bob@localhost` | `hr` | no grants until you give some |
| `carol@localhost` | none | no grants until you give some |

To see two people at the same time, sign in as the administrator in one window,
and as alice in a private window. As the administrator, grant some access to
alice or to the `analysts` group. Then reload the window of alice.

`dev-auth` keeps its own stores, so the data of `just dev` does not change. The
library is in `packages/api/tmp/dev-auth-store`, and the grants are in
`packages/api/tmp/dev-auth-auth`.

| Command | What it does |
| --- | --- |
| Ctrl-C | Stops the API and the SPA. Rauthy stays up. |
| `just rauthy-down` | Stops Rauthy and keeps its people and clients. |
| `just clean-dev-auth` | Deletes the library store and the grants of `dev-auth`. |
| `just clean-rauthy` | Deletes the Rauthy volume and the secrets. The next run makes new passwords. |

### A demo of graph access

`just demo-graph-access` runs the whole access model on one computer, with
Rauthy in front. It needs Docker, `openssl` and `jq`.

- Rauthy runs in Docker on `http://localhost:8080`, from
  `docker-compose.auth-demo.yml`. It has its own project and volume, separate
  from the `auth` profile above. It is the same Rauthy that `just dev-auth`
  uses.
  `rauthy/setup.sh` creates the clients, and `rauthy/demo-users.sh` creates
  the groups `analysts` and `hr` and three people.
- sqlib runs on the host in `required` mode: the API on `:3005`, seeded with
  the "Graph access demo" library, and the SPA on `:3001`.

The first run writes new secrets and passwords to `tmp/auth-demo/.env` (ignored
by git), and later runs keep them. The recipe prints the passwords when it
starts.

| Sign in as | Groups | Reads | Backend modes |
| --- | --- | --- | --- |
| `admin@localhost` | `admin` | everything, not policed | administrator |
| `alice@localhost` | `analysts` | public, finance | `query:adhoc` |
| `bob@localhost` | `hr` | public, finance, hr | `query:saved` |
| `carol@localhost` | none | public | `query:saved` |

Open the library, and run "Everything I can see" as each person. The "reading"
clause of the run bar shows how many graphs each person can read. Open it to
select some of them. Then sign in as the administrator, and open **Access**:

- **People & groups** shows the grants of each group. For a person, it shows
  the resulting access, and the group that gives each part.
- **Backends** shows "Company data" with its graph policy, the people who can
  use it, and `Test as` next to each. Save a new version of the policy query.
  The backend then offers to test and pin it.

Stop Rauthy with `just demo-graph-access-down`. Delete both stores and the
secrets with `just clean-graph-access-demo`.

## Before you expose it

This repository is pre-1.0, and its source is available for review (see
`LICENSE`). No release is published. Before other people can reach a
deployment, decide each item below.

**Authentication is off by default.** The default `SQLIB_AUTH_MODE` is
`disabled`, which gives each request full access. The other modes:

- `dry-run` validates tokens, and logs the result that enforcement would give.
  It refuses nothing.
- `required` refuses.

An enforcing mode needs at least one issuer: `SQLIB_AUTH_ISSUER` with
`SQLIB_AUTH_AUDIENCE`, or `SQLIB_AUTH_ISSUERS_JSON` for several. Without one,
the server does not start. The server also refuses an issuer with no audience.
Without an audience, sqlib would accept any token from that issuer, for any
application. Set `SQLIB_AUTH_AUDIENCE_UNCHECKED=true` only if you need this.
`SQLIB_AUTH_ADMIN_PRINCIPALS` names the principals that are administrators at
startup. [Authentication: one broker in front](#authentication-one-broker-in-front)
tells you what to put in front.

**`/mcp` has no authentication in the default mode**, as for the rest of the
API. It gives a full set of tools over each library and backend on the server.
If the deployment serves `dual-http` or `mcp-http`, enforce authentication, or
do not publish that path. See [connecting an MCP client](mcp-clients.md).

**CORS allows no browser origin by default.** `SQLIB_CORS_ORIGINS` lists the
origins that can read the API and `/mcp`, separated by commas. When it is not
set, a production deployment allows no origin. This is correct when the SPA and
the API share an origin. If the SPA has a different origin, list it. A listed
origin gets credentialed access. `*` allows each origin, and never sends
credentials. See [configuration](../reference/configuration.md#server-and-transport).

**Check the feature flags.** `etl`, `playgroundEtl` and `assistant` are off by
default, for these reasons:

- ETL takes arbitrary DuckDB SQL. This SQL can read the host filesystem, and,
  with the httpfs extension, make outbound requests.
- The assistant has no authentication, calls a paid provider, and can reach a
  configured backend.

To turn on any of them is a decision about what the callers of the deployment
can do. `ruleTuples` is off, because its extension is not part of SHACL 1.2
Rules. [Feature flags](../reference/feature-flags.md) gives the full list, with
defaults.

**Backend credentials are entity data.** A registered HTTP backend can have a
username and password, and the library store holds them. The store therefore
contains secrets. Give it a volume with restricted access. Supply the endpoint
credentials of the library (`LIBRARY_STORAGE_SPARQL_USERNAME` / `_PASSWORD`)
through the secret mechanism of the platform. Do not use a plain environment
variable.

**ETL output is a filesystem write.** If ETL is on, `ETL_OUTPUT_DIR` must exist,
and uid 1000 must be able to write to it. It gets one file for each execution,
with no retention policy. The server checks the directory at startup, and logs
the fix if it is not writable.
`pnpm --filter @sparql-query-lib/api smoke:storage` does the same check in a
container, without a server start.

**Persistence needs a volume.** With the default `sqlite` store, the library and
the auth store are files on the disk of the container. With
`INTERNAL_BACKEND_TYPE=oxigraph-persistent`, the whole library is in the memory
of the container, and in a `.nq` snapshot on its disk. In both cases, without a
volume at the storage path, all data is lost when the container is replaced.
Put a SQLite store on a block volume. Do not use a network file share (Azure
Files, EFS), because SQLite locking is not reliable there.

**Observability.** Telemetry is off until you set an OTLP endpoint. To send
traces, metrics and logs, set `OTEL_EXPORTER_OTLP_ENDPOINT`, and
`OTEL_EXPORTER_OTLP_HEADERS` for a hosted service. On Azure Container Apps, the
managed OpenTelemetry agent sets the endpoint. sqlib logs slow runs in both
cases. See [observability](observability.md).

## Scaling to zero

An instance that stops when idle, and starts on the next request, adds its
startup time to that request. A person waits for it. The image is configured
for this:

- Response serialisers compile on first use.
- The SPARQL grammars and the DuckDB binding are built on first use.
- The image has a V8 compile cache, so the first container to start is already
  warm.

You can also turn off the
[feature flags](../reference/configuration.md#feature-flags) that you do not
serve. Telemetry is already off until you configure it. See
[startup time](../reference/configuration.md#startup-time).

Two properties of the store have a larger effect:

**An in-memory store is empty on each cold start.**
`INTERNAL_BACKEND_TYPE=oxigraph-memory` keeps nothing between runs. A
scale-to-zero deployment that uses it starts with an empty library each time.
Use `oxigraph-persistent`, with the snapshot on a volume that survives the
container. This is the same in-memory Oxigraph, with a `.nq` snapshot restored
at startup and written on a timer. The restore is the only part of startup that
increases with your data: about one second for each 180,000 quads.

**A container that is killed without warning loses all writes since the last
checkpoint.** The snapshot is written each
`INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` (default 60s), and on `SIGTERM`. If
the platform kills idle instances, or its shutdown grace period is shorter than
the dump, up to one checkpoint interval of writes is lost. If the writes are
important, make the interval shorter. Check that your platform sends `SIGTERM`
and waits for the process to exit.
