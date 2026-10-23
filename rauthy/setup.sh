#!/bin/sh
# Configure Rauthy for sqlib, through its admin API (docs/design/auth-architecture.md).
#
# Run once by the `rauthy-setup` service of the `auth` compose profile, and
# safe to run again: every step creates what is missing and updates what is
# there. It defines
#
#   - `sqlib-web`, the SPA: a public client, code flow with PKCE (S256),
#     refresh tokens, RS256, and sqlib's resource in `allowed_resources` and
#     `default_aud`;
#   - `sqlib-machine`, one confidential client for an unattended caller:
#     client credentials and token exchange, the same audience. Its secret is
#     printed the first time the client is created;
#   - an upstream provider for each of Google, GitHub, Entra ID and AAF whose
#     client id is set in the environment. Unset, a provider is skipped.
#
# Rauthy's bootstrap files cannot set `allowed_resources` or `default_aud`,
# which is why this is an API script and not a `clients.json`.
set -eu

: "${RAUTHY_URL:=http://rauthy:8080}"
: "${RAUTHY_API_KEY_SECRET:?set RAUTHY_API_KEY_SECRET in .env}"
: "${SQLIB_AUTH_RESOURCE:?set SQLIB_AUTH_RESOURCE in .env}"
# Comma-separated origins the SPA is served from.
: "${SQLIB_WEB_ORIGINS:=http://localhost:3001}"

API="$RAUTHY_URL/auth/v1"
AUTH="Authorization: API-Key sqlib-setup\$$RAUTHY_API_KEY_SECRET"

log() { printf '[rauthy-setup] %s\n' "$*"; }

# curl wrapper: prints the body, fails on an HTTP error with the body in the log.
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

exists() {
  status=$(curl -sS -o /dev/null -w '%{http_code}' -H "$AUTH" "$API$1")
  [ "$status" = 200 ]
}

log "waiting for $RAUTHY_URL"
i=0
until curl -fsS -o /dev/null "$API/health"; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { log "Rauthy did not become healthy"; exit 1; }
  sleep 2
done

json_list() { printf '%s' "$1" | jq -Rc 'split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))'; }
ORIGINS=$(json_list "$SQLIB_WEB_ORIGINS")
REDIRECTS=$(printf '%s' "$ORIGINS" | jq -c 'map(. + "/auth/callback")')
LOGOUTS=$(printf '%s' "$ORIGINS" | jq -c 'map(. + "/")')
RESOURCE=$(jq -nc --arg r "$SQLIB_AUTH_RESOURCE" '[$r]')

# --- the SPA ----------------------------------------------------------------
if ! exists /clients/sqlib-web; then
  log "creating client sqlib-web"
  call POST /clients "$(jq -nc --argjson r "$REDIRECTS" \
    '{id: "sqlib-web", name: "sqlib web", confidential: false, redirect_uris: $r}')" >/dev/null
fi
log "updating client sqlib-web"
call PUT /clients/sqlib-web "$(jq -nc \
  --argjson redirects "$REDIRECTS" --argjson logouts "$LOGOUTS" \
  --argjson origins "$ORIGINS" --argjson resource "$RESOURCE" '{
    name: "sqlib web",
    confidential: false,
    enabled: true,
    redirect_uris: $redirects,
    post_logout_redirect_uris: $logouts,
    allowed_origins: $origins,
    flows_enabled: ["authorization_code", "refresh_token"],
    access_token_alg: "RS256",
    id_token_alg: "RS256",
    auth_code_lifetime: 60,
    access_token_lifetime: 900,
    scopes: ["openid", "profile", "email", "groups"],
    default_scopes: ["openid"],
    challenges: ["S256"],
    force_mfa: false,
    claims_at_root: false,
    allowed_resources: $resource,
    default_aud: $resource
  }')" >/dev/null

# --- the machine client -----------------------------------------------------
created_machine=false
if ! exists /clients/sqlib-machine; then
  log "creating client sqlib-machine"
  call POST /clients '{"id":"sqlib-machine","name":"sqlib machine","confidential":true,"redirect_uris":[]}' >/dev/null
  created_machine=true
fi
log "updating client sqlib-machine"
call PUT /clients/sqlib-machine "$(jq -nc --argjson resource "$RESOURCE" '{
    name: "sqlib machine",
    confidential: true,
    enabled: true,
    redirect_uris: [],
    flows_enabled: ["client_credentials", "urn:ietf:params:oauth:grant-type:token-exchange"],
    access_token_alg: "RS256",
    id_token_alg: "RS256",
    auth_code_lifetime: 60,
    access_token_lifetime: 900,
    scopes: ["openid"],
    default_scopes: ["openid"],
    force_mfa: false,
    claims_at_root: false,
    allowed_resources: $resource,
    default_aud: $resource
  }')" >/dev/null
if [ "$created_machine" = true ]; then
  secret=$(call POST /clients/sqlib-machine/secret | jq -r '.secret')
  log "sqlib-machine secret (shown once; rotate it in the admin UI): $secret"
fi

# --- upstream providers -----------------------------------------------------
# One entry per source, created when its client id is set. Rauthy redirects
# back to $RAUTHY_PUBLIC_URL/auth/v1/providers/callback: register that URL at
# each provider.
existing_providers=$(call POST /providers '' | jq -c '[.[].name]')

provider() {
  name=$1 typ=$2 client_id=$3 client_secret=$4 issuer=$5 auth=$6 token=$7 userinfo=$8 jwks=$9 scope=${10}
  [ -n "$client_id" ] || { log "provider $name: no client id set, skipped"; return 0; }
  if printf '%s' "$existing_providers" | jq -e --arg n "$name" 'index($n) != null' >/dev/null; then
    log "provider $name: exists, left as it is"
    return 0
  fi
  log "creating provider $name"
  call POST /providers/create "$(jq -nc \
    --arg name "$name" --arg typ "$typ" --arg client_id "$client_id" --arg client_secret "$client_secret" \
    --arg issuer "$issuer" --arg auth "$auth" --arg token "$token" --arg userinfo "$userinfo" \
    --arg jwks "$jwks" --arg scope "$scope" '{
      name: $name, typ: $typ, enabled: true,
      issuer: $issuer, authorization_endpoint: $auth, token_endpoint: $token,
      userinfo_endpoint: $userinfo, jwks_endpoint: (if $jwks == "" then null else $jwks end),
      use_pkce: true, client_secret_basic: false, client_secret_post: true,
      auto_onboarding: true, auto_link: false,
      client_id: $client_id, client_secret: (if $client_secret == "" then null else $client_secret end),
      scope: $scope
    }')" >/dev/null
}

# Endpoints of an OIDC issuer, from its discovery document via Rauthy.
lookup() { call POST /providers/lookup "$(jq -nc --arg i "$1" '{issuer: $i}')"; }

provider Google google "${GOOGLE_CLIENT_ID:-}" "${GOOGLE_CLIENT_SECRET:-}" \
  https://accounts.google.com \
  https://accounts.google.com/o/oauth2/v2/auth \
  https://oauth2.googleapis.com/token \
  https://openidconnect.googleapis.com/v1/userinfo \
  https://www.googleapis.com/oauth2/v3/certs \
  'openid profile email'

provider GitHub github "${GITHUB_CLIENT_ID:-}" "${GITHUB_CLIENT_SECRET:-}" \
  github.com \
  https://github.com/login/oauth/authorize \
  https://github.com/login/oauth/access_token \
  https://api.github.com/user \
  '' \
  'read:user user:email'

for source in ENTRA AAF; do
  eval "client_id=\${${source}_CLIENT_ID:-}"
  eval "client_secret=\${${source}_CLIENT_SECRET:-}"
  eval "issuer=\${${source}_ISSUER:-}"
  name=$([ "$source" = ENTRA ] && echo 'Entra ID' || echo 'AAF')
  if [ -z "$client_id" ] || [ -z "$issuer" ]; then
    log "provider $name: no client id or issuer set, skipped"
    continue
  fi
  found=$(lookup "$issuer")
  provider "$name" oidc "$client_id" "$client_secret" \
    "$(printf '%s' "$found" | jq -r .issuer)" \
    "$(printf '%s' "$found" | jq -r .authorization_endpoint)" \
    "$(printf '%s' "$found" | jq -r .token_endpoint)" \
    "$(printf '%s' "$found" | jq -r .userinfo_endpoint)" \
    "$(printf '%s' "$found" | jq -r '.jwks_endpoint // ""')" \
    "$(printf '%s' "$found" | jq -r .scope)"
done

log "done"
