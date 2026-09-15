#!/usr/bin/env bash
#
# Export the current tree as a fresh single-commit repository.
#
# The working repository carries history that should not be published: a
# registry credential, extracted client material, and the branch names and
# co-authors of several hundred development commits. Rewriting that history
# file by file is slower and less certain than not carrying it, so the public
# repository starts from one commit containing the tree as it stands.
#
#   bash scripts/release/export-orphan.sh ../sqlib [git@github.com:owner/sqlib.git]
#
# With a remote given the script adds it but never pushes: pushing is a
# deliberate act and belongs to whoever is reading the result.
#
# The export refuses to run if the tree still mentions anything from the sweep
# list below. That check is the point of the script — copying files is the easy
# part.
set -euo pipefail

DEST="${1:-}"
REMOTE="${2:-}"

if [ -z "$DEST" ]; then
  echo "usage: $0 <destination-directory> [remote-url]" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to export: the working tree has uncommitted changes" >&2
  echo "commit or stash them first, so what is exported is what was reviewed" >&2
  exit 1
fi

# Names, hosts and paths that must not appear in a published tree. Kept here
# rather than in a separate file so the check travels with the script.
# `azurecr.io` is deliberately absent: `myregistry.azurecr.io` is the placeholder
# the Bicep templates and their examples use, and it names nothing real.
PATTERNS='south32|kurrawong|kaicr|koentest|azurestaticapps|azurecontainerapps|/home/david|sqlib-backup'

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

git archive --format=tar HEAD | tar -x -C "$STAGING"

echo "checking the exported tree for material that must not be published..."
# This script is excluded because it necessarily contains the list itself.
if matches=$(grep -rIniE "$PATTERNS" "$STAGING" \
      --exclude-dir=.git \
      --exclude="$(basename "$0")" 2>/dev/null); then
  echo "refusing to export: the tree still mentions the following" >&2
  printf '%s\n' "$matches" | sed "s|$STAGING/||" | head -40 >&2
  exit 1
fi
echo "  clean"

if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  echo "refusing to export: $DEST exists and is not empty" >&2
  exit 1
fi

mkdir -p "$DEST"
DEST_ABS="$(cd "$DEST" && pwd)"
tar -C "$STAGING" -cf - . | tar -C "$DEST_ABS" -xf -

cd "$DEST_ABS"
git init -q -b main

# Commit as whoever is running this, or as GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL if
# they are set. Worth setting deliberately: this is the only commit the public
# repository will have, so whatever identity git falls back to is the identity
# on the whole history.
if [ -n "${GIT_AUTHOR_NAME:-}" ] && [ -n "${GIT_AUTHOR_EMAIL:-}" ]; then
  git config user.name "$GIT_AUTHOR_NAME"
  git config user.email "$GIT_AUTHOR_EMAIL"
fi

if ! git config user.name >/dev/null || ! git config user.email >/dev/null; then
  echo "refusing to commit: git has no user.name or user.email configured here" >&2
  echo "set them, or pass them through:" >&2
  echo "  git -C \"$DEST_ABS\" config user.name 'Your Name'" >&2
  echo "  git -C \"$DEST_ABS\" config user.email 'you@example.com'" >&2
  echo "the tree is exported; re-run the commit yourself, or delete $DEST_ABS and start again" >&2
  exit 1
fi

# --force, because a fresh repository applies the exported .gitignore to this
# add, and a file can be both tracked upstream and matched by an ignore rule.
# Two hand-written type shims under packages/api/src/types were dropped exactly
# that way on the first export, leaving a tree that could not build its own api
# package. `git archive` already decided what is in the tree; this add must not
# second-guess it.
git add -A --force
git commit -q -m "Initial public release

sqlib is a self-hostable server, web UI and MCP server for authoring,
versioning, parameterising, composing, testing and exporting SPARQL queries
and SHACL 1.2 inference rules.

This repository begins at one commit. Its development history is kept
privately and is not published."

if [ -n "$REMOTE" ]; then
  git remote add origin "$REMOTE"
  echo
  echo "remote 'origin' set to $REMOTE"
  echo "review the tree, then: git -C \"$DEST_ABS\" push -u origin main"
else
  echo
  echo "no remote set. add one and push when you are ready:"
  echo "  git -C \"$DEST_ABS\" remote add origin <url>"
  echo "  git -C \"$DEST_ABS\" push -u origin main"
fi

echo
echo "exported $(git ls-files | wc -l | tr -d ' ') files as one commit in $DEST_ABS"
