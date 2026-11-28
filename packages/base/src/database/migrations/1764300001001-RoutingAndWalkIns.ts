import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Queue routing (PRD WF-002) and walk-in capture (PRD INT-005, INT-002).
 *
 * - `loan_case.owner_id`: the loan officer who owns the case while it is with loan officers
 *   (draft, review, information requested); null = unassigned in the team queue. Existing
 *   drafts are given to whoever created them (the only backfill).
 * - `loan_case.channel`: where the application came in (BRANCH: staff-assisted, the only
 *   channel in this release). Existing cases were all captured by staff at a branch.
 * - `loan_case.priority`: NORMAL or HIGH, set by a loan officer.
 * - `applicant.customer_number`: the core banking customer number (CIF) of an applicant
 *   captured from a core lookup; null for seeded and new-to-bank applicants. Unique, so one
 *   customer is on file once.
 *
 * - `sim.persona_profile.identity_key`: the simulators' copy of who a persona is (name, birth
 *   date, ID last 4; `identityKey`), so a walk-in re-captured under a new applicant id is
 *   screened as the same person. Filled by the seed.
 *
 * down() drops the columns: routing, the CIF link and the identity keys are lost, nothing else.
 */
export class RoutingAndWalkIns1764300001001 implements MigrationInterface {
  name = "RoutingAndWalkIns1764300001001";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "loan_case" ADD "owner_id" character varying(40)`);
    await q.query(
      `ALTER TABLE "loan_case" ADD "channel" character varying(20) NOT NULL DEFAULT 'BRANCH'`,
    );
    await q.query(
      `ALTER TABLE "loan_case" ADD "priority" character varying(10) NOT NULL DEFAULT 'NORMAL'`,
    );
    await q.query(`UPDATE "loan_case" SET "owner_id" = "created_by" WHERE "status" = 'DRAFT'`);
    await q.query(`CREATE INDEX "IDX_loan_case_owner" ON "loan_case" ("owner_id")`);
    await q.query(`ALTER TABLE "applicant" ADD "customer_number" character varying(20)`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_applicant_customer_number" ON "applicant" ("customer_number") WHERE "customer_number" IS NOT NULL`,
    );
    await q.query("ALTER TABLE sim.persona_profile ADD identity_key varchar(200)");
    await q.query(
      "CREATE INDEX persona_profile_identity_key ON sim.persona_profile (identity_key)",
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DROP INDEX sim.persona_profile_identity_key");
    await q.query("ALTER TABLE sim.persona_profile DROP COLUMN identity_key");
    await q.query(`DROP INDEX "public"."UQ_applicant_customer_number"`);
    await q.query(`ALTER TABLE "applicant" DROP COLUMN "customer_number"`);
    await q.query(`DROP INDEX "public"."IDX_loan_case_owner"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "priority"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "channel"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "owner_id"`);
  }
}
