import type { ActivityView, CaseDetail, DecisionRecordView, LoanAccountView } from "@loan/core";
import { count, type Harness, readyForChecker, startHarness, submitCase } from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe("F1 — Maria Santos, auto-approved ₱150,000 over 24 months", () => {
  let c: CaseDetail;

  it("F1-1 decides Auto-approve, score 742, grade A, with no referral trigger", async () => {
    c = await submitCase(h, { applicantId: "APL-MARIA", amount: "150000.00", tenorMonths: 24 });
    expect(c.status).toBe("OFFER");
    expect(c.outcome).toBe("AUTO_APPROVE");
    expect(c.decision).toMatchObject({ score: 742, grade: "A", referralTriggers: [] });
    expect(c.approved).toMatchObject({
      amount: "150000.00",
      tenorMonths: 24,
      monthlyRate: "0.0120",
      regularInstalment: "8050.00",
    });
  });

  it("F1-2 stores a decision record that reproduces exactly", async () => {
    const record = (await h.as("paolo").get(`/cases/${c.id}/decision`).expect(200))
      .body as DecisionRecordView;
    expect(record).toMatchObject({
      ruleSetVersion: "RS-PL-3",
      scorecardVersion: "SC-PL-2",
      // AIS-001: the grade A PD and the affordable amount (her ₱150,000 request).
      pd: "0.0080",
      recommendedAmount: "150000.00",
      providerMode: "SIMULATED",
      outcome: "AUTO_APPROVE",
      automationMode: "LIVE",
      killSwitch: false,
      engineOutcome: "AUTO_APPROVE",
    });
    expect(record.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    // No separate income declaration, so the income-mismatch rule is not evaluated.
    expect(
      record.ruleResults.filter((r) => r.result !== "PASS").map((r) => [r.id, r.result]),
    ).toEqual([["RF-INCOME", "NOT_EVALUATED"]]);
    const replay = await h.as("diane").post(`/decisions/${record.id}/reproduce`).expect(200);
    expect(replay.body).toEqual({
      decisionId: record.id,
      match: true,
      differences: [],
      inputsHashMatches: true,
    });
  });

  it("F1-3 moves to Booking when loan operations records the borrower's e-signature", async () => {
    const res = await h.as("marco").post(`/cases/${c.id}/sign`).expect(200);
    expect(res.body).toMatchObject({
      status: "BOOKING",
      signatureEnvelopeId: expect.stringMatching(/^ENV-/),
    });
  });

  it("F1-4 books through maker and checker: one account, a reconciled 24-line schedule, one disbursement", async () => {
    const maker = await h.as("marco").post(`/cases/${c.id}/booking`).expect(200);
    expect(maker.body).toMatchObject({
      status: "PENDING_CHECKER",
      booking: { status: "PENDING", makerId: "STF-MARCO" },
    });
    const checked = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
    expect(checked.body).toMatchObject({
      status: "DISBURSED",
      booking: { status: "BOOKED", checkerId: "STF-ELLA", attempts: 1 },
    });

    const account = (await h.as("ella").get(`/cases/${c.id}/loan-account`).expect(200))
      .body as LoanAccountView;
    expect(account).toMatchObject({
      principal: "150000.00",
      interest: "43200.00",
      totalRepayable: "193200.00",
      tenorMonths: 24,
      reconciled: true,
    });
    expect(account.schedule).toHaveLength(24);
    expect(account.schedule.every((l) => l.amount === "8050.00")).toBe(true);
    expect(account.disbursement).toMatchObject({
      amount: "150000.00",
      destinationAccount: "WB-SAV-0021-4410",
    });
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM loan_account WHERE case_id = $1", [c.id]),
    ).toBe(1);
  });

  it("F1-5 records who did what and when, in order, for every step", async () => {
    const events = (await h.as("diane").get(`/cases/${c.id}/activity`).expect(200))
      .body as ActivityView[];
    expect(events.map((e) => [e.actorName, e.action, e.toStatus])).toEqual([
      ["Paolo Tan", "CASE_CREATED", "DRAFT"],
      ["Paolo Tan", "CONSENT_RECORDED", null],
      ["Paolo Tan", "CASE_SUBMITTED", null],
      ["Decision engine", "DECISION_MADE", "OFFER"],
      ["Marco Bautista", "SIGNED", "BOOKING"],
      ["Marco Bautista", "BOOKING_SUBMITTED", "PENDING_CHECKER"],
      ["Ella Reyes", "BOOKING_APPROVED", "DISBURSED"],
    ]);
    expect(events.every((e) => !Number.isNaN(Date.parse(e.createdAt)))).toBe(true);
  });
});

describe("F2 — Joel Reyes, referred thin file, counter-offer ₱120,000 over 36 months", () => {
  let c: CaseDetail;

  it("F2-1 refers with score 612, grade C, reasons thin file and score band", async () => {
    c = await submitCase(h, { applicantId: "APL-JOEL", amount: "200000.00", tenorMonths: 36 });
    expect(c).toMatchObject({ status: "REVIEW", outcome: "REFER", grade: "C" });
    expect(c.decision?.score).toBe(612);
    expect(c.decision?.reasonCodes.map((r) => r.code)).toEqual(["R01", "R06"]);
  });

  it("F2-2 shows the officer the applicant, every rule result, the score, reasons and the trigger", async () => {
    const view = (await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(view.applicant).toMatchObject({
      fullName: "Joel Reyes",
      monthlyIncome: "56000.00",
      relationshipMonths: 0,
    });
    expect(view.decision?.ruleResults.map((r) => r.id)).toEqual([
      "KO-AGE",
      "KO-SANCTIONS",
      "KO-KYC",
      "KO-DEFAULT",
      "RF-AMOUNT",
      "RF-DTI",
      "RF-INCOME",
      "RF-RELATED",
      "RF-FRAUD",
      "RF-FILE",
      "SC-BAND",
      "AU-MODE",
    ]);
    expect(view.decision?.referralTriggers).toEqual([
      "Thin bureau file: too little credit history to score with confidence",
      "Score in the referral band",
    ]);
    expect(view.allowedActions).toContainEqual({ action: "RECOMMEND", enabled: true });
  });

  it("F2-3 refuses a counter-offer without a reason code, and changes nothing", async () => {
    const res = await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "COUNTER_OFFER",
        amount: "120000.00",
        tenorMonths: 36,
        rationale: "Thin file",
      })
      .expect(400);
    expect(res.body).toMatchObject({
      code: "OVERRIDE_REASON_REQUIRED",
      errors: [{ field: "overrideReason" }],
    });
    expect((await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body.status).toBe("REVIEW");
  });

  it("F2-4 records the counter-offer as an override with its reason and rationale", async () => {
    const res = await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "COUNTER_OFFER",
        amount: "120000.00",
        tenorMonths: 36,
        overrideReason: "OV04",
        rationale: "Thin file: a smaller amount reduces exposure.",
      })
      .expect(200);
    expect(res.body).toMatchObject({
      status: "APPROVAL",
      recommendation: {
        type: "COUNTER_OFFER",
        amount: "120000.00",
        tenorMonths: 36,
        isOverride: true,
        overrideReason: "OV04",
        byName: "Paolo Tan",
      },
    });
  });

  it("F2-5 is approved by Rina within her ₱1,000,000 grades A–C authority, on the counter-offer terms", async () => {
    const res = await h.as("rina").post(`/cases/${c.id}/approve`).expect(200);
    expect(res.body).toMatchObject({
      status: "OFFER",
      approved: {
        by: "STF-RINA",
        amount: "120000.00",
        tenorMonths: 36,
        monthlyRate: "0.0160",
        regularInstalment: "5253.33",
      },
    });
  });

  it("F2-6 books ₱120,000 with a reconciled 36-line schedule and one disbursement", async () => {
    await readyForChecker(h, c.id);
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
    const account = (await h.as("ella").get(`/cases/${c.id}/loan-account`).expect(200))
      .body as LoanAccountView;
    expect(account).toMatchObject({
      principal: "120000.00",
      interest: "69120.00",
      totalRepayable: "189120.00",
      reconciled: true,
    });
    expect(account.schedule).toHaveLength(36);
    expect(account.schedule[0]?.amount).toBe("5253.33");
    expect(account.schedule[35]?.amount).toBe("5253.45");
    expect(account.disbursement?.amount).toBe("120000.00");
  });
});
