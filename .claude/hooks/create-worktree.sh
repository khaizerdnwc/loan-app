#!/usr/bin/env bash
# WorktreeCreate hook.
#
# This hook REPLACES Claude Code's default git worktree creation. It is
# responsible for actually creating the worktree, then it copies the env files
# from the source repo and runs `pnpm install` inside the new worktree so a
# fresh worktree is immediately runnable.
#
# Contract (https://code.claude.com/docs/en/hooks.md → WorktreeCreate):
#   - Input JSON arrives on stdin.
#   - The absolute worktree path MUST be the first line of stdout.
#   - A non-zero exit (or empty/invalid path) fails worktree creation and the
#     session does not start.
# Therefore: git/cp/pnpm output is sent to stderr, and stdout carries only the
# final path.

set -uo pipefail

input=$(cat)
echo "create-worktree hook: raw input: $input" >&2

# Extract fields — try multiple candidate names since the Claude Code hook API
# doesn't document the exact schema. Fall back to env vars when values are null.
worktree_name=$(jq -r '.worktree_name // .name // empty' <<<"$input")
worktree_parent=$(jq -r '.worktree_parent // .parent // empty' <<<"$input")
git_source_dir=$(jq -r '.git_source_dir // .source_dir // .cwd // empty' <<<"$input")
git_branch=$(jq -r '.git_branch // .branch // empty' <<<"$input")
git_new_branch=$(jq -r '.git_new_branch // .new_branch // "false"' <<<"$input")

# Resolve fallbacks using well-known env vars when fields are missing/null.
if [ -z "$git_source_dir" ]; then
  git_source_dir="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
fi
if [ -z "$worktree_parent" ]; then
  worktree_parent="$git_source_dir/.claude/worktrees"
fi

echo "create-worktree hook: worktree_name=$worktree_name worktree_parent=$worktree_parent git_source_dir=$git_source_dir git_branch=$git_branch git_new_branch=$git_new_branch" >&2

if [ -z "$worktree_name" ]; then
  echo "create-worktree hook: ERROR worktree_name is empty — cannot create worktree" >&2
  exit 1
fi

worktree_path="$worktree_parent/$worktree_name"

# --- Create the worktree (fatal: if this fails, creation must fail) ---
mkdir -p "$worktree_parent" >&2
if [ "$git_new_branch" = "true" ]; then
  git -C "$git_source_dir" worktree add -b "$worktree_name" "$worktree_path" "$git_branch" >&2
elif [ -n "$git_branch" ]; then
  git -C "$git_source_dir" worktree add "$worktree_path" "$git_branch" >&2
else
  git -C "$git_source_dir" worktree add -b "$worktree_name" "$worktree_path" >&2
fi
if [ $? -ne 0 ]; then
  echo "create-worktree hook: 'git worktree add' failed" >&2
  exit 2
fi

# --- Copy env files (best-effort: never fail worktree creation over this) ---
# Each app keeps its own env file: apps/api/.env and apps/backoffice/.env.local.
for envfile in apps/api/.env apps/backoffice/.env.local; do
  if [ -f "$git_source_dir/$envfile" ]; then
    mkdir -p "$worktree_path/$(dirname "$envfile")"
    if cp "$git_source_dir/$envfile" "$worktree_path/$envfile"; then
      echo "create-worktree hook: copied $envfile into worktree" >&2
    else
      echo "create-worktree hook: WARNING failed to copy $envfile" >&2
    fi
  fi
done

echo "create-worktree hook: running 'pnpm install' in $worktree_path ..." >&2
if ( cd "$worktree_path" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --prefer-offline ) >&2; then
  echo "create-worktree hook: pnpm install complete" >&2
else
  echo "create-worktree hook: WARNING pnpm install failed (worktree still created)" >&2
fi

# --- Signal the VSCode companion extension to open an integrated terminal ---
# GATED: only fires when the /worktree command "armed" it via a one-shot marker
# file. Agent-isolation worktrees do not run that command, so they never pop a
# terminal. The marker is consumed here so it cannot leak to a later worktree.
# Best-effort: never fail worktree creation over this.
signal_dir="$git_source_dir/.claude/worktrees"
arm_marker="$signal_dir/.open-terminal-armed"
if [ -f "$arm_marker" ]; then
  rm -f "$arm_marker" 2>/dev/null || true
  mkdir -p "$signal_dir" 2>/dev/null || true
  printf '%s\n' "$worktree_path" > "$signal_dir/.open-terminal" 2>/dev/null \
    && echo "create-worktree hook: signaled VSCode to open a terminal" >&2 \
    || echo "create-worktree hook: WARNING could not write terminal signal" >&2
else
  echo "create-worktree hook: not armed by /worktree, skipping terminal" >&2
fi

# --- Return the worktree path (this MUST be the only thing on stdout) ---
echo "$worktree_path"
exit 0
