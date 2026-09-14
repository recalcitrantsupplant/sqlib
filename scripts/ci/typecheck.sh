#!/usr/bin/env bash
# Type checking for packages/web, as a ratchet rather than a pass/fail gate.
#
# The package accumulated type errors for a long time because nothing ran a
# checker (see issue #52). Gating on zero would mean the gate lands "later",
# which is how it got here. Gating on "no worse than the recorded count" costs
# nothing, works today, and makes the number a one-way door.
#
# When you fix errors the script tells you to lower the baseline — an unlowered
# baseline is slack that silently absorbs the next regression.
#
# The other packages typecheck as part of their build (tsc --project), so this
# covers the one that had no checker at all.
#
# ## Why the checker's exit status is load-bearing
#
# The count comes from grepping the checker's output for `error TS`, so a run
# that never checked a file counts zero — the same number a clean run produces.
# That is not hypothetical: issue #205 documents `vue-tsc` dying at startup on
# typescript 7 with ERR_PACKAGE_PATH_NOT_EXPORTED, before a single file is read.
# With the baseline now at 0 (#52), a crash and a perfect score are the same
# number, so the count alone cannot tell them apart and the gate would report
# green on a checker that did nothing.
#
# The exit status can. A checker either exits 0 (nothing to report) or exits
# non-zero having printed what it found — non-zero *and* nothing countable means
# it fell over, so we fail loudly instead of scoring it. That invariant is
# tool-agnostic: it holds for whatever `nuxi typecheck` shells out to next.
source "$(dirname "$0")/lib.sh"

BASELINE_FILE="${TYPECHECK_BASELINE_FILE:-$REPO_ROOT/packages/web/.typecheck-baseline}"

if [ ! -f "$BASELINE_FILE" ]; then
  warn "typecheck: no baseline at $BASELINE_FILE"
  warn "The ratchet has nothing to compare against. Restore the file, or record"
  warn "the current count with: echo <count> > packages/web/.typecheck-baseline"
  exit 1
fi

# Strict rather than `tr -dc '0-9'`: that silently turned an empty or corrupt
# file into an empty string, which made both comparisons below error out to
# false and the script exit 0 — a second way to pass without measuring anything.
baseline="$(tr -d '[:space:]' < "$BASELINE_FILE")"
if ! [[ "$baseline" =~ ^[0-9]+$ ]]; then
  warn "typecheck: baseline file $BASELINE_FILE does not hold a plain count (read: '$baseline')"
  exit 1
fi

log "typecheck: packages/web (baseline $baseline)"

# Overridable so the guards below can be exercised against a stub checker —
# see scripts/ci/ratchet-selftest.sh. Unset in CI, where the real one runs.
TYPECHECK_CMD="${TYPECHECK_CMD:-pnpm exec nuxi typecheck}"

# nuxi typecheck exits non-zero when there are any errors, which is expected
# while the baseline is above zero — hence `|| true` here and the explicit
# handling of $status below rather than letting `set -e` decide.
set +e
output="$(cd "$REPO_ROOT/packages/web" && eval "$TYPECHECK_CMD" 2>&1)"
status=$?
set -e

count="$(printf '%s\n' "$output" | grep -cE 'error TS' || true)"

if [ "$status" -ne 0 ] && [ "$count" -eq 0 ]; then
  printf '%s\n' "$output" | sed -n '1,40p'
  warn "typecheck: the checker exited $status without reporting a single 'error TS' line."
  warn "That is a crashed checker, not a clean tree — the count would read 0 either way."
  warn "See issue #205 for the known instance (vue-tsc cannot load typescript 7)."
  exit 1
fi

if [ "$count" -gt "$baseline" ]; then
  # `sed -n 1,40p` rather than `head -40`: head closes the pipe early, which
  # under `set -o pipefail` exits the script with SIGPIPE (141) before it can
  # report anything useful.
  printf '%s\n' "$output" | { grep -E 'error TS' || true; } | sed -n '1,40p'
  warn "typecheck: $count errors, baseline is $baseline — this change adds $((count - baseline))"
  warn "Fix them, or if they are genuinely pre-existing, explain why in the PR."
  exit 1
fi

if [ "$count" -lt "$baseline" ]; then
  log "typecheck: $count errors, down from $baseline — lower the baseline:"
  log "  echo $count > packages/web/.typecheck-baseline"
  # Not a failure: a green run that nags is friendlier than a red one that
  # blocks a genuine improvement.
fi

log "typecheck: $count errors (baseline $baseline) — no regression"
