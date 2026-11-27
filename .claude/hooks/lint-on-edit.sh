#!/usr/bin/env bash
# PostToolUse(Edit|Write): lint the file that was just written, and hand any problem back
# to the model immediately (ADR 0016).
#
# Why: a lesson that became a house ESLint rule is only worth something if it fires where
# the mistake is made. Lint in CI, or at /review, catches it several edits later, after the
# wrong shape has been copied. This runs the rules on the one file, in about a second, and
# costs tokens only when something is actually wrong.
#
# Scope: .ts/.tsx/.js under apps/*/src, apps/*/test, packages/*/src, packages/*/test and
# tools/*/src — the files the house rules cover. One root eslint.config.js covers every
# package, so the one root eslint runs. Everything else exits silently. Reviewer agents
# never reach here for product files: their PreToolUse write-scope hook denies it first.
#
# Output: errors, plus warnings from house/* rules (the warn-level ones are real lessons
# pending promotion). ESLint's JSON embeds the whole source, so only file:line:col,
# message and rule id are passed on.

set -uo pipefail

input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
[ -n "$file" ] || exit 0

repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
# Claude Code hooks inherit the PATH Claude Code was started with, which often lacks
# node (nvm, Volta, Homebrew). Without node every tool below fails and the hook goes
# silent — it did, unnoticed, until 2026-11-26. Same fix the git hooks use.
# shellcheck source=/dev/null
. "$repo/scripts/lefthook-rc.sh"
case "$file" in
  "$repo"/*) rel="${file#"$repo"/}" ;;
  *) rel="$file" ;;
esac

case "$rel" in
  apps/*/src/*.ts | apps/*/src/*.tsx | apps/*/test/*.ts | apps/*/e2e/*.ts) ;;
  packages/*/src/*.ts | packages/*/src/*.tsx | packages/*/src/*.js | packages/*/test/*.ts) ;;
  tools/*/src/*.ts | tools/*/test/*.ts) ;;
  *) exit 0 ;;
esac
[ -f "$repo/$rel" ] || exit 0

eslint="$repo/node_modules/.bin/eslint"
[ -x "$eslint" ] || exit 0

report=$(cd "$repo" && "$eslint" --cache --no-warn-ignored --format json "$rel" 2>/dev/null)
problems=$(jq -r --arg base "$repo/" '
  .[] | .filePath as $f | .messages[]
  | select(.severity == 2 or ((.ruleId // "") | startswith("house/")))
  | "\($f | ltrimstr($base)):\(.line // 0):\(.column // 0) \(.message | split("\n")[0]) [\(.ruleId // "parse")]"
' <<<"$report" 2>/dev/null | head -40)

[ -n "$problems" ] || exit 0

jq -n --arg p "$problems" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext:
      ("ESLint on the file you just wrote:\n" + $p +
       "\nFix these now. For a house/* rule, the message says what to do instead; " +
       "`pnpm lessons show house/<rule>` has the reason.")
  }
}'
exit 0
