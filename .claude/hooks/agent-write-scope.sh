#!/usr/bin/env bash
# PreToolUse guard for the role reviewer agents.
#
# Reviewers are read-only on the product. They may write exactly three things:
#   1. house ESLint rules + their tests, house checks + their tests
#      (the deterministic half of a lesson)
#   2. their role's lessons.md + lessons-log.md (the prose half, ADR 0016)
#   3. their own agent-memory notes
#
# Anything else — app and package source, migrations, docs, configs — is denied. The reviewer
# reports the fix; the main session applies it, where the user's intent lives.
#
# Contract (PreToolUse): read hook JSON on stdin, print a permissionDecision
# object on stdout, exit 0. Exit 0 with no output = allow.

set -uo pipefail

input=$(cat)

tool=$(jq -r '.tool_name // empty' <<<"$input")
case "$tool" in
  Write | Edit | NotebookEdit) ;;
  *) exit 0 ;;
esac

file=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
[ -n "$file" ] || exit 0

# Normalise to a repo-relative path so the globs below are stable no matter
# which cwd the agent ran from.
repo=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
rel="$file"
if [ -n "$repo" ]; then
  case "$file" in
    "$repo"/*) rel="${file#"$repo"/}" ;;
  esac
fi

allow=0
case "$rel" in
  packages/eslint-house/*) allow=1 ;;
  eslint.config.js) allow=1 ;;
  tools/review/src/checks/*) allow=1 ;;
  tools/review/test/checks.test.ts) allow=1 ;;
  .claude/skills/*-conventions/lessons.md) allow=1 ;;
  .claude/skills/*-conventions/lessons-log.md) allow=1 ;;
  .claude/agent-memory/*) allow=1 ;;
esac

if [ "$allow" -eq 1 ]; then
  exit 0
fi

jq -n --arg f "$rel" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      ("Reviewer agents do not edit product files (\($f)). You may write only: " +
       "packages/eslint-house/**, eslint.config.js, tools/review/src/checks/**, " +
       "tools/review/test/checks.test.ts, " +
       ".claude/skills/<role>-conventions/lessons{,-log}.md, .claude/agent-memory/**. " +
       "Report this change as a finding instead — the main session applies it.")
  }
}'
exit 0
