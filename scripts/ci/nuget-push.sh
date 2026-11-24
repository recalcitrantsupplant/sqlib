#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# Push the package that scripts/ci/dotnet.sh packed to nuget.org.
# Inputs (environment):
#   EXPECTED_VERSION  the version release-please tagged, such as 0.1.0
#   NUGET_API_KEY     a nuget.org API key that can push SparqlQueryLib.Runtime.
#                     In CI it is the 1-hour key from NuGet/login (trusted publishing).
#   DOTNET_PACK_OUT   the pack output directory (default dotnet/artifacts)
OUT="${DOTNET_PACK_OUT:-dotnet/artifacts}"
: "${EXPECTED_VERSION:?set EXPECTED_VERSION}"
: "${NUGET_API_KEY:?set NUGET_API_KEY (the NuGet/login output in CI)}"

package="$OUT/SparqlQueryLib.Runtime.$EXPECTED_VERSION.nupkg"
if [ ! -f "$package" ]; then
  warn "nuget: $package not found. The csproj version and the release tag disagree:"
  ls "$OUT" >&2
  exit 1
fi

log "nuget: push $package"
# The .snupkg next to the .nupkg is pushed with it.
dotnet nuget push "$package" \
  --api-key "$NUGET_API_KEY" \
  --source https://api.nuget.org/v3/index.json \
  --skip-duplicate
