# The addresses the Rauthy recipes serve sqlib on, for `rauthy-up`, `dev-auth`,
# `demo-graph-access` and the recipes that stop Rauthy. They are set here rather than read from
# tmp/auth-demo/.env, which an older run may have written with other ports.
rauthy_addresses := "SQLIB_AUTH_RESOURCE=http://localhost:3005/mcp SQLIB_WEB_ORIGINS=http://localhost:3001"

# Every feature flag on, for `dev` and `dev-auth`
all_features := "FEATURE_NOTEBOOK=true FEATURE_QUERIES=true FEATURE_QUERY_GROUPS=true FEATURE_RULES_SUITE=true FEATURE_BENCHMARKS=true FEATURE_TESTS=true FEATURE_DATA_GRAPHS=true FEATURE_TUPLE_SETS=true FEATURE_ARGUMENT_SETS=true FEATURE_MCP=true FEATURE_ETL=true FEATURE_BACKENDS=true FEATURE_SETTINGS=true FEATURE_RULES_ALLOW_INVALID_SAVE=true FEATURE_RULE_TUPLES=true FEATURE_RULE_AGGREGATES=true FEATURE_PLAYGROUND_QUERIES=true FEATURE_PLAYGROUND_RULES=true FEATURE_PLAYGROUND_ETL=true FEATURE_ASSISTANT=true"

# The default recipe: API, MCP and frontend together, every feature flag on,
# writes allowed
#
# The library store is SQLite, in packages/api/tmp/library-store/library.sqlite.
# run-local-memory keeps its Oxigraph snapshot in the same directory, so
# `just clean-local-memory` resets both, but the two recipes do not share data.
# To copy the Oxigraph snapshot into the SQLite store, run this from
# packages/api with the API stopped:
#
#     INTERNAL_BACKEND_TYPE=sqlite LIBRARY_STORAGE_DIR=./tmp/library-store \
#         pnpm import:library-store --file ./tmp/library-store/library_store.nq
#
# The flags are exported once and both
# processes read them: the API reads FEATURE_*, and nuxt.config.ts falls back to
# FEATURE_* when NUXT_PUBLIC_FEATURE_* is unset.
#
# The off-by-default flags are on here: ETL and its playground (arbitrary DuckDB
# SQL), the assistant, the SRL TUPLE and AGGREGATE extensions, and saving
# unparseable rules. SQLIB_READ_ONLY and MCP_READ_ONLY are set to false so a
# value left in your shell cannot make this run read-only. Ctrl-C stops both
# processes.
#
# Before starting, it frees 3005 and 3001 if this checkout holds them: a
# listener whose working directory is inside this repo has its process group
# stopped, which takes the tsx or nuxt watcher above it down too. Anything else
# on those ports — another checkout, or a container (named by its compose
# working directory) — stops the recipe with the holder named.
#
# The web app runs with --strictPort. Without it, Nuxt moves to another port
# when 3001 is busy, and the API's CORS allowlist only names 3001, so every
# API call from the page fails its CORS check. `dev-auth` and
# `demo-graph-access` start it the same way.
#
# What the build line builds, and why the trailing `...`: see run-local-memory.
#
# API:  http://localhost:3005
# MCP:  http://localhost:3005/mcp
# Web:  http://localhost:3001
dev: _free-dev-ports
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build
    export {{all_features}}
    export SQLIB_READ_ONLY=false MCP_READ_ONLY=false
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
    wait -n "$api_pid" "$web_pid"

# Start the local observability stack (grafana/otel-lgtm): Grafana on
# http://localhost:3030, OTLP on 4318 (HTTP) and 4317 (gRPC). See
# docs/guides/observability.md.
lgtm-up:
    docker compose -f docker-compose.dev.yml up -d lgtm

# Stop the local observability stack. Its data is in memory and is lost.
lgtm-down:
    docker compose -f docker-compose.dev.yml down

# Grafana Explore on the lgtm stack's Tempo, opened at one trace.
lgtm_trace_url := 'http://localhost:3030/explore?schemaVersion=1&panes=%7B%22a%22%3A%7B%22datasource%22%3A%22tempo%22%2C%22queries%22%3A%5B%7B%22refId%22%3A%22A%22%2C%22datasource%22%3A%7B%22type%22%3A%22tempo%22%2C%22uid%22%3A%22tempo%22%7D%2C%22queryType%22%3A%22traceql%22%2C%22query%22%3A%22{traceId}%22%7D%5D%2C%22range%22%3A%7B%22from%22%3A%22now-1h%22%2C%22to%22%3A%22now%22%7D%7D%7D'

# `dev`, with telemetry sent to the local observability stack
#
# Telemetry is off unless an OTLP endpoint is set, so plain `dev` sends
# nothing. This recipe starts grafana/otel-lgtm and sets the endpoint. In dev
# the slow query log takes runs of 200 ms and over and carries the query text
# and arguments; set SQLIB_SLOW_QUERY_MS or SQLIB_TELEMETRY_DETAIL to change
# that.
#
# Grafana: http://localhost:3030 (dashboard "sqlib"). Settings links to the
# dashboard, and each run result links to its trace.
dev-otel: lgtm-up
    trace_url='{{lgtm_trace_url}}'; \
    OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318" \
    OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-sqlib-dev}" \
    SQLIB_SLOW_QUERY_MS="${SQLIB_SLOW_QUERY_MS:-200}" \
    SQLIB_TELEMETRY_DETAIL="${SQLIB_TELEMETRY_DETAIL:-text+args}" \
    SQLIB_OBSERVABILITY_URL="${SQLIB_OBSERVABILITY_URL:-http://localhost:3030/d/sqlib/sqlib}" \
    SQLIB_TRACE_URL_TEMPLATE="${SQLIB_TRACE_URL_TEMPLATE:-$trace_url}" \
        just dev

# Free ports 3005 and 3001 if this checkout holds them, for `dev` and `dev-auth`
# (see `dev` for the rules)
_free-dev-ports:
    #!/usr/bin/env bash
    set -euo pipefail
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

# Run the API with the Oxigraph persistent in-memory backend, with MCP at /mcp
#
# The build line covers exactly the packages this recipe cannot get from
# source. `tsx` resolves workspace imports through packages/api/tsconfig.json's
# `paths`, which map contracts, types, srl, runtime, compiler, runtime-duckdb, runtime-etl and runtime-srl to `src` — but not tools
# (loaded by mcp-server), rdf-delta (imported across api/src/lib and
# api/src/routes), or mcp-app (whose `ui://` Views mcp-server serves). Those
# three resolve through their exports maps, which point only at `dist`.
#
# mcp-app's build also *copies* its Views and kit beside the built module, so a
# `tsc`-only build would leave `renderView` reading files that are not there.
#
# The trailing `...` is load-bearing: it selects each package *and its workspace
# dependencies*, built in topological order, which is what pulls in contracts —
# tools/dist imports @sparql-query-lib/contracts/schema from contracts/dist. A
# plain `--filter @sparql-query-lib/tools` runs that one package's script and
# nothing else, which is how this recipe came to fail with TS2307 on a tree
# where contracts had never been built.
#
# API:  http://localhost:3005
# MCP:  http://localhost:3005/mcp  (streamable HTTP, same transport as production)
run-local-memory:
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build
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

# Generate trusted localhost certificates for the HTTPS proxy (one-time setup).
setup-local-https:
    if ! command -v mkcert >/dev/null 2>&1; then \
        echo "mkcert is required. Install it from https://github.com/FiloSottile/mkcert" >&2; \
        exit 1; \
    fi
    mkdir -p certs
    mkcert -install
    mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1

# Run the API and MCP over trusted HTTPS via Traefik.
# API: https://localhost:3443
# MCP: https://localhost:3443/mcp
run-local-https:
    if [ ! -f certs/localhost.pem ] || [ ! -f certs/localhost-key.pem ]; then \
        echo "Missing certificates. Run: just setup-local-https" >&2; \
        exit 1; \
    fi
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build
    OTEL_ENABLED="${OTEL_ENABLED:-false}" HTTP_PORT=3300 HTTP_HOST=0.0.0.0 \
        pnpm --filter @sparql-query-lib/mcp-server dev:dual-http & \
    app_pid=$!; \
    docker compose -f docker-compose.mcp-https.yml up --remove-orphans traefik & \
    traefik_pid=$!; \
    cleanup() { kill "$app_pid" "$traefik_pid" 2>/dev/null || true; }; \
    trap cleanup INT TERM EXIT; \
    wait "$app_pid" "$traefik_pid"

# Run the built image plus Fuseki behind Traefik HTTPS on :3443, with no host
# pnpm process. Needs an image built by `just build-docker` tagged
# sparql-query-lib:aca-local, and the certificates from `just setup-local-https`.
run-docker-https:
    if [ ! -f certs/localhost.pem ] || [ ! -f certs/localhost-key.pem ]; then \
        echo "Missing certificates. Run: just setup-local-https" >&2; \
        exit 1; \
    fi
    docker compose -f docker-compose.mcp-https-image.yml up --remove-orphans

# Serve the MCP App harness — a minimal MCP Apps host for the ui:// Views
#
# Pair it with `just run-local-memory`: the harness page talks to that server's
# /mcp, renders a View in a sandboxed iframe and bridges its JSON-RPC back. It
# is how you see the bench without a host that supports MCP Apps.
run-mcp-app-harness:
    pnpm --filter @sparql-query-lib/mcp-app build
    pnpm --filter @sparql-query-lib/mcp-app dev:harness

# Check the MCP Apps door of a running server, without a browser
#
# Proves the protocol underneath the Views: that a UI-capable client is offered
# _meta.ui, that a plain one is not, and that every ui:// resource reads back as
# a self-contained document.
smoke-mcp-app endpoint="http://localhost:3005/mcp":
    node packages/mcp-app/dev/smoke.mjs {{endpoint}}

# Expose the local MCP server over public HTTPS, for testing a real web client
#
# Claude and ChatGPT connectors take a URL, not a command, and their servers
# have to reach it themselves. `just run-local-https` solves the HTTPS half with
# a locally trusted certificate, which satisfies a desktop app on this machine
# and is useless to claude.ai. A tunnel is the only way to test the web clients
# without deploying.
#
# Uses ngrok or cloudflared, whichever is installed; pass `tool=ngrok` or
# `tool=cloudflared` to choose. Neither needs an account for this: `ngrok http`
# and a cloudflared quick tunnel both issue a fresh random hostname per run.
#
# Start the server first, in another terminal:
#
#     MCP_READ_ONLY=1 just run-local-memory
#
# **The tunnel is public and unauthenticated, and that cannot be fixed here.** A
# custom connector authenticates with OAuth or with nothing, and neither Claude
# nor ChatGPT sends an HTTP basic-auth header, so a tunnel's basic-auth option
# would lock out a browser and not the client you are testing. What protects a
# quick tunnel is that the hostname is random, it dies with this process, and
# the server behind it publishes only what you started it with. Run it
# read-only, as above; the MCP page's "Read the catalogue" button reports which
# mode answered, so you can confirm that rather than assume it. Do not tunnel a
# server holding data you would mind a stranger reading.
#
# Give the client the printed https URL with /mcp on the end.
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
    # Checked before the tunnel opens: a tunnel to a dead port answers 502 to
    # the client, which reads in Claude as "unable to reach the connector" and
    # sends you looking at the tunnel rather than at the server you forgot to
    # start.
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

# Clean the local temporary database
clean-local-memory:
    rm -rf packages/api/tmp/library-store

# Run the API as a rules workbench, with the whole W3C SHACL 1.2 Rules suite
# loaded as runnable Tests
#
# Rules, data graphs and tests only — queries, query groups, benchmarks and ETL
# are off, so the rail is just the sections this is about. Pair it with
# `just run-frontend-rules`, which sets the matching flags for the SPA: the two
# are separate processes and each reads its own environment, so setting them
# only here would leave the rail showing sections the API no longer serves.
#
# The flags do two different jobs. FEATURE_QUERIES, FEATURE_QUERY_GROUPS,
# FEATURE_BENCHMARKS and FEATURE_ETL unregister their routes here as well as
# hiding their sections there; FEATURE_BACKENDS only hides the section, because
# /backends is registered unconditionally.
#
# Its own store, so a conformance suite never lands in the library you were
# working in. All 336 entries appear under TESTS: the eval, eval2 and examples
# tests run a rule set against a data graph and compare the inference graph; the
# syntax, well-formedness and stratification tests check the document itself.
# FEATURE_RULES_ALLOW_INVALID_SAVE is on because a third of those documents are
# *supposed* to be unparseable — they are stored anyway, and open in the rules
# editor with the parser's complaint in red. FEATURE_RULE_AGGREGATES is on
# because the suite's GROUP tests need it. Seeding is idempotent — restart as
# often as you like.
#
# The 336 are tagged as they are seeded, on two axes the directory cannot give
# you: what a test *exercises* (templates, negation, RDFS, blank nodes, …) and
# what it *asserts* (must accept, must reject, expects error). Group the Tests
# list by tag in the sidebar to see them, and run a tag — or several — from the
# tag button beside Run all. Re-running this recipe tags a store seeded before
# tags existed, without touching any tag you added yourself.
#
# What the build line builds, and why the trailing `...`: see run-local-memory.
#
# API:  http://localhost:3005
run-local-rules-tests:
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build
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

# The frontend for the above: the same feature set, so the rail matches the API
# Usage: just run-frontend-rules
run-frontend-rules API_URL="http://localhost:3005":
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

# Throw the rules-test store away, so the next run seeds a fresh one
clean-local-rules-tests:
    rm -rf packages/api/tmp/rules-tests-store

# UAT / demo for RDF Patch as an update query's output (#290)
#
# Seeds a library called "RDF Patch demo": a four-document catalogue, an archive
# named graph, and nine update queries that between them cover everything the
# preview has to say — raw counts against net counts, an update that turns out
# to be a no-op, a named graph in graphScope, a two-operation program whose
# second half reads what the first wrote, and a DROP GRAPH that is counted
# rather than diffed.
#
# Every query arrives pointed at the demo backend, so the flow is: open one,
# press Run, read the patch. RDF Patch is selected automatically for an update
# and asking for it *derives* — the store is not written. Applying is the
# separate, deliberate call it should be.
#
# The demo backend is in-process Oxigraph in `ephemeral` mode: writable, so
# apply and revert really change it, and never serialised, so undo is
# restarting this recipe. The *library* store is persistent, so the seeded
# entities survive a restart and seeding them again is a no-op.
#
# In process is also load-bearing rather than incidental: it is what gives the
# derivation an exact membership test (blank nodes included) and a fork to
# simulate multi-operation programs against. Point query 8 at an HTTP backend
# and it will refuse, correctly.
#
# Pair it with `just run-frontend-patch-demo`.
#
# What the build line builds, and why the trailing `...`: see run-local-memory.
#
# API:  http://localhost:3005
run-local-patch-demo:
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build
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

# The frontend for the above: the same feature set, so the rail matches the API
# Usage: just run-frontend-patch-demo
run-frontend-patch-demo API_URL="http://localhost:3005":
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

# Drive the demo end to end in a real browser against a real API.
#
# Not part of the CI e2e lane, which mocks the API at the network layer and so
# could not tell you whether the derivation is right — only whether the UI
# renders a fixture. This one starts nothing: bring up both halves first.
#
#   term 1:  just run-local-patch-demo
#   term 2:  just run-frontend-patch-demo
#   term 3:  just uat-patch-demo
uat-patch-demo API_URL="http://localhost:3005" WEB_URL="http://localhost:3001":
    PATCH_DEMO_API_URL="{{API_URL}}" \
    PATCH_DEMO_WEB_URL="{{WEB_URL}}" \
    pnpm --filter @sparql-query-lib/web test:e2e:uat

# Throw the patch demo's library away, so the next run seeds it fresh
clean-local-patch-demo:
    rm -rf packages/api/tmp/patch-demo-store

# Demo of graph access: who may read which graphs, with Rauthy in front
#
# Rauthy is the reference broker (docs/design/auth-architecture.md): it signs
# people in and puts their groups in the token. Here it runs in Docker on
# http://localhost:8080, and sqlib runs on the host in `required` auth mode:
#
#   API:    http://localhost:3005  (seeded with the "Graph access demo" library)
#   SPA:    http://localhost:3001
#   Rauthy: http://localhost:8080/auth/v1/admin
#
# Sign in as one of these. Everyone's password is in tmp/auth-demo/.env
# (DEMO_USER_PASSWORD; the administrator's is RAUTHY_ADMIN_PASSWORD):
#
#   admin@localhost   sqlib administrator: sees the Access screen, no policy
#   alice@localhost   group analysts: public + finance, may write queries
#   bob@localhost     group hr: public + finance + hr, saved queries only
#   carol@localhost   no group: public only, saved queries only
#
# Open the library and run "Everything I can see" as each of them. As admin,
# open Access > Graph policies, pick "Company data" and use Test as.
#
# The first run writes tmp/auth-demo/.env with fresh secrets and keeps it, so
# the passwords stay the same between runs. Needs Docker, openssl and jq.
# Ctrl-C stops sqlib; `just demo-graph-access-down` stops Rauthy, and
# `just clean-graph-access-demo` throws both stores away. What the build line
# builds, and why the trailing `...`: see run-local-memory.
#
# Run the graph access demo: sqlib in required auth mode behind Rauthy
demo-graph-access: rauthy-up
    #!/usr/bin/env bash
    set -euo pipefail
    set -a; . tmp/auth-demo/.env; set +a
    export {{rauthy_addresses}}
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build
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

# Stop the demo's Rauthy, keeping its users and clients
demo-graph-access-down: rauthy-down

# Throw the graph access demo away: sqlib's store, Rauthy's volume and the secrets
clean-graph-access-demo: clean-rauthy
    rm -rf packages/api/tmp/graph-access-demo-store packages/api/tmp/graph-access-demo-auth

# Start the local dev Rauthy on :8080, with sqlib's clients and the test people
#
# The reference broker in Docker (docker-compose.auth-demo.yml), set up for a
# sqlib API on :3005 and an SPA on :3001. `dev-auth` and `demo-graph-access`
# both start it, and share it. Safe to run again: it starts what is stopped
# and updates the clients and the people.
#
# The first run writes tmp/auth-demo/.env with fresh secrets and passwords and
# keeps it, so the passwords stay the same between runs. It prints them at the
# end. Needs Docker, openssl and jq.
#
#   admin@localhost   Rauthy group admin: a sqlib administrator
#   alice@localhost   group analysts
#   bob@localhost     group hr
#   carol@localhost   no group
#
# Rauthy's admin UI: http://localhost:8080/auth/v1/admin (as admin@localhost)
#
# Start the local dev Rauthy, with sqlib's clients and the test people
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

# Stop the local dev Rauthy, keeping its users and clients
rauthy-down:
    {{rauthy_addresses}} docker compose -f docker-compose.auth-demo.yml --env-file tmp/auth-demo/.env down

# Throw the local dev Rauthy away: its volume and tmp/auth-demo's secrets
clean-rauthy:
    -{{rauthy_addresses}} docker compose -f docker-compose.auth-demo.yml --env-file tmp/auth-demo/.env down -v
    rm -rf tmp/auth-demo

# Run `dev` behind Rauthy: every feature flag on, in `required` auth mode
#
# Starts the local dev Rauthy first (see rauthy-up), then the API and the SPA
# as `dev` does, but every request needs a token and the SPA signs you in
# through Rauthy. Use it to try grants, the Access screen and anything else
# that depends on who is calling.
#
# Sign in as admin@localhost to administer: Rauthy puts that user in the
# `admin` group, which SQLIB_AUTH_ADMIN_PRINCIPALS below makes a sqlib
# administrator. Sign in as alice, bob or carol in a private window to see what
# a person without grants sees, then grant them (or their group) access as the
# administrator. The recipe prints the passwords when it starts; they are also
# in tmp/auth-demo/.env.
#
# Its stores are its own, so `dev`'s data stays as it is: the library store in
# packages/api/tmp/dev-auth-store and the grants in
# packages/api/tmp/dev-auth-auth. `just clean-dev-auth` resets both.
# Ctrl-C stops sqlib; `just rauthy-down` stops Rauthy.
#
# API:    http://localhost:3005
# MCP:    http://localhost:3005/mcp
# Web:    http://localhost:3001
# Rauthy: http://localhost:8080/auth/v1/admin
#
# Run dev behind Rauthy: every feature flag on, in required auth mode
dev-auth: _free-dev-ports rauthy-up
    #!/usr/bin/env bash
    set -euo pipefail
    set -a; . tmp/auth-demo/.env; set +a
    export {{rauthy_addresses}}
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build
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
    wait -n "$api_pid" "$web_pid"

# Reset `dev-auth`'s library store and grants (Rauthy keeps its people; see clean-rauthy)
clean-dev-auth:
    rm -rf packages/api/tmp/dev-auth-store packages/api/tmp/dev-auth-auth

# Run locally without Docker, matching run-docker-local behavior with persistence and 60s checkpoints
run-local-like-docker:
    mkdir -p packages/api/tmp/library-store
    INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
    LIBRARY_STORAGE_DIR="./tmp/library-store" \
    INTERNAL_OXIGRAPH_STORE_ID="library-store" \
    INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
    pnpm --filter @sparql-query-lib/api run dev

# Build a Docker image with a specific tag
# Usage: just build-docker 0.0.17
build-docker TAG="latest":
    docker build --network=host -t sparql-query-lib:{{TAG}} .

# Run the locally built Docker image with persistent store, volume mount, and 60s checkpoints
# Usage: just run-docker-local 0.0.17
run-docker-local TAG="latest":
    mkdir -p tmp/library-store-docker
    docker run -it --rm \
        -p 3005:3000 \
        -v ./tmp/library-store-docker:/app/packages/api/tmp/library-store \
        -e INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
        -e LIBRARY_STORAGE_DIR="/app/packages/api/tmp/library-store" \
        -e INTERNAL_OXIGRAPH_STORE_ID="library-store" \
        -e INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
        -e OTEL_ENABLED="false" \
        -e CACHE_WRITE_THROUGH="true" \
        sparql-query-lib:{{TAG}}

# Run Docker with persistence
run-docker-persistent TAG="latest":
    mkdir -p tmp/library-store-docker
    docker run -it --rm -p 3000:3000 -v ./tmp/library-store-docker:/app/packages/api/tmp/library-store -e INTERNAL_BACKEND_TYPE="oxigraph-persistent" -e APP_MODE="api" -e LIBRARY_STORAGE_DIR="/app/packages/api/tmp/library-store" -e INTERNAL_OXIGRAPH_STORE_ID="library-store" -e FASTIFY_ADDRESS="0.0.0.0" sparql-query-lib:{{TAG}}

# Build the web UI bundle image: the static site at /site, to copy out and
# deploy, not to run. See Dockerfile.web.
# Usage: just build-web-image 0.0.17
build-web-image TAG="latest":
    docker build --network=host -t sqlib-web:{{TAG}} -f Dockerfile.web .

# Copy the static site out of a bundle image.
#
# `docker create` + `docker cp`, with the container never started: the image
# has no server in it. DEST must not already exist — `docker cp` would copy
# `site/` *into* it rather than over it.
# Usage: just extract-web-bundle 0.0.17 tmp/web-bundle
extract-web-bundle TAG="latest" DEST="tmp/web-bundle":
    test ! -e "{{DEST}}" || (echo "{{DEST}} already exists — remove it or pass another DEST" && exit 1)
    mkdir -p "$(dirname "{{DEST}}")"
    docker create --name sqlib-web-extract sqlib-web:{{TAG}} >/dev/null
    docker cp sqlib-web-extract:/site "{{DEST}}"; status=$?; docker rm sqlib-web-extract >/dev/null; exit $status
    @echo "extracted to {{DEST}} — serve it with any static host, and put /config.json beside index.html"

# Run the frontend against any backend URL
#
# No sibling builds, here or in the two recipes above that pair with an API:
# packages/web aliases @sparql-query-lib/{contracts,types,runtime} to source in
# both nuxt.config.ts and tsconfig.json, precisely so `pnpm dev` never waits on
# another package's dist.
#
# Usage: just run-frontend
# Usage: just run-frontend https://example.com/
run-frontend API_URL="http://localhost:3005":
    NUXT_PUBLIC_API_BASE_URL="{{API_URL}}" \
    pnpm --filter @sparql-query-lib/web dev

# The SQLite backup integration test, against local emulators: MinIO (S3),
# Azurite (Azure Blob) and fake-gcs-server (GCS). Builds the API first. Needs Go
# on the first run, to build the emulators; they are cached after that.
# `just test-replication s3` runs one store.
test-replication stores="s3 abs gs":
    pnpm --filter "@sparql-query-lib/api..." build
    STORES="{{stores}}" bash scripts/ci/litestream-it.sh
