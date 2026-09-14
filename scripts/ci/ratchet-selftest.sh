#!/usr/bin/env bash
# Self-test for the ratchet guards.
#
# Every gate in this repo that counts something shares one failure mode: the
# number it reports when it measured nothing is the same number it reports when
# everything is fine. A crashed type checker prints no `error TS` lines; a scan
# directory that moved holds no violations; a baseline file full of junk
# compares false against every count. All three read as "clean" — and with the
# typecheck baseline at 0 (#52), the distance between "perfect" and "broken" is
# zero.
#
# The spacing ratchet used to be tested here too. It is gone: spacing reached 0
# and became a stylelint rule (#36), which fails on the file it reads rather
# than on a number, so it has no "measured nothing" state to guard.
#
# The guards that close that gap only fire in situations CI never reaches on a
# good day, so nothing would notice them rotting. Hence this: each guard gets a
# sandbox that reproduces its failure and asserts the script exits non-zero, and
# a matching healthy case asserting it still passes. Runs in about a second, no
# install required.
#
#   bash scripts/ci/ratchet-selftest.sh
source "$(dirname "$0")/lib.sh"

log "ratchet self-test"

# No EXIT trap for cleanup: lib.sh already owns that one for step timing, and
# replacing it would silently drop the duration report. The sandbox is under
# mktemp's directory, so an unexpected abort leaks a temp dir and nothing worse.
SANDBOX="$(mktemp -d)"
failures=0

# Run a command, capture output, and assert its exit status.
#   expect <want-status> <name> <command...>
expect() {
  local want="$1" name="$2"; shift 2
  local out status
  set +e
  out="$("$@" 2>&1)"
  status=$?
  set -e

  if [ "$want" = "pass" ] && [ "$status" -eq 0 ]; then return 0; fi
  if [ "$want" = "fail" ] && [ "$status" -ne 0 ]; then return 0; fi

  failures=$((failures + 1))
  warn "self-test: $name — expected to $want, exited $status"
  printf '%s\n' "$out" | sed -n '1,15p'
  return 0
}

# --- typecheck.sh -----------------------------------------------------------
#
# Sandboxed by copying the script and lib.sh into a fake repo root: lib.sh
# derives REPO_ROOT from its own location, so the copy checks the copy's tree
# and never touches packages/web.
tc_root="$SANDBOX/typecheck"
mkdir -p "$tc_root/scripts/ci" "$tc_root/packages/web"
cp "$REPO_ROOT/scripts/ci/lib.sh" "$REPO_ROOT/scripts/ci/typecheck.sh" "$tc_root/scripts/ci/"

# A checker that reports n errors in the shape vue-tsc does, and exits like it.
stub_errors() {
  local n="$1" i
  for ((i = 0; i < n; i++)); do
    printf "src/components/Fake%d.vue(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n" "$i"
  done
  [ "$n" -eq 0 ]
}
export -f stub_errors

run_typecheck() {
  local baseline="$1" cmd="$2"
  printf '%s\n' "$baseline" > "$tc_root/packages/web/.typecheck-baseline"
  TYPECHECK_CMD="$cmd" bash "$tc_root/scripts/ci/typecheck.sh"
}

expect pass "clean tree at baseline 0" run_typecheck 0 'stub_errors 0'
expect fail "2 new errors against baseline 0" run_typecheck 0 'stub_errors 2'
expect pass "1 error under baseline 5 (nags, does not fail)" run_typecheck 5 'stub_errors 1'

# The regression this file exists for: #205's vue-tsc-on-typescript-7 crash.
# Nothing is checked, nothing matches `error TS`, and the count is 0 — which at
# baseline 0 used to read as a pass.
expect fail "checker crashes before checking a file" run_typecheck 0 \
  'echo "Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath ./lib/tsc is not defined by exports" >&2; exit 1'
expect fail "checker binary missing" run_typecheck 0 'exec-that-does-not-exist'

# A baseline that is not a plain count used to leave both comparisons erroring
# to false, which passed.
expect fail "baseline is not a number" run_typecheck "v6.0.3" 'stub_errors 0'
expect fail "baseline file is empty" run_typecheck "" 'stub_errors 0'

rm -f "$tc_root/packages/web/.typecheck-baseline"
expect fail "baseline file missing" env TYPECHECK_CMD='stub_errors 0' bash "$tc_root/scripts/ci/typecheck.sh"

# --- count-any.mjs ----------------------------------------------------------
any_root="$SANDBOX/any"
mkdir -p "$any_root/scripts" "$any_root/packages/thing/src"
cp "$REPO_ROOT/scripts/count-any.mjs" "$any_root/scripts/"
printf 'export const x: any = 1;\n' > "$any_root/packages/thing/src/x.ts"
printf '{"srcTotal": 1, "testTotal": 0}\n' > "$any_root/scripts/any-baseline.json"

expect pass "any: one annotation at baseline 1" node "$any_root/scripts/count-any.mjs"

printf '{"srcTotal": 0, "testTotal": 0}\n' > "$any_root/scripts/any-baseline.json"
expect fail "any: annotation above baseline 0" node "$any_root/scripts/count-any.mjs"

printf '{"testTotal": 0}\n' > "$any_root/scripts/any-baseline.json"
expect fail "any: baseline missing srcTotal" node "$any_root/scripts/count-any.mjs"

printf '{"srcTotal": 1, "testTotal": 0}\n' > "$any_root/scripts/any-baseline.json"
rm -rf "$any_root/packages/thing"
expect fail "any: nothing left to scan" node "$any_root/scripts/count-any.mjs"

# --- check-publishable.mjs --------------------------------------------------
#
# Not a counting ratchet, but the same failure mode: it reports success when it
# has nothing to check, and every defect it looks for is invisible from inside
# the workspace — pnpm's symlinks resolve what a published tarball would not.
# So each defect gets a fixture asserting the gate still catches it.
#
# Same sandbox trick: the script derives REPO_ROOT from its own location.
pub_root="$SANDBOX/publishable"

# Rebuild the fixture root, reading the package under test's manifest from stdin.
pub_reset() {
  rm -rf "$pub_root"
  mkdir -p "$pub_root/scripts" "$pub_root/packages/thing/dist"
  cp "$REPO_ROOT/scripts/check-publishable.mjs" "$pub_root/scripts/"
  : > "$pub_root/packages/thing/README.md"
  for f in index.js index.cjs index.d.ts index.d.cts; do
    : > "$pub_root/packages/thing/dist/$f"
  done
  cat > "$pub_root/packages/thing/package.json"
}

# A second workspace package, private, for the dependency cases.
pub_add_private_dep() {
  mkdir -p "$pub_root/packages/inner"
  printf '{"name": "@scope/inner", "version": "0.0.0", "private": true}\n' \
    > "$pub_root/packages/inner/package.json"
}

run_pub() { node "$pub_root/scripts/check-publishable.mjs"; }

# The healthy manifest every failing case below is a one-field mutation of.
pub_reset <<'JSON'
{
  "name": "@scope/thing",
  "version": "0.1.0",
  "description": "a package",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "repository": { "type": "git", "url": "git+https://example.org/r.git", "directory": "packages/thing" },
  "homepage": "https://example.org",
  "bugs": { "url": "https://example.org/issues" },
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=20" },
  "license": "ISC"
}
JSON
expect pass "publishable: a publish-ready package" run_pub

# The measures-nothing case: every package private again.
pub_reset <<'JSON'
{ "name": "@scope/thing", "version": "0.1.0", "private": true }
JSON
expect fail "publishable: nothing to check" run_pub

# The defect this gate was written for (#258): a CommonJS consumer resolves
# ./dist/index.cjs and looks for ./dist/index.d.cts, never .d.ts, so declaring
# the ESM types under `require` ships a package with no types at all.
pub_reset <<'JSON'
{
  "name": "@scope/thing", "version": "0.1.0", "description": "a package", "type": "module",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.ts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "repository": { "type": "git", "url": "git+https://example.org/r.git", "directory": "packages/thing" },
  "homepage": "https://example.org", "bugs": { "url": "https://example.org/issues" },
  "publishConfig": { "access": "public" }, "engines": { "node": ">=20" }, "license": "ISC"
}
JSON
expect fail "publishable: require condition typed with .d.ts" run_pub

pub_reset <<'JSON'
{
  "name": "@scope/thing", "version": "0.1.0", "description": "a package", "type": "module",
  "exports": { ".": { "import": "./dist/index.js", "require": "./dist/index.cjs" } },
  "files": ["dist"],
  "repository": { "type": "git", "url": "git+https://example.org/r.git", "directory": "packages/thing" },
  "homepage": "https://example.org", "bugs": { "url": "https://example.org/issues" },
  "publishConfig": { "access": "public" }, "engines": { "node": ">=20" }, "license": "ISC"
}
JSON
expect fail "publishable: no types conditions at all" run_pub

# An exports target outside `files` resolves in the working tree and is absent
# from the tarball.
pub_reset <<'JSON'
{
  "name": "@scope/thing", "version": "0.1.0", "description": "a package", "type": "module",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["lib"],
  "repository": { "type": "git", "url": "git+https://example.org/r.git", "directory": "packages/thing" },
  "homepage": "https://example.org", "bugs": { "url": "https://example.org/issues" },
  "publishConfig": { "access": "public" }, "engines": { "node": ">=20" }, "license": "ISC"
}
JSON
expect fail "publishable: exports target outside files" run_pub

# A scoped package without publishConfig.access fails its first publish.
pub_reset <<'JSON'
{
  "name": "@scope/thing", "version": "0.1.0", "description": "a package", "type": "module",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "repository": { "type": "git", "url": "git+https://example.org/r.git", "directory": "packages/thing" },
  "homepage": "https://example.org", "bugs": { "url": "https://example.org/issues" },
  "engines": { "node": ">=20" }, "license": "ISC"
}
JSON
expect fail "publishable: scoped package without publishConfig.access" run_pub

# Depending on a package that stays private publishes an uninstallable tarball.
pub_reset <<'JSON'
{
  "name": "@scope/thing", "version": "0.1.0", "description": "a package", "type": "module",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "dependencies": { "@scope/inner": "workspace:^" },
  "repository": { "type": "git", "url": "git+https://example.org/r.git", "directory": "packages/thing" },
  "homepage": "https://example.org", "bugs": { "url": "https://example.org/issues" },
  "publishConfig": { "access": "public" }, "engines": { "node": ">=20" }, "license": "ISC"
}
JSON
pub_add_private_dep
expect fail "publishable: depends on a private workspace package" run_pub

# `workspace:*` in a peer range publishes as an exact pin.
pub_reset <<'JSON'
{
  "name": "@scope/thing", "version": "0.1.0", "description": "a package", "type": "module",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "peerDependencies": { "@scope/inner": "workspace:*" },
  "repository": { "type": "git", "url": "git+https://example.org/r.git", "directory": "packages/thing" },
  "homepage": "https://example.org", "bugs": { "url": "https://example.org/issues" },
  "publishConfig": { "access": "public" }, "engines": { "node": ">=20" }, "license": "ISC"
}
JSON
mkdir -p "$pub_root/packages/inner"
printf '{"name": "@scope/inner", "version": "0.1.0", "description": "d", "files": ["dist"]}\n' \
  > "$pub_root/packages/inner/package.json"
expect fail "publishable: peer range pinned by workspace:*" run_pub

# --- check-public-api.mjs ---------------------------------------------------
#
# The surface gate reads the built declarations, so its "measured nothing" state
# is a build that emitted none: no dist, no exports, and a report it would then
# happily agree with. Each case below is one of those, plus the drift it exists
# to catch.
api_root="$SANDBOX/public-api"

# A healthy package: two declaration files, the entry re-exporting from the
# other, which is the shape every real entry point here has.
api_reset() {
  rm -rf "$api_root"
  mkdir -p "$api_root/scripts" "$api_root/packages/thing/dist"
  cp "$REPO_ROOT/scripts/check-public-api.mjs" "$api_root/scripts/"
  cat > "$api_root/packages/thing/package.json" <<'JSON'
{
  "name": "@scope/thing",
  "version": "0.1.0",
  "description": "a package",
  "type": "module",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./package.json": "./package.json"
  },
  "files": ["dist"]
}
JSON
  cat > "$api_root/packages/thing/dist/index.d.ts" <<'DTS'
export { serialize, type Term } from './terms.js';
DTS
  cat > "$api_root/packages/thing/dist/terms.d.ts" <<'DTS'
export interface Term {
    value: string;
}
export declare function serialize(term: Term): string;
DTS
}

run_api() { node "$api_root/scripts/check-public-api.mjs"; }
seed_api_report() { node "$api_root/scripts/check-public-api.mjs" --update >/dev/null 2>&1 || true; }

api_reset
seed_api_report
expect pass "public-api: report matches the declarations" run_api

# The case the gate exists for: a name added to the surface without the report.
cat >> "$api_root/packages/thing/dist/terms.d.ts" <<'DTS'
export declare function parse(text: string): Term;
DTS
cat >> "$api_root/packages/thing/dist/index.d.ts" <<'DTS'
export { parse } from './terms.js';
DTS
expect fail "public-api: an export the report does not list" run_api

# A signature change with no name change is the one a name-only list misses.
api_reset
seed_api_report
cat > "$api_root/packages/thing/dist/terms.d.ts" <<'DTS'
export interface Term {
    value: string;
}
export declare function serialize(term: Term, quote: boolean): string;
DTS
expect fail "public-api: a signature change under an unchanged name" run_api

# No report at all: the first publishable package must get one deliberately.
api_reset
expect fail "public-api: no report checked in" run_api

# A public signature naming a type no entry point exports. The consumer can call
# it and cannot write down what it returns.
api_reset
cat > "$api_root/packages/thing/dist/terms.d.ts" <<'DTS'
interface Span {
    start: number;
}
export interface Term {
    value: string;
}
export declare function serialize(term: Term): Span;
DTS
seed_api_report
expect fail "public-api: a public signature names an unexported type" run_api

# The measured-nothing cases. A build that emitted no declarations, or emitted
# an empty one, must fail rather than agree with a report of nothing.
api_reset
rm -f "$api_root/packages/thing/dist/index.d.ts"
expect fail "public-api: entry declaration missing (not built)" run_api

api_reset
: > "$api_root/packages/thing/dist/index.d.ts"
seed_api_report
expect fail "public-api: entry exports nothing" run_api

api_reset
printf '{"name": "@scope/thing", "version": "0.1.0", "private": true}\n' \
  > "$api_root/packages/thing/package.json"
expect fail "public-api: nothing publishable to report on" run_api

# --- check-orphans.mjs ------------------------------------------------------
#
# Same sandbox trick again: the script derives ROOT from its own location, so a
# copy under $SANDBOX/orphans checks that tree and never walks packages/.
orph_root="$SANDBOX/orphans"

# Rebuild the fixture: one package whose entry point imports `used.ts`, plus
# whatever orphans the caller adds afterwards.
orph_reset() {
  rm -rf "$orph_root"
  mkdir -p "$orph_root/scripts" "$orph_root/packages/thing/src"
  cp "$REPO_ROOT/scripts/check-orphans.mjs" "$orph_root/scripts/"
  printf '{"name": "@scope/thing", "version": "0.1.0", "main": "dist/index.js"}\n' \
    > "$orph_root/packages/thing/package.json"
  printf "import { used } from './used.js';\nexport const entry = used;\n" \
    > "$orph_root/packages/thing/src/index.ts"
  printf 'export const used = 1;\n' > "$orph_root/packages/thing/src/used.ts"
  printf '{"orphans": []}\n' > "$orph_root/scripts/orphan-baseline.json"
}

run_orph() { node "$orph_root/scripts/check-orphans.mjs"; }

orph_reset
expect pass "orphans: every file reachable from the entry point" run_orph

printf 'export const stranded = 1;\n' > "$orph_root/packages/thing/src/stranded.ts"
expect fail "orphans: a file nothing imports" run_orph

printf '{"orphans": ["packages/thing/src/stranded.ts"]}\n' \
  > "$orph_root/scripts/orphan-baseline.json"
expect pass "orphans: the same file, accepted in the baseline" run_orph

# The regression that shipped in the first draft of this gate. The reachability
# scan reads root-level JSON for paths that name a file, and the baseline is
# root-level JSON full of exactly those paths — so it made every accepted orphan
# look reachable and the check reported an empty set no matter what the tree
# held. Asserting on exit status alone cannot see that (a baselined orphan
# passes either way), so assert on what the scan actually reports.
orph_reports_stranded() {
  node "$orph_root/scripts/check-orphans.mjs" --json | grep -q 'packages/thing/src/stranded.ts'
}
expect pass "orphans: a baselined orphan is still reported as unreachable" orph_reports_stranded

# A dynamic `import()` with a literal specifier is a real edge; missing it would
# condemn a live file. GraphResolver.ts reaches six repositories this way.
orph_reset
printf 'export const lazy = 1;\n' > "$orph_root/packages/thing/src/lazy.ts"
printf "export const load = () => import('./lazy.js');\n" \
  >> "$orph_root/packages/thing/src/index.ts"
expect pass "orphans: dynamic import with a literal specifier is followed" run_orph

# The measured-nothing cases. A scan that walked no files, or found no roots to
# walk from, reports zero orphans — the same answer a clean tree gives.
orph_reset
rm -rf "$orph_root/packages/thing"
expect fail "orphans: nothing left to scan" run_orph

orph_reset
rm -f "$orph_root/scripts/orphan-baseline.json"
expect fail "orphans: baseline file missing" run_orph

orph_reset
printf 'not json\n' > "$orph_root/scripts/orphan-baseline.json"
expect fail "orphans: baseline file is not readable JSON" run_orph

# ----------------------------------------------------------------------------
rm -rf "$SANDBOX"

if [ "$failures" -gt 0 ]; then
  warn "ratchet self-test: $failures guard(s) did not behave as documented"
  exit 1
fi

log "ratchet self-test: all guards behave as documented"
