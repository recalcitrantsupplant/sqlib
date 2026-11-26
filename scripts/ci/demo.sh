#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Seeds the Rail demo (demo/) into an empty store, as `just demo` and
# Dockerfile.demo do. The manifests call the API, so a change to a route that
# they use fails here.
#
# The runner is shared, so the seeding API takes a free port. The issuer takes
# the next port.

free_port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
OUT="${RUNNER_TEMP:-/tmp}/demo-$$"
trap 'rm -rf "$OUT" "$OUT.log"' EXIT

log "demo: building the api's workspace dependencies"
pnpm --filter '@sparql-query-lib/api^...' run build

log "demo: seeding the Rail demo"
LIBRARY_STORAGE_DIR="$OUT/store" ETL_OUTPUT_DIR="$OUT/etl-output" \
DEMO_API_DIR="$REPO_ROOT/packages/api" DEMO_API_CMD="node_modules/.bin/tsx src/index.ts" \
DEMO_SEED_PORT="$(free_port)" \
  sh demo/scripts/seed.sh | tee "$OUT.log"

# Every exercise of the two tutorials must pass with its solution. The Rail
# library keeps one test that fails on purpose, so only the tutorials are checked.
log "demo: checking the tutorial exercises"
for library in sparql-tutorial sqlib-tutorial; do
  grep -Eq "recorded test runs in urn:sqlib:library:${library}: ([0-9]+)/\1 passed" "$OUT.log" \
    || { echo "demo: an exercise in ${library} fails with its solution" >&2; exit 1; }
done
