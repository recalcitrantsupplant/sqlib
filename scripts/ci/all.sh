#!/usr/bin/env bash
# Run the required CI pipeline locally, exactly as CI does:
#   bash scripts/ci/all.sh
source "$(dirname "$0")/lib.sh"

bash "$REPO_ROOT/scripts/ci/install.sh"
bash "$REPO_ROOT/scripts/ci/lint.sh"
bash "$REPO_ROOT/scripts/ci/ratchet-selftest.sh"
bash "$REPO_ROOT/scripts/ci/any-ratchet.sh"
bash "$REPO_ROOT/scripts/ci/orphan-ratchet.sh"
bash "$REPO_ROOT/scripts/ci/typecheck.sh"
bash "$REPO_ROOT/scripts/ci/build.sh"
bash "$REPO_ROOT/scripts/ci/publish-check.sh"
bash "$REPO_ROOT/scripts/ci/test.sh"

log "all required checks passed"
