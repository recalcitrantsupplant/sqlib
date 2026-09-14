#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

log "lint (all packages that define a lint script)"
pnpm -r --if-present lint

# --- what that line actually linted ------------------------------------------
#
# `pnpm -r --if-present lint` passes if every package's lint script exits 0,
# and nine of the ten packages define their lint script as `echo "TODO: add
# lint"`. So the step has always been green, and has never once read a line of
# TypeScript: the only real linting in the repo is stylelint over
# `packages/web/**/*.{vue,css}`.
#
# That is the same shape as the bug scripts/ci/any-ratchet.sh was written for —
# a check whose passing carries no information — and it is why the 2026-09
# cleanup found what it found: an 822-line type module with no importers, four
# more unreferenced modules, `tsc` output committed as source. An unused import
# or an unreachable branch has nothing in this pipeline that would object.
#
# This does not gate. Turning on `@typescript-eslint` across ~250k lines lands
# as a baseline, not as a green build, and that is its own change (start with
# `no-unused-vars`, `no-unreachable`, `unused-imports/no-unused-imports`, then
# ratchet the count the way scripts/count-any.mjs does). Until then the honest
# thing is to say out loud how much of the repo the green tick covers, so the
# gap is visible in every run instead of being discovered again later.
# Documentation links. The docs were consolidated from a dated journal whose
# pages referred to each other by filename, and a rename breaks those links
# without breaking anything a compiler or a test would notice.
log "checking documentation links"
node "$REPO_ROOT/scripts/check-doc-links.mjs"

placeholders=()
for manifest in "$REPO_ROOT"/packages/*/package.json; do
  script="$(node -e '
    const p = require(process.argv[1]);
    process.stdout.write(String((p.scripts || {}).lint ?? ""));
  ' "$manifest")"
  case "$script" in
    ''|*TODO*) placeholders+=("$(basename "$(dirname "$manifest")")") ;;
  esac
done

if [ "${#placeholders[@]}" -gt 0 ]; then
  warn "lint: ${#placeholders[@]} package(s) have no real lint script: ${placeholders[*]}"
  warn "Their green tick means an echo succeeded, not that anything was linted."
  warn "See the note in this script for what turning them on involves."
fi
