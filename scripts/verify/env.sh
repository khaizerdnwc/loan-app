# Sourced by scripts/verify/verify.sh and services.sh — the one environment every verify
# stage runs in, on a Mac and on the GitHub runner alike (ADR 0018).
#
# Every app variable is set explicitly here, so nothing leaks in from a developer's
# apps/api/.env or apps/backoffice/.env.local. These are dummy values — nothing here is a
# secret.

VERIFY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export VERIFY_ROOT

# --- Start from nothing: every app variable blanked ----------------------------------
# Every key named in an app's .env.example, .env or .env.local is exported EMPTY first,
# then the values this file needs are set below. Only key names are read, never values.
for _verify_envfile in \
  "$VERIFY_ROOT/apps/api/.env.example" "$VERIFY_ROOT/apps/api/.env" \
  "$VERIFY_ROOT/apps/backoffice/.env.example" "$VERIFY_ROOT/apps/backoffice/.env.local"; do
  [ -f "$_verify_envfile" ] || continue
  for _verify_key in $(sed -nE 's/^[[:space:]]*#?[[:space:]]*(export[[:space:]]+)?([A-Z][A-Z0-9_]*)=.*/\2/p' "$_verify_envfile"); do
    export "$_verify_key="
  done
done
unset _verify_envfile _verify_key

# --- Pinned tools and service images --------------------------------------------------
export VERIFY_SEMGREP_IMAGE="semgrep/semgrep:1.168.0@sha256:59fbed6127ea7c5dde3ba6a85142733bb20ea9aaa36120c953904f1539aaf66e"
export VERIFY_GITLEAKS_IMAGE="zricethezav/gitleaks:v8.21.2@sha256:0e99e8821643ea5b235718642b93bb32486af9c8162c8b8731f7cbdc951a7f46"
export VERIFY_POSTGRES_IMAGE="postgres:16-alpine@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d"
export VERIFY_ACTIONLINT_IMAGE="rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9"
export VERIFY_HADOLINT_IMAGE="hadolint/hadolint:v2.12.0-alpine@sha256:3c206a451cec6d486367e758645269fd7d696c5ccb6ff59d8b03b0e45268a199"

# --- Throwaway services (scripts/verify/services.sh) ---------------------------------
# Ports chosen never to collide with the dev stack (postgres 5436, API 3101, web 3100),
# so a verify can run while `pnpm dev` is up.
export VERIFY_PG_PORT=55432
export VERIFY_API_PORT=53101
export VERIFY_WEB_PORT=53100
# Both names end in _test: the integration-test helper refuses to truncate anything else.
export VERIFY_DB=loan_verify_test
export VERIFY_E2E_DB=loan_e2e_test

_verify_owner="postgres://loan:loan_verify@127.0.0.1:${VERIFY_PG_PORT}"
export VERIFY_DB_URL="${_verify_owner}/${VERIFY_DB}"
export VERIFY_E2E_URL="${_verify_owner}/${VERIFY_E2E_DB}"

# --- App / test environment -----------------------------------------------------------
# GitHub sets CI=true on every runner; setting it here makes a local run take the same
# branches (Playwright retries and forbidOnly, Jest's --ci).
export CI=true
export NODE_ENV=test
export DATABASE_URL="$VERIFY_DB_URL"
export TEST_DATABASE_URL="$VERIFY_DB_URL"
export JWT_SECRET=verify-dummy-secret-at-least-32-characters-long
export CORS_ORIGIN="http://127.0.0.1:${VERIFY_WEB_PORT}"
export API_URL="http://127.0.0.1:${VERIFY_API_PORT}"
export SIMULATION_AUTO_RESET_MINUTES=15
export SIMULATION_TIMEOUT_MS=20
export MIGRATE_ON_BOOT=false
export EXPIRY_SWEEP_SECONDS=0
export TRUST_PROXY_HOPS=0
export PORT="$VERIFY_API_PORT"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${VERIFY_WEB_PORT}"

unset _verify_owner

# --- Find docker when the caller's PATH lacks it (GUI git clients, agent shells) -----
if ! command -v docker >/dev/null 2>&1; then
  for _verify_dir in "$HOME/.docker/bin" /Applications/Docker.app/Contents/Resources/bin; do
    [ -x "$_verify_dir/docker" ] && PATH="$_verify_dir:$PATH"
  done
  unset _verify_dir
  export PATH
fi
