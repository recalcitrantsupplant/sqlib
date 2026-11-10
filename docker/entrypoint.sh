#!/bin/sh
# The image's entrypoint. With SQLite backup to blob storage turned on, the
# server runs under the replication supervisor, which restores the SQLite files
# and keeps them replicated (packages/api/src/replication/supervisor.ts).
# Otherwise the command runs exactly as it would without this script.
#
# The supervisor is built from packages/api/src/replication/main.ts.
set -e
if [ -n "${SQLIB_SQLITE_REPLICA_URL:-}" ] || [ -n "${SQLIB_LITESTREAM_CONFIG:-}" ]; then
  exec node /app/packages/api/dist/replication/main.js "$@"
fi
exec "$@"
