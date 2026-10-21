# The sqlib CLI with DuckDB's httpfs and azure extensions installed at build
# time, so a job can read az:// and https:// paths without the sandbox ever
# allowing extension downloads.
#
# Build the minimal image first, then this one on top of it:
#
#   docker build -f examples/docker/cli-minimal/Dockerfile -t sqlib-cli .
#   docker build -f examples/docker/cli-duckdb-azure/Dockerfile -t sqlib-cli-azure \
#     --build-arg BASE=sqlib-cli examples/docker/cli-duckdb-azure
#
# A job then loads the extension in its SQL and runs with --allow-http:
#
#   "sql": "LOAD azure; SELECT * FROM read_parquet('az://container/rows/*.parquet')"
#
#   docker run --rm -e AZURE_STORAGE_CONNECTION_STRING -v "$PWD:/work" sqlib-cli-azure \
#     etl run --job job.json --allow-http --out out.nt
#
# Not run in CI: it needs a storage account. How the job authenticates (a
# CREATE SECRET in its SQL, or the extension's environment variables) is
# DuckDB's azure extension's to document.

ARG BASE=sqlib-cli
FROM ${BASE}
# Installed as the user that runs sqlib, into that user's extension directory.
# Network access is needed here, at build time, and never at run time.
RUN cd /opt/sqlib && node --input-type=module -e "\
import { DuckDBInstance } from '@duckdb/node-api'; \
const connection = await (await DuckDBInstance.create(':memory:')).connect(); \
await connection.run('INSTALL httpfs'); \
await connection.run('INSTALL azure'); \
console.log('installed httpfs and azure');"
