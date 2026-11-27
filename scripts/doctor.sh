#!/usr/bin/env bash
# pnpm doctor — checks everything the build loop and the gates need on this machine, so a
# missing tool shows up here instead of as a silent hook or a hung prompt.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lefthook-rc.sh
. "$ROOT/scripts/lefthook-rc.sh"

fail=0
ok() { printf '✔ %s\n' "$1"; }
bad() { printf '✖ %s\n' "$1"; fail=1; }
warn() { printf '⚠ %s\n' "$1"; }

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -ge 22 ]; then ok "node $(node -v)"; else bad "node >= 22 required (found $(node -v 2>/dev/null || echo none))"; fi

pnpm_v=$(cd "$ROOT" && pnpm -v 2>/dev/null || echo none)
case "$pnpm_v" in 9.*) ok "pnpm $pnpm_v" ;; *) bad "pnpm 9 required (found $pnpm_v) — corepack enable" ;; esac

command -v jq >/dev/null && ok "jq $(jq --version)" || bad "jq missing — every Claude hook needs it (brew install jq)"
command -v git >/dev/null && ok "$(git --version)" || bad "git missing"

if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  ok "docker running"
else
  bad "docker not running — needed for the dev database and the security/db/e2e stages"
fi

if [ -x "$ROOT/node_modules/.bin/lefthook" ]; then
  if [ -f "$(git -C "$ROOT" rev-parse --git-common-dir)/hooks/pre-commit" ]; then ok "lefthook hooks installed"; else bad "git hooks not installed — pnpm exec lefthook install"; fi
else
  bad "dependencies not installed — pnpm install"
fi

command -v gitleaks >/dev/null && ok "gitleaks (commit-time scan)" || warn "gitleaks not installed: commit-time scan skipped; the PR security job still runs it"

for port in 3100 3101 5436; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then warn "port $port is in use (dev stack already up?)"; fi
done

if git -C "$ROOT" remote get-url origin >/dev/null 2>&1; then ok "remote $(git -C "$ROOT" remote get-url origin)"; else warn "no git remote"; fi

[ "$fail" = 0 ] && echo "doctor: ✅ ready" || { echo "doctor: ❌ fix the items above"; exit 1; }
