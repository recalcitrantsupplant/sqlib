#!/usr/bin/env bash
# The orphan-module ratchet, as a gate.
#
# Runs `scripts/check-orphans.mjs`: a source file nothing can reach — not an
# entry point, not a test, not a config, not Nuxt's routing — fails the build
# unless it is named in scripts/orphan-baseline.json.
#
# Sits next to the `any` ratchet deliberately. Both measure something
# deterministic about the tree rather than about a run, and both are baselines
# rather than hard zeros so the cleanup can land incrementally. The difference
# is what the baseline holds: `any` counts, orphans are named, because an
# accepted orphan is a claim that a human looked at that specific file and
# decided it stays. A number could not carry that claim.
source "$(dirname "$0")/lib.sh"

log "orphan ratchet"
node "$REPO_ROOT/scripts/check-orphans.mjs"
