#!/bin/sh
# Builds the demo library store: starts a sqlib API with writes open, plays
# each library manifest in demo/libraries back over the API, then stops the
# API so that SQLite folds its write-ahead log into library.sqlite.
#
# Dockerfile.demo runs it at image build. `just demo` runs it on the first
# start, when tmp/demo/store/library.sqlite does not exist.
#
# Settings, from the environment:
#
# | Name | Default | Use |
# | --- | --- | --- |
# | LIBRARY_STORAGE_DIR | required | The directory that gets library.sqlite |
# | ETL_OUTPUT_DIR | required | Where the ETL runs write their output files |
# | DEMO_API_DIR | /app/packages/api | The directory the API starts in |
# | DEMO_API_CMD | node dist/index.js | The command that starts the API |
# | DEMO_SEED_PORT | 3998 | The port of the seeding API |
# | DEMO_ISSUER | urn:sqlib:demo | The issuer that principal IRIs are made with |
#
# Each write is made as a person from demo/people.json, so the activity lists
# and the created-by and edited-by fields name people. sqlib takes these from
# the caller of the request. So the seeding API runs SQLIB_AUTH_MODE=dry-run
# and trusts one issuer, demo-issuer.mjs, which makes a token for each person.
# Every person is an administrator here. This auth store is temporary: the demo
# server builds its own auth store from demo/grants.ttl.
set -eu

demo_dir="$(cd "$(dirname "$0")/.." && pwd)"
: "${LIBRARY_STORAGE_DIR:?set LIBRARY_STORAGE_DIR}"
: "${ETL_OUTPUT_DIR:?set ETL_OUTPUT_DIR}"
api_dir="${DEMO_API_DIR:-/app/packages/api}"
api_cmd="${DEMO_API_CMD:-node dist/index.js}"
port="${DEMO_SEED_PORT:-3998}"
issuer_port=$((port + 1))
audience=sqlib-demo-seed
people="${demo_dir}/people.json"
DEMO_ISSUER="${DEMO_ISSUER:-urn:sqlib:demo}"
export DEMO_ISSUER

store="${LIBRARY_STORAGE_DIR}/library.sqlite"
work="$(mktemp -d)"
log="${work}/api.log"
issuer_log="${work}/issuer.log"
mkdir -p "${LIBRARY_STORAGE_DIR}" "${ETL_OUTPUT_DIR}"
test ! -e "${store}" || { printf '%s exists. Delete it to seed again.\n' "${store}" >&2; exit 1; }

admins="$(node -e "
  const people = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).people;
  process.stdout.write(people.map(p => process.argv[2] + '|' + p.id).join(','));
" "${people}" "${DEMO_ISSUER}")"

node "${demo_dir}/scripts/demo-issuer.mjs" \
  --port "${issuer_port}" --people "${people}" --audience "${audience}" >"${issuer_log}" 2>&1 &
issuer_pid=$!

# The seeder runs each test, benchmark and ETL job once. The demo server is
# read-only and records no runs, so these are the runs a visitor sees.
(
  cd "${api_dir}"
  export \
    NODE_ENV=production \
    OTEL_ENABLED=false \
    PORT="${port}" \
    FASTIFY_ADDRESS=127.0.0.1 \
    INTERNAL_BACKEND_TYPE=sqlite \
    LIBRARY_STORAGE_DIR \
    ETL_OUTPUT_DIR \
    SQLIB_READ_ONLY=false \
    SQLIB_DEMO=false \
    SQLIB_AUTH_MODE=dry-run \
    SQLIB_AUTH_ISSUERS_JSON="[{\"issuer\":\"${DEMO_ISSUER}\",\"audience\":\"${audience}\",\"jwksUri\":\"http://127.0.0.1:${issuer_port}/jwks.json\"}]" \
    SQLIB_AUTH_ADMIN_PRINCIPALS="${admins}" \
    SQLIB_AUTH_STORE_TYPE=sqlite \
    SQLIB_AUTH_STORE_DIR="${work}/auth" \
    ETL_DUCKDB_ALLOW_FILESYSTEM=false \
    FEATURE_QUERIES=true \
    FEATURE_QUERY_GROUPS=true \
    FEATURE_RULES_SUITE=true \
    FEATURE_TESTS=true \
    FEATURE_DATA_GRAPHS=true \
    FEATURE_ARGUMENT_SETS=true \
    FEATURE_BENCHMARKS=true \
    FEATURE_ETL=true \
    FEATURE_BACKENDS=true \
    FEATURE_TUPLE_SETS=true \
    FEATURE_NOTEBOOK=true \
    FEATURE_RULE_AGGREGATES=true \
    FEATURE_RULE_TUPLES=false \
    FEATURE_ASSISTANT=false
  # The command is split into words on purpose.
  # shellcheck disable=SC2086
  exec ${api_cmd}
) >"${log}" 2>&1 &
pid=$!

stop() {
  kill -TERM "${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
  kill -TERM "${issuer_pid}" 2>/dev/null || true
  wait "${issuer_pid}" 2>/dev/null || true
}

fail() {
  printf 'seed: %s\n' "$*" >&2
  stop
  cat "${issuer_log}" "${log}" >&2
  rm -f "${store}" "${store}-wal" "${store}-shm"
  exit 1
}

i=0
until node -e "fetch('http://127.0.0.1:${port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  kill -0 "${pid}" 2>/dev/null || fail 'the seeding API stopped before it was healthy'
  i=$((i + 1))
  test "${i}" -lt 300 || fail 'the seeding API was not healthy after 300 s'
  sleep 1
done

# Rail's access queries run on a backend that Rail operations administrators
# declares, so that library comes first.
for name in rail-admin rail sparql-tutorial sqlib-tutorial; do
  node "${demo_dir}/scripts/seed-library.mjs" \
    --api "http://127.0.0.1:${port}" \
    --library "${demo_dir}/libraries/${name}" \
    --issuer "${DEMO_ISSUER}" \
    --token-url "http://127.0.0.1:${issuer_port}" \
    || fail "seeding ${name} failed"
done

stop

test -s "${store}" || fail "the seeding API wrote no store at ${store}"
test ! -s "${store}-wal" || fail "the seeding API left a write-ahead log beside ${store}"

count="$(node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  process.stdout.write(String(db.prepare('SELECT count(*) AS n FROM entities').get().n));
" "${store}")"
rm -rf "${work}"
printf 'seed: wrote %s (%s entities)\n' "${store}" "${count}"
