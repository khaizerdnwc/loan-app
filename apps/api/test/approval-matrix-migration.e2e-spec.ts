import { MIGRATIONS } from "@loan/base";
import { type Harness, startHarness } from "./support/harness";

/**
 * Migration 1764300001002 must fail closed (AM-1): each approver gets the highest level of the
 * matrix contained in their old per-person authority, or none, so the upgrade never widens
 * anyone's authority. Run here by reverting the migration on the test database, putting
 * approvers in the old shape, and applying it again — all in one transaction that is always
 * rolled back (Postgres DDL is transactional), so the shared test database is never left
 * half-migrated.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const ApprovalMatrix = MIGRATIONS.find((m) => m.name === "ApprovalMatrix1764300001002");

describe("migration 1764300001002 assigns levels fail closed (AM-1)", () => {
  it("gives the highest level contained in the old authority, or none; nobody gains authority", async () => {
    if (!ApprovalMatrix) throw new Error("migration not listed");
    const migration = new ApprovalMatrix();
    const qr = h.ds.createQueryRunner();
    await qr.startTransaction();
    try {
      await migration.down(qr);
      // Ben and Rina come back with their level's limit and grades (L1, L2).
      await qr.query(`INSERT INTO staff (id, username, password_hash, full_name, role, title, approval_limit, approval_grades) VALUES
        ('T-150AB', 't150ab', 'x', 'T 150 AB', 'APPROVER', 't', 150000.00, '{A,B}'),
        ('T-D', 'tdonly', 'x', 'T D only', 'APPROVER', 't', 500000.00, '{D}'),
        ('T-NOGRADES', 'tnogrades', 'x', 'T no grades', 'APPROVER', 't', 5000000.00, NULL),
        ('T-SMALL', 'tsmall', 'x', 'T small', 'APPROVER', 't', 50000.00, '{A,B,C}'),
        ('T-BIG', 'tbig', 'x', 'T big', 'APPROVER', 't', 9000000.00, '{A,B,C,D,E}')`);
      await migration.up(qr);
      const rows = (await qr.query(
        "SELECT id, approval_level FROM staff WHERE id IN ('STF-BEN','STF-RINA','STF-TEO','T-150AB','T-D','T-NOGRADES','T-SMALL','T-BIG') ORDER BY id",
      )) as { id: string; approval_level: string | null }[];
      expect(Object.fromEntries(rows.map((r) => [r.id, r.approval_level]))).toEqual({
        "STF-BEN": "L1",
        "STF-RINA": "L2",
        "STF-TEO": "L3",
        "T-150AB": "L1",
        "T-D": null,
        "T-NOGRADES": null,
        "T-SMALL": null,
        // ₱9,000,000 for A–E contains L3 (₱3,000,000, A–D): capped there, never above.
        "T-BIG": "L3",
      });
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});
