# ADR 0015 — Role-based reviewer agents and a deterministic learning loop

## Status
Accepted (27 Nov 2026). Carried over from the owner's nxlvl repository, where it ran for
several months, and adapted to this NestJS + Next.js monorepo. Amended by ADR 0016.

## Context
This MVP is built with Claude as the coding assistant over one weekend, and the panel will
ask how AI output was checked. A single generalist "review my diff" pass gives the same
shallow attention to money, permissions and CSS. Corrections given in one session do not
reach the next one, so the same mistakes recur.

## Decision
- **R1. Six reviewer subagents** in `.claude/agents/`: `security`, `ui-ux`, `data`,
  `architecture`, `qa`, `devops`. Each reviews code it did not write.
- **R2. Each role owns two skills.** `<role>-conventions` says what the role knows and
  points at docs and rules instead of restating them; its `paths:` makes it auto-load when
  those files are edited. `<role>-review` is the diff checklist, run inside the agent
  (`context: fork`).
- **R3. Reviewers report; they do not fix product code.** `.claude/hooks/agent-write-scope.sh`
  denies their writes outside house rules, house checks, their lessons ledger and their
  memory. The main session applies fixes, where the user's intent lives.
- **R4. Which roles review a diff is code**, not prose: `ROLE_PATHS` in
  `tools/review/src/_review.ts`, shown by `pnpm review:roles`.
- **R5. A finding becomes a gate when a machine can decide it.** Lint-shaped →
  a house ESLint rule in `packages/eslint-house` with RuleTester tests. Cross-file → a
  check in `tools/review/src/checks`. Runtime → a test. Otherwise → one prose line in the
  role's `lessons.md` (ADR 0016). A new rule that would flag more than ten existing places
  starts as `warn`.
- **R6. Day-one foundations.** Each role starts with off-the-shelf deterministic tools
  (Semgrep, gitleaks, audit, eslint-plugin-security, jsx-a11y, dependency-cruiser,
  actionlint, hadolint) and a small set of house rules for what only this project knows
  (money as decimal, roles on every handler, ports over providers). See
  `packages/eslint-house/src/index.js` for the list.

## Consequences
Reviews are specialised and cheap to repeat; corrections turn into rules that hold without
anyone remembering them. Cost: six role skills to keep accurate, and reviewer tokens on
every product commit. Reconsider if review rounds stop finding anything the gates do not.
