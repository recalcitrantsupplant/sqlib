# Stage 1: Build the application
#
# Debian (glibc), not Alpine (musl) — see docs/guides/etl.md §6. ETL is a
# plugin host: DuckDB extensions are published per platform, and the community
# extension registry stopped publishing `linux_amd64_musl` at DuckDB v1.5.0
# (measured 2026-09-12: every community extension checked is 404 on musl and
# 200 on linux_amd64 at v1.5.5, while v1.4.3 had both). On Alpine the whole
# community ecosystem — `webbed`, the XML reader in issue #468, among others —
# is unreachable at the version we run.
#
# The tag tracks Node 26.x rather than pinning a patch: `node:26.3-alpine3.22`
# was three months stale at the time of this change, because a patch+distro tag
# stops receiving base security rebuilds. Pin a digest instead if bit-exact
# reproducibility is wanted.
FROM node:26-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=development

# Install pnpm directly. Corepack was removed from Node core in 25, so
# `corepack enable` is `command not found` on this base image — which is what
# silently broke every image publish after the node 24 -> 26 bump (e9b49db).
# Pinned to the same version as the root package.json `packageManager` field.
RUN npm install --global pnpm@11.1.2

# Copy workspace manifests and TypeScript configs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/api/tsconfig.json packages/api/tsconfig.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/mcp-server/tsconfig.json packages/mcp-server/tsconfig.json
COPY packages/rdf-delta/package.json packages/rdf-delta/package.json
COPY packages/rdf-delta/tsconfig.json packages/rdf-delta/tsconfig.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/runtime/tsconfig.json packages/runtime/tsconfig.json
COPY packages/srl/package.json packages/srl/package.json
COPY packages/srl/tsconfig.json packages/srl/tsconfig.json
COPY packages/tools/package.json packages/tools/package.json
COPY packages/tools/tsconfig.json packages/tools/tsconfig.json
COPY packages/types/package.json packages/types/package.json
COPY packages/types/tsconfig.json packages/types/tsconfig.json
COPY packages/web/package.json packages/web/package.json
COPY packages/web/tsconfig.json packages/web/tsconfig.json

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Repo-level build scripts. `packages/runtime`'s build ends in
# `node ../../scripts/emit-cjs-declarations.mjs`, so the directory has to exist
# in the image or that build — and with it the whole image — fails.
COPY scripts ./scripts

# Copy the rest of the source code
COPY packages/types ./packages/types
COPY packages/contracts ./packages/contracts
COPY packages/rdf-delta ./packages/rdf-delta
COPY packages/runtime ./packages/runtime
COPY packages/srl ./packages/srl
COPY packages/tools ./packages/tools
COPY packages/api ./packages/api
COPY packages/mcp-server ./packages/mcp-server

# Build shared packages first (generates .d.ts files needed by API)
RUN pnpm --filter @sparql-query-lib/types build && \
    echo "=== Types dist contents ===" && \
    ls -la packages/types/dist/

RUN pnpm --filter @sparql-query-lib/contracts build && \
    echo "=== Contracts dist contents ===" && \
    ls -la packages/contracts/dist/

# Term serialisation, query templates and page-parameter substitution — the
# parser-free half of the API's argument handling, which `parser.ts` imports as
# values, not just types. Same lesson as srl below: a workspace package the API
# depends on has to be copied and built here, or the image build fails on it.
RUN pnpm --filter @sparql-query-lib/runtime build && \
    echo "=== Runtime dist contents ===" && \
    ls -la packages/runtime/dist/

# Deriving the diff a SPARQL update would produce, which the patch routes
# import as values. Same lesson as srl and runtime below and above: a workspace
# package the API depends on has to be copied and built here, or the image build
# fails on it.
RUN pnpm --filter @sparql-query-lib/rdf-delta build && \
    echo "=== RDF delta dist contents ===" && \
    ls -la packages/rdf-delta/dist/

# The API depends on @sparql-query-lib/srl (the SHACL Rules parser used by the
# rule-set routes). It was never copied into the image, so its types resolved to
# nothing and the API build failed with a cascade of implicit-any errors.
RUN pnpm --filter @sparql-query-lib/srl build && \
    echo "=== SRL dist contents ===" && \
    ls -la packages/srl/dist/

# The tool catalogue the MCP server and the in-app assistant share. Both the
# API and mcp-server import it, so it builds before either.
RUN pnpm --filter @sparql-query-lib/tools build && \
    echo "=== Tools dist contents ===" && \
    ls -la packages/tools/dist/

# Build the API (includes schema generation)
RUN pnpm --filter @sparql-query-lib/api build

# Build MCP server runtime (CLI + transports)
RUN pnpm --filter @sparql-query-lib/mcp-server build

# Copy otel-setup.js if it exists (it's a JS file, not compiled by TS)
RUN if [ -f packages/api/src/otel-setup.js ]; then \
      cp packages/api/src/otel-setup.js packages/api/dist/otel-setup.js; \
    fi

# Verify the API build output exists
RUN ls -la packages/api/dist

# Stage 2: Production image. Debian (glibc) for the reason given on the builder.
FROM node:26-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# Install pnpm directly. Corepack was removed from Node core in 25, so
# `corepack enable` is `command not found` on this base image — which is what
# silently broke every image publish after the node 24 -> 26 bump (e9b49db).
# Pinned to the same version as the root package.json `packageManager` field.
RUN npm install --global pnpm@11.1.2

# Copy workspace configuration
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./


# Copy built packages (dist + package.json)
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/rdf-delta/package.json ./packages/rdf-delta/package.json
COPY --from=builder /app/packages/rdf-delta/dist ./packages/rdf-delta/dist
COPY --from=builder /app/packages/runtime/package.json ./packages/runtime/package.json
COPY --from=builder /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=builder /app/packages/srl/package.json ./packages/srl/package.json
COPY --from=builder /app/packages/srl/dist ./packages/srl/dist
COPY --from=builder /app/packages/tools/package.json ./packages/tools/package.json
COPY --from=builder /app/packages/tools/dist ./packages/tools/dist
COPY --from=builder /app/packages/api/package.json ./packages/api/package.json
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/api/system-store ./packages/api/system-store
COPY --from=builder /app/packages/mcp-server/package.json ./packages/mcp-server/package.json
COPY --from=builder /app/packages/mcp-server/dist ./packages/mcp-server/dist

# Install production dependencies for all workspace packages
# This ensures transitive dependencies of contracts and types are available
RUN pnpm install --prod --frozen-lockfile

# The base image's libc, as DuckDB itself reports it — the property this image's
# base was chosen for, asserted where a regression is cheap to catch.
#
# A base flipped back to Alpine would still build, still pass every test, and
# still serve: the only symptom would be `INSTALL <ext> FROM community` failing
# with a 404 in somebody's ingestion, weeks later (issue #468). Two seconds at
# build time turns that into a failed build with a reason attached.
#
# Checked here rather than by running the image: `docker run` is broken on the
# CI runner (see the note in scripts/ci/docker-build-push.sh), so a build step
# is what CI can actually execute.
RUN cd /app/packages/api && node --input-type=module -e "\
import { DuckDBInstance } from '@duckdb/node-api'; \
const instance = await DuckDBInstance.create(':memory:'); \
const connection = await instance.connect(); \
const result = await connection.runAndReadAll('SELECT * FROM pragma_platform()'); \
const platform = String(Object.values(result.getRowObjects()[0])[0]); \
console.log('duckdb platform: ' + platform); \
if (platform.includes('musl')) { \
  console.error('This image is musl-based. DuckDB community extensions are not published for ' + platform + ' at this version, so ETL cannot load them — see docs/guides/etl.md §6.'); \
  process.exit(1); \
}"

# Remove pnpm files to reduce image size
RUN rm -rf pnpm-lock.yaml pnpm-workspace.yaml

# Default to dual HTTP (API + MCP on one port) in cloud, with override support.
# Valid APP_MODE values: dual-http, api, mcp-http
ENV APP_MODE=dual-http
ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=3000
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=3333

# Create the storage directory *before* declaring it a volume, owned by the
# `node` user the container runs as (issue #466).
#
# Docker seeds a fresh anonymous or named volume from the image's content at
# that path, ownership included. Left to be created implicitly by VOLUME, the
# directory is root-owned 0755, so the first thing the app does on a fresh
# volume — `mkdir storage/etl-output` as uid 1000 — fails with EACCES. Creating
# the ETL output directory here as well means the default `ETL_OUTPUT_DIR` is
# writable on a fresh volume without the app having to create anything.
#
# This fixes fresh volumes only. A host bind mount, or a named volume that was
# already seeded root-owned by an earlier image, keeps the ownership it has:
# see docs/guides/etl.md §5.
RUN mkdir -p /app/packages/api/storage/etl-output \
    && chown -R node:node /app/packages/api/storage

# Create volume mount point for persistent storage
VOLUME /app/packages/api/storage

EXPOSE 3000
EXPOSE 3333

# Switch to non-root user for security
USER node

# Boot API or MCP runtime based on APP_MODE
# Set OTEL_ENABLED=false to disable OpenTelemetry for API mode if needed
# Mount a volume to /app/packages/api/storage for persistence:
#   docker run -v sparql-storage:/app/packages/api/storage ...
CMD ["sh", "-c", "case \"${APP_MODE:-dual-http}\" in api) cd /app/packages/api && if [ -f ./dist/otel-setup.js ] && [ \"${OTEL_ENABLED:-true}\" = \"true\" ]; then node --require ./dist/otel-setup.js dist/index.js; else node dist/index.js; fi ;; mcp-http) cd /app/packages/mcp-server && MCP_TRANSPORT=streamable-http NODE_ENV=production node dist/cli.js ;; dual-http|*) cd /app/packages/mcp-server && MCP_TRANSPORT=dual-http NODE_ENV=production node dist/cli.js ;; esac"]
