#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

log "pnpm install (frozen lockfile)"
pnpm install --frozen-lockfile
