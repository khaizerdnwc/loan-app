#!/usr/bin/env bash
# PreToolUse(Edit|Write): show the lessons for a file before Claude first writes it
# (ADR 0017).
#
# Why: `pnpm lessons for <files>` before editing was an instruction, so it ran when the
# model remembered. This delivers the same lines deterministically, at the moment they
# matter — before the first write to a file in this session.
#
# How: the first Edit/Write of a file in a session looks up its lessons. None → allow,
# silently. Some → refuse that one call with the lessons as the reason; the model reads
# them and repeats the same edit, which then passes. Every later edit of that file in the
# session passes straight through. Cost: one lookup (~1 s) per file per session, and one
# extra round trip only for files that have lessons.
#
# Skipped: .claude/ (lessons and tooling themselves), docs/, Markdown.

set -uo pipefail

input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
session=$(jq -r '.session_id // "nosession"' <<<"$input" | tr -cd '[:alnum:]_-')
[ -n "$file" ] || exit 0

repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
# Claude Code hooks inherit the PATH Claude Code was started with, which often lacks
# node (nvm, Volta, Homebrew). Without node every tool below fails and the hook goes
# silent — it did, unnoticed, until 2026-11-26. Same fix the git hooks use.
# shellcheck source=/dev/null
. "$repo/scripts/lefthook-rc.sh"
case "$file" in
  "$repo"/*) rel="${file#"$repo"/}" ;;
  /*) exit 0 ;; # outside the repo
  *) rel="$file" ;;
esac

case "$rel" in
  .claude/* | docs/* | *.md) exit 0 ;;
esac

seen_dir="$repo/.claude/.review"
seen="$seen_dir/lessons-seen-$session"
mkdir -p "$seen_dir"
grep -qxF "$rel" "$seen" 2>/dev/null && exit 0
echo "$rel" >>"$seen"

tsx="$repo/node_modules/.bin/tsx"
[ -x "$tsx" ] || exit 0
lessons=$(cd "$repo" && "$tsx" tools/review/src/lessons.ts for "$rel" 2>/dev/null | grep -E '^(- \[|[a-z-]+:$)')
grep -q '^- \[' <<<"$lessons" || exit 0

jq -n --arg f "$rel" --arg l "$lessons" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      ("Lessons for " + $f + " — past mistakes in this area that no automatic check enforces yet. " +
       "Read them, adjust your change if one applies, then make the same edit again " +
       "(it will pass; this is shown once per file per session). " +
       "Full story: pnpm lessons show <id>.\n" + $l)
  }
}'
exit 0
