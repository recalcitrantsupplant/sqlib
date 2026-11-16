#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Merge the open lockfile refresh pull request, after ci.yml has passed every
# gate on its branch. ci.yml calls this only from a workflow_dispatch run on
# $BRANCH, from a job that `needs` every gate.
#
# The merge names the commit that CI tested (--match-head-commit). If the
# branch moved after CI started, GitHub refuses the merge and the newer run
# merges instead.
#
# Inputs (env):
#   GH_TOKEN   token with contents and pull-requests write
#   BRANCH     default deps/lockfile-refresh
#   HEAD_SHA   the commit CI tested (github.sha)
#   DRY_RUN    any non-empty value: log without merging
BRANCH="${BRANCH:-deps/lockfile-refresh}"
HEAD_SHA="${HEAD_SHA:-}"

if [ -z "$HEAD_SHA" ]; then
  warn "HEAD_SHA not set; nothing to merge"
  exit 0
fi

pr="$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty')"
if [ -z "$pr" ]; then
  log "no open pull request for $BRANCH; nothing to merge"
  exit 0
fi

log "merging #$pr at $HEAD_SHA"
if [ -n "${DRY_RUN:-}" ]; then
  log "DRY_RUN: gh pr merge $pr --squash --delete-branch --match-head-commit $HEAD_SHA"
  exit 0
fi

if ! gh pr merge "$pr" --squash --delete-branch --match-head-commit "$HEAD_SHA"; then
  warn "merge failed for #$pr: the branch moved, or it conflicts with $TRUNK."
  warn "run the Lockfile refresh workflow again, or merge #$pr by hand."
  exit 1
fi
