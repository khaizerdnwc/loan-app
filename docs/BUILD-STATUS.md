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
| M8 | Backoffice screens (prototype look) | done | a663559 on build/backoffice, merged into build/mvp · five roles, three review rounds · backoffice 75 + ui 24 Vitest tests · next build green |
| M9 | Playwright F1/F2, Dockerfiles, full verify | done | 6 browser journeys (F1, F2 + R-6, B-7, B-5, sign-out) green in verify build,e2e · Dockerfile (api + web targets, Node pinned by digest) + docker-compose.yml rehearsed: migrate, seed, health, proxy · docs/DEPLOY.md · M9 commit |
| M9b | Test sign-in (username + scrypt-hashed test password) replacing the persona picker; no password-less route | done | R-10 (API, unit, browser, component) · sign-in throttled per account (20/min) and per source (60/min) · migration 1764300000003 rehearsed on the seeded dev database (upgrade, seed, revert, upgrade) · docs/ASSUMPTIONS.md Sign-in · M9b commit |
| M9c | One published test password (`Password123!`) for every account; no account list on the sign-in page and no public staff list endpoint; docs/TEST-ACCOUNTS.md | done | R-10 updated (API, unit, component, browser) · M9c commit |
| P1 | PRD backlog #1: re-decide a case referred during a provider outage (NFR-005) | done | B-10 (integration) · lifecycle REDECIDE edges (unit) · officer's "Decide again" action · PRD-COVERAGE updated |
| P2 | PRD backlog #2: consent before the bureau check (INT-006, AIS-002) | done | C-1 (integration, unit, browser) · migration 1764300000004 (insert-only, FK to the case) · consent card on New application and a Consent panel on the case |
| P3 | PRD backlog #3: one open application per applicant and product (INT-007) | done | A-7 (integration: refusal, declined and disbursed free the applicant, forced index path, concurrent race) · migration 1764300000005 (partial unique index) rehearsed on the used dev database (migrate, revert, migrate) · pre-flight query in docs/DEPLOY.md · three more synthetic applicants for independent browser journeys |
| P4 | PRD backlog #4: withdrawal and expiry (WF-012, INT-003) | done | W-1 (integration, component, browser), W-2 (integration, api unit for the sweep) · lifecycle WITHDRAW/EXPIRE edges (unit) · migration 1764300000006 (offered_at, withdraw reason/note, open-application index recreated with the closed set) rehearsed on a seeded database at the prior head (migrate, revert, migrate; revert refused with a withdrawn case) · `EXPIRY_SWEEP_SECONDS` |
| H1 | Hardening: Swagger an explicit opt-in (`SWAGGER_ENABLED`, off by default) | done | H-1 (integration with SWAGGER_ENABLED unset, plus a swagger-on control; unit test pins the default) |
| H2 | Hardening: request body cap and read deadline on the backoffice `/api` proxy; backoffice env module kept out of client bundles | done | H-2 (Vitest: exact cap forwarded, over-cap body, declared and non-numeric Content-Length, streamed body, stalled body → 504) · env module throws in a browser (jsdom test) · new lint rule `house/no-server-env-in-client` (no new dependency) |
| H3 | Hardening: per-user rate limits behind the proxy | done | H-3 (integration: per-user buckets, forged tokens fall back to the address, sign-in stays per address) · `apps/api/src/throttler.guard.ts`; sign-in throttlers unchanged |
| U1 | Prototype UI/UX parity, batch 1: audit of every screen against the prototype (docs/ui-parity.md, screenshots at 1440 and 390), fixes in packages/ui first (clickable rows, one button hierarchy, field, pill, callout, facts block, stage bar, toast, modal, amounts in server sentences through formatPeso, monospace only for identifiers), rules and component list in the ui-ux-conventions skill; reconciled with P4 (outcome banner on Callout, Withdrawal card on KeyValues, closed stage step), next-action card inline | done | U-1..U-4 (Vitest) · 8 journeys green on lane ports · no schema change |
| P9 | PRD backlog #9: pre-booking checklist (BKG-001) | done | BK-1 (integration incl. refusal with nothing written, the under-lock re-check and the checker/retry re-check, base unit, component, browser) · `booking-checklist.ts` one gate for the view, the disabled action and the 409 `BOOKING_CHECKLIST_INCOMPLETE` · no migration |
| P13 | PRD backlog #13: indicative repayment before a decision (INT-004) | done | IR-1 (integration incl. every core failure mode, conformance for `quote`, component, browser) · `GET /products/PL/quote` · core's `quote()` now follows the simulated failure modes and is labelled simulated; an approved case opens with the instalment null when core is down · two synthetic personas (Teresa Lopez, Paz Ocampo) · no migration |
| M10 | Deploy to the dev environment | waiting | no environment named in the materials; access not received |
| M11 | Design notes, AI evidence, video script drafts | todo | |

## Blocked / waiting

- **M10 deploy:** the mechanics require the provided dev environment; none of the materials
  name it. The images and docs/DEPLOY.md are ready; waiting for the user to name the target.

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
  suites in packages/contracts; a quoted instalment fetched from core on every case
  read. (Per-user throttling and closing Swagger by default: done, H3 and H1.)
- Unauthenticated traffic behind the backoffice proxy, sign-in included, still shares one
  per-address bucket: the proxy sends no client address, so the API sees only the proxy's.
  One person's mistyped passwords or an anonymous flood can make sign-in answer 429 for
  everyone for a minute. Deferred fix: the proxy appends the client address to
  X-Forwarded-For and the API runs with `TRUST_PROXY_HOPS=1`.
- Deferred from the M8 reviews: display labels come from `@loan/core`, whose index also
  pulls decimal.js into the client bundle (a `@loan/core/labels` subpath would avoid it); the
  form's product limits and the score-band edges (600/700) are copied in the backoffice
  instead of read from the API; dependency-cruiser has no `no-unresolvable` or
  `ui-depends-only-on-core` rule yet. (The /api proxy body cap and keeping the backoffice env
  module server-only: done, H2.)
- Fixed: `review:preflight --bugfix` could not prove a backoffice (Vitest) fix, because its
  throwaway worktree had no built `@loan/core` (`dist/` is not tracked). The repro tool now
  builds the compiled packages (core, contracts, base) in the worktree before each run;
  re-proved against b74c302 (fails without the fix, passes with it).
- Reviewer agents run as general-purpose agents that load `.claude/agents/<role>.md` in the
  session that created them (agents register at session start); later sessions use the
  native agents with the write-scope hook.
