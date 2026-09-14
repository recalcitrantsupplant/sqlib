#!/usr/bin/env bash
# Publish-readiness gate for the packages that are not `private: true`.
#
# Runs after build.sh, because what it checks are the built entry points: an
# `exports` map is only true if the files it names exist and are inside `files`.
#
# This does not publish anything and needs no token — release-plan D7 has not
# been flipped (issue #258). It exists because the moment a package stopped
# being private, the shape it *would* publish in became something a PR can
# break invisibly: everything inside the workspace resolves through pnpm's
# symlinks, so the first person to find a broken tarball is a stranger running
# `npm install`.
source "$(dirname "$0")/lib.sh"

log "publish readiness: packages/* that are not private"
node "$REPO_ROOT/scripts/check-publishable.mjs"

# The same package, asked a different question: not "is the manifest right" but
# "what is in it". The surface a version range promises is invisible in a
# workspace where every consumer imports the source.
log "public surface: packages/*/public-api.md matches the built declarations"
node "$REPO_ROOT/scripts/check-public-api.mjs"

# And the question neither of those asks, because both read the working tree:
# does the tarball itself install. This one packs each package, unpacks it into
# a sandbox node_modules, compiles a consumer against it under three module
# resolutions, and loads every entry point in a plain Node process.
log "installability: the packed tarball compiles and loads as a consumer's dependency"
node "$REPO_ROOT/scripts/check-installable.mjs"

# The contract that is in no tarball at all: the declaration `sqlib export
# --typings` writes. It lands in a consumer's project and is compiled by their
# tsc against the runtime version they installed — so it belongs in this lane and
# nowhere else. A unit test can freeze its bytes and check the names it reaches
# for, which is what derivedOutputs.test.ts does; only a compiler can say
# whether it typechecks, and until this ran, none ever had.
log "generated typings: the declaration compiles in a consumer-shaped project"
node "$REPO_ROOT/scripts/check-generated-typings.mjs"
