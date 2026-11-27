#!/usr/bin/env bash
# lefthook commit-msg: a `fix:` that names `Repro-Test: <file>` must prove that test fails
# without the fix and passes with it (ADR 0017). commitlint has already checked the
# trailer exists; this checks it is true.
#
# Reuses the proof /review already ran (.claude/.review/repro-<hash>.json) when it was
# for this exact staged diff; otherwise runs `pnpm review:repro --cached <file>` now.
# Skipped for SKIP_REVIEW=1, CI, merges / cherry-picks / reverts, and
# `Repro: not testable — <reason>`.
#
# Usage: repro-commit-check.sh <commit message file>

set -uo pipefail

msg_file=${1:-}
[ -n "$msg_file" ] && [ -f "$msg_file" ] || exit 0
[ "${SKIP_REVIEW:-}" = "1" ] && exit 0
[ "${CI:-}" = "true" ] && exit 0

repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo" || exit 0
gitdir=$(git rev-parse --git-dir)
for head in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
  [ -f "$gitdir/$head" ] && exit 0
done

subject=$(grep -v '^#' "$msg_file" | grep -m1 -v '^[[:space:]]*$')
grep -qE '^fix(\([^)]*\))?!?:' <<<"$subject" || exit 0

test_file=$(sed -nE 's/^Repro-Test:[[:space:]]*([^[:space:]]+).*/\1/p' "$msg_file" | head -1)
[ -n "$test_file" ] || exit 0

hash=$(git -c core.quotePath=false diff --cached | git hash-object --stdin)
cached=".claude/.review/repro-$hash.json"
if [ -f "$cached" ] && jq -e '.ok == true' "$cached" >/dev/null 2>&1; then
  exit 0
fi

echo "repro: proving $test_file fails without the fix and passes with it…"
if pnpm -s review:repro --cached "$test_file"; then
  exit 0
fi
echo "✖ The Repro-Test does not reproduce the bug (see above). Fix the test, or use" >&2
echo "  Repro: not testable — <reason>   when no test can capture it." >&2
exit 1
