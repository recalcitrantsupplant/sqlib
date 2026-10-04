#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Package lint scripts. Only packages/web defines one today: stylelint over
# `src/**/*.{vue,css}`. The other packages' scripts were `echo "TODO: add
# lint"`, which made this line green without reading a line of TypeScript;
# they are gone rather than kept as decoration.
log "lint (package lint scripts)"
pnpm -r --if-present lint

# ESLint over every package's TypeScript, as a ratchet. It landed on a tree that
# had never been linted, so it fails on a count rising above
# scripts/lint-baseline.json rather than on any problem at all; a rule at zero
# is enforced outright. See the header of scripts/lint-ratchet.mjs.
log "eslint ratchet"
node "$REPO_ROOT/scripts/lint-ratchet.mjs"

# Documentation links. The docs were consolidated from a dated journal whose
# pages referred to each other by filename, and a rename breaks those links
# without breaking anything a compiler or a test would notice.
log "checking documentation links"
node "$REPO_ROOT/scripts/check-doc-links.mjs"
