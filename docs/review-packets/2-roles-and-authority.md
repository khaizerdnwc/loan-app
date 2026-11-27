# Review packet 2 — Roles, maker-checker and authority limits

For you to check by hand (about 15 minutes). Anything you correct goes through `/lesson`.

## What was built

- One global guard (packages/base/src/auth/session.guard.ts) that fails closed: no session
  → 401; a route without `@Roles`/`@Public` → 403; a role not listed → 403. A house lint
  rule makes a handler without `@Roles` or `@Public` a build error.
- Case visibility (packages/base/src/cases/case-access.ts `canView`): a case outside a
  role's stages answers 404, not 403.
- Authority (`authorityProblem`): the approver's limit AND grade list, read from the staff
  table at decision time — never from the session token. A refused approval commits an
  `escalated` flag and an activity event before answering 403.
- Maker-checker: the booking maker can never be its checker (`BookingService.book`), and
  the recommender can never approve (defence in depth: one person has one role).
- `allowedActions` tells the UI which actions are disabled and why; the services enforce
  the same rules when the action is posted anyway.

## How it was tested

`apps/api/test/access-and-validation.e2e-spec.ts` against the real API: R-1 officer cannot
approve, R-2 approver cannot book, R-3 401 everywhere without a session, R-5 the maker
supervisor is refused and another supervisor books, R-6 Ben is refused on ₱120,000 grade C,
the case is escalated and leaves his queue, Rina approves, R-7 compliance reads everything
and every write is refused, plus 404-not-403 and admin-only simulation switches.
`apps/api/test/approval-and-session.e2e-spec.ts`: R-8 approver decline and return (and
the roles refused on them), R-9 role re-read from the staff table on every request.

## Check these three by hand

1. Sign in as Ben in the backoffice and open Joel's case: is the disabled Approve button and
   its reason clear enough for a branch user?
2. Should a refused approval escalate automatically (current), or should Ben have to press
   "Escalate"? The PRD says "blocked or escalated".
3. Sign-in is now a test account per staff member (`<username>-test-2026`, scrypt-hashed;
   your call on 27 Nov replaced the password-less picker). Are published test passwords
   acceptable for the shared dev environment, or should the deployed seed take passwords
   from an environment variable instead?
