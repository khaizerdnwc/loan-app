# Data lessons

Ungated lessons only, one per line, newest first. Load only the ones for your files: `pnpm lessons for <files> --role data`. Full story: `pnpm lessons show <id>`. Enforced lessons are not listed; the rule's message is the lesson.

- [data-20261127-migration-backfill-needs-populated-run] paths: packages/base/src/database/migrations/** · shape: check-candidate · A migration that UPDATEs existing rows or tightens constraints must be run on a seeded DB at the prior head, then reverted. Check: evidence beyond "from empty"; down() executed once.
