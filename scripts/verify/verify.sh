#!/usr/bin/env bash
# `pnpm verify` — every gate stage, defined once (ADR 0018, amended by ADR 0021).
#
# Where each stage runs:
#   pre-push (lefthook)      verify.sh --only static,unit --affected <base>   fast, no Docker
#   pull request (Actions)   one job per stage, in parallel (.github/workflows/verify.yml)
#   on demand                pnpm verify  (every stage, needs Docker)
# Do not add a check to the workflow or the hook without adding it here: they call this.
#
#   pnpm verify                                   every stage
#   pnpm verify --only security,static            just those stages
#   pnpm verify --only static,unit --affected origin/main
#                                                 only packages changed since that ref
#                                                 (and the packages that depend on them)
#   SKIP_E2E=1 pnpm verify                        skip the e2e stage, loudly (local only)
#
# Stages, cheapest first, stopping at the first failure:
#   security     gitleaks (full history) · semgrep · pnpm audit · audit-ci · licences ·
#                actionlint · hadolint · shellcheck
#   static       house:check · dependency rules · typecheck · biome + eslint
#   unit         every package's unit tests (no database)
#   db           throwaway postgres · migrations from empty · entity/migration drift · seed
#   integration  API tests (Jest + supertest) against that database
#   build        every package and app
#   e2e          migrate + seed a second database · API + backoffice · Playwright
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/verify/env.sh
. "$ROOT/scripts/verify/env.sh"

ALL_STAGES=(security static unit db integration build e2e)
LOG_DIR="$ROOT/verify-logs"
API=(pnpm --filter @loan/api run)

# --- arguments -----------------------------------------------------------------------
STAGES=(${ALL_STAGES[@]+"${ALL_STAGES[@]}"})
AFFECTED_BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only)
      IFS=',' read -r -a STAGES <<<"${2:?--only needs a comma-separated list of stages}"
      shift 2
      ;;
    --affected)
      AFFECTED_BASE="${2:?--affected needs a base ref}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,25p' "$0"
      exit 0
      ;;
    *)
      echo "✖ unknown argument: $1 (try --help)" >&2
      exit 2
      ;;
  esac
done
for s in ${STAGES[@]+"${STAGES[@]}"}; do
  case " ${ALL_STAGES[*]} " in
    *" $s "*) ;;
    *)
      echo "✖ unknown stage: $s (stages: ${ALL_STAGES[*]})" >&2
      exit 2
      ;;
  esac
done
wants() { case " ${STAGES[*]} " in *" $1 "*) return 0 ;; *) return 1 ;; esac }

# --- helpers -------------------------------------------------------------------------
SUMMARY=()
CURRENT=""
# Set to 1 only on the last line; never inherited from the environment.
VERIFY_DONE=0
STAGE_START=0

step() { # <label> <command...> — echo, run, fail loudly
  printf '\n\033[1m▸ %s\033[0m\n' "$1"
  shift
  "$@"
}

stage_begin() {
  CURRENT="$1"
  STAGE_START=$SECONDS
  printf '\n\033[1;36m━━ %s ━━\033[0m\n' "$CURRENT"
}

stage_end() {
  SUMMARY+=("✔ $(printf '%-12s' "$CURRENT") $((SECONDS - STAGE_START))s")
  CURRENT=""
}

SERVICES_UP=0
PIDS=()
cleanup() {
  local code=$?
  # Fail closed: a stage still marked as running did not finish, whatever $? says. Under
  # bash 3.2 an error such as "unbound variable" can reach this trap with $? = 0.
  if [ -n "$CURRENT" ] && [ "$code" = 0 ]; then code=1; fi
  # And a run that never reached its last line did not pass, even outside a stage.
  if [ "${VERIFY_DONE:-}" != 1 ] && [ "$code" = 0 ]; then code=1; fi
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    [ -n "$pid" ] && kill "$pid" >/dev/null 2>&1 || true
  done
  if [ "$SERVICES_UP" = 1 ] && [ "${VERIFY_KEEP_SERVICES:-}" != 1 ]; then
    bash "$ROOT/scripts/verify/services.sh" down
  fi
  printf '\n\033[1m━━ verify summary ━━\033[0m\n'
  for line in ${SUMMARY[@]+"${SUMMARY[@]}"}; do [ -n "$line" ] && echo "$line"; done
  if [ -n "$CURRENT" ]; then
    echo "✖ $(printf '%-12s' "$CURRENT") failed after $((SECONDS - STAGE_START))s"
    [ -d "$LOG_DIR" ] && echo "  logs: $LOG_DIR"
  fi
  if [ "$code" = 0 ]; then echo "verify: ✅ passed in ${SECONDS}s"; else echo "verify: ❌ failed"; fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# After the trap: everything from here on, including git, exits through cleanup().
# Turbo filter: everything, or the packages changed since the base plus their dependents.
# Expanded as ${TURBO_FILTER[@]+"${TURBO_FILTER[@]}"}: bash 3.2 (macOS) treats an empty
# "${array[@]}" as unbound under `set -u`.
# A change to root plumbing (lockfile, tsconfig.base, turbo.json) makes turbo treat every
# package as changed, which is the safe answer.
TURBO_FILTER=()
if [ -n "$AFFECTED_BASE" ]; then
  if git rev-parse --verify --quiet "$AFFECTED_BASE^{commit}" >/dev/null; then
    TURBO_FILTER=(--filter="...[$AFFECTED_BASE]")
    echo "verify: affected packages since $(git rev-parse --short "$AFFECTED_BASE")"
  else
    echo "verify: base $AFFECTED_BASE not found — running every package"
  fi
fi


docker_ok() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "✖ docker not found. Install Docker Desktop." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "✖ Docker is not running. Start Docker Desktop and try again." >&2
    exit 1
  fi
}

# A scanner container sees the checkout at a fixed path, /src, never at the host's absolute
# path: from a linked worktree under .claude/worktrees, a same-path bind mount was seen to
# come up empty under Docker Desktop, and the scanners then passed having scanned nothing.
# The git common dir is mounted at /gitcommon and GIT_DIR points into it, so history scans
# work from a linked worktree too (its .git is a pointer outside the checkout; the
# worktree's own git dir finds the common dir through its relative `commondir` file).
# safe.directory: the container's uid does not own the mount.
docker_scan() { # <image> <args...>
  local image="$1"
  shift
  local common gitdir
  common="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
  gitdir="$(cd "$(git rev-parse --git-dir)" && pwd)"
  local mounts=(-v "$ROOT:/src") envs=(-e GIT_WORK_TREE=/src)
  case "$gitdir" in
    "$ROOT"/*) envs+=(-e "GIT_DIR=/src/${gitdir#"$ROOT"/}") ;;
    "$common" | "$common"/*)
      mounts+=(-v "$common:/gitcommon")
      envs+=(-e "GIT_DIR=/gitcommon${gitdir#"$common"}")
      ;;
    *)
      echo "✖ docker_scan: git dir $gitdir is neither in the checkout nor the common dir" >&2
      return 1
      ;;
  esac
  docker run --rm ${mounts[@]+"${mounts[@]}"} ${envs[@]+"${envs[@]}"} -w /src \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
    "$image" "$@"
}

# gitleaks through docker_scan, failing unless it reports having scanned at least one commit
# (a scan that saw no history must not pass as "no leaks found").
gitleaks_scan() {
  local out code=0
  out="$(docker_scan "$VERIFY_GITLEAKS_IMAGE" git . --config .gitleaks.toml --redact \
    --no-banner 2>&1)" || code=$?
  printf '%s\n' "$out"
  if [ "$code" -ne 0 ]; then return "$code"; fi
  if ! printf '%s\n' "$out" | grep -Eq '(^|[^0-9])[1-9][0-9]* commits scanned'; then
    echo "✖ gitleaks: it reported no commits scanned; the history was not visible to it" >&2
    return 1
  fi
}

# Tracked files matching a pathspec, as NUL-separated names; fails when there are none.
tracked_or_fail() { # <label> <pathspec...>
  local label="$1"
  shift
  local list
  list="$(git ls-files -- "$@")"
  if [ -z "$list" ]; then
    echo "✖ $label: no tracked files match $*" >&2
    return 1
  fi
  echo "  $label: $(printf '%s\n' "$list" | wc -l | tr -d ' ') files" >&2
  git ls-files -z -- "$@"
}

# actionlint on the tracked workflow files, named explicitly: a missing file is an error,
# and an empty set fails here rather than passing as "nothing to lint".
actionlint_scan() {
  local files=() f
  while IFS= read -r -d '' f; do files+=("$f"); done \
    < <(tracked_or_fail actionlint ".github/workflows/*.yml" ".github/workflows/*.yaml")
  if [ "${#files[@]}" -eq 0 ]; then return 1; fi
  docker_scan "$VERIFY_ACTIONLINT_IMAGE" -color ${files[@]+"${files[@]}"}
}

# Lint every tracked script under scripts/ with ShellCheck, each named explicitly, mounted at
# /src (see docker_scan). A file the container cannot read makes it exit 2: the step fails.
shellcheck_scan() {
  local files=() f
  while IFS= read -r -d '' f; do files+=("$f"); done \
    < <(tracked_or_fail shellcheck "scripts/*.sh")
  if [ "${#files[@]}" -eq 0 ]; then return 1; fi
  docker run --rm -e LANG=C.UTF-8 -v "$ROOT:/src:ro" -w /src "$VERIFY_SHELLCHECK_IMAGE" \
    -x --shell=bash --severity=warning ${files[@]+"${files[@]}"}
}

# Semgrep gets the tracked files streamed in as a tar instead of a bind mount: through
# Docker Desktop's file sharing on macOS a bind-mounted scan is several times slower.
# Tracked files only — what a push or a CI checkout contains.
semgrep_scan() { # <paths...>
  git ls-files -z -- "$@" |
    while IFS= read -r -d '' f; do if [ -e "$f" ]; then printf '%s\0' "$f"; fi; done |
    tar --null -T - -cf - |
    docker run --rm -i --entrypoint sh "$VERIFY_SEMGREP_IMAGE" -c '
      mkdir -p /src && cd /src && tar -xf - &&
      semgrep scan --config p/typescript --config p/nodejs --config p/nextjs \
        --config p/owasp-top-ten --config p/secrets --config p/jwt \
        --error --metrics=off --disable-version-check "$@"' semgrep "$@"
}

# --- stages --------------------------------------------------------------------------
stage_security() {
  stage_begin security
  step "gitleaks (full history)" gitleaks_scan
  # The BLOCKING SAST gate. --error: any finding fails. Fix it, or annotate the line
  #   // nosemgrep: <rule-id> -- <why>
  # A bare nosemgrep is an unreviewed exception.
  # Only folders with tracked files: semgrep_scan streams tracked files into the container,
  # and semgrep refuses a scanning root that is not there. An empty set is a failure, never
  # a silent "scanned nothing".
  local roots=()
  for d in apps packages tools scripts; do
    if [ -n "$(git ls-files -- "$d" | head -n1)" ]; then roots+=("$d"); fi
  done
  if [ "${#roots[@]}" -eq 0 ]; then
    echo "✖ semgrep: no tracked files to scan" >&2
    return 1
  fi
  step "semgrep" semgrep_scan ${roots[@]+"${roots[@]}"}
  step "pnpm audit (moderate+)" pnpm audit --audit-level=moderate
  step "audit-ci (allowlist)" pnpm exec audit-ci --config audit-ci.json
  step "licence allowlist" pnpm exec tsx scripts/check-licenses.ts
  step "actionlint (workflows)" actionlint_scan
  # shellcheck disable=SC2046
  step "hadolint (Dockerfiles)" bash -c 'for f in $(git ls-files "*Dockerfile"); do
      echo "  $f"; docker run --rm -i "$VERIFY_HADOLINT_IMAGE" hadolint --failure-threshold warning - <"$f" || exit 1;
    done'
  # Every tracked script under scripts/ (the backup and restore scripts among them). Here and
  # not in static: static runs in the pre-push hook, which needs no Docker.
  step "shellcheck (scripts/**/*.sh)" shellcheck_scan
  stage_end
}

stage_static() {
  stage_begin static
  step "house:check (house checks + lessons ledgers)" pnpm house:check
  step "dependency rules (dependency-cruiser)" pnpm deps:check
  step "typecheck" pnpm exec turbo run typecheck ${TURBO_FILTER[@]+"${TURBO_FILTER[@]}"}
  step "biome" pnpm exec biome check .
  step "eslint (house rules + plugins)" pnpm exec turbo run lint ${TURBO_FILTER[@]+"${TURBO_FILTER[@]}"}
  stage_end
}

stage_unit() {
  stage_begin unit
  step "unit tests" pnpm exec turbo run test ${TURBO_FILTER[@]+"${TURBO_FILTER[@]}"}
  stage_end
}

ensure_services() {
  [ "$SERVICES_UP" = 1 ] && return 0
  SERVICES_UP=1
  step "throwaway postgres" bash "$ROOT/scripts/verify/services.sh" up
  step "build the API and the packages it needs" pnpm exec turbo run build --filter=@loan/api...
  step "migrations from empty" ${API[@]+"${API[@]}"} db:migrate
}

stage_db() {
  stage_begin db
  ensure_services
  # Entities and migrations must agree: a schema change with no migration fails here.
  step "entity/migration drift" ${API[@]+"${API[@]}"} db:migration:check
  step "seed (idempotent: twice)" bash -c 'pnpm --filter @loan/api run db:seed && pnpm --filter @loan/api run db:seed'
  stage_end
}

stage_integration() {
  stage_begin integration
  ensure_services
  step "API integration tests (Jest + supertest, real Postgres)" ${API[@]+"${API[@]}"} test:integration
  stage_end
}

stage_build() {
  stage_begin build
  step "build" pnpm exec turbo run build
  stage_end
}

stage_e2e() {
  stage_begin e2e
  if [ ! -f apps/api/dist/main.js ] || [ ! -d apps/backoffice/.next ]; then
    echo "✖ no build — run the build stage first (pnpm verify --only build,e2e)" >&2
    return 1
  fi
  ensure_services
  mkdir -p "$LOG_DIR"
  for port in "$VERIFY_API_PORT" "$VERIFY_WEB_PORT"; do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
      echo "✖ port $port is already in use — a leftover verify server? (lsof -i :$port)" >&2
      return 1
    fi
  done

  # Its own database: the integration stage truncates the first one.
  (
    export DATABASE_URL="$VERIFY_E2E_URL"
    step "migrate (e2e db)" ${API[@]+"${API[@]}"} db:migrate
    step "seed (e2e db)" ${API[@]+"${API[@]}"} db:seed
  )

  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    step "playwright browsers" pnpm --filter @loan/backoffice exec playwright install --with-deps chromium
  else
    step "playwright browsers" pnpm --filter @loan/backoffice exec playwright install chromium
  fi

  (
    cd apps/api
    exec env NODE_ENV=production PORT="$VERIFY_API_PORT" DATABASE_URL="$VERIFY_E2E_URL" \
      node dist/main.js
  ) >"$LOG_DIR/api-server.log" 2>&1 &
  PIDS+=($!)
  (
    cd apps/backoffice
    exec env NODE_ENV=production PORT="$VERIFY_WEB_PORT" API_URL="http://127.0.0.1:${VERIFY_API_PORT}" \
      pnpm exec next start -p "$VERIFY_WEB_PORT" -H 127.0.0.1
  ) >"$LOG_DIR/web-server.log" 2>&1 &
  PIDS+=($!)

  printf '\n\033[1m▸ wait for API and backoffice\033[0m\n'
  local ready=0
  for i in $(seq 1 45); do
    if curl -sf "http://127.0.0.1:${VERIFY_API_PORT}/health" >/dev/null &&
      curl -sf -o /dev/null "http://127.0.0.1:${VERIFY_WEB_PORT}/sign-in"; then
      ready=1
      break
    fi
    echo "  waiting... ($i/45)"
    sleep 2
  done
  if [ "$ready" != 1 ]; then
    echo "✖ servers never became healthy; logs follow." >&2
    cat "$LOG_DIR/api-server.log" "$LOG_DIR/web-server.log" >&2
    return 1
  fi

  step "playwright (chromium)" pnpm --filter @loan/backoffice exec playwright test --project=chromium
  stage_end
}

# --- run -----------------------------------------------------------------------------
if wants security || wants db || wants integration || wants e2e; then docker_ok; fi

if wants e2e && [ "${SKIP_E2E:-}" = 1 ]; then
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    echo "✖ SKIP_E2E is a local escape hatch; the runner always runs e2e." >&2
    exit 1
  fi
  printf '\n\033[1;33m⚠ SKIP_E2E=1 — the e2e stage will NOT run. The PR still runs it.\033[0m\n'
  _kept=()
  for s in ${STAGES[@]+"${STAGES[@]}"}; do [ "$s" = e2e ] || _kept+=("$s"); done
  STAGES=(${_kept[@]+"${_kept[@]}"})
  SUMMARY+=("⚠ e2e          skipped (SKIP_E2E=1)")
fi

for s in ${ALL_STAGES[@]+"${ALL_STAGES[@]}"}; do
  if wants "$s"; then "stage_$s"; fi
done

# Reached only when every wanted stage passed; cleanup() refuses success without it.
VERIFY_DONE=1
