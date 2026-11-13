# sqlib's task runner. `just` starts the app; `just --list` shows every recipe
# by group. docs/reference/scripts.md describes each one.
#
# The recipes use `[group]`, so they need just 1.27 or later.

# Every feature flag on, for `dev` and `dev-auth`. The Dockerfile sets the same
# list; packages/api/test/deployment/dockerfileDefaults.test.ts checks that both name
# every flag.
all_features := "FEATURE_NOTEBOOK=true FEATURE_QUERIES=true FEATURE_QUERY_GROUPS=true FEATURE_RULES_SUITE=true FEATURE_BENCHMARKS=true FEATURE_TESTS=true FEATURE_DATA_GRAPHS=true FEATURE_TUPLE_SETS=true FEATURE_ARGUMENT_SETS=true FEATURE_MCP=true FEATURE_ETL=true FEATURE_BACKENDS=true FEATURE_SETTINGS=true FEATURE_RULES_ALLOW_INVALID_SAVE=true FEATURE_RULE_TUPLES=true FEATURE_RULE_AGGREGATES=true FEATURE_PLAYGROUND_QUERIES=true FEATURE_PLAYGROUND_RULES=true FEATURE_PLAYGROUND_ETL=true FEATURE_ASSISTANT=true FEATURE_OGC=true"

# The addresses the Rauthy recipes serve sqlib on. They are set here, because
# an older run may have written other ports to tmp/auth-demo/.env.
rauthy_addresses := "SQLIB_AUTH_RESOURCE=http://localhost:3005/mcp SQLIB_WEB_ORIGINS=http://localhost:3001"

# Grafana Explore on the lgtm stack's Tempo, opened at one trace, for `dev-otel`.
lgtm_trace_url := 'http://localhost:3030/explore?schemaVersion=1&panes=%7B%22a%22%3A%7B%22datasource%22%3A%22tempo%22%2C%22queries%22%3A%5B%7B%22refId%22%3A%22A%22%2C%22datasource%22%3A%7B%22type%22%3A%22tempo%22%2C%22uid%22%3A%22tempo%22%7D%2C%22queryType%22%3A%22traceql%22%2C%22query%22%3A%22{traceId}%22%7D%5D%2C%22range%22%3A%7B%22from%22%3A%22now-1h%22%2C%22to%22%3A%22now%22%7D%7D%7D'

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

# The default recipe. It installs dependencies, builds what the API cannot run
# from source, and starts the API, MCP and web UI with ports 3005 and 3001.
#
# - Library store: SQLite, in packages/api/tmp/library-store/library.sqlite.
#   `just clean-local-memory` deletes it.
# - Every feature flag is on, including the ones that are off by default: ETL
#   and its playground (arbitrary DuckDB SQL), the assistant, OGC API Features,
#   the SRL TUPLE and AGGREGATE extensions, and saving unparseable rules.
# - Auth is disabled and writes are allowed. The recipe sets SQLIB_AUTH_MODE,
#   SQLIB_READ_ONLY and MCP_READ_ONLY, so a value left in your shell has no
#   effect.
# - The API reads FEATURE_*. nuxt.config.ts uses FEATURE_* when
#   NUXT_PUBLIC_FEATURE_* is unset, so one export sets both processes.
# - The web app runs with --strictPort. The API's CORS allowlist names only
#   port 3001, so a web app on another port could not call the API.
# - `_free-dev-ports` stops this checkout's earlier server on 3005 or 3001 first.
#
# Ctrl-C stops both processes.
#
# Start sqlib: SQLite store, every feature on, no auth (web UI on :3001)
[group('run')]
dev: _build-deps _free-dev-ports
    #!/usr/bin/env bash
    set -euo pipefail
    export {{all_features}}
    export SQLIB_AUTH_MODE=disabled SQLIB_READ_ONLY=false MCP_READ_ONLY=false
    INTERNAL_BACKEND_TYPE="sqlite" \
    LIBRARY_STORAGE_DIR="./tmp/library-store" \
    NODE_ENV="development" \
    MCP_TRANSPORT="dual-http" \
    HTTP_PORT=3005 \
        pnpm --filter @sparql-query-lib/api exec tsx watch ../mcp-server/src/cli.ts &
    api_pid=$!
    NUXT_PUBLIC_API_BASE_URL="http://localhost:3005" \
        pnpm --filter @sparql-query-lib/web exec nuxt dev --port 3001 --strictPort &
    web_pid=$!
    trap 'kill "$api_pid" "$web_pid" 2>/dev/null || true' INT TERM EXIT
    echo
    echo "sqlib is starting. Web UI: http://localhost:3001"
    echo "  API: http://localhost:3005 (OpenAPI at /docs/)  MCP: http://localhost:3005/mcp"
    echo
    # `wait -n` (stop when either process exits) needs bash 4.3. The bash that
    # macOS ships is 3.2, where this waits for both.
    if (( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] >= 403 )); then wait -n "$api_pid" "$web_pid"; else wait "$api_pid" "$web_pid"; fi

# `dev`, with telemetry sent to the local observability stack (lgtm-up).
# Telemetry is off unless an OTLP endpoint is set, so plain `dev` sends nothing.
# The slow query log takes runs of 200 ms and over, with query text and
# arguments; set SQLIB_SLOW_QUERY_MS or SQLIB_TELEMETRY_DETAIL to change that.
# Grafana: http://localhost:3030 (dashboard "sqlib"). See
# docs/guides/observability.md.
#
# Run `dev` with telemetry sent to a local Grafana on :3030
[group('run')]
dev-otel: lgtm-up
    trace_url='{{lgtm_trace_url}}'; \
    OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318" \
    OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-sqlib-dev}" \
    SQLIB_SLOW_QUERY_MS="${SQLIB_SLOW_QUERY_MS:-200}" \
    SQLIB_TELEMETRY_DETAIL="${SQLIB_TELEMETRY_DETAIL:-text+args}" \
    SQLIB_OBSERVABILITY_URL="${SQLIB_OBSERVABILITY_URL:-http://localhost:3030/d/sqlib/sqlib}" \
    SQLIB_TRACE_URL_TEMPLATE="${SQLIB_TRACE_URL_TEMPLATE:-$trace_url}" \
        just dev

# The API and MCP alone on :3005, with the library in an Oxigraph store that is
# held in memory and written to packages/api/tmp/library-store as N-Quads every
# 60 s and on shutdown. It shares that directory with `dev`, but the two
# recipes do not share data. To copy the Oxigraph snapshot into the SQLite
# store, run this from packages/api with the API stopped:
#
#     INTERNAL_BACKEND_TYPE=sqlite LIBRARY_STORAGE_DIR=./tmp/library-store \
#         pnpm import:library-store --file ./tmp/library-store/library_store.nq
#
# Run the API and MCP on :3005 with an Oxigraph library store (no web UI)
[group('run')]
run-local-memory: _build-deps
    INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
    LIBRARY_STORAGE_DIR="./tmp/library-store" \
    INTERNAL_OXIGRAPH_STORE_ID="library-store" \
    INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
    FEATURE_ASSISTANT=true \
    NODE_ENV="development" \
    OTEL_ENABLED="false" \
    MCP_TRANSPORT="dual-http" \
    HTTP_PORT=3005 \
    pnpm --filter @sparql-query-lib/api exec tsx watch ../mcp-server/src/cli.ts

# packages/web aliases contracts, types and runtime to source, so this recipe
# needs no sibling builds.
#
# Run the web UI on :3001 against any API base URL
[group('run')]
run-frontend API_URL="http://localhost:3005": _setup
    NUXT_PUBLIC_API_BASE_URL="{{API_URL}}" \
    pnpm --filter @sparql-query-lib/web dev

# Delete the local library store that `dev` and `run-local-memory` use
[group('run')]
clean-local-memory:
    rm -rf packages/api/tmp/library-store

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------

# Build the server image, tagged sparql-query-lib:TAG
[group('docker')]
build-docker TAG="latest":
    docker build --network=host -t sparql-query-lib:{{TAG}} .

# The image's defaults are those of `dev`: SQLite store, every feature on, auth
# disabled. The port is published on 127.0.0.1 only, because that
# configuration runs arbitrary DuckDB SQL for any caller. The sqlib-data volume
# keeps the library between runs; `just clean-docker` deletes it.
#
# Run the server image on :PORT with its defaults, keeping data in a volume
[group('docker')]
run-docker TAG="latest" PORT="3005":
    docker run -it --rm \
        -p 127.0.0.1:{{PORT}}:3000 \
        -v sqlib-data:/app/packages/api/storage \
        sparql-query-lib:{{TAG}}

# Delete the sqlib-data volume that `run-docker` uses
[group('docker')]
clean-docker:
    docker volume rm sqlib-data

# The static site at /site, to copy out and deploy. It has no server. See
# Dockerfile.web.
#
# Build the web UI bundle image, tagged sqlib-web:TAG
[group('docker')]
build-web-image TAG="latest":
    docker build --network=host -t sqlib-web:{{TAG}} -f Dockerfile.web .

# `docker create` + `docker cp`, with the container never started. DEST must not
# exist, because `docker cp` would copy `site/` into it.
#
# Copy the static site out of a web bundle image into DEST
[group('docker')]
extract-web-bundle TAG="latest" DEST="tmp/web-bundle":
    test ! -e "{{DEST}}" || (echo "{{DEST}} already exists. Remove it or pass another DEST." && exit 1)
    mkdir -p "$(dirname "{{DEST}}")"
    docker create --name sqlib-web-extract sqlib-web:{{TAG}} >/dev/null
    docker cp sqlib-web-extract:/site "{{DEST}}"; status=$?; docker rm sqlib-web-extract >/dev/null; exit $status
    @echo "Extracted to {{DEST}}. Serve it with any static host, with /config.json beside index.html."

# ---------------------------------------------------------------------------
# HTTPS and MCP clients
# ---------------------------------------------------------------------------

# Generate trusted localhost certificates into certs/ with mkcert (one time)
[group('https')]
setup-local-https:
    if ! command -v mkcert >/dev/null 2>&1; then \
        echo "mkcert is required. Install it from https://github.com/FiloSottile/mkcert" >&2; \
        exit 1; \
    fi
    mkdir -p certs
    mkcert -install
    mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1

# Run the API and MCP over HTTPS on https://localhost:3443 through Traefik
[group('https')]
run-local-https: _build-deps
    if [ ! -f certs/localhost.pem ] || [ ! -f certs/localhost-key.pem ]; then \
        echo "Missing certificates. Run: just setup-local-https" >&2; \
        exit 1; \
    fi
    OTEL_ENABLED="${OTEL_ENABLED:-false}" HTTP_PORT=3300 HTTP_HOST=0.0.0.0 \
        pnpm --filter @sparql-query-lib/mcp-server dev:dual-http & \
    app_pid=$!; \
    docker compose -f docker-compose.mcp-https.yml up --remove-orphans traefik & \
    traefik_pid=$!; \
    cleanup() { kill "$app_pid" "$traefik_pid" 2>/dev/null || true; }; \
    trap cleanup INT TERM EXIT; \
    wait "$app_pid" "$traefik_pid"

# Needs an image built by `just build-docker aca-local` and the certificates
# from `just setup-local-https`.
#
# Run the built image and Fuseki behind Traefik on https://localhost:3443
[group('https')]
run-docker-https:
    if [ ! -f certs/localhost.pem ] || [ ! -f certs/localhost-key.pem ]; then \
        echo "Missing certificates. Run: just setup-local-https" >&2; \
        exit 1; \
    fi
    docker compose -f docker-compose.mcp-https-image.yml up --remove-orphans

# A minimal MCP Apps host for the ui:// Views. Pair it with
# `just run-local-memory`: the page talks to that server's /mcp, renders a View
# in a sandboxed iframe and bridges its JSON-RPC back.
#
# Serve the MCP App harness, to see the ui:// Views without an MCP Apps host
[group('mcp')]
run-mcp-app-harness: _setup
    pnpm --filter @sparql-query-lib/mcp-app build
    pnpm --filter @sparql-query-lib/mcp-app dev:harness

# Checks that a UI-capable client is offered _meta.ui, that a plain one is not,
# and that every ui:// resource reads back as a self-contained document.
#
# Check the MCP Apps protocol of a running server, without a browser
[group('mcp')]
smoke-mcp-app endpoint="http://localhost:3005/mcp":
    node packages/mcp-app/dev/smoke.mjs {{endpoint}}

# Claude and ChatGPT connectors take a URL, and their servers must reach it, so
# a locally trusted certificate is not enough. Uses ngrok or cloudflared,
# whichever is installed; pass `tool=ngrok` or `tool=cloudflared` to choose.
# Neither needs an account: each run gets a fresh random hostname.
#
# The tunnel is public and unauthenticated. A custom connector authenticates
# with OAuth or with nothing, so a tunnel's basic-auth option would lock out the
# browser and not the client. Start the server read-only in another terminal:
#
#     MCP_READ_ONLY=1 just run-local-memory
#
# Do not tunnel a server that holds data a stranger must not read. Give the
# client the printed https URL with /mcp on the end.
#
# Expose the local MCP server over public HTTPS, to test a web client
[group('mcp')]
tunnel-mcp port="3005" tool="":
    #!/usr/bin/env bash
    set -euo pipefail
    tool="{{tool}}"
    if [ -z "$tool" ]; then
        if command -v ngrok >/dev/null 2>&1; then tool=ngrok
        elif command -v cloudflared >/dev/null 2>&1; then tool=cloudflared
        else
            echo "Install ngrok (https://ngrok.com/download) or cloudflared" >&2
            echo "(https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)." >&2
            echo "tailscale funnel {{port}} does the same job if you already run Tailscale." >&2
            exit 1
        fi
    elif ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool is not installed." >&2
        exit 1
    fi
    # A tunnel to a dead port answers 502, which a client reports as "unable to
    # reach the connector". Check the server first.
    if ! curl -fsS -o /dev/null "http://localhost:{{port}}/health" 2>/dev/null; then
        echo "Nothing answering on localhost:{{port}}. Start one first:" >&2
        echo "    MCP_READ_ONLY=1 just run-local-memory" >&2
        exit 1
    fi
    echo "Tunnelling localhost:{{port}} with $tool."
    echo "The MCP endpoint is the printed https URL with /mcp on the end."
    echo "It is public and unauthenticated for as long as this runs."
    if [ "$tool" = "ngrok" ]; then
        exec ngrok http "{{port}}"
    else
        exec cloudflared tunnel --url "http://localhost:{{port}}"
    fi

# ---------------------------------------------------------------------------
# Auth (Rauthy)
# ---------------------------------------------------------------------------

# Starts the local Rauthy (see rauthy-up), then the API and the web UI as `dev`
# does, but every request needs a token and the web UI signs you in through
# Rauthy.
#
# Sign in as admin@localhost to administer: Rauthy puts that user in the
# `admin` group, which SQLIB_AUTH_ADMIN_PRINCIPALS makes a sqlib administrator.
# Sign in as alice, bob or carol in a private window to see what a person
# without grants sees. The recipe prints the passwords; they are also in
# tmp/auth-demo/.env.
#
# Its stores are its own: packages/api/tmp/dev-auth-store and
# packages/api/tmp/dev-auth-auth. `just clean-dev-auth` resets both. Ctrl-C
# stops sqlib; `just rauthy-down` stops Rauthy.
#
# Rauthy admin UI: http://localhost:8080/auth/v1/admin
#
# Run `dev` behind a local Rauthy, in required auth mode
[group('auth')]
dev-auth: _build-deps _free-dev-ports rauthy-up
    #!/usr/bin/env bash
    set -euo pipefail
    set -a; . tmp/auth-demo/.env; set +a
    export {{rauthy_addresses}}
    export {{all_features}}
    export SQLIB_READ_ONLY=false MCP_READ_ONLY=false
    SQLIB_AUTH_MODE="required" \
    SQLIB_AUTH_ISSUER="http://localhost:8080/auth/v1/" \
    SQLIB_AUTH_JWKS_URI="http://localhost:8080/auth/v1/oidc/certs" \
    SQLIB_AUTH_AUDIENCE="$SQLIB_AUTH_RESOURCE" \
    SQLIB_AUTH_CLAIM_GROUPS="groups" \
    SQLIB_AUTH_ADMIN_PRINCIPALS="http://localhost:8080/auth/v1/|group:admin" \
    SQLIB_CORS_ORIGINS="$SQLIB_WEB_ORIGINS" \
    INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
    LIBRARY_STORAGE_DIR="./tmp/dev-auth-store" \
    INTERNAL_OXIGRAPH_STORE_ID="dev-auth-store" \
    SQLIB_AUTH_STORE_DIR="./tmp/dev-auth-auth" \
    INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
    NODE_ENV="development" \
    OTEL_ENABLED="false" \
    MCP_TRANSPORT="dual-http" \
    HTTP_PORT=3005 \
        pnpm --filter @sparql-query-lib/api exec tsx watch ../mcp-server/src/cli.ts &
    api_pid=$!
    NUXT_PUBLIC_API_BASE_URL="http://localhost:3005" \
    NUXT_PUBLIC_AUTH_CLIENT_ID="sqlib-web" \
    NUXT_PUBLIC_AUTH_SCOPE="openid profile email groups" \
        pnpm --filter @sparql-query-lib/web exec nuxt dev --port 3001 --strictPort &
    web_pid=$!
    trap 'kill "$api_pid" "$web_pid" 2>/dev/null || true' INT TERM EXIT
    echo
    echo "sqlib behind Rauthy: open http://localhost:3001"
    echo "  admin@localhost  password: $RAUTHY_ADMIN_PASSWORD"
    echo "  alice@localhost, bob@localhost, carol@localhost  password: $DEMO_USER_PASSWORD"
    echo
    # `wait -n` (stop when either process exits) needs bash 4.3. The bash that
    # macOS ships is 3.2, where this waits for both.
    if (( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] >= 403 )); then wait -n "$api_pid" "$web_pid"; else wait "$api_pid" "$web_pid"; fi

# Reset `dev-auth`'s library store and grants (Rauthy keeps its people)
[group('auth')]
clean-dev-auth:
    rm -rf packages/api/tmp/dev-auth-store packages/api/tmp/dev-auth-auth

# Rauthy runs in Docker (docker-compose.auth-demo.yml), set up for a sqlib API
# on :3005 and a web UI on :3001. `dev-auth` and `demo-graph-access` both start
# it, and share it. It is safe to run again: it starts what is stopped and
# updates the clients and the people. Needs Docker, openssl and jq.
#
# The first run writes tmp/auth-demo/.env with fresh secrets and passwords and
# keeps it, so the passwords stay the same between runs. It prints them.
#
#   admin@localhost   Rauthy group admin: a sqlib administrator
#   alice@localhost   group analysts
#   bob@localhost     group hr
#   carol@localhost   no group
#
# Start the local Rauthy on :8080, with sqlib's clients and the test people
[group('auth')]
rauthy-up:
    #!/usr/bin/env bash
    set -euo pipefail
    env_file=tmp/auth-demo/.env
    if [ ! -f "$env_file" ]; then
        mkdir -p tmp/auth-demo
        key_id=$(openssl rand -hex 4)
        {
            echo "RAUTHY_SECRET_RAFT=$(openssl rand -hex 16)"
            echo "RAUTHY_SECRET_API=$(openssl rand -hex 16)"
            echo "RAUTHY_ENC_KEY=$key_id/$(openssl rand -base64 32)"
            echo "RAUTHY_ENC_KEY_ID=$key_id"
            echo "RAUTHY_ADMIN_PASSWORD=Admin-$(openssl rand -hex 8)-Aa1!"
            echo "RAUTHY_API_KEY_SECRET=$(openssl rand -hex 32)"
            echo "DEMO_USER_PASSWORD=Demo-$(openssl rand -hex 6)-Aa1!"
        } > "$env_file"
        chmod 600 "$env_file"
        echo "Wrote fresh secrets to $env_file"
    fi
    set -a; . "$env_file"; set +a
    # Set after the env file, so a file written when the demo used other ports
    # cannot point Rauthy's redirects and resource at an address nothing serves.
    # Docker Compose prefers these shell values to the env file's.
    export {{rauthy_addresses}}
    compose="docker compose -f docker-compose.auth-demo.yml --env-file $env_file"
    $compose up -d rauthy
    $compose run --rm rauthy-setup
    $compose run --rm rauthy-demo-users
    echo
    echo "Rauthy is up on http://localhost:8080 (admin UI: /auth/v1/admin)"
    echo "  admin@localhost  password: $RAUTHY_ADMIN_PASSWORD"
    echo "  alice@localhost, bob@localhost, carol@localhost  password: $DEMO_USER_PASSWORD"
    echo

# Stop the local Rauthy, keeping its users and clients
[group('auth')]
rauthy-down:
    {{rauthy_addresses}} docker compose -f docker-compose.auth-demo.yml --env-file tmp/auth-demo/.env down

# Delete the local Rauthy: its volume and the secrets in tmp/auth-demo
[group('auth')]
clean-rauthy:
    -{{rauthy_addresses}} docker compose -f docker-compose.auth-demo.yml --env-file tmp/auth-demo/.env down -v
    rm -rf tmp/auth-demo

# ---------------------------------------------------------------------------
# Demos
# ---------------------------------------------------------------------------

# A rules workbench on :3005, with the W3C SHACL 1.2 Rules suite seeded as 336
# runnable Tests in its own store (packages/api/tmp/rules-tests-store).
#
# - Rules, data graphs, tests, queries and query groups are on; benchmarks and
#   ETL are off. Pair it with `just run-frontend-rules`, which sets the
#   matching flags for the web UI.
# - FEATURE_RULES_ALLOW_INVALID_SAVE is on, because a third of the suite's
#   documents must be unparseable. FEATURE_RULE_AGGREGATES is on, because the
#   suite's GROUP tests need it.
# - Each test is tagged with what it exercises (templates, negation, RDFS,
#   blank nodes) and what it asserts (must accept, must reject, expects error).
# - Seeding is idempotent. A restart also tags a store seeded before tags
#   existed, and keeps the tags you added.
#
# Run the API with the W3C SHACL 1.2 Rules suite loaded as Tests
[group('demos')]
run-local-rules-tests: _build-deps
    SEED_W3C_RULES_SUITE="true" \
    FEATURE_RULES_SUITE="true" \
    FEATURE_TESTS="true" \
    FEATURE_DATA_GRAPHS="true" \
    FEATURE_RULES_ALLOW_INVALID_SAVE="true" \
    FEATURE_RULE_AGGREGATES="true" \
    FEATURE_QUERIES="true" \
    FEATURE_QUERY_GROUPS="true" \
    FEATURE_BENCHMARKS="false" \
    FEATURE_ETL="false" \
    FEATURE_BACKENDS="true" \
    INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
    LIBRARY_STORAGE_DIR="./tmp/rules-tests-store" \
    INTERNAL_OXIGRAPH_STORE_ID="rules-tests-store" \
    INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
    NODE_ENV="development" \
    OTEL_ENABLED="false" \
    MCP_TRANSPORT="dual-http" \
    HTTP_PORT=3005 \
    pnpm --filter @sparql-query-lib/api exec tsx watch ../mcp-server/src/cli.ts

# Run the web UI with the feature flags of `run-local-rules-tests`
[group('demos')]
run-frontend-rules API_URL="http://localhost:3005": _setup
    NUXT_PUBLIC_API_BASE_URL="{{API_URL}}" \
    NUXT_PUBLIC_FEATURE_RULES_SUITE="true" \
    NUXT_PUBLIC_FEATURE_TESTS="true" \
    NUXT_PUBLIC_FEATURE_DATA_GRAPHS="true" \
    NUXT_PUBLIC_FEATURE_RULES_ALLOW_INVALID_SAVE="true" \
    NUXT_PUBLIC_FEATURE_RULE_AGGREGATES="true" \
    NUXT_PUBLIC_FEATURE_QUERIES="true" \
    NUXT_PUBLIC_FEATURE_QUERY_GROUPS="true" \
    NUXT_PUBLIC_FEATURE_BENCHMARKS="false" \
    NUXT_PUBLIC_FEATURE_ETL="false" \
    NUXT_PUBLIC_FEATURE_BACKENDS="true" \
    pnpm --filter @sparql-query-lib/web dev

# Delete the rules-test store, so the next run seeds a fresh one
[group('demos')]
clean-local-rules-tests:
    rm -rf packages/api/tmp/rules-tests-store

# Seeds a library called "RDF Patch demo": a four-document catalogue, an archive
# named graph, and nine update queries. They cover raw against net counts, a
# no-op update, a named graph in graphScope, a two-operation program whose
# second half reads what the first wrote, and a DROP GRAPH.
#
# Open a query, press Run and read the patch. Asking for RDF Patch derives it
# and does not write the store; applying is a separate call. The demo backend
# is in-process Oxigraph in `ephemeral` mode, so apply and revert change it and
# a restart undoes them. The library store is persistent, so seeding again is a
# no-op. Pair it with `just run-frontend-patch-demo`.
#
# Run the API seeded with the RDF Patch demo library
[group('demos')]
run-local-patch-demo: _build-deps
    SEED_PATCH_DEMO="true" \
    FEATURE_QUERIES="true" \
    FEATURE_BACKENDS="true" \
    FEATURE_DATA_GRAPHS="true" \
    FEATURE_QUERY_GROUPS="false" \
    FEATURE_RULES_SUITE="false" \
    FEATURE_TESTS="false" \
    FEATURE_BENCHMARKS="false" \
    FEATURE_ETL="false" \
    INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
    LIBRARY_STORAGE_DIR="./tmp/patch-demo-store" \
    INTERNAL_OXIGRAPH_STORE_ID="patch-demo-store" \
    INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
    NODE_ENV="development" \
    OTEL_ENABLED="false" \
    MCP_TRANSPORT="dual-http" \
    HTTP_PORT=3005 \
    pnpm --filter @sparql-query-lib/api exec tsx watch ../mcp-server/src/cli.ts

# Run the web UI with the feature flags of `run-local-patch-demo`
[group('demos')]
run-frontend-patch-demo API_URL="http://localhost:3005": _setup
    NUXT_PUBLIC_API_BASE_URL="{{API_URL}}" \
    NUXT_PUBLIC_FEATURE_QUERIES="true" \
    NUXT_PUBLIC_FEATURE_BACKENDS="true" \
    NUXT_PUBLIC_FEATURE_DATA_GRAPHS="true" \
    NUXT_PUBLIC_FEATURE_QUERY_GROUPS="false" \
    NUXT_PUBLIC_FEATURE_RULES_SUITE="false" \
    NUXT_PUBLIC_FEATURE_TESTS="false" \
    NUXT_PUBLIC_FEATURE_BENCHMARKS="false" \
    NUXT_PUBLIC_FEATURE_ETL="false" \
    pnpm --filter @sparql-query-lib/web dev

# The CI e2e lane mocks the API, so it cannot check the derivation. This recipe
# starts nothing. Start both halves first:
#
#   term 1:  just run-local-patch-demo
#   term 2:  just run-frontend-patch-demo
#   term 3:  just uat-patch-demo
#
# Drive the RDF Patch demo end to end in a browser against a real API
[group('demos')]
uat-patch-demo API_URL="http://localhost:3005" WEB_URL="http://localhost:3001":
    PATCH_DEMO_API_URL="{{API_URL}}" \
    PATCH_DEMO_WEB_URL="{{WEB_URL}}" \
    pnpm --filter @sparql-query-lib/web test:e2e:uat

# Delete the patch demo's library, so the next run seeds it fresh
[group('demos')]
clean-local-patch-demo:
    rm -rf packages/api/tmp/patch-demo-store

# Who may read which graphs, with Rauthy in front (docs/design/auth-architecture.md).
# Rauthy runs in Docker on :8080; sqlib runs on the host in `required` auth mode,
# seeded with the "Graph access demo" library. Web UI: http://localhost:3001.
#
# Sign in as one of these. The passwords are in tmp/auth-demo/.env
# (DEMO_USER_PASSWORD; the administrator's is RAUTHY_ADMIN_PASSWORD):
#
#   admin@localhost   sqlib administrator: sees the Access screen, no policy
#   alice@localhost   group analysts: public + finance, may write queries
#   bob@localhost     group hr: public + finance + hr, saved queries only
#   carol@localhost   no group: public only, saved queries only
#
# Open the library and run "Everything I can see" as each of them. As admin,
# open Access > Graph policies, pick "Company data" and use Test as.
# `just demo-graph-access-down` stops Rauthy; `just clean-graph-access-demo`
# deletes both stores.
#
# Run the graph access demo: sqlib in required auth mode behind Rauthy
[group('demos')]
demo-graph-access: _build-deps rauthy-up
    #!/usr/bin/env bash
    set -euo pipefail
    set -a; . tmp/auth-demo/.env; set +a
    export {{rauthy_addresses}}
    SEED_GRAPH_ACCESS_DEMO="true" \
    SQLIB_AUTH_MODE="required" \
    SQLIB_AUTH_ISSUER="http://localhost:8080/auth/v1/" \
    SQLIB_AUTH_JWKS_URI="http://localhost:8080/auth/v1/oidc/certs" \
    SQLIB_AUTH_AUDIENCE="$SQLIB_AUTH_RESOURCE" \
    SQLIB_AUTH_CLAIM_GROUPS="groups" \
    SQLIB_AUTH_ADMIN_PRINCIPALS="http://localhost:8080/auth/v1/|group:admin" \
    SQLIB_CORS_ORIGINS="$SQLIB_WEB_ORIGINS" \
    FEATURE_QUERIES="true" \
    FEATURE_BACKENDS="true" \
    FEATURE_DATA_GRAPHS="true" \
    INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
    LIBRARY_STORAGE_DIR="./tmp/graph-access-demo-store" \
    INTERNAL_OXIGRAPH_STORE_ID="graph-access-demo-store" \
    SQLIB_AUTH_STORE_DIR="./tmp/graph-access-demo-auth" \
    INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
    NODE_ENV="development" \
    OTEL_ENABLED="false" \
    MCP_TRANSPORT="dual-http" \
    HTTP_PORT=3005 \
        pnpm --filter @sparql-query-lib/api exec tsx ../mcp-server/src/cli.ts &
    api_pid=$!
    NUXT_PUBLIC_API_BASE_URL="http://localhost:3005" \
    NUXT_PUBLIC_AUTH_CLIENT_ID="sqlib-web" \
    NUXT_PUBLIC_AUTH_SCOPE="openid profile email groups" \
    NUXT_PUBLIC_FEATURE_QUERIES="true" \
    NUXT_PUBLIC_FEATURE_BACKENDS="true" \
    NUXT_PUBLIC_FEATURE_DATA_GRAPHS="true" \
        pnpm --filter @sparql-query-lib/web exec nuxt dev --port 3001 --strictPort &
    web_pid=$!
    trap 'kill "$api_pid" "$web_pid" 2>/dev/null || true' INT TERM EXIT
    echo
    echo "Graph access demo: open http://localhost:3001"
    echo "  admin@localhost  password: $RAUTHY_ADMIN_PASSWORD"
    echo "  alice@localhost, bob@localhost, carol@localhost  password: $DEMO_USER_PASSWORD"
    echo
    wait "$api_pid" "$web_pid"

# Stop the graph access demo's Rauthy, keeping its users and clients
[group('demos')]
demo-graph-access-down: rauthy-down

# Delete the graph access demo: sqlib's stores, Rauthy's volume and the secrets
[group('demos')]
clean-graph-access-demo: clean-rauthy
    rm -rf packages/api/tmp/graph-access-demo-store packages/api/tmp/graph-access-demo-auth

# ---------------------------------------------------------------------------
# Observability and tests
# ---------------------------------------------------------------------------

# Grafana on :3030, OTLP on 4318 (HTTP) and 4317 (gRPC). See
# docs/guides/observability.md.
#
# Start the local observability stack (grafana/otel-lgtm)
[group('observability')]
lgtm-up:
    docker compose -f docker-compose.dev.yml up -d lgtm

# Stop the local observability stack and lose its data, which is in memory
[group('observability')]
lgtm-down:
    docker compose -f docker-compose.dev.yml down

# Runs against local emulators: MinIO (S3), Azurite (Azure Blob) and
# fake-gcs-server (GCS). Needs Go on the first run, to build the emulators;
# they are cached after that. `just test-replication s3` runs one store.
#
# Run the SQLite backup integration test against local storage emulators
[group('test')]
test-replication stores="s3 abs gs": _setup
    pnpm --filter "@sparql-query-lib/api..." build
    STORES="{{stores}}" bash scripts/ci/litestream-it.sh

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Check Node and pnpm, then install the workspace dependencies. pnpm returns in
# about a second when node_modules already matches pnpm-lock.yaml.
[private]
_setup:
    #!/usr/bin/env bash
    set -euo pipefail
    want=$(cat .nvmrc)
    if ! command -v node >/dev/null 2>&1; then
        echo "sqlib needs Node $want (see .nvmrc). Install it, then run just again." >&2
        exit 1
    fi
    have=$(node -p 'process.versions.node.split(".")[0]')
    if [ "$have" -lt "$want" ]; then
        echo "sqlib needs Node $want; this is Node $(node --version). Install Node $want, then run just again." >&2
        exit 1
    fi
    if ! command -v pnpm >/dev/null 2>&1; then
        echo "sqlib needs pnpm. Install it with: npm install --global pnpm@11.1.2" >&2
        exit 1
    fi
    pnpm install --frozen-lockfile

# Build the packages the API cannot run from source.
#
# `tsx` resolves workspace imports through packages/api/tsconfig.json's `paths`,
# which map contracts, types, srl, runtime, compiler, runtime-duckdb,
# runtime-etl and runtime-srl to `src`. They do not map tools (loaded by
# mcp-server), rdf-delta (imported across api/src) or mcp-app (whose ui://
# Views mcp-server serves). Those three resolve through exports maps that point
# only at `dist`. mcp-app's build also copies its Views and kit beside the
# built module, so a `tsc`-only build is not enough.
#
# The trailing `...` selects each package and its workspace dependencies, in
# topological order. That pulls in contracts, which tools/dist imports. A plain
# `--filter @sparql-query-lib/tools` builds that one package, and fails with
# TS2307 on a tree where contracts was never built.
[private]
_build-deps: _setup
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build

# Free ports 3005 and 3001 if this checkout holds them, for `dev` and `dev-auth`.
# A listener whose working directory is inside this repository has its process
# group stopped, which also stops the tsx or nuxt watcher above it. Any other
# holder (another checkout, or a container, named by its compose working
# directory) stops the recipe, with the holder named. Without `ss` (macOS), the
# check is skipped and a busy port fails when the server starts.
[private]
_free-dev-ports:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v ss >/dev/null 2>&1 || exit 0
    repo="{{justfile_directory()}}"
    for port in 3005 3001; do
        [ -z "$(ss -ltnH "sport = :$port")" ] && continue
        pids=$(ss -ltnpH "sport = :$port" | grep -oP 'pid=\K[0-9]+' | sort -u || true)
        if [ -z "$pids" ]; then
            # No PID visible: a container's docker-proxy, or another user's process.
            holder=$(docker ps --filter "publish=$port" \
                --format '{{{{.Names}} (from {{{{.Label "com.docker.compose.project.working_dir"}})' 2>/dev/null || true)
            echo "Port $port is held by ${holder:-a process this user cannot see}, not by this checkout." >&2
            exit 1
        fi
        for pid in $pids; do
            cwd=$(readlink "/proc/$pid/cwd" || true)
            if [[ "$cwd" != "$repo" && "$cwd" != "$repo"/* ]]; then
                echo "Port $port is held by PID $pid, started in ${cwd:-an unknown directory}, not this checkout:" >&2
                ps -o args= -p "$pid" >&2
                exit 1
            fi
            echo "Stopping this checkout's previous server on port $port (PID $pid)."
            kill -TERM -- "-$(ps -o pgid= -p "$pid" | tr -d ' ')" 2>/dev/null || kill -TERM "$pid"
        done
        for _ in $(seq 50); do [ -z "$(ss -ltnH "sport = :$port")" ] && break; sleep 0.1; done
        if [ -n "$(ss -ltnH "sport = :$port")" ]; then
            echo "Port $port is still in use 5 seconds after stopping the previous server." >&2
            exit 1
        fi
    done
