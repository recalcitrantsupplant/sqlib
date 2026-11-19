#!/usr/bin/env bash
# Request-rate floor for the built API server, against a mock SPARQL endpoint
# and an in-memory store. Runs after build.sh, because it starts
# packages/api/dist/index.js. See packages/api/scripts/throughput-smoke.ts.
source "$(dirname "$0")/lib.sh"

log "throughput: minimum request rate of the built server"
pnpm --filter @sparql-query-lib/api smoke:throughput
