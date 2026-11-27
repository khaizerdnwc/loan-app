# Build status

The resume point for the build loop (plan: continuous loop, no pauses). One row per
milestone; a milestone is done only when its acceptance criteria have passing tests and its
commit passed the review loop. Blocked items carry the evidence.

| # | Milestone | Status | Evidence |
|---|---|---|---|
| M0 | Scaffold, GitHub repo, no-stall setup, draft PR, acceptance + ADRs | done | repo khaizerdnwc/loan-app (public) · PR #1 (draft) · 0107424 |
| M1 | Full workflow port (hooks, preflight, reviewers, stamp, lock, gates, CI) | done | 0107424 bootstrap · 294dee2 first commit through the full loop · cabcddc gate fails closed · eslint-house 140 tests · review-tools 150 tests · 6 house checks |
| M2 | Money, decision engine, scorecard, schedule maths (review packet 1) | done | 294dee2 Money (37 tests) · 9d9a44a engine + ports (49 tests, D-1..D-9 ☑) · 34d3e35 HTTP contract · schedule maths with M3 (327 tests, B-4 ☑) · docs/review-packets/1-money-and-schedule.md |
| M3 | Simulated providers + conformance tests | done | five simulators, every failure mode (OK/OUTAGE/TIMEOUT/MALFORMED, LOST_REPLY for core), conformance suite apps/api/test/simulators.e2e-spec.ts · provider mode taken from the ports · M3–M7 commit |
| M4 | Entities, migrations, seed, auth + guards (review packet 2) | done | 3 migrations from empty, drift check clean, seed idempotent (verify db stage) · guard fails closed and re-reads the staff row (R-9) · secure cookie outside dev · docs/review-packets/2-roles-and-authority.md · M3–M7 commit |
| M5 | Application + decision API | done | F1-1..F1-2, F2-1..F2-2, A-1..A-6 passing (submit refuses a draft changed mid-decision) · M3–M7 commit |
| M6 | Review + approval API | done | F2-3..F2-5, R-1..R-9 passing (decline/return covered) · M3–M7 commit |
| M7 | Booking, maker-checker, idempotency, failure/retry (review packet 3) | done | B-1..B-9 + L-1 passing (lost reply, 5×3 concurrent checkers, reconciliation refusal) · 77 integration + 332 api unit + 72 base unit tests · docs/review-packets/3-booking-integrity.md · M3–M7 commit |
| M8 | Backoffice screens (prototype look) | doing | branch build/backoffice: 5 reviews fixed (69 backoffice + 24 ui tests, build green); re-review, then merge into build/mvp |
| M9 | Playwright F1/F2, Dockerfiles, full verify | todo | |
| M10 | Deploy to the dev environment | waiting | no environment named in the materials; access not received |
| M11 | Design notes, AI evidence, video script drafts | todo | |

## Blocked / waiting

- **M10 deploy:** the mechanics require the provided dev environment; none of the materials
  name it. The loop builds host-neutral Dockerfiles and a compose file, then waits for the user.

## Gaps and limitations found during the build

(Recorded here instead of TODO comments; carried into the design notes.)

- `pnpm.overrides` pins glob ≥14.0.2 and minimatch ≥11.0.1 (two moderate advisories reached
  through Jest's tooling). They force major versions on transitive consumers; all tests pass
  with them. Drop them once Jest's dependencies move past the vulnerable ranges.
- A case referred while the bureau was down has no grade and cannot be approved; re-running
  the decision is not built (ASSUMPTIONS "Ungraded referrals").
- Forked build agents cannot spawn reviewer agents, so work they build is reviewed from the
  main session before it is committed (the backoffice branch).
- Deferred from the M3–M7 reviews (recorded in ADR 0020/0022 and the design notes): foreign
  keys on the child tables; a reconciliation job and runbook for a refused schedule; TRUNCATE
  not blocked on insert-only tables; rate and DTI stored as varchar; per-port conformance
  suites in packages/contracts; per-user throttling (behind the backoffice proxy all callers share
  one bucket; `TRUST_PROXY_HOPS` lets a deployment with an appending load balancer key on the
  real address); a quoted instalment fetched from core on every case
  read; Swagger open on the API.
- Reviewer agents run as general-purpose agents that load `.claude/agents/<role>.md` in the
  session that created them (agents register at session start); later sessions use the
  native agents with the write-scope hook.
