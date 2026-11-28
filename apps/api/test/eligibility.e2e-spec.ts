import type { EligibilityPreCheckView } from "@loan/core";
import { count, type Harness, setMode, startHarness } from "./support/harness";

/**
 * The eligibility pre-check through the API (PRD PC-008; ACCEPTANCE EL-1, EL-2): the loan
 * officer checks stated figures before any application. No provider is called and nothing is
 * stored, so it needs no consent and works while the providers are down.
 */
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

const body = {
  amount: "150000.00",
  tenorMonths: 24,
  ageYears: 31,
  monthlyIncome: "78000.00",
  monthlyObligations: "9000.00",
};

const stored = async () => ({
  decisions: await count(h.ds, "SELECT count(*) AS n FROM decision_record"),
  cases: await count(h.ds, "SELECT count(*) AS n FROM loan_case"),
  calls: await count(h.ds, "SELECT count(*) AS n FROM provider_call"),
  events: await count(h.ds, "SELECT count(*) AS n FROM activity_event"),
});

describe("EL-2 the pre-check answers from stated figures and the current rule set, and stores nothing", () => {
  it("Maria's figures are likely eligible, with the rate range and affordable amounts", async () => {
    const before = await stored();
    const res = await h.as("paolo").post("/eligibility/pre-check", body).expect(200);
    const view = res.body as EligibilityPreCheckView;
    expect(view).toMatchObject({
      productCode: "PL",
      ruleSetVersion: "RS-PL-4",
      outcome: "LIKELY_ELIGIBLE",
      monthlyRateRange: { from: "0.0120", to: "0.0200" },
      affordable: { atBestRate: "150000.00", atWorstRate: "150000.00" },
    });
    expect(view.caveat).toMatch(/not a decision or an offer/);
    expect(view.checks.map((c) => c.id)).toEqual(["PC-AGE", "PC-DTI", "PC-AMOUNT", "PC-AFFORD"]);
    expect(await stored()).toEqual(before);
  });

  it("calls no provider: it answers while the bureau, screening and fraud check are all down", async () => {
    for (const service of ["CREDIT_BUREAU", "KYC_AML", "FRAUD"]) {
      await setMode(h, service, "OUTAGE");
    }
    const before = await stored();
    const view = (
      await h
        .as("paolo")
        .post("/eligibility/pre-check", { ...body, ageYears: 70 })
        .expect(200)
    ).body as EligibilityPreCheckView;
    expect(view.outcome).toBe("NOT_ELIGIBLE");
    expect(view.checks.find((c) => c.id === "PC-AGE")?.result).toBe("FAIL");
    expect(await stored()).toEqual(before);
  });

  it("accepts the tenor at each product limit and refuses one month past it", async () => {
    for (const tenorMonths of [6, 36]) {
      await h
        .as("paolo")
        .post("/eligibility/pre-check", { ...body, tenorMonths })
        .expect(200);
    }
    for (const tenorMonths of [5, 37]) {
      const res = await h
        .as("paolo")
        .post("/eligibility/pre-check", { ...body, tenorMonths })
        .expect(400);
      expect((res.body.errors as { field: string }[]).map((e) => e.field)).toContain("tenorMonths");
    }
  });

  it("refuses terms outside the product and unreadable figures, field by field", async () => {
    const before = await stored();
    const res = await h
      .as("paolo")
      .post("/eligibility/pre-check", { ...body, amount: "10000.00", monthlyIncome: "-5.00" })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    const fields = (res.body.errors as { field: string }[]).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["amount", "monthlyIncome"]));
    await h
      .as("paolo")
      .post("/eligibility/pre-check", { ...body, tenorMonths: 3 })
      .expect(400);
    await h
      .as("paolo")
      .post("/eligibility/pre-check", { ...body, fullName: "x" })
      .expect(400);
    expect(await stored()).toEqual(before);
  });

  it("is for the loan officer only", async () => {
    const before = await stored();
    for (const persona of ["rina", "marco", "diane", "leo"] as const) {
      await h.as(persona).post("/eligibility/pre-check", body).expect(403);
    }
    await h.anonymous().post("/eligibility/pre-check").send(body).expect(401);
    expect(await stored()).toEqual(before);
  });
});
