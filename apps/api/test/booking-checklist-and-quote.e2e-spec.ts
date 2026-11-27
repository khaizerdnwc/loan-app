import type { CaseDetail, IndicativeRepaymentView } from "@loan/core";
import {
  count,
  FULL_CONSENT,
  type Harness,
  setMode,
  startHarness,
  submitCase,
  twin,
} from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await h.ds.query("TRUNCATE sim.service_mode");
});

/** Maria's twin, auto-approved and signed: the case is in BOOKING. */
async function readyToBook(prepare?: (applicantId: string) => Promise<unknown>): Promise<string> {
  const applicantId = await twin(h, "APL-MARIA");
  await prepare?.(applicantId);
  const c = await submitCase(
    h,
    { applicantId, amount: "60000.00", tenorMonths: 12 },
    { sameApplicant: true },
  );
  expect(c.status).toBe("OFFER");
  expect(c.bookingChecklist).toBeNull();
  await h.as("marco").post(`/cases/${c.id}/sign`).expect(200);
  return c.id;
}

const writesFor = async (id: string) => ({
  bookings: await count(h.ds, "SELECT count(*) AS n FROM booking_request WHERE case_id = $1", [id]),
  events: await count(h.ds, "SELECT count(*) AS n FROM activity_event WHERE case_id = $1", [id]),
  status: (
    (await h.ds.query("SELECT status FROM loan_case WHERE id = $1", [id])) as {
      status: string;
    }[]
  )[0]?.status,
});

describe("pre-booking checklist (BK-1, PRD BKG-001)", () => {
  it("BK-1 shows four passing items on the booking step, and the booking can be submitted", async () => {
    const id = await readyToBook();
    const c = (await h.as("marco").get(`/cases/${id}`).expect(200)).body as CaseDetail;
    expect(c.status).toBe("BOOKING");
    expect(c.bookingChecklist?.map((i) => [i.check, i.passed])).toEqual([
      ["APPROVALS_COMPLETE", true],
      ["DOCUMENTS_SIGNED", true],
      ["KYC_VALID", true],
      ["DISBURSEMENT_ACCOUNT_VERIFIED", true],
    ]);
    expect(c.bookingChecklist?.[0]?.detail).toBe(
      "₱60000.00 over 12 months, approved automatically",
    );
    expect(c.bookingChecklist?.[3]?.detail).toMatch(/^WB-SAV-0021-4410, the applicant's own/);
    expect(c.allowedActions).toContainEqual({ action: "SUBMIT_BOOKING", enabled: true });

    const booked = (await h.as("marco").post(`/cases/${id}/booking`).expect(200))
      .body as CaseDetail;
    expect(booked.status).toBe("PENDING_CHECKER");
    // The checker sees what was checked.
    expect(booked.bookingChecklist?.every((i) => i.passed)).toBe(true);
  });

  it("BK-1 a failing item disables SUBMIT_BOOKING with the reason, and the API refuses it (409) with nothing written", async () => {
    const id = await readyToBook((applicantId) =>
      h.ds.query("UPDATE applicant SET deposit_account = 'EXT-0000' WHERE id = $1", [applicantId]),
    );
    const c = (await h.as("marco").get(`/cases/${id}`).expect(200)).body as CaseDetail;
    const account = c.bookingChecklist?.find((i) => i.check === "DISBURSEMENT_ACCOUNT_VERIFIED");
    expect(account).toMatchObject({
      passed: false,
      detail: "No valid WhiteBank deposit account on record for the applicant",
    });
    const reason =
      "Pre-booking checklist: Disbursement account verified — No valid WhiteBank deposit account on record for the applicant. The booking cannot go ahead until every item passes.";
    expect(c.allowedActions).toContainEqual({
      action: "SUBMIT_BOOKING",
      enabled: false,
      blockedBy: "BOOKING_CHECKLIST_INCOMPLETE",
      detail: reason,
    });

    const before = await writesFor(id);
    for (const persona of ["marco", "lito"] as const) {
      const res = await h.as(persona).post(`/cases/${id}/booking`).expect(409);
      expect(res.body).toMatchObject({ code: "BOOKING_CHECKLIST_INCOMPLETE", detail: reason });
    }
    expect(await writesFor(id)).toEqual(before);
    expect(before).toMatchObject({ bookings: 0, status: "BOOKING" });

    // Once the item passes, the same request goes through.
    await h.ds.query(
      "UPDATE applicant SET deposit_account = 'WB-SAV-0021-4410' WHERE id = (SELECT applicant_id FROM loan_case WHERE id = $1)",
      [id],
    );
    const res = await h.as("marco").post(`/cases/${id}/booking`).expect(200);
    expect((res.body as CaseDetail).status).toBe("PENDING_CHECKER");
  });

  it("BK-1 the checklist is read under the lock: a change after the page loaded is still refused", async () => {
    const id = await readyToBook();
    const c = (await h.as("marco").get(`/cases/${id}`).expect(200)).body as CaseDetail;
    expect(c.allowedActions).toContainEqual({ action: "SUBMIT_BOOKING", enabled: true });
    await h.ds.query(
      "UPDATE applicant SET deposit_account = '' WHERE id = (SELECT applicant_id FROM loan_case WHERE id = $1)",
      [id],
    );
    const before = await writesFor(id);
    const res = await h.as("marco").post(`/cases/${id}/booking`).expect(409);
    expect(res.body.code).toBe("BOOKING_CHECKLIST_INCOMPLETE");
    expect(await writesFor(id)).toEqual(before);
  });

  it("BK-1 the checker's approval (and a retry) runs the checklist again: a change since the maker submitted is refused (409) with nothing written", async () => {
    const id = await readyToBook();
    await h.as("marco").post(`/cases/${id}/booking`).expect(200);
    await h.ds.query(
      "UPDATE applicant SET deposit_account = 'EXT-0000' WHERE id = (SELECT applicant_id FROM loan_case WHERE id = $1)",
      [id],
    );
    const c = (await h.as("lito").get(`/cases/${id}`).expect(200)).body as CaseDetail;
    expect(c.status).toBe("PENDING_CHECKER");
    expect(c.allowedActions).toContainEqual(
      expect.objectContaining({
        action: "APPROVE_BOOKING",
        enabled: false,
        blockedBy: "BOOKING_CHECKLIST_INCOMPLETE",
      }),
    );
    const before = {
      ...(await writesFor(id)),
      accounts: await count(h.ds, "SELECT count(*) AS n FROM sim.core_account"),
      booking: await h.ds.query(
        "SELECT status, attempts, checker_id FROM booking_request WHERE case_id = $1",
        [id],
      ),
    };
    const res = await h.as("lito").post(`/cases/${id}/booking/approve`).expect(409);
    expect(res.body.code).toBe("BOOKING_CHECKLIST_INCOMPLETE");
    expect(res.body.detail).toMatch(/^Pre-booking checklist: Disbursement account verified/);
    expect({
      ...(await writesFor(id)),
      accounts: await count(h.ds, "SELECT count(*) AS n FROM sim.core_account"),
      booking: await h.ds.query(
        "SELECT status, attempts, checker_id FROM booking_request WHERE case_id = $1",
        [id],
      ),
    }).toEqual(before);

    // A failed booking's retry meets the same check.
    await h.ds.query(
      "UPDATE applicant SET deposit_account = 'WB-SAV-0021-4410' WHERE id = (SELECT applicant_id FROM loan_case WHERE id = $1)",
      [id],
    );
    await setMode(h, "CORE_BANKING", "OUTAGE");
    await h.as("lito").post(`/cases/${id}/booking/approve`).expect(503);
    await setMode(h, "CORE_BANKING", "OK");
    await h.ds.query(
      "UPDATE applicant SET deposit_account = '' WHERE id = (SELECT applicant_id FROM loan_case WHERE id = $1)",
      [id],
    );
    const failed = (await h.as("lito").get(`/cases/${id}`).expect(200)).body as CaseDetail;
    expect(failed.status).toBe("BOOKING_FAILED");
    expect(failed.allowedActions).toContainEqual(
      expect.objectContaining({ action: "RETRY_BOOKING", enabled: false }),
    );
    const retry = await h.as("lito").post(`/cases/${id}/booking/approve`).expect(409);
    expect(retry.body.code).toBe("BOOKING_CHECKLIST_INCOMPLETE");
    expect(await writesFor(id)).toMatchObject({ status: "BOOKING_FAILED" });
  });

  it("BK-1 a retry refused by the checklist after a lost core reply leaves core's account undisbursed and lending untouched", async () => {
    const id = await readyToBook();
    await h.as("marco").post(`/cases/${id}/booking`).expect(200);
    const coreAccounts = () => count(h.ds, "SELECT count(*) AS n FROM sim.core_account");
    const before = await coreAccounts();

    // Core opens the account, then the reply is lost: the booking fails, nothing in lending.
    await setMode(h, "CORE_BANKING", "LOST_REPLY");
    await h.as("lito").post(`/cases/${id}/booking/approve`).expect(503);
    await setMode(h, "CORE_BANKING", "OK");
    expect(await coreAccounts()).toBe(before + 1);

    await h.ds.query(
      "UPDATE applicant SET deposit_account = '' WHERE id = (SELECT applicant_id FROM loan_case WHERE id = $1)",
      [id],
    );
    const retry = await h.as("lito").post(`/cases/${id}/booking/approve`).expect(409);
    expect(retry.body.code).toBe("BOOKING_CHECKLIST_INCOMPLETE");

    // Still one core account (open, undisbursed); no loan account and no payment in lending.
    expect(await coreAccounts()).toBe(before + 1);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM loan_account WHERE case_id = $1", [id]),
    ).toBe(0);
    expect(await count(h.ds, "SELECT count(*) AS n FROM sim.disbursement")).toBe(
      await count(h.ds, "SELECT count(*) AS n FROM disbursement"),
    );
    expect(await writesFor(id)).toMatchObject({ status: "BOOKING_FAILED", bookings: 1 });
  });

  it("BK-1 is not shown before the booking step", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    expect(c.status).toBe("REVIEW");
    expect(c.bookingChecklist).toBeNull();
  });
});

const quote = (query: string, persona: "paolo" | "rina" | "marco" | "diane" = "paolo") =>
  h.as(persona).get(`/products/PL/quote?${query}`);

describe("indicative repayment (IR-1, PRD INT-004)", () => {
  it("IR-1 quotes the requested terms at grade C pricing, from simulated core, to the centavo", async () => {
    const before = await count(h.ds, "SELECT count(*) AS n FROM sim.core_account");
    const res = await quote("amount=100000.00&tenorMonths=36").expect(200);
    // 100,000 × 1.60% × 36 = 57,600; 157,600 ÷ 36 = 4,377.77…; the last absorbs the remainder.
    expect(res.body).toEqual({
      status: "QUOTED",
      amount: "100000.00",
      tenorMonths: 36,
      grade: "C",
      monthlyRate: "0.0160",
      regularInstalment: "4377.77",
      finalInstalment: "4378.05",
      totalRepayable: "157600.00",
      providerMode: "SIMULATED",
    } satisfies IndicativeRepaymentView);
    expect(await count(h.ds, "SELECT count(*) AS n FROM sim.core_account")).toBe(before);
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED", "LOST_REPLY"])(
    "IR-1 with core banking in %s the quote is UNAVAILABLE (200), never an error",
    async (mode) => {
      await setMode(h, "CORE_BANKING", mode);
      const res = await quote("amount=150000&tenorMonths=24").expect(200);
      expect(res.body).toEqual({
        status: "UNAVAILABLE",
        amount: "150000.00",
        tenorMonths: 24,
        grade: "C",
        monthlyRate: "0.0160",
        regularInstalment: null,
        finalInstalment: null,
        totalRepayable: null,
        providerMode: null,
      });
    },
  );

  it.each([
    ["an amount below the product", "amount=19999.99&tenorMonths=24", "amount"],
    ["an amount above the product", "amount=500000.01&tenorMonths=24", "amount"],
    ["a tenor outside 6–36", "amount=150000.00&tenorMonths=37", "tenorMonths"],
    // @IsDecimal lets these through; Money cannot read them: a field error, never a 500.
    ["a bare decimal point", "amount=.&tenorMonths=24", "amount"],
    ["a plus-signed amount", "amount=%2B150000&tenorMonths=24", "amount"],
    ["a minus and a point", "amount=-.&tenorMonths=24", "amount"],
    ["a 30-digit whole part", `amount=${"9".repeat(30)}&tenorMonths=24`, "amount"],
  ])("IR-1 refuses %s with a field error (400)", async (_label, query, field) => {
    const res = await quote(query).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual([field]);
  });

  it.each([
    ["a non-decimal amount", "amount=1e5&tenorMonths=24"],
    ["a fractional tenor", "amount=150000.00&tenorMonths=12.5"],
    ["missing terms", ""],
    ["an unknown parameter", "amount=150000.00&tenorMonths=24&grade=A"],
  ])("IR-1 refuses %s (400)", async (_label, query) => {
    const res = await quote(query).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("IR-1 only the loan officer, who captures applications, may ask; no session is 401", async () => {
    for (const persona of ["rina", "marco", "diane"] as const) {
      const res = await quote("amount=150000.00&tenorMonths=24", persona).expect(403);
      expect(res.body.code).toBe("FORBIDDEN_ROLE");
    }
    await h.anonymous().get("/products/PL/quote?amount=150000.00&tenorMonths=24").expect(401);
  });

  it("IR-1 a draft carries it before the decision, unavailable when core is down; a decided case does not", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    const draft = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId,
          amount: "150000.00",
          tenorMonths: 24,
          purpose: "Home improvement",
          submit: false,
          consent: FULL_CONSENT,
        })
        .expect(201)
    ).body as CaseDetail;
    // 150,000 × 1.60% × 24 = 57,600; 207,600 ÷ 24 = 8,650.00.
    expect(draft.indicativeRepayment).toMatchObject({
      status: "QUOTED",
      grade: "C",
      regularInstalment: "8650.00",
      providerMode: "SIMULATED",
    });

    await setMode(h, "CORE_BANKING", "OUTAGE");
    const down = (await h.as("paolo").get(`/cases/${draft.id}`).expect(200)).body as CaseDetail;
    expect(down.indicativeRepayment).toMatchObject({
      status: "UNAVAILABLE",
      regularInstalment: null,
    });
    await setMode(h, "CORE_BANKING", "OK");

    const decided = (await h.as("paolo").post(`/cases/${draft.id}/submit`).expect(200))
      .body as CaseDetail;
    expect(decided.status).toBe("OFFER");
    expect(decided.indicativeRepayment).toBeNull();
    // Approved at grade A: the offer's own instalment, quoted by core (F1-4 terms at 1.20%).
    expect(decided.approved?.regularInstalment).toBe("8050.00");
  });

  it("IR-1 an approved case still opens while core is down: its instalment is null", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "150000.00",
      tenorMonths: 24,
    });
    await setMode(h, "CORE_BANKING", "OUTAGE");
    const down = (await h.as("marco").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(down.approved).toMatchObject({ amount: "150000.00", regularInstalment: null });
  });
});
