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

A host that serves a directory of files serves this unchanged: `nuxt generate`
prerenders an `index.html` per route, so deep links resolve without a rewrite
rule. `200.html` is there for hosts that want an explicit SPA fallback (Azure
Static Web Apps takes one through `navigationFallback` in
`staticwebapp.config.json`, which the deployment adds beside `/config.json` —
it is deployment configuration, not part of the bundle).

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
  "authIssuer": "",
  "authClientId": "",
  "authAudience": "",
  "authScope": "openid profile email"
}
```

The recognised keys are `apiBaseUrl`, `featureFlags` (merged over the built-in
flags, so a partial object is fine), and the four OIDC settings. The file is not
in the repository: the deployment places it at the site root beside
`index.html`. A missing file, a non-2xx response, or a response that is not
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

## Before you expose it

This repository is pre-1.0 and source-available for review (see `LICENSE`). No
release has been published. Settle each of the following before a deployment is
reachable by anyone but you.

**Authentication is off by default.** `SQLIB_AUTH_MODE` defaults to `disabled`,
which gives every request full access. `dry-run` validates tokens and logs what
would have happened without refusing anything; `required` refuses. An enforcing
mode needs at least one issuer — `SQLIB_AUTH_ISSUER` with `SQLIB_AUTH_AUDIENCE`,
or `SQLIB_AUTH_ISSUERS_JSON` for several — and refuses to start without one.
`SQLIB_AUTH_ADMIN_PRINCIPALS` names the principals that are administrators at
boot.

**`/mcp` is unauthenticated in the default mode**, like the rest of the API, and
it is a complete tool surface over every library and backend on the server. If
the deployment serves `dual-http` or `mcp-http`, either enforce authentication
or do not publish that path. See [connecting an MCP client](mcp-clients.md).

**CORS is wide open.** The API registers `origin: "*"` with
`credentials: true`. Narrow it, or front the API with something that does,
before serving a browser origin you care about.

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
