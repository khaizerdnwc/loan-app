# Data lessons

Ungated lessons only, one per line, newest first. Load only the ones for your files: `pnpm lessons for <files> --role data`. Full story: `pnpm lessons show <id>`. Enforced lessons are not listed; the rule's message is the lesson.

- [data-20261128-engine-step-needs-a-version] paths: packages/base/src/decisioning/engine/** · shape: test-candidate · Engine logic outside a rule set (a post-step, a mode overlay) is gated by a versioned flag, or the current version has a frozen replay fixture. Check: changing the step fails a stored-record replay.
- [data-20261128-reconcile-every-feed-record] paths: packages/base/src/operations/** · shape: test-candidate · Reconciliation accounts for every feed record once (matched, finding or orphan); no branch drops one. Check: each `continue` path; a test sums records per feed.
- [data-20261128-unique-violation-mapping-forced-test] paths: packages/base/src/**/*.service.ts, apps/api/test/** · shape: test-candidate · A unique-violation→409 mapping has a test that forces the index path, and maps after tx.run rejects. Check: catch branch hit deterministically; no 2nd connection inside the tx.
- [data-20261127-precondition-reread-under-lock] paths: packages/base/src/cases/** · shape: test-candidate · A guard read before the locked transaction (consent, terms) is re-read inside it after the row lock, or its writer bumps the locked row's version. Check: each pre-tx guard has an in-tx twin or a version bump.
- [data-20261127-migration-backfill-needs-populated-run] paths: packages/base/src/database/migrations/** · shape: check-candidate · A migration that UPDATEs existing rows or tightens constraints must be run on a seeded DB at the prior head, then reverted. Check: evidence beyond "from empty"; down() executed once.
