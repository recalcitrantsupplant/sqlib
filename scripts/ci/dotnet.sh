#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

# The C# runtime (dotnet/) against the shared conformance goldens in
# packages/runtime/test/conformance/goldens.json. Two test runs, then a pack:
#   1. The net8.0 and net10.0 test assemblies against the net8.0 library build.
#   2. The same tests against the netstandard2.0 library build, which is the
#      build that a .NET Framework 4.7.2+ consumer loads.
# The test project needs both SDK runtimes. ci.yml installs them with
# actions/setup-dotnet.
PROJECT=dotnet/test/SparqlQueryLib.Runtime.Tests

if ! command -v dotnet >/dev/null 2>&1; then
  warn "dotnet: no dotnet SDK on PATH"
  exit 1
fi

log "dotnet: test against the net8.0 library build"
dotnet test "$PROJECT" -c Release

log "dotnet: test against the netstandard2.0 library build"
dotnet test "$PROJECT" -c Release -p:TestNetStandard=true

log "dotnet: pack"
dotnet pack dotnet/src/SparqlQueryLib.Runtime -c Release -o "${DOTNET_PACK_OUT:-dotnet/artifacts}"
