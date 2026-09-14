#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Web end-to-end tests (Playwright). Separate lane per Decision D5.
#
# DECISION — settles the old "Phase 2: stand up the real server" TODO:
# CI runs the functional specs only, against the production preview build,
# with the API mocked at the network layer by Playwright. No API server is
# started, and none is needed — every spec that required one has been either
# rewritten against mocks or removed. See packages/web/tests/e2e/README.md.
#
# The visual regression specs (tagged @visual) are NOT run here. Their
# baselines are rasterised with the authoring machine's font stack; a GitHub
# runner renders text differently, so they would fail on day one for reasons
# unrelated to any change. They stay a local gate:
#
#     pnpm --filter @sparql-query-lib/web test:e2e:visual
#
# Revisit if the baselines ever move into a pinned container image.

# CI binds the preview to a port outside the range anyone reaches for by hand;
# local runs still default to 3001 (packages/web/tests/e2e/web-port.ts).
# Playwright refuses to start its web server if the port is taken
# ("http://localhost:3001 is already used"), which on a runner that shares a
# machine with local development — the self-hosted box — meant a `just
# run-frontend` left open could red out a job for reasons that had nothing to do
# with the change under test. Harmless on a hosted runner, and cheap insurance
# if that box is ever used again.
export WEB_PORT="${WEB_PORT:-3701}"
log "e2e: preview server on port $WEB_PORT"

# `--with-deps` shells out to apt-get and needs root. A hosted runner hands us
# passwordless sudo; a self-hosted one may not, and there the system libraries
# are a one-time install that has almost certainly already happened. Asking for
# root when we cannot have it fails the job over a no-op, so only ask when the
# answer will be yes.
if sudo -n true 2>/dev/null; then
  pnpm --filter @sparql-query-lib/web exec playwright install --with-deps chromium
else
  log "e2e: no passwordless sudo — installing the browser without system deps"
  pnpm --filter @sparql-query-lib/web exec playwright install chromium
fi

pnpm --filter @sparql-query-lib/web test:e2e:ci

# API browser coverage for server-generated HTML (issue #261): the exported
# library page (`generateDemoPage`) rendered in a real browser rather than
# asserted on as a markup string. No dev server or preview build involved —
# each spec writes its own fixture page to a temp file and opens it with
# file://, with packages/runtime's real built bundle inlined (hence needing
# build.sh to have already run). A separate `playwright install` because this
# is a different package's node_modules, even though today it pins the same
# Playwright version as web.
log "e2e: packages/api demo page suite"
if sudo -n true 2>/dev/null; then
  pnpm --filter @sparql-query-lib/api exec playwright install --with-deps chromium
else
  pnpm --filter @sparql-query-lib/api exec playwright install chromium
fi

pnpm --filter @sparql-query-lib/api test:e2e
