#!/usr/bin/env bash
# Shared helpers for CI scripts. Source this at the top of each script:
#   source "$(dirname "$0")/lib.sh"
#
# Design note: all CI logic lives in these shell scripts, NOT in the GitHub
# Actions YAML. The workflow is a thin dispatcher that calls them, so every
# step is runnable locally with plain `bash scripts/ci/<step>.sh`.

set -euo pipefail

# Repo root = two levels up from scripts/ci/.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# The trunk branch. Override with TRUNK=... if it ever changes.
TRUNK="${TRUNK:-main}"

log()  { printf '\033[1;34m[ci]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ci:warn]\033[0m %s\n' "$*" >&2; }

# --- step timing ------------------------------------------------------------
#
# Every script that sources lib.sh is timed, and its duration reported in the
# job summary. If scripts/ci/budgets.txt names a budget for it, going over that
# budget raises a warning annotation on the run.
#
# Why an alert and not a ratchet. This repo already ratchets two things
# (`scripts/count-any.mjs`, the typecheck baseline) and both work for the same
# reason: the number they measure is deterministic. Re-run the job and you get
# the same count. Wall-clock time is not that number. The 2026-08-27 publish
# took 12m30s and the one before it took 82s on byte-identical work, entirely
# because the first had a cold BuildKit cache and a slow Docker Hub. A hard gate
# on a metric with that variance fails honest PRs, gets `|| true`-ed within a
# fortnight, and is then worse than nothing — the same "a ratchet nobody runs is
# a comment" failure any-ratchet.sh was written to fix, arrived at from the
# other end.
#
# So: time alerts, and ratchet a deterministic proxy instead if you want a gate
# (image size and lockfile package count are the two candidates here).
#
# Timing is best-effort throughout. Nothing below may change a step's exit code.
__ci_step_started="$(date +%s)"
__ci_step_name="$(basename "${BASH_SOURCE[1]:-unknown}")"

__ci_report_duration() {
  local status=$?
  local elapsed=$(( $(date +%s) - __ci_step_started ))
  local budgets="$REPO_ROOT/scripts/ci/budgets.txt"
  local budget=""

  if [ -f "$budgets" ]; then
    budget="$(awk -v n="$__ci_step_name" '$1 == n { print $2; exit }' "$budgets" 2>/dev/null || true)"
  fi

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s — %ds%s\n\n' "$__ci_step_name" "$elapsed" \
      "${budget:+ (budget ${budget}s)}" >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || true
  fi

  if [ -n "$budget" ] && [ "$elapsed" -gt "$budget" ]; then
    # ::warning:: is the annotation form; it shows on the run and the PR without
    # failing anything. Deliberately not ::error::.
    printf '::warning title=CI time budget::%s took %ds, over its %ds budget. Either something regressed, or the budget in scripts/ci/budgets.txt is stale — raise it in a commit that says why.\n' \
      "$__ci_step_name" "$elapsed" "$budget" || true
    warn "$__ci_step_name took ${elapsed}s (budget ${budget}s)"
  else
    log "$__ci_step_name took ${elapsed}s"
  fi

  return $status
}

trap __ci_report_duration EXIT

# Echo the git ref to diff against for "affected" detection, or empty string to
# signal "test everything" (trunk pushes, or when no base can be determined).
#
# Priority:
#   1. CI_TEST_MODE=full            -> "" (full run)
#   2. GITHUB_BASE_REF set (a PR)   -> origin/<base>
#   3. on the trunk branch          -> "" (full run)
#   4. local: merge-base vs origin/<trunk> if it exists, else "" (full run)
affected_base() {
  if [ "${CI_TEST_MODE:-}" = "full" ]; then
    echo ""; return
  fi
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    git fetch --quiet --depth=1 origin "$GITHUB_BASE_REF" 2>/dev/null || true
    echo "origin/$GITHUB_BASE_REF"; return
  fi
  if [ "${GITHUB_REF_NAME:-}" = "$TRUNK" ]; then
    echo ""; return
  fi
  if git rev-parse --verify --quiet "origin/$TRUNK" >/dev/null 2>&1; then
    echo "origin/$TRUNK"; return
  fi
  echo ""
}
