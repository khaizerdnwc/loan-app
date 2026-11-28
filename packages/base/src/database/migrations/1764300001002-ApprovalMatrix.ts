import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The approval matrix as data (PRD WF-004): delegated authority levels by product, amount,
 * risk grade and exception type, and each approver's level.
 *
 * - `approval_level`: the levels. The first version of the matrix is inserted here (reference
 *   data, like a product): L1 up to ₱100,000 for grades A–B; L2 up to ₱1,000,000 for grades
 *   A–C and overrides; L3 up to ₱3,000,000 for grades A–D, overrides, policy exceptions and
 *   related-party loans (prototype "Approval matrix"; values beyond it are ours).
 * - `staff.approval_level`: an approver's level, replacing the per-person `approval_limit` and
 *   `approval_grades`. Fail closed: an existing approver gets the highest level contained in
 *   their old authority (its limit at most the old limit, its grades all among the old grades),
 *   otherwise none — no approval until a level is assigned on purpose. Nobody gains authority
 *   (Ben → L1, Rina → L2 on the seeded data). L1 approves no overrides, which the old per-person
 *   authority did not distinguish. The old columns are dropped.
 *
 * down() puts the old columns back from each approver's level, then drops the matrix.
 */
export class ApprovalMatrix1764300001002 implements MigrationInterface {
  name = "ApprovalMatrix1764300001002";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "approval_level" (
      "code" character varying(10) NOT NULL,
      "name" character varying(80) NOT NULL,
      "product_code" character varying(10) NOT NULL,
      "rank" integer NOT NULL,
      "max_amount" numeric(14,2) NOT NULL,
      "grades" jsonb NOT NULL,
      "exceptions" jsonb NOT NULL,
      CONSTRAINT "PK_approval_level_code" PRIMARY KEY ("code"))`);
    await q.query(`INSERT INTO "approval_level" ("code", "name", "product_code", "rank", "max_amount", "grades", "exceptions") VALUES
      ('L1', 'Approver (junior)', 'PL', 1, 100000.00, '["A","B"]', '[]'),
      ('L2', 'Approver', 'PL', 2, 1000000.00, '["A","B","C"]', '["OVERRIDE"]'),
      ('L3', 'Head of credit', 'PL', 3, 3000000.00, '["A","B","C","D"]', '["OVERRIDE","POLICY_EXCEPTION","RELATED_PARTY"]')`);
    await q.query(`ALTER TABLE "staff" ADD "approval_level" character varying(10)`);
    // Fail closed: the highest level contained in the old authority, else none.
    await q.query(`UPDATE "staff" s SET "approval_level" = (
        SELECT l."code" FROM "approval_level" l
         WHERE s."approval_grades" IS NOT NULL
           AND l."max_amount" <= s."approval_limit"
           AND to_jsonb(s."approval_grades") @> l."grades"
         ORDER BY l."rank" DESC LIMIT 1)
      WHERE s."approval_limit" IS NOT NULL`);
    await q.query(
      `ALTER TABLE "staff" ADD CONSTRAINT "FK_staff_approval_level" FOREIGN KEY ("approval_level") REFERENCES "approval_level"("code") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await q.query(`ALTER TABLE "staff" DROP COLUMN "approval_grades"`);
    await q.query(`ALTER TABLE "staff" DROP COLUMN "approval_limit"`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "staff" ADD "approval_limit" numeric(14,2)`);
    await q.query(`ALTER TABLE "staff" ADD "approval_grades" character varying array`);
    await q.query(`UPDATE "staff" s SET "approval_limit" = l."max_amount",
        "approval_grades" = ARRAY(SELECT jsonb_array_elements_text(l."grades"))
      FROM "approval_level" l WHERE l."code" = s."approval_level"`);
    await q.query(`ALTER TABLE "staff" DROP CONSTRAINT "FK_staff_approval_level"`);
    await q.query(`ALTER TABLE "staff" DROP COLUMN "approval_level"`);
    await q.query(`DROP TABLE "approval_level"`);
  }
}
