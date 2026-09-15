#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Point pnpm at a store that outlives the job.
#
# `pnpm/action-setup` installs pnpm into ~/setup-pnpm and recreates that
# directory on every run. pnpm's default store then resolves to
# ~/setup-pnpm/node_modules/.bin/store/v11 — inside the directory that just got
# recreated — so the store is destroyed and refetched from npm every job. The
# symptom is a ~730MB store on disk and `reused 0, downloaded 1287` in the log,
# which reads like a working cache and is the opposite of one.
#
# PNPM_HOME moves the store out from under the action. The path is the one a
# developer's own pnpm already uses on this box, so CI and the terminal share a
# single warm store rather than each maintaining a cold one.
#
# Exported through GITHUB_ENV so it applies to the later steps in the job, not
# just this one.
store_home="$HOME/.local/share/pnpm"
log "pnpm store: $store_home/store"

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "PNPM_HOME=$store_home" >> "$GITHUB_ENV"
else
  log "not in Actions — nothing to export"
fi
