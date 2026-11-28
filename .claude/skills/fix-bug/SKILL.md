---
name: fix-bug
description: Fix a reported bug the reproduce-first way — pin the report, reproduce it twice (a failing test AND by driving the real app in a browser), only then fix the root cause, and verify the fix the same two ways before /review. Use whenever the task is a bug, regression, "X is broken", "X doesn't work", "this shows the wrong thing", or an error report — as opposed to a new feature or a change in intended behaviour.
argument-hint: "<what is broken, where, for whom>"
---

# Fix a bug

A fix is only as good as the reproduction behind it. A bug fixed without being seen is a
guess; a fix verified only by a test that was written after the fix proves nothing. So
this path reproduces the bug **two ways before touching product code**, and verifies the
fix **the same two ways after**:

| | Before the fix | After the fix |
|---|---|---|
| **Code** | a test that **fails** for the reported reason | the same test, unedited, **passes** |
| **Real app** | drive the real screens and **see** the wrong behaviour | drive the same steps and **see** the right behaviour |

Feature work and intended-behaviour changes do not use this skill — they follow
AGENTS.md (Working process) and the `add-*` skills.

## 1. Pin the report

Write down, before anything else:

- **Expected vs actual** — one sentence each.
- **Where** — the URL or screen, and the steps to get there.
- **Who** — which seeded persona: loan officer (Paolo Tan), approver (Rina Aquino, or Ben
  Castro with the lower authority), loan operations maker (Marco Bautista), supervisor checker
  (Ella Reyes), compliance (Diane Yu) or the simulation admin (Leo Santiago). Permissions
  change what renders and what the API allows, so the role is part of the bug.
- **State** — what has to exist: which applicant, which stage the case is in (Review,
  Approval, Booking, Pending checker, Booking failed…), and which simulated service is in a
  failure mode (bureau outage, core timeout…).
- **Device** — desktop or mobile width; browser if it matters.
- **Where it was seen** — local or the dev environment. For the dev environment, read the
  evidence first (the host's logs, read-only). Never drive the shared dev environment into a
  failure mode without saying so; failure modes reset after 15 minutes.

Fill each item from, in order: the user's report (words, screenshot, recording), the code
(what *should* happen; which role can even reach the screen), and logs for production
reports. Ask the user only for what blocks reproduction. Mark every item you inferred
rather than were told as `assumed`, with where it came from:

```
Who:     approver             (from code: only approvers can approve a referral)
Device:  desktop — assumed    (not stated; try mobile if desktop does not reproduce)
```

When reproduction fails, the `assumed` items are the first to revisit, and the question
to the user names them specifically.

## 2. Reproduce it in code — a failing test

Pick the lowest level that can show the bug:

| The bug lives in… | Test |
|---|---|
| Money, the schedule maths, a formatter | unit: `packages/core/test/**` (Jest) or the backoffice's Vitest |
| the decision engine, a rule, the scorecard, the transition table | unit: `packages/base/test/**` (Jest) |
| a simulated provider against its port | the port's conformance test |
| an endpoint, a permission, maker-checker, authority, a transaction, booking | integration: `apps/api/test/*.e2e-spec.ts` (Jest + supertest, real Postgres) |
| only the rendered UI or navigation | Playwright spec under `apps/backoffice/e2e/` |

```bash
pnpm --filter @loan/core exec jest <the test file>
pnpm --filter @loan/base exec jest <the test file>
pnpm --filter @loan/backoffice exec vitest run <the test file>
pnpm db:up && TEST_DATABASE_URL=postgres://loan:loan_dev_password@127.0.0.1:5436/loan_test \
  pnpm --filter @loan/api run test:integration <the test file>      # DB-backed
pnpm --filter @loan/backoffice exec playwright test <spec> --project=chromium
```

Integration tests TRUNCATE every table. They must run against a database whose name ends in
`_test` (`TEST_DATABASE_URL`), **never** the dev database `loan_dev`. Create `loan_test` once
on the dev Postgres, or use verify's throwaway one (`pnpm verify --only db,integration`).

The test must **fail, for the reported reason**: assert the wrong value, message or
element the user described, not merely "something threw". A test that fails for another
reason (missing fixture, wrong import) has reproduced nothing. Name it after the
behaviour, e.g. `it("refuses the booking maker as its own checker")`.

## 3. Reproduce it in the real app — drive the screens

1. **Get the app running.** Check first: `lsof -i :3100 -i :3101`. If nothing is running:
   `pnpm db:up && pnpm db:migrate && pnpm db:seed`, then `pnpm dev` in the background
   (backoffice http://localhost:3100, API http://localhost:3101). `pnpm db:reset` wipes and
   re-seeds local data — only with the user's OK.
2. **Sign in as the reported persona** with the demo persona picker on `/sign-in`. Create the
   needed state through the UI, the API, or the simulation controls (signed in as the admin),
   not by hand-editing rows.
3. **Drive it with Claude in Chrome** (`mcp__claude-in-chrome__*`; load the tools in one
   ToolSearch call, open a new tab). Follow the user's steps exactly, at the reported
   width (`resize_window` 390×844 for mobile).
   - Record it with `gif_creator` as `bug-<slug>-before.gif`.
   - Read `read_console_messages` and `read_network_requests` for errors and failed calls.
   - Do not click anything that opens a browser `alert`/`confirm` dialog.
4. **No browser extension available?** Drive the same steps with a Playwright script
   (`--headed` when the user wants to watch), or the spec from step 2, and keep its
   trace or screenshots as the evidence.

## 4. Verdict — is it really a bug?

| Code repro | App repro | Then |
|---|---|---|
| fails | wrong on screen | **Confirmed.** Go to step 5. |
| passes | correct on screen | **Not reproduced.** Stop. Report what was tried (steps, role, data, evidence) and ask for what differs. Do not fix a bug you could not see. |
| passes | wrong on screen | The test is at the wrong level or misses state. Fix the test until it fails, then continue. |
| fails | correct on screen | The test asserts something the app does not do that way. Re-read the code path; fix the test or find the missing app step. |
| — | works as designed | **Intended behaviour.** Explain why to the user, cite the code or doc; offer it as a change request instead. |

## 5. Find the root cause, then fix it

- Trace the cause, not the symptom: a fix that hides one screen's wrong value while the
  query still returns it is not a fix.
- `pnpm lessons for <files you will touch>` before editing; follow the lines it prints.
- **Do not edit the reproduction test to make it pass.** If the test itself was wrong,
  that is step 4, not step 5.
- Search for the same mistake elsewhere (`git grep` the pattern). Fix siblings in the same
  change or list them for the user.

## 6. Verify in code

```bash
pnpm --filter <same package> exec jest <the reproduction test>     # now passes, unedited
pnpm --filter <same package> test                                   # the package's suite
```

The test failed in step 2 and passes now, with only product code changed in between —
that is the proof the test guards this bug. A machine re-checks it rather than taking your
word: `pnpm review:repro` runs the changed tests in a throwaway worktree **without** the
product changes (at least one must fail) and **with** them (all must pass). Run it now; it
is also part of `/review --bugfix` and of the commit.

## 7. Verify in the real app

Repeat step 3 exactly — same account, same data, same width — and record
`bug-<slug>-after.gif`. Console and network must be clean of the step-3 errors. Then try
one neighbouring path the fix could have affected (the other role, the empty state, mobile).

If the app still shows the bug while the test passes, go back to step 4: the test is not
testing what the user sees.

## 8. Learn, report, ship

- Was this a class of mistake rather than a one-off? Run `/lesson` (a lint rule if a
  checker can decide it).
- Tell the user, in this shape:

  ```
  Bug:         <expected vs actual, one line>
  Root cause:  <file:line, why it happened>
  Fix:         <what changed>
  Code proof:  <test name> — failed before, passes after
  App proof:   bug-<slug>-before.gif → bug-<slug>-after.gif (<role>, <width>)
  Also checked: <neighbouring path>
  ```

- Then the normal path, with two bug-fix additions (ADR 0017):
  - review with **`/review --cached --bugfix`** — preflight then runs the repro proof;
  - commit as `fix(<scope>): …` with a trailer, which commitlint requires on every `fix:`:

    ```
    Repro-Test: apps/api/test/<x>.e2e-spec.ts
    ```
    or, when step 4 allowed app-only proof (visual, device-only, outside service, timing):
    ```
    Repro: not testable — <the reason, specific to this bug>
    ```
    With `Repro-Test:`, the commit-msg check proves that test again unless `/review`
    already proved it for this exact staged diff.
