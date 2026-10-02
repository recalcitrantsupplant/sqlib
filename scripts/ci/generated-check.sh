#!/usr/bin/env bash
# The committed contracts are what the generator writes.
#
# Runs `generate-schemas` (the same script `pnpm build` runs first in
# packages/api) and fails if that changed anything under packages/contracts:
# a modified file means an entity schema changed without its output being
# regenerated, or someone hand-edited generated output; an untracked one means
# the generator writes a file nobody committed.
#
# Hand-written contract modules live in packages/contracts/src/hand-written/,
# which the generator never touches. packages/api's
# test/scripts/route-generation.snapshot.test.ts asks the same question per file
# from the unit tests; this is the gate that also catches a build leaving the
# tree dirty.
#
# Needs only an install, not a build: the generator runs under tsx.
source "$(dirname "$0")/lib.sh"

log "generated contracts: regenerate and compare with the committed files"
pnpm --silent generate-schemas > /dev/null

status="$(git status --porcelain --untracked-files=all -- packages/contracts)"
if [ -n "$status" ]; then
  printf '%s\n' "$status"
  git --no-pager diff --stat -- packages/contracts
  warn "generate-schemas changed packages/contracts (above)."
  warn "Run 'pnpm generate-schemas' and commit the result. If the change is to a"
  warn "hand-written module, it belongs in packages/contracts/src/hand-written/."
  exit 1
fi

log "generated contracts: committed files match the generator"
