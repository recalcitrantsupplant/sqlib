#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Move every package in pnpm-lock.yaml, direct and transitive, to the newest
# version that the ranges in the package.json files allow.
#
# Dependabot version updates bump direct dependencies only. A transitive
# dependency stays at the version that was resolved when it entered the
# lockfile, until one of its parents changes. Dependabot security updates
# opened no pull request for the transitive alerts in this repository
# (2026-11: 19 open alerts, all transitive, none with a PR). This step closes
# that gap. A trial on 2026-11-16 cleared 16 of those 19 alerts.
#
# `--no-save` keeps the package.json ranges as they are, so only the lockfile
# changes and every move stays inside a range a person chose.
#
# Prints `changed=true|false` to $GITHUB_OUTPUT when it runs in Actions.
log "pnpm update, all depths, ranges unchanged"
pnpm update -r --depth Infinity --no-save

if git diff --quiet -- pnpm-lock.yaml; then
  log "pnpm-lock.yaml unchanged"
  changed=false
else
  git --no-pager diff --stat -- pnpm-lock.yaml
  changed=true
fi

# Only the lockfile may change. Anything else means the update did more than
# this step claims, so stop and let a person look.
other="$(git status --porcelain --untracked-files=no -- . ':!pnpm-lock.yaml')"
if [ -n "$other" ]; then
  warn "files other than pnpm-lock.yaml changed:"
  printf '%s\n' "$other" >&2
  exit 1
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "changed=$changed" >> "$GITHUB_OUTPUT"
fi
