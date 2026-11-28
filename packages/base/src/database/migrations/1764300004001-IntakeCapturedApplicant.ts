import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Email and file intake, batch 2 (PRD INT-010, INT-005): a draft no customer matched can now be
 * confirmed by capturing the applicant from it in the same step.
 *
 * - `intake_draft.applicant_captured`: the applicant was captured from this draft when it was
 *   confirmed. Existing drafts were all confirmed against a customer already on record, so the
 *   default `false` is true of every existing row; nothing is backfilled.
 *
 * Additive (one column with a constant default: no table rewrite on Postgres 11+). down() drops
 * it; the drafts confirmed with a capture then read as plain confirmations.
 */
export class IntakeCapturedApplicant1764300004001 implements MigrationInterface {
  name = "IntakeCapturedApplicant1764300004001";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "intake_draft" ADD "applicant_captured" boolean NOT NULL DEFAULT false`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "intake_draft" DROP COLUMN "applicant_captured"`);
  }
}
