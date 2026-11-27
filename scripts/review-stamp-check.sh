#!/usr/bin/env bash
# No review, no commit — the one implementation of the commit lock (ADR 0015, ADR 0017).
#
# Callers:
#   .claude/hooks/require-review-before-commit.sh  Claude Code, before the commit command runs
#   lefthook.yml commit-msg job `review-stamp`      every commit, whoever makes it
#
# Passes (exit 0) when the staged diff is exactly the one /review stamped, or when the
# lock does not apply. Refuses (exit 1) with the reason on stderr otherwise.
#
# Does not apply to: SKIP_REVIEW=1 (visible opt-out), CI, merges / cherry-picks / reverts
# (their content was reviewed on its own branch), commits with nothing staged, and commits
# that touch no product code (docs, plans, .claude tooling).
#
# The stamp is written by `pnpm review:ack --stamp`, which refuses unless the last
# preflight for this exact diff was green and every reviewer answered every lesson.

set -uo pipefail

[ "${SKIP_REVIEW:-}" = "1" ] && exit 0
[ "${CI:-}" = "true" ] && exit 0

repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo" || exit 0
gitdir=$(git rev-parse --git-dir)

for head in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
  [ -f "$gitdir/$head" ] && exit 0
done

staged=$(git diff --cached --name-only)
[ -n "$staged" ] || exit 0

# Product code, plus the workspace plumbing CLAUDE.md marks high-leverage (it builds,
# gates and deploys everything else). Docs, plans and .claude tooling commit freely.
if ! grep -qE '^(apps/|packages/|tools/|\.github/|(.*/)?Dockerfile$|docker-compose[^/]*\.yml$|package\.json$|pnpm-workspace\.yaml$|turbo\.json$|lefthook\.yml$|commitlint\.config\.js$|eslint\.config\.js$|biome\.json$|tsconfig[^/]*\.json$|\.dependency-cruiser\.cjs$|scripts/)' <<<"$staged"; then
  exit 0
fi

stamp_file=".claude/.review-stamp"
# Same command as pnpm review:ack's hashDiff — quotePath off — so the fingerprints agree.
current=$(git -c core.quotePath=false diff --cached | git hash-object --stdin)
recorded=$([ -f "$stamp_file" ] && tr -d '[:space:]' <"$stamp_file" || echo "")

[ "$current" = "$recorded" ] && exit 0

if [ -z "$recorded" ]; then
  echo "This staged diff has not been reviewed." >&2
else
  echo "The staged diff changed since the last review, so that review no longer covers it." >&2
fi
echo "Run /review --cached in Claude Code (it stamps the diff when clean), then commit." >&2
echo "To skip on purpose: SKIP_REVIEW=1 git commit …  (the skip stays visible)." >&2
exit 1
