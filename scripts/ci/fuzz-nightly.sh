#!/usr/bin/env bash
# Nightly deep run of the query group property harness (docs §2.3, "CI shape").
#
# The PR suite already runs these files, but at a fixed seed and ~50 cases so it
# stays inside the unit-test budget. That makes it a regression net, not a
# search: the same 50 graphs every time. This run varies the seed and raises the
# case count by more than an order of magnitude, so consecutive nights actually
# explore new ground.
#
# The seed is printed before the run, not just on failure, so a red nightly can
# be reproduced with one command even if the log is truncated.
source "$(dirname "$0")/lib.sh"

RUNS="${PHASE2_FUZZ_RUNS:-1000}"
# A caller-supplied seed reproduces a specific night; otherwise the clock picks
# one. fast-check seeds are 32-bit, hence the modulus.
SEED="${PHASE2_FUZZ_SEED:-$(( $(date +%s) % 2147483647 ))}"

log "query group fuzz: runs=$RUNS seed=$SEED"
log "reproduce with: PHASE2_FUZZ_SEED=$SEED PHASE2_FUZZ_RUNS=$RUNS bash scripts/ci/fuzz-nightly.sh"

# `test/web/` is named alongside `test/phase2/` because the canvas round trip
# reads its budget from the same `fuzzBudget`, and a deep run that left it at the
# PR default would raise one half of the property and not the other: the graphs
# the generator explores and the graphs the canvas can save are the same graphs.
if ! PHASE2_FUZZ_RUNS="$RUNS" PHASE2_FUZZ_SEED="$SEED" \
  pnpm --filter @sparql-query-lib/api exec vitest run test/phase2/ test/web/; then
  warn "query group fuzz FAILED"
  warn "reproduce: PHASE2_FUZZ_SEED=$SEED PHASE2_FUZZ_RUNS=$RUNS bash scripts/ci/fuzz-nightly.sh"
  warn "fast-check prints the shrunk counterexample above; it is a complete graph spec."
  exit 1
fi

log "query group fuzz passed at seed $SEED"
