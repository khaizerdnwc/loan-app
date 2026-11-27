# Agent workflow — from change to merge

How a change moves through the Claude Code tooling and the deterministic gates, and how a
mistake becomes a permanent rule. Carried over from the owner's nxlvl repository and adapted
to this monorepo. The reasons are in ADRs 0015–0018 and 0021 (`docs/DECISIONS/`).

**Hexagons are deterministic** (same result every time, whatever Claude remembers).
Rectangles are steps; the six reviewers are judgment.

## Chart 1 — Build → review → ship

```mermaid
flowchart TD
    S(["START: a milestone or a request"]) --> K{"Bug fix?"}
    K -- "no" --> P["Plan<br/>(auth, money, booking, migrations, gate: plan first)"]
    K -- "yes" --> B1["/fix-bug: failing test + reproduce in the browser"]
    B1 --> P
    P --> L{{"Lessons shown before the first edit of each file<br/>(lessons-before-edit.sh)"}}
    L --> E["Edit / Write"]
    E --> H1{{"On save: root ESLint (house rules, security, a11y)<br/>(lint-on-edit.sh)"}}
    H1 --> D1{"Errors?"}
    D1 -- yes --> E
    D1 -- no --> ADD["git add"]
    ADD --> PF{{"review:preflight<br/>house autofix · Biome · ESLint · house:check ·<br/>typecheck (changed + dependents) ·<br/>related tests per package (Jest / Vitest) ·<br/>integration if a test DB is set · repro proof for fixes"}}
    PF --> D2{"Green?"}
    D2 -- "no — no reviewer spawned" --> E
    D2 -- yes --> MAP["review:roles — changed paths → roles + their lessons"]
    MAP --> R["security · data · architecture · qa · ui-ux · devops<br/>(in parallel; read-only on product code)"]
    R --> D3{"Findings?"}
    D3 -- "yes" --> LES["Fix; repeatable → /lesson (rule, check, test or prose)"]
    LES --> E
    D3 -- "none" --> ACK{{"review:ack --stamp<br/>every lesson answered · preflight green for this exact diff"}}
    ACK --> CM{{"git commit — commit lock (review-stamp-check.sh)<br/>+ commitlint + repro trailer for fix:"}}
    CM --> PU{{"git push — FAST pre-push gate<br/>static + unit for affected packages (no Docker, < 2 min)"}}
    PU --> PR{{"Draft PR — full gate as parallel jobs<br/>security · static · unit · db+integration · build+e2e"}}
    PR --> D4{"All green?"}
    D4 -- no --> E
    D4 -- yes --> NEXT["Next milestone (docs/BUILD-STATUS.md)"]
    NEXT -.-> S
    PR -.-> HM(["Human reviews and merges"])
```

## Chart 2 — Learning loop (`/lesson`)

```mermaid
flowchart TD
    C(["Reviewer finding or user correction"]) --> D0{"Repeatable?"}
    D0 -- "no" --> FIX(["Fix it"])
    D0 -- yes --> D1{"Can a machine catch it?"}
    D1 -- "one file's code" --> LINT["House ESLint rule<br/>packages/eslint-house + RuleTester"]
    D1 -- "several files" --> CHK["House check<br/>tools/review/src/checks"]
    D1 -- "only at runtime" --> TEST["Test"]
    D1 -- "needs judgment" --> PROSE["One line in &lt;role&gt;-conventions/lessons.md<br/>story in lessons-log.md"]
    LINT & CHK & TEST --> GATE["Gate: line in lessons-log.md"]
    GATE & PROSE --> LC{{"house:check — ledger grammar and 8 KB budget"}}
```

## Where each gate runs

| Gate | When | What |
|---|---|---|
| Lessons before edit | first edit of a file per session | that file's prose lessons |
| Lint on save | every Edit/Write by Claude | root ESLint on the file |
| `review:preflight` | before reviewers | see Chart 1 |
| Commit lock | every commit (Claude hook + lefthook) | staged diff = stamped diff |
| Pre-push | every push | `verify.sh --only static,unit --affected <base>` |
| Pull request | every push to the PR | `verify.sh` stages as parallel jobs |
| Nightly | 07:00 UTC | `verify.sh --only security` |
| On demand | before submission, or when Actions is down | `pnpm verify` (everything) |

## Where enforcement is soft

- `SKIP_REVIEW=1`, `Repro: not testable` and `SKIP_E2E=1` are visible opt-outs.
- A reviewer must answer every lesson but can answer one wrongly.
- Required status checks are not available on this private repo's plan; merging only on
  green is a convention.
- The bootstrap commit of the tooling itself was made with `SKIP_REVIEW=1`, because the
  reviewers it installs did not exist yet. Every later product commit goes through the lock.

## Source of truth

| Piece | File |
|---|---|
| On save | `.claude/hooks/lint-on-edit.sh` |
| Lessons before edit | `.claude/hooks/lessons-before-edit.sh` |
| Reviewers can only report | `.claude/hooks/agent-write-scope.sh` |
| Commit lock | `.claude/hooks/require-review-before-commit.sh` → `scripts/review-stamp-check.sh` |
| Roles, preflight, ack, repro | `tools/review/src/{_review,review-preflight,review-ack,repro-proof}.ts` |
| Lessons ledger and checks | `tools/review/src/_lessons.ts`, `tools/review/src/checks/`, `pnpm house:check` |
| House rules | `packages/eslint-house/src/index.js` |
| Git hooks | `lefthook.yml` |
| Gate stages | `scripts/verify/verify.sh`, `.github/workflows/verify.yml` |
