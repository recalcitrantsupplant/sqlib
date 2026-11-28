#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Builds the Rail demo as a static site with the API in the browser
# (demo/scripts/build-browser-site.sh), then checks it in headless Chromium:
#
# 1. browser/test/parity.mjs sends the same calls to a Node server on the same
#    store and to the Worker. Every call must give the same status and body.
#    This covers queries, groups, rule sets, tests, notebooks and ETL. ETL loads
#    duckdb-wasm from jsDelivr, so the runner needs to reach it.
# 2. browser/test/site.mjs opens screens. No screen may log an error or load
#    anything from another origin.
# 3. browser/test/runs.mjs presses Run on a query and a group. No error may
#    be logged.

free_port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
OUT="${RUNNER_TEMP:-/tmp}/browser-demo-$$"
api_pid=""
trap '[ -n "$api_pid" ] && kill "$api_pid" 2>/dev/null; rm -rf "$OUT"' EXIT

# As in e2e.sh: `--with-deps` needs root, so ask for it only when sudo needs no
# password. PLAYWRIGHT_CHROMIUM_PATH names a Chromium to use instead.
if [ -z "${PLAYWRIGHT_CHROMIUM_PATH:-}" ]; then
  if sudo -n true 2>/dev/null; then
    pnpm --filter @sparql-query-lib/api exec playwright install --with-deps chromium
  else
    pnpm --filter @sparql-query-lib/api exec playwright install chromium
  fi
fi

log "browser-demo: building the workspace dependencies"
pnpm --filter '@sparql-query-lib/api^...' --filter '@sparql-query-lib/web^...' run build

log "browser-demo: building the site"
DEMO_STORE="$OUT/state/store/library.sqlite" DEMO_SEED_PORT="$(free_port)" \
  sh demo/scripts/build-browser-site.sh "$OUT/site"
du -sh "$OUT/site" "$OUT/site/sqlib-api"/*

log "browser-demo: starting the server on the same store"
port="$(free_port)"
(
  set -a; . demo/server.env; set +a
  # Writable, with the browser build's grants, as the Worker runs.
  node packages/api/browser/demo-grants.mjs demo/grants.ttl > "$OUT/grants.ttl"
  export NODE_ENV=production PORT="$port" \
    SQLIB_READ_ONLY=false SQLIB_DEMO_WRITABLE=true SQLIB_AUTH_ALLOW_LIBRARY_CREATE=all \
    LIBRARY_STORAGE_DIR="$OUT/state/store" ETL_OUTPUT_DIR="$OUT/state/etl-output" \
    OXIGRAPH_STORAGE_DIR="$OUT/state/oxigraph" SQLIB_AUTH_STORE_DIR="$OUT/state/auth" \
    SQLIB_DEMO_PEOPLE="$REPO_ROOT/demo/people.json" SQLIB_AUTH_SEED_GRANTS="$OUT/grants.ttl"
  cd packages/api
  exec node_modules/.bin/tsx src/index.ts
) > "$OUT/server.log" 2>&1 &
api_pid=$!
for _ in $(seq 1 120); do
  curl -sf "http://127.0.0.1:$port/health" > /dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$port/health" > /dev/null \
  || { cat "$OUT/server.log" >&2; echo "browser-demo: the server did not start" >&2; exit 1; }

cp packages/api/browser/harness.html "$OUT/site/sqlib-api/"
cd packages/api

log "browser-demo: comparing the Worker with the server"
node browser/test/parity.mjs "$OUT/site/sqlib-api" "http://127.0.0.1:$port"

log "browser-demo: opening screens"
node browser/test/site.mjs "$OUT/site" "$OUT/shots" / /queries /tests /backends

log "browser-demo: running a query and a group"
node browser/test/runs.mjs "$OUT/site" "$OUT/shots" \
  /queries/urn%3Asqlib%3Aquery%3Arail-departures-from-station \
  /queryGroups/urn%3Asqlib%3Agroup%3Arail-one-change-away
