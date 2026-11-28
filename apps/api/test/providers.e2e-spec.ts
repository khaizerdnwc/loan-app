import { ProvidersRepository } from "@loan/base";
import { CREDIT_BUREAU, type CreditBureau, ProviderUnavailableError } from "@loan/contracts";
import type {
  CaseDetail,
  DecisionLatencyView,
  DecisionRecordView,
  ProviderUsageView,
} from "@loan/core";
import { count, type Harness, setMode, startHarness, submitCase, twin } from "./support/harness";

/**
 * Provider resilience and cost (PRD IH-003, IH-005, IH-006; ACCEPTANCE PR-1..PR-4) and
 * decision latency (NFR-003, PR-5). The test environment uses a 5 ms backoff base and a
 * 300 ms open circuit (support/env.ts); three attempts per call and a threshold of five failed
 * calls are the defaults. The circuit lives in this app's memory: the breaker test runs last.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await h.ds.query("TRUNCATE sim.service_mode");
});

interface CallRow {
  service: string;
  outcome: string;
  failure: string | null;
  attempt: number;
  cost: string;
}

const calls = async (caseId: string): Promise<CallRow[]> =>
  (await h.ds.query(
    `SELECT service, outcome, failure, attempt, cost::text AS cost FROM provider_call
     WHERE case_id = $1 ORDER BY service, attempt, outcome`,
    [caseId],
  )) as CallRow[];

const decisionOf = async (c: CaseDetail) =>
  (await h.as("paolo").get(`/cases/${c.id}/decision`).expect(200)).body as DecisionRecordView;

const usage = async (persona: "leo" | "diane" = "leo") =>
  (await h.as(persona).get("/providers/usage").expect(200)).body as ProviderUsageView;

const bureauRows = async (caseId: string) =>
  (await calls(caseId)).filter((r) => r.service === "CREDIT_BUREAU");

describe("PR-1 retry with backoff: a failing provider is tried again; still down, the case refers", () => {
  it("a bureau timeout on the first try is retried and the case is decided on the second", async () => {
    const bureau = h.app.get<CreditBureau>(CREDIT_BUREAU);
    const real = bureau.pull.bind(bureau);
    jest
      .spyOn(bureau, "pull")
      .mockRejectedValueOnce(
        new ProviderUnavailableError("CREDIT_BUREAU", "TIMEOUT", "simulated timeout"),
      )
      .mockImplementation(real);
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("OFFER");
    expect(await bureauRows(c.id)).toEqual([
      { service: "CREDIT_BUREAU", outcome: "FAILED", failure: "TIMEOUT", attempt: 1, cost: "0.00" },
      { service: "CREDIT_BUREAU", outcome: "OK", failure: null, attempt: 2, cost: "25.00" },
    ]);
  });

  it("a bureau in outage is tried three times, then the case is referred (R10), never declined", async () => {
    await setMode(h, "CREDIT_BUREAU", "OUTAGE");
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("REVIEW");
    expect((await decisionOf(c)).reasonCodes.map((r) => r.code)).toEqual(["R10"]);
    const bureau = await bureauRows(c.id);
    expect(bureau.map((r) => [r.attempt, r.outcome, r.cost])).toEqual([
      [1, "FAILED", "0.00"],
      [2, "FAILED", "0.00"],
      [3, "FAILED", "0.00"],
    ]);
    // The other providers answered once each and are charged.
    expect((await calls(c.id)).filter((r) => r.service !== "CREDIT_BUREAU")).toEqual([
      { service: "FRAUD", outcome: "OK", failure: null, attempt: 1, cost: "5.00" },
      { service: "KYC_AML", outcome: "OK", failure: null, attempt: 1, cost: "10.00" },
    ]);
  });
});

describe("PR-2 bureau reuse: a report pulled in the last 30 days is reused, not pulled and charged again", () => {
  it("reuses the report for the same applicant (even while the bureau is down), and pulls again after 30 days", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    const first = await submitCase(h, { applicantId }, { sameApplicant: true });
    expect(first.status).toBe("OFFER");
    expect((await bureauRows(first.id)).map((r) => r.outcome)).toEqual(["OK"]);
    await h
      .as("paolo")
      .post(`/cases/${first.id}/withdraw`, { reasonCode: "NOT_PROCEEDING" })
      .expect(200);

    await setMode(h, "CREDIT_BUREAU", "OUTAGE");
    const second = await submitCase(h, { applicantId }, { sameApplicant: true });
    expect(second.status).toBe("OFFER");
    expect(await bureauRows(second.id)).toEqual([
      { service: "CREDIT_BUREAU", outcome: "CACHE_HIT", failure: null, attempt: 0, cost: "0.00" },
    ]);
    const inputs = (await decisionOf(second)).inputs as { bureau: { fromCache: boolean } };
    expect(inputs.bureau.fromCache).toBe(true);

    // Older than the window: the bureau is asked again (and, still down, the case refers).
    await h
      .as("paolo")
      .post(`/cases/${second.id}/withdraw`, { reasonCode: "NOT_PROCEEDING" })
      .expect(200);
    await h.ds.query(
      "UPDATE bureau_report_cache SET retrieved_at = now() - interval '31 days' WHERE applicant_id = $1",
      [applicantId],
    );
    const third = await submitCase(h, { applicantId }, { sameApplicant: true });
    expect(third.status).toBe("REVIEW");
    expect((await bureauRows(third.id)).map((r) => r.outcome)).toEqual([
      "FAILED",
      "FAILED",
      "FAILED",
    ]);
  });
});

describe("PR-2 a stored report is only reused for the same applicant, provider mode and with consent", () => {
  const cacheFor = async (applicantId: string, mode: string) => {
    await h.ds.query(
      `INSERT INTO bureau_report_cache (applicant_id, mode, report, retrieved_at)
       SELECT $1::text, $2::text, jsonb_build_object('provider', 'Credit bureau', 'mode', $2::text) || bureau, now()
       FROM sim.persona_profile WHERE applicant_id = 'APL-MARIA'`,
      [applicantId, mode],
    );
  };

  it("a report from a provider in another mode is not reused: the bureau is asked (down, so the case refers)", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    await cacheFor(applicantId, "REAL");
    await setMode(h, "CREDIT_BUREAU", "OUTAGE");
    const c = await submitCase(h, { applicantId }, { sameApplicant: true });
    expect(c.status).toBe("REVIEW");
    expect((await bureauRows(c.id)).map((r) => r.outcome)).toEqual(["FAILED", "FAILED", "FAILED"]);
  });

  it("another applicant's report is never used", async () => {
    const first = await twin(h, "APL-MARIA");
    await cacheFor(first, "SIMULATED");
    const other = await submitCase(h, { applicantId: "APL-MARIA" });
    expect((await bureauRows(other.id)).map((r) => r.outcome)).toEqual(["OK"]);
  });

  it("without complete consent nothing is read: no reuse row, no provider call, no decision", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    await cacheFor(applicantId, "SIMULATED");
    const draft = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId,
          amount: "150000.00",
          tenorMonths: 24,
          purpose: "Home improvement",
          submit: false,
        })
        .expect(201)
    ).body as CaseDetail;
    const refused = await h.as("paolo").post(`/cases/${draft.id}/submit`).expect(400);
    expect(refused.body.code).toBe("VALIDATION_FAILED");
    expect(await calls(draft.id)).toEqual([]);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM decision_record WHERE case_id = $1", [draft.id]),
    ).toBe(0);
  });

  it("two pulls stored at once for one applicant both succeed and keep the newer report", async () => {
    const repo = h.app.get(ProvidersRepository);
    const applicantId = await twin(h, "APL-MARIA");
    const older = new Date("2026-11-01T00:00:00.000Z");
    const newer = new Date("2026-11-02T00:00:00.000Z");
    await Promise.all([
      repo.cacheReport({
        applicantId,
        mode: "SIMULATED",
        report: { v: "newer" },
        retrievedAt: newer,
      }),
      repo.cacheReport({
        applicantId,
        mode: "SIMULATED",
        report: { v: "older" },
        retrievedAt: older,
      }),
    ]);
    const rows = (await h.ds.query(
      "SELECT report->>'v' AS v FROM bureau_report_cache WHERE applicant_id = $1",
      [applicantId],
    )) as { v: string }[];
    expect(rows).toEqual([{ v: "newer" }]);
  });
});

describe("PR-4 usage and cost, PR-5 latency: read by administrators and compliance only", () => {
  it("counts attempts, failures, cache hits and simulated cost per service", async () => {
    const before = await usage();
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("OFFER");
    const after = await usage("diane");
    const bureau = (u: ProviderUsageView) => u.services.find((s) => s.service === "CREDIT_BUREAU");
    expect(bureau(after)?.ok).toBe((bureau(before)?.ok ?? 0) + 1);
    expect(after.services.map((s) => s.service)).toEqual([
      "CREDIT_BUREAU",
      "KYC_AML",
      "FRAUD",
      "EXTERNAL_DECISION",
    ]);
    // One bureau pull (25), one screening (10), one fraud check (5).
    expect(Math.round((Number(after.totalCost) - Number(before.totalCost)) * 100)).toBe(4000);
  });

  it("reports decision latency against the 60-second target; every new record carries its own", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    const d = await decisionOf(c);
    expect(d.latencyMs).toEqual(expect.any(Number));
    expect(d.latencyMs).toBeGreaterThanOrEqual(0);
    const l = (await h.as("diane").get("/decisions/latency").expect(200))
      .body as DecisionLatencyView;
    expect(l.decisions).toBeGreaterThan(0);
    expect(l.targetP95Ms).toBe(60_000);
    expect(l.p95Ms).toEqual(expect.any(Number));
    expect(l.p95Ms ?? Number.POSITIVE_INFINITY).toBeLessThan(l.targetP95Ms);
  });

  it("refuses other roles and a bad window", async () => {
    for (const persona of ["paolo", "rina", "marco"] as const) {
      await h.as(persona).get("/providers/usage").expect(403);
      await h.as(persona).get("/decisions/latency").expect(403);
    }
    const bad = await h.as("leo").get("/providers/usage?days=0").expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
  });
});

describe("PR-3 circuit breaker: after five failed calls the bureau is not called for a while; then one trial", () => {
  beforeAll(async () => {
    // The circuit lives in this app's memory: earlier tests must have left it closed.
    const bureau = (await usage()).services.find((s) => s.service === "CREDIT_BUREAU");
    expect(bureau?.circuit).toEqual({ state: "CLOSED", consecutiveFailures: 0, openUntil: null });
  });

  it("opens, refuses at once (still a referral), then closes after a successful trial", async () => {
    await setMode(h, "CREDIT_BUREAU", "OUTAGE");
    for (let i = 0; i < 5; i++) {
      const c = await submitCase(h, { applicantId: "APL-MARIA" });
      expect(c.status).toBe("REVIEW");
    }
    const open = (await usage()).services.find((s) => s.service === "CREDIT_BUREAU");
    expect(open?.circuit).toMatchObject({ state: "OPEN", consecutiveFailures: 5 });

    const refused = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(refused.status).toBe("REVIEW");
    expect((await decisionOf(refused)).reasonCodes.map((r) => r.code)).toEqual(["R10"]);
    expect(await bureauRows(refused.id)).toEqual([
      {
        service: "CREDIT_BUREAU",
        outcome: "SHORT_CIRCUITED",
        failure: null,
        attempt: 0,
        cost: "0.00",
      },
    ]);

    await setMode(h, "CREDIT_BUREAU", "OK");
    await new Promise((resolve) => setTimeout(resolve, 350));
    const halfOpen = (await usage()).services.find((s) => s.service === "CREDIT_BUREAU");
    expect(halfOpen?.circuit.state).toBe("HALF_OPEN");
    const trial = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(trial.status).toBe("OFFER");
    const closed = (await usage()).services.find((s) => s.service === "CREDIT_BUREAU");
    expect(closed?.circuit).toEqual({ state: "CLOSED", consecutiveFailures: 0, openUntil: null });
  });
});
