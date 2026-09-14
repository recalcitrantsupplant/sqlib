#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Unit tests across all packages (api, mcp-server, web, contracts, types),
# affected-aware: on a PR, only packages changed since the base branch and
# their dependents; on a trunk push (or CI_TEST_MODE=full), everything.
# Playwright e2e is separate (scripts/ci/e2e.sh) — web's `test` is unit-only.
base="$(affected_base)"

# The workspace root is excluded because its `test` script delegates to the api
# package (`pnpm --filter @sparql-query-lib/api test`). Left in, pnpm runs the
# root and the api package concurrently, so the same vitest suite runs twice at
# once over one on-disk oxigraph store in packages/api/storage — which failed a
# different storage or bootstrap test on almost every run. The root script stays
# for `pnpm test` at the terminal; it just has no business being a CI project.
ROOT_PROJECT='!sparql-query-lib'

if [ -z "$base" ]; then
  log "test: full run"
  FILTER=(-r --filter "$ROOT_PROJECT")
else
  log "test: affected packages since $base + their dependents"
  FILTER=(--filter "...[$base]" --filter "$ROOT_PROJECT")
fi

# This runner is 2 vCPU / 7.75 GiB — the private-repo free-plan box, not the
# 4-vCPU standard one — so the api suite's ~117s of CPU work gets two threads.
# The same suite pinned to the same 2-thread shape on a Ryzen 7600 runs in 105s
# against the runner's 235s: a ~2x per-core difference that accounts for the
# whole local-vs-CI gap. Nothing pathological, just a small machine.
#
# Hence SHARD=n/N (see ci.yml's matrix): the work is CPU-bound on a box that
# cannot be made faster, so the only lever is more boxes.
#
# Deliberately NOT setting --maxWorkers here. Oversubscribing to 4 looked like a
# 19% win in one run, but that was variance (the flag was being swallowed by pnpm
# at the time and never reached vitest). When it did take effect it pushed
# index.bootstrap.test.ts — 2.95s locally — past vitest's 5s default timeout on a
# contended 2-vCPU box. Autodetect is both faster and not on the edge of a cliff.
VITEST_ARGS=()

# --passWithNoTests because a shard of a small package (mcp-server has one test
# file) is legitimately empty for most shards.
if [ -n "${SHARD:-}" ]; then
  log "test: shard $SHARD"
  VITEST_ARGS+=(--shard="$SHARD" --passWithNoTests)
fi

# Invoke vitest directly rather than through each package's `test` script:
# pnpm 11 does NOT forward trailing args to run-scripts. `pnpm --filter srl test
# -- --shard=3/4` silently runs all 5 files, and a CI shard configured that way
# ran the full 183-file api suite in every shard while looking like it worked.
# `pnpm --filter X exec` does pass them through.
#
# Selecting on `scripts.test` containing "vitest" reproduces what --if-present
# did, minus the packages whose test script is still an echo TODO.
pkgs=$(pnpm "${FILTER[@]}" list --depth -1 --json | node -e '
  const fs = require("node:fs"), path = require("node:path");
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  for (const p of input) {
    if (!p.path) continue;
    const pj = JSON.parse(fs.readFileSync(path.join(p.path, "package.json"), "utf8"));
    if ((pj.scripts?.test ?? "").includes("vitest")) console.log(pj.name);
  }
')

if [ -z "$pkgs" ]; then
  log "test: no packages with a vitest suite in scope — nothing to do"
  exit 0
fi

for pkg in $pkgs; do
  log "test: $pkg"
  pnpm --filter "$pkg" exec vitest run "${VITEST_ARGS[@]}"
done
