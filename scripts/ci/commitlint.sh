#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Conventional-commits check. WARN-ONLY (Decision D3: warn first, enforce later).
# To make it blocking, change the final `exit 0` to `exit "$status"`.
range="${COMMITLINT_RANGE:-}"
if [ -z "$range" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
  git fetch --quiet --depth=100 origin "$GITHUB_BASE_REF" 2>/dev/null || true
  range="origin/$GITHUB_BASE_REF..HEAD"
fi

if [ -z "$range" ]; then
  warn "commitlint: no commit range to check; skipping"
  exit 0
fi

log "commitlint (warn-only) on $range"
status=0
pnpm exec commitlint --from "${range%%..*}" --to "${range##*..}" || status=$?
if [ "$status" -ne 0 ]; then
  warn "some commits are not Conventional Commits (non-blocking for now)"
fi
exit 0
