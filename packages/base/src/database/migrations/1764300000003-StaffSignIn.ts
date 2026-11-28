import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Test sign-in for staff (Program Mechanics 1a): a unique username and a scrypt password
 * hash. Existing rows get a username from their id (STF-PAOLO → paolo) and an unusable hash
 * until the seed sets their test password, so nobody can sign in without one.
 */
export class StaffSignIn1764300000003 implements MigrationInterface {
  name = "StaffSignIn1764300000003";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "staff" ADD "username" character varying(40)`);
    await q.query(`ALTER TABLE "staff" ADD "password_hash" character varying(200)`);
    await q.query(
      `UPDATE "staff" SET "username" = lower(regexp_replace("id", '^STF-', '')), "password_hash" = 'unset'`,
    );
    await q.query(`ALTER TABLE "staff" ALTER COLUMN "username" SET NOT NULL`);
    await q.query(`ALTER TABLE "staff" ALTER COLUMN "password_hash" SET NOT NULL`);
    await q.query(`ALTER TABLE "staff" ADD CONSTRAINT "UQ_staff_username" UNIQUE ("username")`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "staff" DROP CONSTRAINT "UQ_staff_username"`);
    await q.query(`ALTER TABLE "staff" DROP COLUMN "password_hash"`);
    await q.query(`ALTER TABLE "staff" DROP COLUMN "username"`);
  }
}
