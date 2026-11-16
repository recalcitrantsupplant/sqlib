#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Fail on a known advisory of high or critical severity in pnpm-lock.yaml.
#
# Dependabot raises alerts for the same advisories, but an alert does not show
# on a pull request or a push. This step does. Low and moderate advisories do
# not fail it; the weekly lockfile refresh (lockfile-refresh.yml) clears most of
# those.
#
# The audit reads the registry's advisory database, so the result can change
# without a commit. A new high advisory makes every run fail until the
# lockfile moves past it, or until the advisory is ignored with a reason in
# pnpm-workspace.yaml (`auditConfig.ignoreGhsas`).
log "pnpm audit (high and critical)"
pnpm audit --audit-level high
