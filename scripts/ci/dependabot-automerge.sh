#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Auto-merge Dependabot bumps that CI has already proven green.
#
# IMPORTANT: this repo is private on the free plan, so branch protection and
# required status checks are unavailable (the API returns 403). That means the
# calling job's `needs: [verify, test, image]` is the ONLY gate keeping a red PR
# from merging. If you ever call this from a job that does not depend on all
# three, you have removed the safety net.
#
# `image` is in that list because of a specific failure: a Docker base-image
# bump merged itself green and broke every publish afterwards, since nothing in
# the PR pipeline built the image.
#
# Note also that `e2e` does not run on pull requests (it is workflow_dispatch
# only), so "green" here means lint + typecheck + build + unit tests + a
# successful image build.
#
# Inputs (all via env, supplied by ci.yml from dependabot/fetch-metadata):
#   PR_URL            the pull request to merge
#   UPDATE_TYPE       e.g. version-update:semver-patch
#   DEPENDENCY_NAMES  comma-separated, for logging only
#   MERGE_METHOD      squash (default) | merge | rebase
#   DRY_RUN           set to any non-empty value to log without merging
#
# Local dry run:
#   PR_URL=https://github.com/o/r/pull/1 UPDATE_TYPE=version-update:semver-patch \
#     DRY_RUN=1 bash scripts/ci/dependabot-automerge.sh

PR_URL="${PR_URL:-}"
UPDATE_TYPE="${UPDATE_TYPE:-}"
DEPENDENCY_NAMES="${DEPENDENCY_NAMES:-unknown}"
MERGE_METHOD="${MERGE_METHOD:-squash}"

# Bumps we trust to land unattended. Majors always wait for a human. For grouped
# updates fetch-metadata reports the highest update type in the group, so a
# group containing a major is held back as a whole.
ALLOWED="version-update:semver-patch version-update:semver-minor"

if [ -z "$PR_URL" ] || [ -z "$UPDATE_TYPE" ]; then
  warn "PR_URL or UPDATE_TYPE not set; nothing to merge"
  exit 0
fi

case " $ALLOWED " in
  *" $UPDATE_TYPE "*) ;;
  *)
    log "$UPDATE_TYPE is not auto-mergeable; leaving $PR_URL for review"
    exit 0
    ;;
esac

log "auto-merging $UPDATE_TYPE ($DEPENDENCY_NAMES): $PR_URL"

if [ -n "${DRY_RUN:-}" ]; then
  log "DRY_RUN set; would run: gh pr merge --$MERGE_METHOD --delete-branch"
  exit 0
fi

# A failure here is usually "not mergeable" (conflicts, or the branch is behind
# and needs a Dependabot rebase). Surface it rather than swallowing it.
if ! gh pr merge "--$MERGE_METHOD" --delete-branch "$PR_URL"; then
  warn "merge failed for $PR_URL — likely conflicts or a stale branch."
  warn "comment '@dependabot rebase' on the PR, or merge it by hand."
  exit 1
fi
