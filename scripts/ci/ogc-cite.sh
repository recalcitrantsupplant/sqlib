#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# OGC API Features Part 1 conformance, with the OGC's own test suite (CITE,
# ets-ogcapi-features10) run in its TEAM Engine image against the plain
# starter set (docs/examples/ogc/plain). See docs/proposals/ogc-api-features.md.
#
# There is no CITE suite for Part 3 (filtering) yet, so the cql2 mode is
# covered by packages/api/test/server/ogcRoutes.cql2.test.ts only.
#
# Needs Docker. The suite runs in a container and reaches the server on the
# host through host.docker.internal, so every link the server writes uses
# that name (SQLIB_OGC_BASE_URL).

ETS_IMAGE="${ETS_IMAGE:-ogccite/ets-ogcapi-features10:1.8-teamengine-5.7}"
PORT="${OGC_CITE_PORT:-7740}"
TE_PORT="${OGC_CITE_TE_PORT:-7741}"
NAME="sqlib-ogc-cite-$$"
OUT="${RUNNER_TEMP:-/tmp}/ogc-cite-$$"
mkdir -p "$OUT"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

# The server runs from source with tsx, but reads the workspace packages it
# depends on from their dist.
log "ogc-cite: building the api's workspace dependencies"
pnpm --filter '@sparql-query-lib/api^...' run build

log "ogc-cite: starting the server on port $PORT"
OGC_CITE_PORT="$PORT" SQLIB_OGC_BASE_URL="http://host.docker.internal:$PORT" \
  pnpm --filter @sparql-query-lib/api exec tsx scripts/ogc-cite-server.ts > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 120); do
  curl -sf "http://localhost:$PORT/ogc/survey/conformance" >/dev/null && break
  sleep 1
done
curl -sf "http://localhost:$PORT/ogc/survey/conformance" >/dev/null || { cat "$OUT/server.log"; exit 1; }

log "ogc-cite: starting $ETS_IMAGE on port $TE_PORT"
docker run -d --name "$NAME" -p "$TE_PORT:8080" --add-host=host.docker.internal:host-gateway "$ETS_IMAGE" >/dev/null
for _ in $(seq 1 120); do
  curl -sf --max-time 10 -u ogctest:ogctest "http://localhost:$TE_PORT/teamengine/rest/suites" >/dev/null && break
  sleep 2
done
curl -sf --max-time 10 -u ogctest:ogctest "http://localhost:$TE_PORT/teamengine/rest/suites" >/dev/null || {
  warn "ogc-cite: TEAM Engine did not start"
  docker logs --tail 100 "$NAME" || true
  exit 1
}

# The suite reaches the server through host.docker.internal; check that route
# from inside the container before running anything.
if ! docker exec "$NAME" curl -sf --max-time 10 "http://host.docker.internal:$PORT/ogc/survey/conformance" >/dev/null 2>&1; then
  warn "ogc-cite: the container cannot reach http://host.docker.internal:$PORT (or has no curl)"
fi

IUT="http://host.docker.internal:$PORT/ogc/survey"
log "ogc-cite: running the suite against $IUT"
status="$(curl -s --max-time 1800 -u ogctest:ogctest -H 'Accept: application/xml' \
  "http://localhost:$TE_PORT/teamengine/rest/suites/ogcapi-features-1.0/run?iut=$(node -p 'encodeURIComponent(process.argv[1])' "$IUT")" \
  -o "$OUT/results.xml" -w '%{http_code}')"
if [ "$status" != "200" ]; then
  warn "ogc-cite: the suite answered HTTP $status"
  head -c 4000 "$OUT/results.xml" || true
  echo
  docker logs --tail 100 "$NAME" || true
  tail -50 "$OUT/server.log" || true
  exit 1
fi

# TestNG's summary: <testng-results ... failed="N" passed="N" skipped="N">.
summary="$(grep -o '<testng-results[^>]*>' "$OUT/results.xml" | head -1)"
log "ogc-cite: $summary"
failed="$(printf '%s' "$summary" | sed -n 's/.*failed="\([0-9]*\)".*/\1/p')"
if [ -z "$failed" ]; then
  warn "ogc-cite: no TestNG summary in the results"
  head -c 2000 "$OUT/results.xml"
  exit 1
fi
if [ "$failed" != "0" ]; then
  # Name each failed test and its message.
  node -e '
    const xml = require("fs").readFileSync(process.argv[1], "utf8");
    for (const m of xml.matchAll(/<test-method[^>]*status="FAIL"[^>]*name="([^"]*)"[\s\S]*?<message>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
      console.log(`FAIL ${m[1]}: ${m[2].trim().split("\n")[0]}`);
    }' "$OUT/results.xml"
  exit 1
fi
log "ogc-cite: all tests passed"
