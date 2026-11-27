---
description: Create a git worktree (copies the apps' env files + runs pnpm install, opens a terminal)
argument-hint: <worktree-name>
allowed-tools: Bash(mkdir:*), Bash(touch:*), Bash(printf:*), Bash(rm:*), EnterWorktree
---

!`mkdir -p .claude/worktrees && touch .claude/worktrees/.open-terminal-armed`

Create a new git worktree and switch this session into it by calling the `EnterWorktree` tool.

- Use `$ARGUMENTS` as the worktree `name`. If `$ARGUMENTS` is empty, ask me for a name before proceeding (do not generate a random one).
- **Check first** whether the worktree already exists at `.claude/worktrees/$ARGUMENTS` (use `git worktree list` to verify):
  - **Existing worktree**: the `WorktreeCreate` hook will not run, so you must open the terminal manually:
    1. Remove the stale armed marker so it does not leak to the next creation: `rm -f .claude/worktrees/.open-terminal-armed`
    2. Write the terminal signal directly: `printf '%s\n' "$(pwd)/.claude/worktrees/$ARGUMENTS" > .claude/worktrees/.open-terminal`
    3. Then call `EnterWorktree` with `path` = `.claude/worktrees/$ARGUMENTS`.
  - **New worktree**: call `EnterWorktree` with `name` = `$ARGUMENTS`. The `WorktreeCreate` hook handles everything automatically: creates the worktree, copies `apps/api/.env` and `apps/backoffice/.env.local`, runs `pnpm install`, and opens an integrated terminal because the armed marker is present. Do not run any of those steps yourself.

After entering the worktree (new or existing), confirm the worktree path and the branch name, and remind me that the editor still points at the main workspace folder (open the worktree folder in a new window to see its files).
