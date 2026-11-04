#!/usr/bin/env bash
# Integration test for SQLite backup to blob storage (packages/api/src/replication).
#
#   bash scripts/ci/litestream-it.sh            # every store
#   STORES="s3" bash scripts/ci/litestream-it.sh
#
# Runs the real server under the real supervisor and the real Litestream, against
# local emulators: MinIO for S3, Azurite for Azure Blob, fake-gcs-server for GCS.
# Everything runs as plain processes, not containers: the self-hosted CI runner
# cannot `docker run` (see scripts/ci/docker-build-push.sh), and processes start
# faster anyway.
#
# Needs: a built API (`pnpm --filter "@sparql-query-lib/api..." build`), Go 1.26+
# (to build MinIO and fake-gcs-server at pinned versions), curl, tar, sha256sum.
# Binaries are cached in $SQLIB_IT_CACHE (default ~/.cache/sqlib-it), so only the
# first run builds them. Point MINIO_BIN, FAKE_GCS_BIN or LITESTREAM_BIN at an
# existing binary to skip that.
#
# What the emulators cannot test (IAM roles, managed identity, KMS, private
# endpoints) is the manual checklist in docs/guides/deploying.md.
source "$(dirname "$0")/lib.sh"

# --- pinned tools --------------------------------------------------------------
# Litestream: the same release and checksum as the Dockerfile.
LITESTREAM_VERSION=0.5.17
LITESTREAM_SHA256_X86_64=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
LITESTREAM_SHA256_ARM64=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5
# Built with `go install`, so the Go checksum database verifies the source.
MINIO_MODULE=github.com/minio/minio@v0.0.0-20260212201848-7aac2a2c5b7c
FAKE_GCS_MODULE=github.com/fsouza/fake-gcs-server@v1.56.1
AZURITE_VERSION=3.35.0

STORES="${STORES:-s3 abs gs}"
CACHE="${SQLIB_IT_CACHE:-$HOME/.cache/sqlib-it}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sqlib-litestream-it.XXXXXX")"
API_DIR="$REPO_ROOT/packages/api"
PORT_A=3871
PORT_B=3872
PIDS=()

# The agent and some CI images set AWS_CA_BUNDLE for their proxy. Litestream's
# S3 client fails to load any config while it is set, so the test clears it;
# the emulators are plain HTTP on localhost.
unset AWS_CA_BUNDLE

cleanup() {
  local pid
  for pid in "${PIDS[@]}"; do kill -9 "$pid" 2>/dev/null || true; done
  pkill -9 -f "$WORK" 2>/dev/null || true
  if [ "${KEEP_WORK:-}" = "1" ]; then log "kept $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

fail() {
  printf '\033[1;31m[it:fail]\033[0m %s\n' "$*" >&2
  local f
  for f in "$WORK"/*.log; do
    [ -f "$f" ] || continue
    echo "----- $(basename "$f") (last 30 lines)" >&2
    tail -n 30 "$f" >&2
  done
  exit 1
}

# --- tools ---------------------------------------------------------------------
mkdir -p "$CACHE/bin"

ensure_litestream() {
  if [ -n "${LITESTREAM_BIN:-}" ]; then return; fi
  LITESTREAM_BIN="$CACHE/bin/litestream-$LITESTREAM_VERSION"
  [ -x "$LITESTREAM_BIN" ] && return
  local arch sha
  case "$(uname -m)" in
    x86_64) arch=x86_64; sha=$LITESTREAM_SHA256_X86_64 ;;
    aarch64|arm64) arch=arm64; sha=$LITESTREAM_SHA256_ARM64 ;;
    *) fail "no pinned Litestream for $(uname -m)" ;;
  esac
  local tgz="$WORK/litestream.tar.gz"
  log "downloading Litestream $LITESTREAM_VERSION"
  curl -sSfL -o "$tgz" "https://github.com/benbjohnson/litestream/releases/download/v$LITESTREAM_VERSION/litestream-$LITESTREAM_VERSION-linux-$arch.tar.gz"
  echo "$sha  $tgz" | sha256sum -c - >/dev/null || fail "Litestream checksum mismatch"
  tar -xzf "$tgz" -C "$WORK" litestream
  mv "$WORK/litestream" "$LITESTREAM_BIN"
}

ensure_go_tool() { # <var name> <module@version> <binary name>
  local var=$1 module=$2 name=$3
  if [ -n "${!var:-}" ]; then return; fi
  local dir="$CACHE/go/${module//[@\/]/_}"
  if [ ! -x "$dir/$name" ]; then
    command -v go >/dev/null || fail "Go is needed to build $module (or set $var)"
    log "building $module (first run only)"
    GOBIN="$dir" GOFLAGS=-mod=mod go install "$module"
  fi
  printf -v "$var" '%s' "$dir/$name"
}

ensure_litestream
ensure_go_tool MINIO_BIN "$MINIO_MODULE" minio
ensure_go_tool FAKE_GCS_BIN "$FAKE_GCS_MODULE" fake-gcs-server
[ -f "$API_DIR/dist/replication/main.js" ] || fail "build the API first: pnpm --filter \"@sparql-query-lib/api...\" build"

# --- emulators -----------------------------------------------------------------
wait_for() { # <seconds> <command...>
  local deadline=$((SECONDS + $1)); shift
  until "$@" >/dev/null 2>&1; do
    [ $SECONDS -lt $deadline ] || return 1
    sleep 0.3
  done
}

start_minio() {
  MINIO_ROOT_USER=sqlibtest MINIO_ROOT_PASSWORD=sqlibtest-secret \
    "$MINIO_BIN" server "$WORK/minio-data" --address 127.0.0.1:9100 --console-address 127.0.0.1:9101 \
    > "$WORK/minio.log" 2>&1 &
  MINIO_PID=$!
  PIDS+=("$MINIO_PID")
  wait_for 30 curl -sf http://127.0.0.1:9100/minio/health/live || fail "MinIO did not start"
}

start_emulators() {
  case " $STORES " in *" s3 "*) start_minio ;; esac
  case " $STORES " in *" abs "*)
    (cd "$API_DIR" && pnpm dlx "azurite@$AZURITE_VERSION" --blobHost 127.0.0.1 --blobPort 10100 \
      --location "$WORK/azurite-data" --skipApiVersionCheck --loose --silent) > "$WORK/azurite.log" 2>&1 &
    PIDS+=($!)
    wait_for 120 curl -s -o /dev/null http://127.0.0.1:10100/devstoreaccount1?comp=list || fail "Azurite did not start"
    ;;
  esac
  case " $STORES " in *" gs "*)
    "$FAKE_GCS_BIN" -scheme http -host 127.0.0.1 -port 4543 -backend memory -public-host 127.0.0.1:4543 \
      > "$WORK/gcs.log" 2>&1 &
    PIDS+=($!)
    wait_for 30 curl -sf http://127.0.0.1:4543/storage/v1/b || fail "fake-gcs-server did not start"
    ;;
  esac
}

# --- per-store environment -----------------------------------------------------
# Exports what an operator would set for that store. $1: store, $2: prefix.
use_store() {
  local store=$1 prefix=$2
  unset SQLIB_SQLITE_REPLICA_ENDPOINT SQLIB_SQLITE_REPLICA_REGION LITESTREAM_AZURE_ACCOUNT_KEY STORAGE_EMULATOR_HOST \
    AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  case "$store" in
    s3)
      export SQLIB_SQLITE_REPLICA_URL="s3://sqlib-it/$prefix"
      export SQLIB_SQLITE_REPLICA_ENDPOINT=http://127.0.0.1:9100 SQLIB_SQLITE_REPLICA_REGION=us-east-1
      export AWS_ACCESS_KEY_ID=sqlibtest AWS_SECRET_ACCESS_KEY=sqlibtest-secret
      ;;
    abs)
      # Azurite's well-known development account; not a secret.
      export SQLIB_SQLITE_REPLICA_URL="abs://devstoreaccount1@sqlib-it/$prefix"
      export SQLIB_SQLITE_REPLICA_ENDPOINT=http://127.0.0.1:10100/devstoreaccount1
      export LITESTREAM_AZURE_ACCOUNT_KEY='Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
      ;;
    gs)
      export SQLIB_SQLITE_REPLICA_URL="gs://sqlib-it/$prefix"
      export STORAGE_EMULATOR_HOST=http://127.0.0.1:4543
      ;;
  esac
}

# --- the server ----------------------------------------------------------------
# start_server <name> <port> [VAR=value...]: runs the supervisor and the API with
# the current store environment, its own storage dir, and the extra variables.
start_server() {
  local name=$1 port=$2; shift 2
  mkdir -p "$WORK/$name"
  # setsid: its own process group, so kill_hard can take down the supervisor,
  # Litestream and the server together.
  (
    cd "$API_DIR"
    exec setsid env \
      SQLIB_LITESTREAM_BIN="$LITESTREAM_BIN" \
      SQLIB_SQLITE_REPLICA_LEASE_TTL=4s SQLIB_SQLITE_REPLICA_LEASE_RENEW=1s \
      LIBRARY_STORAGE_DIR="$WORK/$name/library-store" \
      SQLIB_AUTH_MODE=anonymous SQLIB_AUTH_STORE_DIR="$WORK/$name/auth" \
      PORT="$port" OTEL_ENABLED=false NODE_ENV=production LOG_LEVEL=warn \
      "$@" \
      node dist/replication/main.js node dist/index.js
  ) >> "$WORK/$name.log" 2>&1 &
  SERVER_PID=$!
  PIDS+=("$SERVER_PID")
}

wait_up() { # <port> <pid>
  local deadline=$((SECONDS + 90))
  until curl -sf "http://127.0.0.1:$1/health" >/dev/null 2>&1; do
    kill -0 "$2" 2>/dev/null || fail "server on :$1 exited before it was ready"
    [ $SECONDS -lt $deadline ] || fail "server on :$1 not ready after 90s"
    sleep 0.3
  done
}

# Kills the supervisor, Litestream and the server at once, as a lost VM would.
kill_hard() { # <pid>
  kill -9 -- "-$1" 2>/dev/null || true
  wait_for 10 bash -c "! kill -0 $1" || fail "could not kill $1"
}

stop_clean() { # <pid>
  kill -TERM "$1"
  wait_for 40 bash -c "! kill -0 $1" || fail "server did not stop within 40s of SIGTERM"
}

create_library() { # <port> <slug>
  curl -sf -X POST "http://127.0.0.1:$1/libraries" -H 'content-type: application/json' \
    -d "{\"name\":\"$2\",\"slug\":\"$2\"}" >/dev/null || fail "could not create library $2"
}

has_library() { # <port> <slug>
  curl -sf "http://127.0.0.1:$1/libraries" | grep -q "\"slug\":\"$2\""
}

outcome() { # <name> <database>: the last restore outcome the supervisor logged
  grep -o "\"msg\":\"Restore\",\"database\":\"$2\",[^}]*\"outcome\":\"[a-z-]*\"" "$WORK/$1.log" | tail -1 | sed 's/.*"outcome":"//; s/"$//'
}

# --- scenarios -----------------------------------------------------------------
run_store() {
  local store=$1 started
  log "[$store] creating the bucket"
  use_store "$store" "run-$RANDOM"
  (cd "$API_DIR" && pnpm -s it:replication-buckets "$store" sqlib-it) || fail "[$store] could not create the bucket"

  log "[$store] 1. first start: no replica yet"
  start_server "$store-a" $PORT_A; wait_up $PORT_A "$SERVER_PID"
  [ "$(outcome "$store-a" library)" = "no-replica" ] || fail "[$store] expected no-replica"
  create_library $PORT_A "$store-one"
  sleep 3

  log "[$store] 2. kill -9, lose the disk, start again: everything synced is back"
  kill_hard "$SERVER_PID"
  rm -rf "$WORK/$store-a"
  start_server "$store-a" $PORT_A; wait_up $PORT_A "$SERVER_PID"
  has_library $PORT_A "$store-one" || fail "[$store] library lost after kill -9"
  [ "$(outcome "$store-a" library)" = "restored" ] || fail "[$store] library not restored"
  [ "$(outcome "$store-a" auth)" = "restored" ] || fail "[$store] auth not restored"

  log "[$store] 3. SIGTERM: the last write is synced on the way out, and the lease is free at once"
  create_library $PORT_A "$store-two"
  stop_clean "$SERVER_PID"
  grep -q '"msg":"Released the replica lease"' "$WORK/$store-a.log" || fail "[$store] lease not released"
  rm -rf "$WORK/$store-a"
  started=$SECONDS
  start_server "$store-a" $PORT_A; wait_up $PORT_A "$SERVER_PID"
  local a_pid=$SERVER_PID
  has_library $PORT_A "$store-two" || fail "[$store] write before SIGTERM lost"
  log "[$store]    restart with restore took $((SECONDS - started))s"

  log "[$store] 4. a second instance waits for the lease, and gives up while it is held"
  start_server "$store-b" $PORT_B SQLIB_SQLITE_REPLICA_LEASE_WAIT=3s
  local b_pid=$SERVER_PID
  wait_for 30 bash -c "! kill -0 $b_pid" || fail "[$store] second instance did not give up"
  grep -q "holds the replica lease" "$WORK/$store-b.log" || fail "[$store] second instance did not report the lease"
  if curl -sf "http://127.0.0.1:$PORT_B/health" >/dev/null 2>&1; then fail "[$store] second instance served"; fi

  log "[$store] 5. a second instance takes over once the first stops (a rolling deploy)"
  create_library $PORT_A "$store-three"
  start_server "$store-b" $PORT_B
  b_pid=$SERVER_PID
  sleep 2
  curl -sf "http://127.0.0.1:$PORT_B/health" >/dev/null 2>&1 && fail "[$store] second instance served while the first held the lease"
  stop_clean "$a_pid"
  wait_up $PORT_B "$b_pid"
  has_library $PORT_B "$store-three" || fail "[$store] write on the old instance lost in the handover"

  log "[$store] 6. replica wins over a stale local file"
  stop_clean "$b_pid"
  mkdir -p "$WORK/$store-c/library-store"
  (cd "$API_DIR" && node -e "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.exec('CREATE TABLE stale(x)'); d.close();" \
    "$WORK/$store-c/library-store/library.sqlite") 2>/dev/null
  start_server "$store-c" $PORT_A; wait_up $PORT_A "$SERVER_PID"
  has_library $PORT_A "$store-three" || fail "[$store] stale local file won over the replica"
  stop_clean "$SERVER_PID"

  log "[$store] 7. a failed restore stops the start (wrong credentials, or no bucket)"
  case "$store" in
    s3) start_server "$store-d" $PORT_A AWS_SECRET_ACCESS_KEY=wrong SQLIB_SQLITE_REPLICA_LEASE=off ;;
    abs) start_server "$store-d" $PORT_A LITESTREAM_AZURE_ACCOUNT_KEY=d3JvbmcK SQLIB_SQLITE_REPLICA_LEASE=off ;;
    # The emulator checks no credentials, so a missing bucket stands in for them.
    gs) start_server "$store-d" $PORT_A SQLIB_SQLITE_REPLICA_URL=gs://no-such-bucket/x SQLIB_SQLITE_REPLICA_LEASE=off ;;
  esac
  local d_pid=$SERVER_PID
  wait_for 60 bash -c "! kill -0 $d_pid" || fail "[$store] start with bad credentials did not stop"
  grep -q "Could not restore the library database" "$WORK/$store-d.log" || fail "[$store] no restore error logged"
  if curl -sf "http://127.0.0.1:$PORT_A/health" >/dev/null 2>&1; then fail "[$store] served after a failed restore"; fi

  log "[$store] passed"
}

run_store_outage() {
  log "[s3] 8. the store goes away while sqlib writes, then comes back"
  use_store s3 "outage-$RANDOM"
  start_server s3-e $PORT_A; wait_up $PORT_A "$SERVER_PID"
  create_library $PORT_A s3-before
  sleep 2
  kill -9 "$MINIO_PID"
  create_library $PORT_A s3-during
  sleep 3
  start_minio
  sleep 5
  kill_hard "$SERVER_PID"
  rm -rf "$WORK/s3-e"
  sleep 6 # the dead holder's lease: TTL 4s plus 5s grace, counted from its last renewal
  start_server s3-e $PORT_A; wait_up $PORT_A "$SERVER_PID"
  has_library $PORT_A s3-during || fail "[s3] write made during the outage was not caught up"
  stop_clean "$SERVER_PID"
  log "[s3] outage passed"
}

start_emulators
for store in $STORES; do run_store "$store"; done
case " $STORES " in *" s3 "*) run_store_outage ;; esac
log "litestream integration test passed for: $STORES"
