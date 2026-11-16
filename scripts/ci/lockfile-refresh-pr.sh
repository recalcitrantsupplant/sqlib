#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Commit the refreshed pnpm-lock.yaml to $BRANCH, open or update its pull
# request, and start CI on that branch.
#
# CI has to be started by hand. A push or a pull request made with the
# workflow's GITHUB_TOKEN does not start other workflows; workflow_dispatch is
# the exception. ci.yml then runs every gate on the branch, and its
# lockfile-refresh-automerge job merges the pull request when they all pass.
#
# $BRANCH belongs to this job. Each run rebuilds it from main and force-pushes,
# so a refresh that nobody merged is replaced by the next one.
#
# Inputs (env):
#   GH_TOKEN   token with contents, pull-requests and actions write
#   BRANCH     default deps/lockfile-refresh
#   DRY_RUN    any non-empty value: log the commands, change nothing remote
BRANCH="${BRANCH:-deps/lockfile-refresh}"
TITLE="chore(deps): refresh pnpm-lock.yaml"

run() {
  if [ -n "${DRY_RUN:-}" ]; then
    log "DRY_RUN: $*"
  else
    "$@"
  fi
}

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -B "$BRANCH"
git add pnpm-lock.yaml
git commit -m "$TITLE" -m "Move every package to the newest version inside its current range (scripts/ci/lockfile-refresh.sh)."
run git push --force origin "$BRANCH"

body="$(cat <<BODY
Weekly refresh of \`pnpm-lock.yaml\` by \`.github/workflows/lockfile-refresh.yml\`.

Every package, direct and transitive, moves to the newest version that its current range allows. No \`package.json\` changes. This picks up fixes for transitive dependencies, which Dependabot does not update.

CI runs on this branch through \`workflow_dispatch\`. The \`lockfile-refresh-automerge\` job in \`ci.yml\` merges this pull request when every gate passes.
BODY
)"

existing="$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty')"
if [ -n "$existing" ]; then
  log "pull request #$existing already open; the push updated it"
else
  run gh pr create --base "$TRUNK" --head "$BRANCH" --title "$TITLE" --body "$body"
fi

run gh workflow run ci.yml --ref "$BRANCH"
log "started CI on $BRANCH"
