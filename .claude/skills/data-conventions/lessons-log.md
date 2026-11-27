# data lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## data-20261127-migration-backfill-needs-populated-run

A migration that backfills existing rows (UPDATE … then SET NOT NULL / ADD UNIQUE) or whose
down() matters must be exercised against a database at the previous head *holding seed data*,
then reverted — not only "from empty". Why: the `db` gate stage and the integration
global-setup both migrate an empty database, so the backfill UPDATE touches zero rows and
down() never runs; a collision under the new UNIQUE, a NULL left behind, or a broken down()
reaches every developer's existing database untested. Nearest deterministic gate: a db-stage
step (migrate to N-1, seed, migrate, seed, revert last, migrate) or a check that a migration
containing UPDATE has a matching upgrade test.

- 2026-11-27 — StaffSignIn (1764300000003) backfilled username from id and set a placeholder
  hash, then NOT NULL + UQ_staff_username. Reviewed correct by reasoning (8 seeded ids map to
  8 distinct usernames that equal the seed's, migration runs in its own transaction), but the
  "verify --only db passed" evidence never executed the UPDATE or down(). Found by the data
  reviewer.

## data-20261127-money-parse-limit-matches-column

Gate: test: packages/core/test/money.test.ts

- 2026-11-27 — First reviewed commit. Money.of accepted 13 whole digits while the column is
  numeric(14,2) (12 whole digits), so an oversized amount would pass validation and fail the
  INSERT with a 500. Found by the data reviewer. Fixed by deriving the parse limit from
  MONEY_PRECISION/MONEY_SCALE (also used by the column transformer) and refusing to serialise
  an arithmetic result that overflows; the boundary is tested both ways.

## data-20261127-compare-exact-not-rounded-ratio

Gate: test: packages/base/test/decisioning/decide.test.ts

- 2026-11-27 — Engine review. The DTI cap and the scorecard's DTI bands compared a ratio
  already rounded to 4 decimals, so ₱31,201 on ₱78,000 (40.0013%) passed a 40% cap. Found by
  the data and qa reviewers. Policy now compares exact amounts (obligations > income × cap);
  the 4-decimal ratio is display and record only. Tests sit just either side of 40/30/20%.
