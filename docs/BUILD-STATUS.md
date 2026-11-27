# Build status

The resume point for the build loop (plan: continuous loop, no pauses). One row per
milestone; a milestone is done only when its acceptance criteria have passing tests and its
commit passed the review loop. Blocked items carry the evidence.

| # | Milestone | Status | Evidence |
|---|---|---|---|
| M0 | Scaffold, GitHub repo, no-stall setup, draft PR, acceptance + ADRs | doing | repo khaizerdnwc/loan-app (private) |
| M1 | Full workflow port (hooks, preflight, reviewers, stamp, lock, gates, CI) | doing | eslint-house 140 tests · review-tools 136 tests · house:check clean |
| M2 | Money, decision engine, scorecard, schedule maths (review packet 1) | todo | |
| M3 | Simulated providers + conformance tests | todo | |
| M4 | Entities, migrations, seed, auth + guards (review packet 2) | todo | |
| M5 | Application + decision API | todo | |
| M6 | Review + approval API | todo | |
| M7 | Booking, maker-checker, idempotency, failure/retry (review packet 3) | todo | |
| M8 | Backoffice screens (prototype look) | todo | |
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
- Reviewer agents run as general-purpose agents that load `.claude/agents/<role>.md` in the
  session that created them (agents register at session start); later sessions use the
  native agents with the write-scope hook.
