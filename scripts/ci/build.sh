#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# `pnpm -r build` runs in topological order, so types/contracts build before the
# packages that consume them. This doubles as our typecheck (every TS package
# compiles with tsc / nuxt during build).
log "build all packages (topological order)"
pnpm -r build
