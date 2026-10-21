# The sqlib CLI in a container, built from this repository.
#
# Build from the repository root (the build needs the workspace):
#
#   docker build -f examples/docker/cli-minimal/Dockerfile -t sqlib-cli .
#
# Run it with the files it reads mounted at /work:
#
#   docker run --rm -v "$PWD/examples/docker/cli-minimal/sample:/work" sqlib-cli \
#     etl run --job job.json
#
# Debian rather than Alpine for the reason the server image gives
# (docs/guides/etl.md): DuckDB's community extensions are published for glibc.

FROM node:26-bookworm-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@11.1.2
COPY . .
# Only the CLI and what it depends on: the web app is never installed.
RUN pnpm install --frozen-lockfile --filter "@sparql-query-lib/cli..."
RUN pnpm --filter "@sparql-query-lib/cli..." build
# One directory holding the CLI and its production dependencies.
RUN pnpm --filter @sparql-query-lib/cli deploy --legacy --prod /opt/sqlib

FROM node:26-bookworm-slim
COPY --from=build /opt/sqlib /opt/sqlib
RUN ln -s /opt/sqlib/dist/cli.js /usr/local/bin/sqlib
# Fail the build on a musl base, where DuckDB extensions are not published.
RUN cd /opt/sqlib && node --input-type=module -e "\
import { DuckDBInstance } from '@duckdb/node-api'; \
const connection = await (await DuckDBInstance.create(':memory:')).connect(); \
const platform = String(Object.values((await connection.runAndReadAll('SELECT * FROM pragma_platform()')).getRowObjects()[0])[0]); \
console.log('duckdb platform: ' + platform); \
if (platform.includes('musl')) process.exit(1);"
USER node
WORKDIR /work
ENTRYPOINT ["sqlib"]
CMD ["--help"]
