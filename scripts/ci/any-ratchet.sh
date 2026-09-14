#!/usr/bin/env bash
# The `any` ratchet, as a gate.
#
# `scripts/count-any.mjs` has existed since the `any` cleanup landed, but nothing
# ever ran it — not `all.sh`, not the workflow. So the two things it promises
# both quietly stopped being true: the whole-repo counts drifted above their
# recorded baseline, and `packages/api/src` — the "hard zero, must never come
# back" strict zone — picked up three `as any` in lib/parser.ts with no alarm.
#
# A ratchet nobody runs is a comment. This is the wiring.
#
# Two different promises, deliberately:
#   - strict zone: any occurrence is a failure, not just an increase.
#   - whole repo:  only *increases* fail, so cleanup can land incrementally.
#     Lower the baseline with `node scripts/count-any.mjs --update`.
source "$(dirname "$0")/lib.sh"

log "any ratchet"
node "$REPO_ROOT/scripts/count-any.mjs"
