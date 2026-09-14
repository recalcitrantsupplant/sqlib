#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Build the server image (api + mcp-server, one image; APP_MODE selects the
# runtime) from the repo-root Dockerfile and push it to GHCR.
#
# Tags:
#   sha-<short>            always
#   latest                only on the trunk branch
#   <X.Y.Z>               when building a vX.Y.Z git tag, or when RELEASE_VERSION is set
#
# Env:
#   PUSH=true             actually push (default: build only — safe locally)
#   RELEASE_VERSION=X.Y.Z manual versioned release (from the dispatch input)
#   IMAGE=...             override the image ref (default derives from the
#                         GitHub owner, lower-cased as GHCR requires)
#
# Login is the caller's job (the workflow does `docker login ghcr.io` with the
# built-in GITHUB_TOKEN); this script only builds and pushes.

owner="${GITHUB_REPOSITORY_OWNER:-local}"
owner_lc="$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')"
IMAGE="${IMAGE:-ghcr.io/${owner_lc}/sparql-query-lib}"
PUSH="${PUSH:-false}"

sha="${GITHUB_SHA:-$(git rev-parse HEAD)}"
short_sha="${sha:0:12}"
ref_name="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"

tags=("sha-${short_sha}")
if [ "$ref_name" = "$TRUNK" ]; then
  tags+=("latest")
fi
if [ "${GITHUB_REF_TYPE:-}" = "tag" ] && [[ "$ref_name" =~ ^v[0-9] ]]; then
  tags+=("${ref_name#v}")
fi
if [ -n "${RELEASE_VERSION:-}" ]; then
  tags+=("${RELEASE_VERSION#v}")
fi

build_args=()
for t in "${tags[@]}"; do build_args+=(--tag "${IMAGE}:${t}"); done

if [ "$PUSH" = "true" ]; then
  # Build and push in one buildx step rather than `docker build` then
  # `docker push`. Going via the local image store produced manifests GHCR
  # rejected with "unknown blob" — the push referenced layers the registry
  # never received. buildx uploads layers and manifest together.
  #
  # --provenance=false keeps the result a plain image rather than an index with
  # an attestation manifest attached, which is what most consumers expect and
  # what the previous pushes produced.
  #
  # Requires a buildx builder that can export to a registry; the workflow sets
  # one up with docker/setup-buildx-action.
  log "docker buildx build --push ${IMAGE} (${tags[*]})"
  docker buildx build "${build_args[@]}" --provenance=false --push -f Dockerfile .

  # Housekeeping for runners whose BuildKit state outlives the job — the
  # self-hosted box, or a developer's machine. A cache that is never collected
  # grows without bound there, so bound it rather than trading a slow build for
  # a full disk. A GitHub-hosted runner is a fresh VM that is discarded whole,
  # so the prune would only burn seconds; skip it.
  #
  # Deliberately after the push and deliberately non-fatal: a published image is
  # not worth failing over a housekeeping flag. `--keep-storage` is spelled
  # `--reserved-space` on newer buildx, hence the fallback and the `|| true`.
  if [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]; then
    log "pruning build cache above 20GB"
    docker buildx prune --force --reserved-space 20GB >/dev/null 2>&1 \
      || docker buildx prune --force --keep-storage 20GB >/dev/null 2>&1 \
      || warn "could not prune the build cache — check disk on the runner"
  fi
else
  # --network=host: RUN steps share the host network namespace instead of each
  # getting a bridge endpoint. Only applied off GitHub-hosted runners, where a
  # bridge endpoint works fine and the default isolation is worth keeping. The
  # Justfile's local recipe has done this since it was written, for the same
  # reason it is needed on the self-hosted runner, where creating a bridge
  # endpoint fails:
  #
  #   failed to create endpoint ... on network bridge: Unable to enable DIRECT
  #   ACCESS FILTERING - DROP rule: ERROR: ld.so: object
  #   '/usr/local/lib/AppProtection/libAppProtection.so' from /etc/ld.so.preload
  #   cannot be preloaded (cannot open shared object file): ignored.
  #
  # dockerd shells out to iptables to program that rule; `/etc/ld.so.preload`
  # names a library that is not installed, so ld.so writes to stderr on every
  # exec, and dockerd reads the non-empty stderr as the failure. The build needs
  # a network for `pnpm install` either way, so host networking costs isolation
  # that a build on a single-tenant runner was not relying on.
  #
  # This is a workaround, not the fix: the stale `/etc/ld.so.preload` entry
  # breaks `docker run` on that box too, and removing it is the durable answer.
  # Deliberately not applied to the buildx/push branch above — the
  # docker-container driver rejects --network=host unless the builder was
  # created with `--allow network.host`, so adding it blindly would break
  # publishing to fix building.
  log "docker build ${IMAGE} (${tags[*]})"
  if [ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ]; then
    docker build "${build_args[@]}" -f Dockerfile .
  else
    docker build --network=host "${build_args[@]}" -f Dockerfile .
  fi
  warn "PUSH!=true — built only, not pushed"
fi
