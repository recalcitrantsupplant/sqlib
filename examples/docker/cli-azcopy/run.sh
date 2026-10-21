#!/bin/sh
# Copy the source rows in, run the job, copy the RDF out.
#
#   SOURCE_URL   a blob or prefix to copy into /work/in
#   TARGET_URL   where to copy /work/out/out.nt
#   JOB          the job file (default /job/job.json); its SQL reads /work/in
set -eu
: "${SOURCE_URL:?set SOURCE_URL}"
: "${TARGET_URL:?set TARGET_URL}"
JOB="${JOB:-/job/job.json}"

mkdir -p /work/in /work/out
azcopy copy "$SOURCE_URL" /work/in --recursive
sqlib etl run --job "$JOB" --out /work/out/out.nt
azcopy copy /work/out/out.nt "$TARGET_URL"
