#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Build the web UI *bundle* image from Dockerfile.web and push it to GHCR.
#
# The image carries the static site at /site and serves nothing; see the header
# of Dockerfile.web for what it is for and how to get the files out. This
# script is the sibling of docker-build-push.sh (the server image) and takes
# the same environment, so the two can be read side by side.
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
# Login is the caller's job, same as the server image's script.

owner="${GITHUB_REPOSITORY_OWNER:-local}"
owner_lc="$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')"
# A separate package from `sqlib` rather than a tag on it: the two have
# different contents, different sizes and different consumers, and sharing one
# package would make `:latest` mean whichever of them published last.
IMAGE="${IMAGE:-ghcr.io/${owner_lc}/sqlib-web}"
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

# What the image's labels and /bundle-info.json report. `BUILD_VERSION` is the
# release version when there is one, and the short sha otherwise — a bundle
# copied out of an unreleased build still says which commit it came from.
version="${RELEASE_VERSION:-}"
if [ -z "$version" ] && [ "${GITHUB_REF_TYPE:-}" = "tag" ] && [[ "$ref_name" =~ ^v[0-9] ]]; then
  version="${ref_name#v}"
fi
version="${version#v}"

build_args=()
for t in "${tags[@]}"; do build_args+=(--tag "${IMAGE}:${t}"); done
build_args+=(--build-arg "SOURCE_COMMIT=${sha}")
build_args+=(--build-arg "BUILD_VERSION=${version:-sha-${short_sha}}")
build_args+=(--build-arg "BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)")

if [ "$PUSH" = "true" ]; then
  # buildx straight to the registry, --provenance=false: same reasoning as
  # docker-build-push.sh, where both are explained at length.
  log "docker buildx build --push ${IMAGE} (${tags[*]})"
  docker buildx build "${build_args[@]}" --provenance=false --push -f Dockerfile.web .

  # No cache prune here. This shares the `sqlib-publisher` builder with
  # docker-build-push.sh, which prunes it in the same workflow run; a second
  # prune would only ever be a no-op or a race with the first.
else
  # --network=host for the self-hosted runner's broken bridge networking; see
  # the long note in docker-build-push.sh.
  log "docker build ${IMAGE} (${tags[*]})"
  docker build --network=host "${build_args[@]}" -f Dockerfile.web .
  warn "PUSH!=true — built only, not pushed"
fi
