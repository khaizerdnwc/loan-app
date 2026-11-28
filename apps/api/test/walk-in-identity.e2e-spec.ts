import { identityKey } from "@loan/base";
import { count, type Harness, resetData, startHarness, submitCase } from "./support/harness";

/**
 * WI-2 (PRD INT-005, INT-007): one person is on record once. A walk-in captured by hand, or from
 * core, whose identity (name as compared, birth date, ID ending) is already on file is refused
 * with a 409 naming the customer, so the officer uses them; captures of one identity are
 * serialised by a transaction-scoped advisory lock, so two at once store one.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await resetData(h.ds);
  await h.ds.query("DELETE FROM applicant WHERE id LIKE 'APL-W%' OR id LIKE 'APL-LORNA-WI2-%'");
});

const WALK_IN = {
  fullName: "Natividad Ilagan",
  birthDate: "1984-09-14",
  governmentIdLast4: "6150",
  employer: "Batangas Port Services",
  employmentMonths: 40,
  monthlyIncome: "47000.00",
  monthlyObligations: "5000.00",
};

/**
 * Lorna Abad's identity, typed by hand (the spacing and case an officer might use). A seeded
 * applicant no test twins (twin() copies an identity, such as Maria's, for most tests).
 */
const LORNA_BY_HAND = {
  ...WALK_IN,
  fullName: "  lorna   ABAD ",
  birthDate: "1986-03-18",
  governmentIdLast4: "2950",
};

const state = async () => ({
  applicants: await count(h.ds, "SELECT count(*) AS n FROM applicant"),
  captured: await count(
    h.ds,
    "SELECT count(*) AS n FROM audit_event WHERE action = 'APPLICANT_CAPTURED'",
  ),
});

describe("one person on record once (WI-2)", () => {
  it("WI-2 a walk-in whose identity is already on file is refused (409, naming the customer) and nothing is stored", async () => {
    const before = await state();
    const res = await h.as("paolo").post("/applicants", LORNA_BY_HAND).expect(409);
    expect(res.body.code).toBe("DUPLICATE_APPLICATION");
    expect(res.body.detail).toContain("APL-LORNA-ABAD (Lorna Abad)");
    expect(res.body.detail).toContain("Choose them from the list instead.");
    expect(await state()).toEqual(before);
  });

  it("WI-2 the same walk-in captured twice in a row: the second is refused, naming the first", async () => {
    const first = await h.as("paolo").post("/applicants", WALK_IN).expect(201);
    const again = await h.as("paolo").post("/applicants", WALK_IN).expect(409);
    expect(again.body.detail).toContain(first.body.id);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM applicant WHERE full_name = 'Natividad Ilagan'"),
    ).toBe(1);
  });

  it("WI-2 a capture waits on the identity lock held by another transaction, then sees what it committed (409), storing nothing more", async () => {
    // Deterministic: another transaction holds the lock and captures the same person first.
    const qr = h.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    let settled = false;
    try {
      await qr.query("SELECT pg_advisory_xact_lock(4004, hashtext($1))", [identityKey(WALK_IN)]);
      await qr.query(
        `INSERT INTO applicant SELECT (jsonb_populate_record(NULL::applicant, to_jsonb(a) ||
           jsonb_build_object('id', 'APL-WLOCKHOLDER', 'full_name', $1::text, 'birth_date', $2::date,
             'government_id_last4', $3::text, 'customer_number', NULL))).*
         FROM applicant a WHERE a.id = 'APL-MARIA'`,
        [WALK_IN.fullName, WALK_IN.birthDate, WALK_IN.governmentIdLast4],
      );
      const capture = h
        .as("paolo")
        .post("/applicants", WALK_IN)
        .then((res) => {
          settled = true;
          return res;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await qr.commitTransaction();
      const res = await capture;
      expect(res.status).toBe(409);
      expect(res.body.detail).toContain("APL-WLOCKHOLDER");
    } finally {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.release();
    }
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM applicant WHERE full_name = 'Natividad Ilagan'"),
    ).toBe(1);
  });

  it("WI-2 a walk-in captured by hand, later found in core, is upgraded in place: one applicant with core's account and income, its case still linked, audited by reference", async () => {
    // Core's CIF-100245 is Lorna Bautista; she first comes in as a walk-in, typed by hand.
    const walkIn = (
      await h
        .as("paolo")
        .post("/applicants", {
          ...WALK_IN,
          fullName: "Lorna Bautista",
          birthDate: "1990-03-17",
          governmentIdLast4: "5521",
          monthlyIncome: "61000.00",
        })
        .expect(201)
    ).body;
    expect(walkIn.depositAccount).toBe("");
    const c = await submitCase(
      h,
      { applicantId: walkIn.id, amount: "60000.00" },
      { sameApplicant: true },
    );
    const res = await h
      .as("paolo")
      .post("/applicants", { ...WALK_IN, customerNumber: "CIF-100245", monthlyIncome: "70000.00" })
      .expect(201);
    expect(res.body).toMatchObject({
      id: walkIn.id,
      depositAccount: "WB-SAV-0245-1180",
      relationshipMonths: 61,
      monthlyIncome: "64000.00",
    });
    const [row] = await h.ds.query(
      `SELECT customer_number, deposit_account, monthly_income, declared_monthly_income
         FROM applicant WHERE id = $1`,
      [walkIn.id],
    );
    // Verified income from core; declared is what she declares now (RS-PL-2 compares them).
    expect(row).toEqual({
      customer_number: "CIF-100245",
      deposit_account: "WB-SAV-0245-1180",
      monthly_income: "64000.00",
      declared_monthly_income: "70000.00",
    });
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM applicant WHERE full_name = 'Lorna Bautista'"),
    ).toBe(1);
    const [link] = await h.ds.query("SELECT applicant_id FROM loan_case WHERE id = $1", [c.id]);
    expect(link.applicant_id).toBe(walkIn.id);
    // Her open case says so in its history, and that event is in the audit chain too.
    const events = await h.ds.query(
      "SELECT summary, details FROM activity_event WHERE case_id = $1 AND action = 'APPLICANT_LINKED_TO_CORE'",
      [c.id],
    );
    expect(events).toHaveLength(1);
    expect(events[0].details).toEqual({
      applicantId: walkIn.id,
      customerNumber: "CIF-100245",
      before: { hadPayoutAccount: false },
      after: { hadPayoutAccount: true },
    });
    expect(JSON.stringify(events[0])).not.toContain("WB-SAV");
    expect(JSON.stringify(events[0])).not.toContain("64000");
    expect(
      await count(
        h.ds,
        "SELECT count(*) AS n FROM audit_event WHERE action = 'APPLICANT_LINKED_TO_CORE' AND case_id = $1",
        [c.id],
      ),
    ).toBe(1);
    const [entry] = await h.ds.query(
      "SELECT summary, details FROM audit_event WHERE action = 'APPLICANT_UPGRADED' ORDER BY seq DESC LIMIT 1",
    );
    expect(entry.details).toMatchObject({
      applicantId: walkIn.id,
      before: { customerNumber: null, hadPayoutAccount: false },
      after: { customerNumber: "CIF-100245", hadPayoutAccount: true },
    });
    expect(JSON.stringify(entry)).not.toContain("Lorna");
    expect(JSON.stringify(entry)).not.toContain("WB-SAV");

    // Already from core: capturing the same core customer again is refused, naming her.
    const again = await h
      .as("paolo")
      .post("/applicants", { ...WALK_IN, customerNumber: "CIF-100245" })
      .expect(409);
    expect(again.body.detail).toContain(walkIn.id);
  });

  it("WI-2 a walk-in with another ID ending is not core's customer: a core capture stores a new applicant and leaves the walk-in unchanged", async () => {
    const walkIn = (
      await h
        .as("paolo")
        .post("/applicants", {
          ...WALK_IN,
          fullName: "Lorna Bautista",
          birthDate: "1990-03-17",
          governmentIdLast4: "9999",
        })
        .expect(201)
    ).body;
    // The audit log is never emptied between tests: compare with before.
    const upgradesBefore = await count(
      h.ds,
      "SELECT count(*) AS n FROM audit_event WHERE action = 'APPLICANT_UPGRADED'",
    );
    const fromCore = await h
      .as("paolo")
      .post("/applicants", { ...WALK_IN, customerNumber: "CIF-100245" })
      .expect(201);
    expect(fromCore.body.id).not.toBe(walkIn.id);
    const [row] = await h.ds.query(
      "SELECT customer_number, deposit_account, government_id_last4 FROM applicant WHERE id = $1",
      [walkIn.id],
    );
    expect(row).toEqual({
      customer_number: null,
      deposit_account: "",
      government_id_last4: "9999",
    });
    expect(
      await count(
        h.ds,
        "SELECT count(*) AS n FROM audit_event WHERE action = 'APPLICANT_UPGRADED'",
      ),
    ).toBe(upgradesBefore);
  });

  it("WI-2 several customers already on file with the identity: refused, naming each", async () => {
    await h.ds.query(
      `INSERT INTO applicant SELECT (jsonb_populate_record(NULL::applicant, to_jsonb(a) ||
         jsonb_build_object('id', 'APL-LORNA-WI2-1'))).*
       FROM applicant a WHERE a.id = 'APL-LORNA-ABAD'`,
    );
    const before = await state();
    const res = await h.as("paolo").post("/applicants", LORNA_BY_HAND).expect(409);
    expect(res.body.detail).toContain("APL-LORNA-ABAD (Lorna Abad)");
    expect(res.body.detail).toContain("APL-LORNA-WI2-1 (Lorna Abad)");
    expect(await state()).toEqual(before);
  });

  it("WI-2 another person (a different ID ending) is captured as usual", async () => {
    const res = await h
      .as("paolo")
      .post("/applicants", { ...LORNA_BY_HAND, governmentIdLast4: "2951" })
      .expect(201);
    expect(res.body.id).toMatch(/^APL-W/);
  });
});
