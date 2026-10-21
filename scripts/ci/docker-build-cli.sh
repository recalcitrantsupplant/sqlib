#!/usr/bin/env bash
# Build the example CLI image and run each command in it on the sample files.
#
# The CLI's own tests run its commands in process. This proves the packaged
# thing: that `pnpm deploy` carried every workspace package and DuckDB's
# native binding into the image, and that the binary runs there.
source "$(dirname "$0")/lib.sh"

IMAGE="${IMAGE:-sqlib-cli:ci}"
SAMPLE="$REPO_ROOT/examples/docker/cli-minimal/sample"

log "build $IMAGE"
docker build -f "$REPO_ROOT/examples/docker/cli-minimal/Dockerfile" -t "$IMAGE" "$REPO_ROOT"

run() { docker run --rm -v "$SAMPLE:/work:ro" "$IMAGE" "$@"; }
expect() {
  local name="$1" needle="$2" output="$3"
  if ! grep -qF -- "$needle" <<<"$output"; then
    warn "$name: expected output containing: $needle"
    printf '%s\n' "$output" | sed -n '1,40p'
    exit 1
  fi
  log "$name: ok"
}

expect query '"value": "http://ex/ann"' \
  "$(run query --file by-city.rq --data people.ttl --arg 'city=<http://ex/Perth>')"
expect rules '<http://ex/ann> <http://ex/anc> <http://ex/di> .' \
  "$(run rules run --srl anc.srl --data people.ttl)"
expect etl '<http://ex/c/1> <http://ex/name> "Ann Lee" .' \
  "$(run etl run --job job.json)"
expect check 'anc.srl: ok' \
  "$(run check by-city.rq anc.srl construct.rq)"
