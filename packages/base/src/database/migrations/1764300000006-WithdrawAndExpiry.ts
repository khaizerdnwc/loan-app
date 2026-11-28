import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Withdrawal (PRD WF-012) and expiry (PRD INT-003, the prototype's offer expiry).
 *
 * - `offered_at`: when the case last entered OFFER; the offer expires from here. Cases already
 *   in OFFER are backfilled from `updated_at`, their last change (the move into OFFER).
 * - `withdraw_reason`, `withdraw_note`: the loan officer's reason for withdrawing.
 * - The one-open-application index (1764300000005) is recreated so withdrawn and expired
 *   cases, like declined and disbursed ones, no longer block a new application. Loosening the
 *   predicate cannot fail on existing rows.
 *
 * down() refuses while a withdrawn or expired case exists: the older index would count it as
 * open, and the older code has no status for it (demo databases only, all data synthetic).
 */
export class WithdrawAndExpiry1764300000006 implements MigrationInterface {
  name = "WithdrawAndExpiry1764300000006";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "loan_case" ADD "offered_at" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "loan_case" ADD "withdraw_reason" character varying(30)`);
    await q.query(`ALTER TABLE "loan_case" ADD "withdraw_note" text`);
    await q.query(`UPDATE "loan_case" SET "offered_at" = "updated_at" WHERE "status" = 'OFFER'`);
    await q.query(`DROP INDEX "public"."UQ_loan_case_open_per_applicant_product"`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_loan_case_open_per_applicant_product" ON "loan_case" ("applicant_id", "product_code") WHERE "status" NOT IN ('DECLINED', 'DISBURSED', 'WITHDRAWN', 'EXPIRED')`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    const [{ n }] = (await q.query(
      `SELECT count(*)::int AS n FROM "loan_case" WHERE "status" IN ('WITHDRAWN', 'EXPIRED')`,
    )) as [{ n: number }];
    if (n > 0) {
      throw new Error(
        `Cannot revert WithdrawAndExpiry: ${n} withdrawn or expired case(s) exist. Reset the demo database instead.`,
      );
    }
    await q.query(`DROP INDEX "public"."UQ_loan_case_open_per_applicant_product"`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_loan_case_open_per_applicant_product" ON "loan_case" ("applicant_id", "product_code") WHERE "status" NOT IN ('DECLINED', 'DISBURSED')`,
    );
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "withdraw_note"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "withdraw_reason"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "offered_at"`);
  }
}
