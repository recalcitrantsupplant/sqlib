# Run the API with the Oxigraph persistent in-memory backend, with MCP at /mcp
#
# The build line covers exactly the packages this recipe cannot get from
# source. `tsx` resolves workspace imports through packages/api/tsconfig.json's
# `paths`, which map contracts, types, srl and runtime to `src` — but not tools
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
# API:  http://localhost:3010
# MCP:  http://localhost:3010/mcp  (streamable HTTP, same transport as production)
#       — this recipe sets HTTP_PORT=3010; 3005 is the server's own default.
run-local-memory:
    pnpm --filter "@sparql-query-lib/tools..." --filter "@sparql-query-lib/rdf-delta..." --filter "@sparql-query-lib/mcp-app..." build
    INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
    LIBRARY_STORAGE_DIR="./tmp/library-store" \
    INTERNAL_OXIGRAPH_STORE_ID="library-store" \
    INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
    FEATURE_ASSISTANT=true \
    NODE_ENV="development" \
    OTEL_ENABLED="false" \
    RULESET_CANON_DEBUG="true" \
    MCP_TRANSPORT="dual-http" \
    HTTP_PORT=3010 \
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
smoke-mcp-app endpoint="http://localhost:3010/mcp":
    node packages/mcp-app/dev/smoke.mjs {{endpoint}}

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
# working in. All 205 entries appear under TESTS: the eval, eval2 and examples
# tests run a rule set against a data graph and compare the inference graph; the
# syntax, well-formedness and stratification tests check the document itself.
# FEATURE_RULES_ALLOW_INVALID_SAVE is on because a third of those documents are
# *supposed* to be unparseable — they are stored anyway, and open in the rules
# editor with the parser's complaint in red. Seeding is idempotent — restart as
# often as you like.
#
# The 205 are tagged as they are seeded, on two axes the directory cannot give
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

# Run locally without Docker, matching run-docker-local behavior with persistence and 60s checkpoints
run-local-like-docker:
    mkdir -p packages/api/tmp/library-store
    INTERNAL_BACKEND_TYPE="oxigraph-persistent" \
    LIBRARY_STORAGE_DIR="./tmp/library-store" \
    INTERNAL_OXIGRAPH_STORE_ID="library-store" \
    INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS="60000" \
    FEATURE_ETL_ENABLED="false" \
    FEATURE_RULES_ENABLED="false" \
    FEATURE_QUERIES_ENABLED="true" \
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
        -e FEATURE_ETL_ENABLED="false" \
        -e FEATURE_RULES_ENABLED="false" \
        -e FEATURE_QUERIES_ENABLED="true" \
        -e SQLIB_BACKEND_QMS_FUSEKI_DEV_USERNAME \
        -e SQLIB_BACKEND_QMS_FUSEKI_DEV_PASSWORD \
        sparql-query-lib:{{TAG}}

# Run Docker with persistence
run-docker-persistent TAG="latest":
    mkdir -p tmp/library-store-docker
    docker run -it --rm -p 3000:3000 -v ./tmp/library-store-docker:/app/packages/api/tmp/library-store -e INTERNAL_BACKEND_TYPE="oxigraph-persistent" -e APP_MODE="api" -e LIBRARY_STORAGE_DIR="/app/packages/api/tmp/library-store" -e INTERNAL_OXIGRAPH_STORE_ID="library-store" -e FEATURE_ETL_ENABLED="false" -e FEATURE_RULES_ENABLED="false" -e FEATURE_QUERIES_ENABLED="true" -e FASTIFY_ADDRESS="0.0.0.0" sparql-query-lib:{{TAG}}

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
run-frontend API_URL="http://localhost:3010":
    NUXT_PUBLIC_API_BASE_URL="{{API_URL}}" \
    pnpm --filter @sparql-query-lib/web dev
