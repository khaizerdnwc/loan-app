#!/usr/bin/env bash
# PreToolUse(Bash) gate: no Claude-driven commit of product code until /review ran.
#
# Rationale: the role reviewers only help if they actually run. Relying on the model
# to remember means they run most of the time, which is the same as not having them
# for the commit that matters. This makes it deterministic.
#
# The lock itself lives in scripts/review-stamp-check.sh, shared with the lefthook
# commit-msg job that applies it to every commit, not only Claude's (ADR 0017). This hook
# stays because it refuses earlier and more clearly: before the command runs, with the
# reason handed straight back to the model.
#
# Ordering note: this runs BEFORE the command it guards, so `git add -A && git
# commit` in a single call is always refused — at hook time the staged diff is
# still the pre-add one. Stage in one call, review and stamp in the next, commit
# in a third.
#
# Escape hatch: prefix the command with SKIP_REVIEW=1 — visible in the transcript,
# so a skipped review is a thing the user can see rather than a silent default.

set -uo pipefail

input=$(cat)

[ "$(jq -r '.tool_name // empty' <<<"$input")" = "Bash" ] || exit 0
command=$(jq -r '.tool_input.command // empty' <<<"$input")

# Only real commits. `git log`, `git commit --help`, `git commitlint` etc. pass through.
grep -qE '(^|[;&|[:space:]])git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*commit([[:space:]]|$)' \
  <<<"$command" || exit 0

# Explicit, visible opt-out. (At hook time it is only text in the command, not yet an
# environment variable, so it is read here rather than by the shared check.)
grep -q 'SKIP_REVIEW=1' <<<"$command" && exit 0

repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

why=$(bash "$repo/scripts/review-stamp-check.sh" 2>&1 >/dev/null) && exit 0

jq -n --arg why "$why" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      ($why + "\nIf the user has explicitly said to skip review, prefix the command with SKIP_REVIEW=1.")
  }
}'
exit 0
