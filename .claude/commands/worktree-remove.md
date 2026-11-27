---
description: Remove the current git worktree and close its integrated terminal
allowed-tools: Bash(git:*), Bash(sed:*), Bash(printf:*), Bash(cat:*), Bash(rm:*)
---

!`MAIN=$(cd "$(git rev-parse --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd -P) && [ -n "$MAIN" ] && printf '%s\n' "$PWD" > "$MAIN/.claude/worktrees/.close-terminal-armed" || true`

Remove the current worktree and close its integrated terminal:

1. Use ToolSearch (`select:ExitWorktree`) to load the tool schema, then call `ExitWorktree` with `action: "remove"`.
   - If ExitWorktree fails because the worktree was entered via `path` (not created this session), call `ExitWorktree` with `action: "keep"` instead, then manually remove with `git worktree remove --force <path>` and `git branch -d <branch>`.
2. After the session returns to the main directory, read `.claude/worktrees/.close-terminal-armed` to get the former worktree's absolute path.
3. Write that path to `.claude/worktrees/.close-terminal` — the VSCode extension watches this file and will close the matching terminal by name.
4. Delete `.claude/worktrees/.close-terminal-armed`.
5. Confirm the worktree has been removed and the terminal signal was sent.
