#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Conventional-commits check. BLOCKING.
#
# Decision D3 was "warn first, enforce later", and this was the warn half. Later
# arrived with release automation: .github/workflows/release-please.yml derives
# the next version and the changelog from these subjects, so a commit that does
# not parse is no longer untidy — it is invisible. It produces no version bump
# and no changelog line, silently, and the release that omits it looks entirely
# normal. A warning nobody has to act on cannot hold that up.
#
# Safe to turn on because the history already adopted the convention; this
# enforces what is being written anyway rather than asking for new habits.
#
# Runs on pull requests only (see the `if` in ci.yml): it needs two endpoints to
# diff, and a push to the trunk branch has no base ref to compare against.
range="${COMMITLINT_RANGE:-}"
if [ -z "$range" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
  git fetch --quiet --depth=100 origin "$GITHUB_BASE_REF" 2>/dev/null || true
  range="origin/$GITHUB_BASE_REF..HEAD"
fi

if [ -z "$range" ]; then
  warn "commitlint: no commit range to check; skipping"
  exit 0
fi

log "commitlint on $range"
status=0
pnpm exec commitlint --from "${range%%..*}" --to "${range##*..}" || status=$?
if [ "$status" -ne 0 ]; then
  warn "the commits above are not Conventional Commits, so release-please would"
  warn "skip them: no version bump, no changelog entry. Reword them (git rebase"
  warn "-i, or amend if it is the only one) and force-push."
fi
exit "$status"
