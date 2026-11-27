# Reviewer notes

Each role reviewer agent (`.claude/agents/`) keeps its own notes here, in
`<role>/MEMORY.md` plus topic files. The agent reads them when it starts and writes them
itself; nobody maintains them by hand.

These are committed on purpose, so a reviewer's accumulated judgment is shared rather than
trapped in one person's machine. Expect them to appear in diffs after a review runs.

**This is the weakest of the three places a lesson can live**, and the narrowest — only that
one agent ever reads it. It is for a reviewer's own working notes: settled points it has
already checked, false positives it should stop re-raising, context about why something odd
in this repo is deliberate.

`MEMORY.md` auto-loads at the start of every review, so `pnpm house:check` caps it at 4,000
bytes. Keep it an index; put the detail in topic files, which are read only on demand.

Anything the *implementer* also needs belongs one level up, as a lesson in
`.claude/skills/<role>-conventions/` (one line in `lessons.md`, the story in
`lessons-log.md`; see the `/lesson` skill and ADR 0016). Anything a checker can decide belongs in a
house ESLint rule. See [ADR 0015](../../docs/DECISIONS/0015-role-based-reviewer-agents.md)
and the `/lesson` skill.
