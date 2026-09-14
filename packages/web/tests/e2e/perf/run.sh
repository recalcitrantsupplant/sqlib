#!/usr/bin/env bash
# Convenience runner: ./tests/e2e/perf/run.sh <spec> [base-url]
# Defaults to the diagnostic report against the local preview server.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PERF_BASE="${2:-http://localhost:3002}"
exec npx playwright test "tests/e2e/perf/${1:-diagnose}" --reporter=list
