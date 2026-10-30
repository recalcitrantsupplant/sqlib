#!/bin/sh
# Demo people for `just demo-graph-access`: three users and the two groups the
# graph access demo's rules name. Safe to run again: it creates what is
# missing and resets each user's groups and password to the values below.
#
#   alice@localhost   group analysts   reads public + finance
#   bob@localhost     group hr         reads public + finance + hr
#   carol@localhost   no group         reads public
#
# All three share DEMO_USER_PASSWORD. Local demo only: never point this at a
# Rauthy that real people sign in to.
set -eu

: "${RAUTHY_URL:=http://rauthy:8080}"
: "${RAUTHY_API_KEY_SECRET:?set RAUTHY_API_KEY_SECRET}"
: "${DEMO_USER_PASSWORD:?set DEMO_USER_PASSWORD}"

API="$RAUTHY_URL/auth/v1"
AUTH="Authorization: API-Key sqlib-setup\$$RAUTHY_API_KEY_SECRET"

log() { printf '[demo-users] %s\n' "$*"; }

call() {
  method=$1 path=$2 body=${3:-}
  out=$(mktemp)
  if [ -n "$body" ]; then
    status=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H "$AUTH" \
      -H 'Content-Type: application/json' --data "$body" "$API$path")
  else
    status=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H "$AUTH" "$API$path")
  fi
  if [ "$status" -ge 400 ]; then
    log "$method $path answered $status: $(cat "$out")" >&2
    rm -f "$out"
    return 1
  fi
  cat "$out"
  rm -f "$out"
}

i=0
until curl -fsS -o /dev/null "$API/health"; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { log "Rauthy did not become healthy"; exit 1; }
  sleep 2
done

existing_groups=$(call GET /groups | jq -c '[.[].name]')
for group in analysts hr; do
  if printf '%s' "$existing_groups" | jq -e --arg g "$group" 'index($g) != null' >/dev/null; then
    log "group $group: exists"
  else
    log "creating group $group"
    call POST /groups "$(jq -nc --arg g "$group" '{group: $g}')" >/dev/null
  fi
done

# user <email> <given name> <groups as a JSON array>
user() {
  email=$1 name=$2 groups=$3
  id=$(curl -sS -H "$AUTH" "$API/users/email/$email" | jq -r '.id // empty')
  if [ -z "$id" ]; then
    log "creating user $email"
    id=$(call POST /users "$(jq -nc --arg e "$email" --arg n "$name" --argjson g "$groups" \
      '{email: $e, given_name: $n, language: "en", roles: [], groups: $g}')" | jq -r .id)
  fi
  log "setting groups and password for $email"
  call PUT "/users/$id" "$(jq -nc --arg e "$email" --arg n "$name" --argjson g "$groups" --arg p "$DEMO_USER_PASSWORD" \
    '{email: $e, given_name: $n, language: "en", password: $p, roles: [], groups: $g, enabled: true, email_verified: true}')" >/dev/null
}

user alice@localhost Alice '["analysts"]'
user bob@localhost Bob '["hr"]'
user carol@localhost Carol '[]'

log "done"
