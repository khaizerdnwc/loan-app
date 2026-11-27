import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One open application per applicant and product (PRD INT-007). A partial unique index: a
 * declined or disbursed case no longer blocks a new one. An existing database that already
 * holds two open applications for the same applicant and product fails here, on purpose;
 * close one of them first (demo databases only, all data synthetic).
 */
export class OneOpenApplication1764300000005 implements MigrationInterface {
  name = "OneOpenApplication1764300000005";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE UNIQUE INDEX "UQ_loan_case_open_per_applicant_product" ON "loan_case" ("applicant_id", "product_code") WHERE "status" NOT IN ('DECLINED', 'DISBURSED')`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."UQ_loan_case_open_per_applicant_product"`);
  }
}
